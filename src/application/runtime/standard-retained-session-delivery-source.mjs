import path from 'node:path';
import fs from 'node:fs';
import { createAgenticProcessStore } from '../../adapters/runtime/agentic-process-store.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { createNativeAllocationJournalStore } from '../../adapters/runtime/native-allocation-journal-store.mjs';
import { createStandardHostAuthority } from '../../adapters/runtime/standard-host-authority.mjs';
import { createLocalWorkflowGitCheckpoint } from '../../adapters/runtime/local-workflow-git-checkpoint.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { nativeJournalId } from '../../core/workflow/native-allocation-journal.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { assertRetainedSessionDeliveryEntry, assertRetainedSessionDeliveryProof } from '../../core/workflow/standard-retained-session-delivery.mjs';
import { retainedSessionCheckpointContinuation } from '../../core/workflow/standard-retained-session-checkpoint.mjs';
import { sessionClosePaths } from '../../core/workflow/standard-session-close-render.mjs';
import { analyzeStructuredArtifact } from '../../lib/workflow/structured-artifact-parser-lib.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { createProjectArtifactStore } from './project-artifact-store-service.mjs';
import { createRetainedSessionCheckpointSource } from './standard-retained-session-checkpoint-source.mjs';
import { readSessionDeliveryPostimages } from './session-delivery-postimages.mjs';
import { admitSessionDeliveryMetadata } from './session-delivery-metadata-admission.mjs';

const require = (ok, code = 'STANDARD_RETAINED_SESSION_DELIVERY_SOURCE_CHANGED') => { if (!ok) throw Object.assign(Error(code), { code }); };
// Continue one accepted close after a retained-checkpoint recovery. No historical
// receipt or business artifact is rewritten, and the close hook is not replayed.
export function createRetainedSessionDeliverySource({ configuration, environment, createAuthority }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options), natives = createNativeAllocationJournalStore(options);
  function capture(entry) {
    assertRetainedSessionDeliveryEntry(entry);
    const execution = readAgentRunFile(entry.original_configuration.path, { sha256: entry.original_configuration.sha256 }).value;
    require(execution.instance_id !== configuration.instance_id && execution.target_root === configuration.target_root
      && execution.product_root === configuration.product_root && H(execution.product_files) === H(configuration.product_files));
    require(H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ['executable', 'sha256', 'home', 'model', 'effort'].every(key => execution.native[key] === configuration.native[key]), 'STANDARD_RETAINED_SESSION_DELIVERY_BINDING_CHANGED');
    const roots = [configuration.control_root, configuration.review_root, configuration.native.home, ...configuration.native.protected_roots];
    require([entry.original_configuration.path, execution.control_root, execution.review_root].every(file => roots.some(root => {
      const relative = path.relative(root, file); return !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
    })), 'STANDARD_RETAINED_SESSION_DELIVERY_EVIDENCE_UNPROTECTED');
    const instance = instances.read(execution.instance_id).record;
    require(instance?.initial_parameters?.entry_point?.kind === 'retained_session_checkpoint');
    const host = createStandardHostAuthority({ configuration: execution, environment }, { useProvider: false }), signer = createOperationJournalSigner(host.readKey);
    const intents = instance.events.filter(row => row.kind === 'operation_intent');
    const records = intents.map(row => journals.read(row.intent.operation_id).record);
    require(H(records.map(row => row?.intent.binding_ref)) === H(['workflow_entry_select', 'session_close_finalize']), 'STANDARD_RETAINED_SESSION_DELIVERY_BOUNDARY_CHANGED');
    for (const [i, row] of records.entries()) {
      require(row?.phase === 'receipted' && row.results.length === 1); signer.verify(row); signer.verify(row.preview);
      const result = row.results[0];
      require(H(row.intent) === H(intents[i].intent) && row.intent.instance_id === instance.instance_id && row.intent.scope_id === instance.scope_id
        && row.intent.model_sha256 === instance.model_sha256 && row.preview.snapshot.native.configuration_sha256 === H(execution)
        && result.receipt.outcome === 'completed' && result.output.outcome === 'completed'
        && result.receipt.output_sha256 === H(result.output) && result.receipt.effect_status === result.output.effect_status
        && instance.events.some(event => event.kind === 'operation_result' && H(event.receipt) === H(result.receipt)));
    }
    const finalizer = records[1], output = finalizer.results[0].output, plan = finalizer.preview.prepared.plan;
    require(records[0].results[0].output.effect_status === 'no_effect' && finalizer.operation_id === entry.finalization_operation_id
      && plan.operation_id === finalizer.operation_id && output.effect_status === 'confirmed' && output.facts.session_close_completed === true);
    const native = natives.read(nativeJournalId(instance)).record;
    require(native === null, 'STANDARD_RETAINED_SESSION_DELIVERY_NATIVE_BOUNDARY_CHANGED');
    return { execution, instance, records, finalizer, output, plan, native,
      pins: { configuration: H(execution), instance: H(instance), records: H(records), native: H(native) } };
  }
  function observe(before) {
    const { plan, output } = before, observed = output.observations, names = sessionClosePaths(plan.session_path);
    require(observed.run_id === plan.run_id && observed.event_file === '.aidn/runtime/perf/workflow-events.ndjson');
    const events = readAgentRunFile(path.join(artifacts.root, observed.event_file), { json: false, maxBytes: 4194304 });
    const bytes = events.value, offset = observed.event_offset, end = Number.isSafeInteger(offset) ? bytes.indexOf(10, offset) : -1;
    require(Number.isSafeInteger(offset) && offset >= 0 && end >= offset && (!offset || bytes[offset - 1] === 10));
    const event = JSON.parse(bytes.subarray(offset, end).toString('utf8'));
    require(H(event) === H(observed.event) && event.event === 'hook_session_close' && event.run_id === plan.run_id
      && event.result === 'ok' && event.mode === plan.mode && event.branch === plan.branch
      && bytes.toString('utf8').trimEnd().split('\n').map(JSON.parse).filter(row => row.event === 'hook_session_close' && row.run_id === plan.run_id).length === 1
      && !fs.existsSync(path.join(artifacts.root, '.aidn/runtime/perf/current-run-id.txt')), 'STANDARD_RETAINED_SESSION_DELIVERY_EVENT_CHANGED');
    const session = analyzeStructuredArtifact(artifacts.read(plan.session_path, { required: true }).content).key_values;
    const current = analyzeStructuredArtifact(artifacts.read('CURRENT-STATE.md', { required: true }).content).key_values;
    require(session.state === 'CLOSED' && session.mode === 'COMMITTING' && session.session_closure_status === 'completed'
      && current.active_session === plan.session_id && current.active_cycle === 'none' && current.session_closure_status === 'completed', 'STANDARD_RETAINED_SESSION_DELIVERY_OWNER_CHANGED');
    let postimages, metadata_basis = 'confirmed_postimages';
    if (output.contract_version === 'standard-session-close-hook-output.v1' && artifacts.describe().database) {
      const store = createProjectArtifactStore({ ...options, readOnly: true, existingOnly: true });
      try { postimages = admitSessionDeliveryMetadata({ rows: store.getArtifacts(names), plan, output }); }
      finally { store.close(); }
      metadata_basis = 'fresh_canonical_observation';
    } else postimages = readSessionDeliveryPostimages({ artifacts, plan, output });
    for (const row of postimages) require(artifacts.read(row.path, { required: true }).sha256 === row.sha256 && artifacts.metadataHash(row.path) === row.metadata_sha256);
    return { postimages, metadata_basis, events_sha256: events.sha256, backend_sha256: H(artifacts.describe()) };
  }
  async function read(entry, { signal } = {}, fresh = false) {
    require(!signal?.aborted, 'STANDARD_RETAINED_SESSION_DELIVERY_CANCELLED');
    const before = capture(entry), initial = observe(before);
    const checkpoint = await createRetainedSessionCheckpointSource({ configuration: before.execution, environment, createAuthority })
      .readRecorded(before.instance.initial_parameters.entry_point, { signal });
    require(H(before.records[0].results[0].output.observations.continuation) === H(retainedSessionCheckpointContinuation(checkpoint.proof))
      && H({ ...checkpoint.source, objective_completion: checkpoint.finalization.record.preview.prepared.plan.objective_alignment }) === before.plan.source_sha256
      && before.plan.input.record_operation_id === checkpoint.proof.record_operation_id && before.plan.input.checkpoint_operation_id === checkpoint.proof.checkpoint_operation_id);
    if (fresh) {
      require(!artifacts.ownerPending(), 'STANDARD_RETAINED_SESSION_DELIVERY_OWNER_UNSETTLED');
      const git = createLocalWorkflowGitCheckpoint({ targetRoot: artifacts.root }, { profile: 'cycle-terminal', approvedPaths: initial.postimages.map(row => 'docs/audit/' + row.path) }).inspect();
      require(git.index_clean && !git.lock_present && git.branch === before.plan.branch && git.head === before.plan.head
        && git.changes.every(row => initial.postimages.some(file => 'docs/audit/' + file.path === row.path)), 'STANDARD_RETAINED_SESSION_DELIVERY_HEAD_CHANGED');
    }
    const proof = assertRetainedSessionDeliveryProof({ original_instance_id: before.instance.instance_id, original_instance_sha256: before.instance.instance_sha256,
      original_configuration_sha256: H(before.execution), journals_sha256: H(before.records), native_journal_sha256: H(before.native), session_id: before.plan.session_id,
      finalizer_sha256: H(before.finalizer), checkpoint_proof_sha256: H(checkpoint.proof), postimages_sha256: H(initial.postimages),
      finalization_operation_id: entry.finalization_operation_id, metadata_basis: initial.metadata_basis });
    require(!signal?.aborted && H(capture(entry).pins) === H(before.pins) && H(observe(before)) === H(initial));
    return { proof, postimages: initial.postimages, checkpoint, finalizer: { record: before.finalizer, output: before.output },
      instance: before.instance, records: before.records };
  }
  return Object.freeze({ inspect: (entry, options) => read(entry, options, true), readRecorded: (entry, options) => read(entry, options) });
}
