import path from 'node:path';
import { createAgenticProcessStore } from '../../adapters/runtime/agentic-process-store.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { createProcessDecisionInboxStore } from '../../adapters/runtime/process-decision-inbox-store.mjs';
import { createStandardHostAuthority } from '../../adapters/runtime/standard-host-authority.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { assertRetainedSessionClosureEntry, assertRetainedSessionClosureProof } from '../../core/workflow/standard-retained-session-closure.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { readAgenticProductSnapshot } from './agentic-process-execution-composition.mjs';
import { createStandardHumanDecisions } from './standard-workflow-human-decisions.mjs';
import { createStandardSessionClosureAuthority } from './standard-session-closure-authority.mjs';
import { createStandardSessionClosureReview } from './standard-session-closure-review.mjs';

const require = (value, code = 'STANDARD_RETAINED_SESSION_CLOSURE_SOURCE_CHANGED') => {
  if (!value) throw Object.assign(Error(code), { code });
};
const sequence = ['workflow_entry_select', 'cycle_close_completed_select', 'drift_check_finalize', 'baseline_promotion_finalize',
  'session_preclose_checkpoint', 'session_close_admit', 'drift_report_evaluate', 'drift_check_finalize', 'session_closure_decision'];

// One unaccepted, durably receipted close decision after a settled promotion.
// Historical authentication does not execute old bindings or migrate receipts.
export function createRetainedSessionClosureSource({ configuration, environment, createAuthority }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options);
  const inbox = createProcessDecisionInboxStore(options);
  function captureConfiguration(ref) {
    const execution = readAgentRunFile(ref.path, { sha256: ref.sha256 }).value;
    require(execution.instance_id !== configuration.instance_id && execution.target_root === configuration.target_root
      && execution.product_root === configuration.product_root && H(execution.product_files) === H(configuration.product_files));
    require(H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ['executable', 'sha256', 'home', 'model', 'effort'].every(key => execution.native[key] === configuration.native[key]), 'STANDARD_RETAINED_SESSION_CLOSURE_BINDING_CHANGED');
    const roots = [configuration.control_root, configuration.review_root, configuration.native.home, ...configuration.native.protected_roots];
    require([ref.path, execution.control_root, execution.review_root].every(file => roots.some(root => {
      const relative = path.relative(root, file); return !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
    })), 'STANDARD_RETAINED_SESSION_CLOSURE_EVIDENCE_UNPROTECTED');
    const instance = instances.read(execution.instance_id).record;
    const host = createStandardHostAuthority({ configuration: execution, environment }, { useProvider: false });
    const signer = createOperationJournalSigner(host.readKey);
    const records = instance.events.filter(row => row.kind === 'operation_intent').map(row => journals.read(row.intent.operation_id).record);
    for (const row of records) { signer.verify(row); signer.verify(row.preview);
      require(row.intent.instance_id === instance.instance_id && row.intent.scope_id === instance.scope_id
        && row.preview.snapshot.native.configuration_sha256 === H(execution)); }
    return { execution, instance, host, signer, records };
  }
  function capture(entry) {
    assertRetainedSessionClosureEntry(entry);
    const origin = captureConfiguration(entry.original_configuration), start = captureConfiguration(entry.start_configuration);
    const { instance, records, signer, host } = origin, record = records.at(-1);
    require(instance.initial_parameters?.entry_point?.kind === 'retained_promotion'
      && H(records.map(row => row.intent.binding_ref)) === H(sequence)
      && record.operation_id === entry.decision_operation_id, 'STANDARD_RETAINED_SESSION_CLOSURE_BOUNDARY_CHANGED');
    for (const row of records) {
      const result = row.results[0], last = row === record;
      require(row.phase === 'receipted' && row.results.length === 1 && result.receipt.outcome === 'completed'
        && result.output.outcome === 'completed' && result.receipt.output_sha256 === H(result.output)
        && result.receipt.effect_status === result.output.effect_status
        && (last ? result.output.effect_status === 'no_effect' : ['no_effect', 'confirmed'].includes(result.output.effect_status)), 'STANDARD_RETAINED_SESSION_CLOSURE_EFFECT_UNSETTLED');
      const accepted = instance.events.some(event => event.kind === 'operation_result' && H(event.receipt) === H(result.receipt));
      require(last ? !accepted : accepted, 'STANDARD_RETAINED_SESSION_CLOSURE_BOUNDARY_CHANGED');
    }
    const human = createStandardHumanDecisions({ inbox, signer, source: host.humanSource, projectionRequired: false });
    const captured = human.captured(record), question = human.question(record);
    require(captured.phase === 'receipted' && captured.source.choice === 'close' && H(human.output(record, captured)) === H(record.results[0].output), 'STANDARD_RETAINED_SESSION_CLOSURE_DECISION_REQUIRED');
    const startRows = start.records.filter(row => row.intent.binding_ref === 'session_start_finalize');
    require(startRows.length === 1, 'STANDARD_RETAINED_SESSION_CLOSURE_START_REQUIRED');
    const started = startRows[0], result = started.results.at(-1);
    require(started.phase === 'receipted' && started.results.length === 1 && result.receipt.outcome === 'completed'
      && result.output.effect_status === 'confirmed' && result.output.facts.session_started === true
      && started.preview.input.session_id === question.review.session_id && start.instance.initial_parameters.session.session_id === question.review.session_id
      && start.instance.events.some(row => row.kind === 'operation_result' && H(row.receipt) === H(result.receipt)), 'STANDARD_RETAINED_SESSION_CLOSURE_START_REQUIRED');
    return { ...origin, start, started: { record: started, output: result.output }, human, captured, question, record,
      pins: { instance: H(instance), configuration: H(origin.execution), journals: records.map(row => H(row)), inbox: H(captured),
        start_instance: H(start.instance), start_configuration: H(start.execution), start_journals: start.records.map(row => H(row)) } };
  }
  async function read(entry, { signal } = {}, fresh = false) {
    require(!signal?.aborted, 'STANDARD_RETAINED_SESSION_CLOSURE_CANCELLED');
    if (fresh) require(!artifacts.ownerPending(), 'STANDARD_RETAINED_SESSION_CLOSURE_OWNER_UNSETTLED');
    const before = capture(entry), product = () => readAgenticProductSnapshot(configuration.product_root, configuration.product_files), productSha = H(product());
    const authorityFor = source => createAuthority({ configuration: source.execution, model: source.instance.model,
      modelSource: source.records[0].preview.snapshot.model_source, readSigningKey: source.host.readKey, humanSource: source.host.humanSource,
      readProductSnapshot: product, readProductSha256: () => H(product()), environment });
    const authority = authorityFor(before), diagnostic = authority.inspectDiagnostic(before.instance), startAuthority = authorityFor(before.start);
    const startDiagnostic = startAuthority.inspectDiagnostic(before.start.instance);
    for (const observed of [diagnostic, startDiagnostic]) require(!observed.journal || observed.journal.allocations.every(row => row.phase === 'closed' && row.tree_closed === true), 'STANDARD_RETAINED_SESSION_CLOSURE_NATIVE_UNSETTLED');
    require(diagnostic.journal?.allocations.length > 0, 'STANDARD_RETAINED_SESSION_CLOSURE_NATIVE_REQUIRED');
    await before.human.verifyCaptured(before.record, signal, { historical: true, acknowledged: true });
    const accepted = (instance, id, binding) => {
      require(instance.instance_sha256 === before.instance.instance_sha256);
      const record = before.records.find(row => row.operation_id === id);
      require(record && record !== before.record && record.intent.binding_ref === binding);
      return { record, output: record.results[0].output };
    };
    if (fresh) {
      const hook = before.started.output.observations.hook?.payload?.workflow_hook;
      const run = readAgentRunFile(path.join(artifacts.root, '.aidn/runtime/perf/current-run-id.txt'), { json: false, maxBytes: 256 });
      const startEvidence = before.started.output.evidence_refs.filter(row => row.ref === '.aidn/runtime/perf/current-run-id.txt');
      const events = readAgentRunFile(path.join(artifacts.root, '.aidn/runtime/perf/workflow-events.ndjson'), { json: false, maxBytes: 4194304 }).value;
      const rows = events.toString('utf8').trimEnd().split('\n').map(row => JSON.parse(row));
      const starts = rows.filter(row => row.event === 'hook_session_start' && row.run_id === hook?.run_id);
      require(hook?.ok === true && hook.result === 'ok' && /^[a-zA-Z0-9_-]{1,128}$/.test(hook.run_id ?? '')
        && run.value.toString('utf8') === hook.run_id + '\n' && startEvidence.length === 1 && startEvidence[0].sha256 === run.sha256
        && starts.length === 1 && starts[0].ts === hook.ts && starts[0].result === 'ok' && starts[0].skill === 'workflow-hook'
        && starts[0].branch === hook.branch && starts[0].mode === before.question.review.mode
        && !rows.some(row => row.event === 'hook_session_close' && row.run_id === hook.run_id), 'STANDARD_RETAINED_SESSION_CLOSURE_START_CHANGED');
      const source = createStandardSessionClosureAuthority({ targetRoot: artifacts.root, readAcceptedOperation: accepted,
        readEvaluation: (instance, input) => authority.readRecordedDriftEvaluation(instance, input) });
      await createStandardSessionClosureReview({ readSource: source.readSource }).assertFresh(before.instance, before.record.preview.prepared.plan);
      require(!artifacts.ownerPending(), 'STANDARD_RETAINED_SESSION_CLOSURE_OWNER_UNSETTLED');
    }
    const proof = assertRetainedSessionClosureProof({ original_instance_id: before.instance.instance_id, original_instance_sha256: before.instance.instance_sha256,
      original_configuration_sha256: H(before.execution), journals_sha256: H(before.pins.journals), decision_operation_id: before.record.operation_id,
      decision_material_sha256: H({ question: before.question, decision: before.captured.source }), native_journal_sha256: H(diagnostic.journal),
      start_instance_sha256: before.start.instance.instance_sha256, start_configuration_sha256: H(before.start.execution), start_journals_sha256: H(before.pins.start_journals),
      start_native_journal_sha256: H(startDiagnostic.journal), start_operation_id: before.started.record.operation_id,
      session_id: before.question.review.session_id });
    require(!signal?.aborted && H(capture(entry).pins) === H(before.pins) && H(product()) === productSha
      && H(authority.inspectDiagnostic(before.instance).journal) === H(diagnostic.journal)
      && H(startAuthority.inspectDiagnostic(before.start.instance).journal) === H(startDiagnostic.journal));
    return { proof, question: before.question, decision: before.captured.source, record: before.record, started: before.started,
      admission: accepted(before.instance, before.question.review.admission_operation_id, 'session_close_admit'), instance: before.instance, records: before.records };
  }
  return Object.freeze({ inspect: (entry, options) => read(entry, options, true), readRecorded: (entry, options) => read(entry, options) });
}
