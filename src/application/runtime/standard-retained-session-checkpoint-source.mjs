import path from 'node:path';
import { createAgenticProcessStore } from '../../adapters/runtime/agentic-process-store.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { createProcessDispatchRecordStore } from '../../adapters/runtime/process-dispatch-record-store.mjs';
import { createNativeAllocationJournalStore } from '../../adapters/runtime/native-allocation-journal-store.mjs';
import { createSessionCloseRecoveryStore } from '../../adapters/runtime/standard-session-close-recovery-store.mjs';
import { createStandardHostAuthority } from '../../adapters/runtime/standard-host-authority.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { nativeJournalId } from '../../core/workflow/native-allocation-journal.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { assertRetainedSessionCheckpointEntry, assertRetainedSessionCheckpointProof } from '../../core/workflow/standard-retained-session-checkpoint.mjs';
import { assertSessionCloseRecoveryRecord, assertSessionCloseCheckpointOnly } from '../../core/workflow/standard-session-close-recovery.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { createRetainedSessionClosureSource } from './standard-retained-session-closure-source.mjs';
import { readSessionCloseObjectiveCompletion } from './session-close-objective-completion.mjs';

const require = (ok, code = 'STANDARD_RETAINED_SESSION_CHECKPOINT_SOURCE_CHANGED') => { if (!ok) throw Object.assign(Error(code), { code }); };
// A completed checkpoint-only disposition admits a new technical continuation.
// It neither alters the old instance nor turns its UNKNOWN into a close receipt.
export function createRetainedSessionCheckpointSource({ configuration, environment, createAuthority }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options), dispatches = createProcessDispatchRecordStore(options);
  const recoveries = createSessionCloseRecoveryStore(options), natives = createNativeAllocationJournalStore(options);
  function capture(entry) {
    assertRetainedSessionCheckpointEntry(entry);
    const execution = readAgentRunFile(entry.original_configuration.path, { sha256: entry.original_configuration.sha256 }).value;
    require(execution.instance_id !== configuration.instance_id && execution.target_root === configuration.target_root
      && execution.product_root === configuration.product_root && H(execution.product_files) === H(configuration.product_files));
    require(H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ['executable', 'sha256', 'home', 'model', 'effort'].every(key => execution.native[key] === configuration.native[key]), 'STANDARD_RETAINED_SESSION_CHECKPOINT_BINDING_CHANGED');
    const roots = [configuration.control_root, configuration.review_root, configuration.native.home, ...configuration.native.protected_roots];
    require([entry.original_configuration.path, execution.control_root, execution.review_root].every(file => roots.some(root => {
      const relative = path.relative(root, file); return !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
    })), 'STANDARD_RETAINED_SESSION_CHECKPOINT_EVIDENCE_UNPROTECTED');
    const instance = instances.read(execution.instance_id).record;
    require(instance?.initial_parameters?.entry_point?.kind === 'retained_session_closure');
    const host = createStandardHostAuthority({ configuration: execution, environment }, { useProvider: false }), signer = createOperationJournalSigner(host.readKey);
    const records = instance.events.filter(row => row.kind === 'operation_intent').map(row => journals.read(row.intent.operation_id).record);
    require(H(records.map(row => row?.intent.binding_ref)) === H(['workflow_entry_select', 'session_close_record', 'session_close_checkpoint', 'session_close_finalize']), 'STANDARD_RETAINED_SESSION_CHECKPOINT_BOUNDARY_CHANGED');
    for (const row of records) {
      require(row?.phase === 'receipted' && row.results.length === 1); signer.verify(row); signer.verify(row.preview);
      const result = row.results[0];
      require(row.intent.instance_id === instance.instance_id && row.intent.scope_id === instance.scope_id && row.intent.model_sha256 === instance.model_sha256
        && row.preview.snapshot.native.configuration_sha256 === H(execution) && result.receipt.output_sha256 === H(result.output)
        && result.receipt.effect_status === result.output.effect_status
        && instance.events.some(event => event.kind === 'operation_result' && H(event.receipt) === H(result.receipt)));
    }
    const failed = records.at(-1), result = failed.results[0], recovery = recoveries.read(entry.recovery_operation_id).record;
    require(failed.operation_id === entry.recovery_operation_id && result.receipt.outcome === 'reconciliation_required'
      && result.receipt.effect_status === 'unknown' && recovery, 'STANDARD_RETAINED_SESSION_CHECKPOINT_RECOVERY_REQUIRED');
    assertSessionCloseRecoveryRecord(recovery); signer.verify(recovery);
    const capsule = dispatches.read(failed.operation_id).record, native = natives.read(nativeJournalId(instance)).record;
    require(capsule); signer.verify(capsule); if (native) signer.verify(native);
    const e = recovery.evidence;
    require(recovery.phase === 'completed' && e.instance_id === instance.instance_id && e.operation_id === failed.operation_id
      && e.instance_sha256 === instance.instance_sha256 && e.scope_id === instance.scope_id && e.model_sha256 === instance.model_sha256
      && e.journal_sha256 === H(failed) && e.records_sha256 === H(records) && e.configuration_sha256 === H(execution)
      && e.dispatch_sha256 === H(capsule) && e.native_sha256 === H(native), 'STANDARD_RETAINED_SESSION_CHECKPOINT_RECOVERY_CHANGED');
    const writer = records[1], checkpoint = records[2], plan = failed.preview.prepared.plan;
    require(plan.input.record_operation_id === writer.operation_id && plan.input.checkpoint_operation_id === checkpoint.operation_id
      && writer.results[0].receipt.outcome === 'completed' && writer.results[0].output.effect_status === 'confirmed'
      && writer.results[0].output.facts.session_close_report_recorded === true
      && checkpoint.results[0].receipt.outcome === 'completed' && checkpoint.results[0].output.effect_status === 'confirmed'
      && checkpoint.results[0].output.facts.session_close_checkpoint_completed === true
      && checkpoint.results[0].output.observations.record_operation_id === writer.operation_id);
    return { execution, instance, records, failed, recovery, capsule, native, writer, checkpoint, plan,
      pins: { configuration: H(execution), instance: H(instance), records: H(records), recovery: H(recovery), dispatch: H(capsule), native: H(native) } };
  }
  async function read(entry, { signal } = {}, fresh = false) {
    require(!signal?.aborted, 'STANDARD_RETAINED_SESSION_CHECKPOINT_CANCELLED');
    const before = capture(entry), { writer, checkpoint, plan, recovery } = before;
    const historical = await createRetainedSessionClosureSource({ configuration: before.execution, environment, createAuthority }).readRecorded(before.instance.initial_parameters.entry_point, { signal });
    require(H(historical.proof) === recovery.evidence.historical_proof_sha256
      && writer.preview.prepared.plan.decision_material_sha256 === H({ question: historical.question, decision: historical.decision }));
    const recorded = { recorded: { record: writer, output: writer.results[0].output }, plan: writer.preview.prepared.plan,
      question: historical.question, decision: historical.decision, historical };
    const source = { record_operation_id: writer.operation_id, checkpoint_operation_id: checkpoint.operation_id,
      session_id: historical.question.review.session_id, session_path: historical.question.review.session_path,
      mode: historical.question.review.mode, branch: historical.question.review.branch,
      record_plan_sha256: H(recorded.plan), record_output_sha256: H(recorded.recorded.output),
      start_output: historical.started.output, checkpoint_output: checkpoint.results[0].output };
    require(H(source) === plan.source_sha256);
    const final = historical.records.find(row => row.operation_id === historical.question.review.drift_finalization_operation_id);
    require(final);
    if (fresh) {
      require(!artifacts.ownerPending(), 'STANDARD_RETAINED_SESSION_CHECKPOINT_OWNER_UNSETTLED');
      const events = readAgentRunFile(path.join(artifacts.root, '.aidn/runtime/perf/workflow-events.ndjson'), { json: false, maxBytes: 4194304 });
      const run = readAgentRunFile(path.join(artifacts.root, '.aidn/runtime/perf/current-run-id.txt'), { json: false, maxBytes: 256 });
      assertSessionCloseCheckpointOnly({ plan, events, run });
      require(events.sha256 === recovery.evidence.events_sha256 && run.sha256 === recovery.evidence.run_file_sha256
        && H(plan.documents) === recovery.evidence.documents_sha256);
      for (const row of plan.documents) require(artifacts.read(row.path, { required: true }).sha256 === row.sha256
        && artifacts.metadataHash(row.path) === row.metadata_sha256, 'STANDARD_RETAINED_SESSION_CHECKPOINT_PREIMAGE_CHANGED');
      readSessionCloseObjectiveCompletion({ artifacts, recorded, finalization: { record: final, output: final.results[0].output } });
    }
    const proof = assertRetainedSessionCheckpointProof({ original_instance_id: before.instance.instance_id, original_instance_sha256: before.instance.instance_sha256,
      original_configuration_sha256: H(before.execution), journals_sha256: H(before.records), native_journal_sha256: H(before.native), session_id: source.session_id,
      recovery_sha256: H(recovery), dispatch_sha256: H(before.capsule), closure_proof_sha256: H(historical.proof),
      recovery_operation_id: entry.recovery_operation_id, record_operation_id: writer.operation_id, checkpoint_operation_id: checkpoint.operation_id });
    require(!signal?.aborted && H(capture(entry).pins) === H(before.pins));
    return { proof, recorded, source, historical, instance: before.instance, records: before.records,
      checkpoint: { record: checkpoint, output: checkpoint.results[0].output }, finalization: { record: final, output: final.results[0].output } };
  }
  return Object.freeze({ inspect: (entry, options) => read(entry, options, true), readRecorded: (entry, options) => read(entry, options) });
}
