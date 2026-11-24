import path from 'node:path';
import { createAgenticProcessStore } from '../../adapters/runtime/agentic-process-store.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { createStandardHostAuthority } from '../../adapters/runtime/standard-host-authority.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { assertRetainedCompletionEntry, assertRetainedCompletionProof } from '../../core/workflow/standard-retained-completion.mjs';
import { assertRetainedClosureTerminalMaterial, retainedClosureContinuation } from '../../core/workflow/standard-retained-closure.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { readAgenticProductSnapshot } from './agentic-process-execution-composition.mjs';
import { createStandardBaselinePromotionAuthority } from './standard-baseline-promotion-authority.mjs';
import { createRetainedClosureSource } from './standard-retained-closure-source.mjs';
import { analyzeStructuredArtifact } from '../../lib/workflow/structured-artifact-parser-lib.mjs';
import { createLocalGitAdapter } from '../../adapters/runtime/local-git-adapter.mjs';

const require = (value, code = 'STANDARD_RETAINED_COMPLETION_SOURCE_CHANGED') => {
  if (!value) throw Object.assign(Error(code), { code });
};
// Read a settled retained-closure instance at the first promotion boundary.
// Old receipts stay under their original key; no current receipt is invented.
export function createRetainedCompletionSource({ configuration, environment, createAuthority }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options);
  function capture(entry) {
    assertRetainedCompletionEntry(entry);
    const execution = readAgentRunFile(entry.original_configuration.path, { sha256: entry.original_configuration.sha256 }).value;
    require(execution.instance_id !== configuration.instance_id && execution.target_root === configuration.target_root
      && execution.product_root === configuration.product_root && H(execution.product_files) === H(configuration.product_files));
    require(H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ['executable', 'sha256', 'home', 'model', 'effort'].every(key => execution.native[key] === configuration.native[key]), 'STANDARD_RETAINED_COMPLETION_BINDING_CHANGED');
    const roots = [configuration.control_root, configuration.review_root, configuration.native.home, ...configuration.native.protected_roots];
    require([entry.original_configuration.path, execution.control_root, execution.review_root].every(file => roots.some(root => {
      const relative = path.relative(root, file); return !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
    })), 'STANDARD_RETAINED_COMPLETION_EVIDENCE_UNPROTECTED');
    const instance = instances.read(execution.instance_id).record;
    require(instance?.initial_parameters?.entry_point?.kind === 'retained_closure', 'STANDARD_RETAINED_COMPLETION_ORIGIN_UNSUPPORTED');
    const intents = instance.events.filter(row => row.kind === 'operation_intent');
    require(intents.length > 0 && intents.length <= 64 && intents.at(-1).intent.binding_ref === 'cycle_close_completed_select'
      && !intents.some(row => row.intent.binding_ref === 'baseline_promotion_decision'), 'STANDARD_RETAINED_COMPLETION_BOUNDARY_CHANGED');
    const host = createStandardHostAuthority({ configuration: execution, environment }, { useProvider: false }), signer = createOperationJournalSigner(host.readKey);
    const records = intents.map(row => journals.read(row.intent.operation_id).record);
    for (const record of records) {
      signer.verify(record); signer.verify(record.preview);
      require(record.preview.snapshot.native.configuration_sha256 === H(execution), 'STANDARD_RETAINED_COMPLETION_CONFIGURATION_CHANGED');
      require(record.phase === 'receipted' && record.results.length === 1 && record.results[0].receipt.outcome === 'completed'
        && ['no_effect', 'confirmed'].includes(record.results[0].receipt.effect_status)
        && instance.events.some(row => row.kind === 'operation_result' && H(row.receipt) === H(record.results[0].receipt)), 'STANDARD_RETAINED_COMPLETION_EFFECT_UNSETTLED');
    }
    const selection = records.at(-1).results[0].output;
    require(selection.observations.closure_operation_id === entry.closure_operation_id, 'STANDARD_RETAINED_COMPLETION_BOUNDARY_CHANGED');
    const accepted = (actual, id, binding) => {
      require(actual.instance_sha256 === instance.instance_sha256);
      const record = records.find(row => row.operation_id === id);
      require(record && record.intent.binding_ref === binding && record.intent.instance_id === instance.instance_id && record.intent.scope_id === instance.scope_id
        && intents.findLast(row => row.intent.binding_ref === binding)?.intent.operation_id === id);
      return { record, output: record.results[0].output };
    };
    const closed = accepted(instance, entry.closure_operation_id, 'cycle_close_finalize');
    require(selection.observations.receipt_sha256 === H(closed.record.results[0].receipt) && selection.observations.output_sha256 === H(closed.output));
    return { execution, instance, host, records, accepted, closed, pins: { instance: H(instance), configuration: H(execution), journals: records.map(row => H(row)) } };
  }
  async function read(entry, { readValidation, signal } = {}, fresh = false) {
    require(typeof readValidation === 'function', 'STANDARD_RETAINED_COMPLETION_VALIDATION_REQUIRED');
    require(!signal?.aborted, 'STANDARD_RETAINED_COMPLETION_CANCELLED');
    if (fresh) require(!artifacts.ownerPending(), 'STANDARD_RETAINED_COMPLETION_OWNER_UNSETTLED');
    const before = capture(entry), { execution, instance, host, accepted, closed } = before;
    const product = () => readAgenticProductSnapshot(execution.product_root, execution.product_files), initialProduct = H(product());
    const authority = createAuthority({ configuration: execution, model: instance.model, modelSource: closed.record.preview.snapshot.model_source,
      readSigningKey: host.readKey, humanSource: host.humanSource, readProductSnapshot: product, readProductSha256: () => H(product()), environment });
    const diagnostic = authority.inspectDiagnostic(instance);
    require(diagnostic.journal?.allocations.length > 0 && diagnostic.journal.allocations.every(row => row.phase === 'closed' && row.tree_closed === true), 'STANDARD_RETAINED_COMPLETION_NATIVE_UNSETTLED');
    const recorded = accepted(instance, closed.record.preview.prepared.plan.input.closure_operation_id, 'cycle_close_record'), plan = recorded.record.preview.prepared.plan;
    const originalEntry = instance.events.filter(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select');
    require(originalEntry.length === 1 && plan.input.decision_operation_id === instance.initial_parameters.entry_point.decision_operation_id);
    const entryResult = accepted(instance, originalEntry[0].intent.operation_id, 'workflow_entry_select').output;
    const retained = createRetainedClosureSource({ configuration: execution, environment, createAuthority });
    const verified = await retained.readRecorded(instance.initial_parameters.entry_point, { readValidation, signal });
    require(entryResult.facts.retained_closure_requested === true && entryResult.observations.entry_point === 'retained_closure'
      && H(entryResult.observations.continuation) === H(retainedClosureContinuation(verified.proof)));
    assertRetainedClosureTerminalMaterial(plan, recorded.output, verified);
    const terminal = { record_operation_id: recorded.record.operation_id, plan, output: recorded.output, closure_question: verified.question };
    const promotion = createStandardBaselinePromotionAuthority({ targetRoot: artifacts.root, readAcceptedOperation: accepted,
      readTerminalRecord: async (actual, input) => { require(input.closure_operation_id === recorded.record.operation_id); return terminal; },
      human: { question: () => { throw Error('STANDARD_RETAINED_COMPLETION_UNEXPECTED_QUESTION'); }, captured: () => { throw Error('STANDARD_RETAINED_COMPLETION_UNEXPECTED_CAPTURE'); } } });
    const closure = await promotion.readClosure(instance, { closure_operation_id: entry.closure_operation_id });
    const checkpointIntent = instance.events.findLast(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'cycle_terminal_checkpoint');
    const checkpoint = accepted(instance, checkpointIntent?.intent.operation_id, 'cycle_terminal_checkpoint'), cp = checkpoint.record.preview.prepared.plan;
    require(cp.input.closure_operation_id === terminal.record_operation_id && cp.target_state === 'DONE'
      && checkpoint.output.effect_status === 'confirmed' && checkpoint.output.facts.cycle_terminal_checkpoint_completed === true
      && cp.cycle_id === closure.cycle_id && cp.cycle_path === closure.cycle_path && cp.session_id === closure.session_id);
    const scope = closed.record.preview.prepared.plan.scope;
    require(closure.session_id === instance.initial_parameters.session.session_id && closure.product_sha256 === initialProduct);
    if (fresh) {
      const sessions = artifacts.sessions().filter(row => row.session_id === closure.session_id), cycles = artifacts.cycles().filter(row => row.cycle_id === closure.cycle_id);
      require(sessions.length === 1 && cycles.length === 1 && cycles[0].path === closure.cycle_path + '/status.md', 'STANDARD_RETAINED_COMPLETION_FOCUS_CHANGED');
      const parsedSession = analyzeStructuredArtifact(sessions[0].content, { classification: { kind: 'session' } }), session = parsedSession.key_values, cycle = analyzeStructuredArtifact(cycles[0].content).key_values;
      const current = analyzeStructuredArtifact(artifacts.read('CURRENT-STATE.md', { required: true }).content).key_values;
      require(session.state === 'OPEN' && cycle.state === 'DONE' && cycle.session_owner === closure.session_id
        && parsedSession.derived_session_context.attached_cycles.includes(closure.cycle_id)
        && current.active_session === closure.session_id && current.active_cycle === 'none' && current.mode === 'COMMITTING', 'STANDARD_RETAINED_COMPLETION_FOCUS_CHANGED');
      const git = createLocalGitAdapter();
      require(git.getCurrentBranch(artifacts.root) === scope.branch && git.getHeadCommit(artifacts.root) === scope.head
        && git.execStatusPorcelain(artifacts.root, '', true).trim().length === 0, 'STANDARD_RETAINED_COMPLETION_HEAD_CHANGED');
      const postimages = new Map();
      for (const record of before.records) for (const evidence of record.results[0].output.evidence_refs ?? [])
        if (record.results[0].output.effect_status === 'confirmed' && evidence.ref.startsWith('docs/audit/')) postimages.set(evidence.ref.slice(11), evidence.sha256);
      require(postimages.size >= 3 && [...postimages].every(([name, hash]) => artifacts.read(name, { required: true }).sha256 === hash), 'STANDARD_RETAINED_COMPLETION_POSTIMAGE_CHANGED');
      require(!artifacts.ownerPending(), 'STANDARD_RETAINED_COMPLETION_OWNER_UNSETTLED');
    }
    const proof = assertRetainedCompletionProof({ original_instance_id: instance.instance_id, original_instance_sha256: instance.instance_sha256,
      original_configuration_sha256: H(execution), journals_sha256: H(before.pins.journals), native_journal_sha256: H(diagnostic.journal),
      closure_operation_id: closed.record.operation_id, closure_output_sha256: H(closed.output), terminal_operation_id: terminal.record_operation_id,
      checkpoint_operation_id: checkpoint.record.operation_id, question_sha256: H(verified.question), retained_closure_proof_sha256: H(verified.proof),
      session_id: closure.session_id, cycle_id: closure.cycle_id, cycle_path: closure.cycle_path, product_sha256: initialProduct });
    require(!signal?.aborted && H(capture(entry).pins) === H(before.pins) && H(product()) === initialProduct
      && H(authority.inspectDiagnostic(instance).journal) === H(diagnostic.journal));
    return { proof, closure, closed, terminal, checkpoint, instance, records: before.records };
  }
  return Object.freeze({ inspect: (entry, options) => read(entry, options, true), readRecorded: (entry, options) => read(entry, options, false) });
}
