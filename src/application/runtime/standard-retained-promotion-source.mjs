import path from 'node:path';
import { createAgenticProcessStore } from '../../adapters/runtime/agentic-process-store.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { createProcessDecisionInboxStore } from '../../adapters/runtime/process-decision-inbox-store.mjs';
import { createStandardHostAuthority } from '../../adapters/runtime/standard-host-authority.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { readAgenticProductSnapshot } from './agentic-process-execution-composition.mjs';
import { createStandardHumanDecisions } from './standard-workflow-human-decisions.mjs';
import { createStandardBaselinePromotionAuthority } from './standard-baseline-promotion-authority.mjs';
import { baselinePromotionSourceMaterialSha256 } from './standard-baseline-promotion.mjs';
import { createRetainedCompletionSource } from './standard-retained-completion-source.mjs';
import { retainedCompletionContinuation } from '../../core/workflow/standard-retained-completion.mjs';
import { assertRetainedPromotionEntry, assertRetainedPromotionProof } from '../../core/workflow/standard-retained-promotion.mjs';
import { retainObjectiveAlignment } from '../../core/workflow/standard-drift-retained-objective.mjs';
import { analyzeStructuredArtifact } from '../../lib/workflow/structured-artifact-parser-lib.mjs';
import { createLocalGitAdapter } from '../../adapters/runtime/local-git-adapter.mjs';
import recordSchema from '../../core/contracts/workflow-definition/standard-baseline-promotion-plan.v1.schema.json' with { type: 'json' };
import checkpointSchema from '../../core/contracts/workflow-definition/standard-baseline-promotion-checkpoint-plan.v1.schema.json' with { type: 'json' };

const require = (value, code = 'STANDARD_RETAINED_PROMOTION_SOURCE_CHANGED') => {
  if (!value) throw Object.assign(Error(code), { code });
};
const sequence = ['workflow_entry_select', 'cycle_close_completed_select', 'baseline_promotion_decision',
  'baseline_promotion_record', 'baseline_promotion_checkpoint', 'drift_report_evaluate', 'drift_check_finalize'];

// Only the exact settled no-effect promotion refusal is supported. The original
// technical instance, Human receipt and Native accounting remain immutable.
export function createRetainedPromotionSource({ configuration, environment, createAuthority }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options);
  function capture(entry) {
    assertRetainedPromotionEntry(entry);
    const execution = readAgentRunFile(entry.original_configuration.path, { sha256: entry.original_configuration.sha256 }).value;
    require(execution.instance_id !== configuration.instance_id && execution.target_root === configuration.target_root
      && execution.product_root === configuration.product_root && H(execution.product_files) === H(configuration.product_files));
    require(H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ['executable', 'sha256', 'home', 'model', 'effort'].every(key => execution.native[key] === configuration.native[key]), 'STANDARD_RETAINED_PROMOTION_BINDING_CHANGED');
    const roots = [configuration.control_root, configuration.review_root, configuration.native.home, ...configuration.native.protected_roots];
    require([entry.original_configuration.path, execution.control_root, execution.review_root].every(file => roots.some(root => {
      const relative = path.relative(root, file); return !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
    })), 'STANDARD_RETAINED_PROMOTION_EVIDENCE_UNPROTECTED');
    const instance = instances.read(execution.instance_id).record;
    require(instance?.initial_parameters?.entry_point?.kind === 'retained_completion', 'STANDARD_RETAINED_PROMOTION_ORIGIN_UNSUPPORTED');
    const intents = instance.events.filter(row => row.kind === 'operation_intent');
    require(H(intents.map(row => row.intent.binding_ref)) === H(sequence)
      && intents.at(-1).intent.operation_id === entry.failed_finalization_operation_id, 'STANDARD_RETAINED_PROMOTION_BOUNDARY_CHANGED');
    const host = createStandardHostAuthority({ configuration: execution, environment }, { useProvider: false });
    const signer = createOperationJournalSigner(host.readKey), records = intents.map(row => journals.read(row.intent.operation_id).record);
    for (const [index, record] of records.entries()) {
      signer.verify(record); signer.verify(record.preview);
      const result = record.results.at(-1), failed = index === records.length - 1;
      require(record.preview.snapshot.native.configuration_sha256 === H(execution) && record.phase === 'receipted' && record.results.length === 1
        && result.receipt.outcome === (failed ? 'blocked' : 'completed')
        && result.output.outcome === result.receipt.outcome && result.output.effect_status === result.receipt.effect_status
        && result.receipt.output_sha256 === H(result.output)
        && (failed ? result.receipt.effect_status === 'no_effect' : ['no_effect', 'confirmed'].includes(result.receipt.effect_status))
        && instance.events.some(row => row.kind === 'operation_result' && H(row.receipt) === H(result.receipt)), 'STANDARD_RETAINED_PROMOTION_EFFECT_UNSETTLED');
    }
    const refused = records.at(-1);
    require(refused.results[0].output.observations.reason_code === 'STANDARD_DRIFT_GATE_BLOCKED'
      && refused.preview.prepared.can_apply === false && !refused.preview.prepared.plan
      && refused.preview.input.evaluation_operation_id === records[5].operation_id, 'STANDARD_RETAINED_PROMOTION_REFUSAL_UNSUPPORTED');
    const accepted = (actual, id, binding) => {
      require(actual.instance_sha256 === instance.instance_sha256);
      const record = records.find(row => row.operation_id === id);
      require(record && record.intent.binding_ref === binding && record.intent.instance_id === instance.instance_id && record.intent.scope_id === instance.scope_id);
      return { record, output: record.results[0].output };
    };
    return { execution, instance, host, signer, records, accepted,
      pins: { instance: H(instance), configuration: H(execution), journals: records.map(row => H(row)) } };
  }
  async function read(entry, { readValidation, signal } = {}, fresh = false, evaluationRequired = false, alignmentRequired = false) {
    require(typeof readValidation === 'function', 'STANDARD_RETAINED_PROMOTION_VALIDATION_REQUIRED');
    require(!signal?.aborted, 'STANDARD_RETAINED_PROMOTION_CANCELLED');
    if (fresh) require(!artifacts.ownerPending(), 'STANDARD_RETAINED_PROMOTION_OWNER_UNSETTLED');
    const before = capture(entry), { execution, instance, host, signer, records, accepted } = before;
    const product = () => readAgenticProductSnapshot(execution.product_root, execution.product_files), initialProduct = H(product());
    const authority = createAuthority({ configuration: execution, model: instance.model, modelSource: records[0].preview.snapshot.model_source,
      readSigningKey: host.readKey, humanSource: host.humanSource, readProductSnapshot: product, readProductSha256: () => H(product()), environment });
    const diagnostic = authority.inspectDiagnostic(instance);
    require(diagnostic.journal?.allocations.length > 0 && diagnostic.journal.allocations.every(row => row.phase === 'closed' && row.tree_closed === true), 'STANDARD_RETAINED_PROMOTION_NATIVE_UNSETTLED');
    const completionSource = createRetainedCompletionSource({ configuration: execution, environment, createAuthority });
    const completed = await completionSource.readRecorded(instance.initial_parameters.entry_point, { readValidation, signal });
    const entryOutput = records[0].results[0].output;
    require(H(entryOutput.observations.continuation) === H(retainedCompletionContinuation(completed.proof))
      && entryOutput.facts.retained_completion_requested === true);
    const human = createStandardHumanDecisions({ inbox: createProcessDecisionInboxStore(options), signer, source: host.humanSource, projectionRequired: false });
    const promotionAuthority = createStandardBaselinePromotionAuthority({ targetRoot: artifacts.root, readAcceptedOperation: accepted,
      readTerminalRecord: async () => completed.terminal, human,
      readRetainedClosure: async (actual, input) => {
        require(actual.instance_sha256 === instance.instance_sha256 && input.closure_operation_id === completed.closure.operation_id);
        return { ...completed.closure, instance_id: instance.instance_id, scope_id: instance.scope_id };
      } });
    const record = records[3], plan = record.preview.prepared.plan, output = record.results[0].output;
    require(validateJsonSchema(plan, recordSchema, '$', { contractKind: 'workflow-definition' }).length === 0);
    const source = await promotionAuthority.readRequest(instance, plan.input);
    require(plan.input.decision_operation_id === records[2].operation_id && baselinePromotionSourceMaterialSha256(source) === plan.source_material_sha256
      && H(source.request) === H(plan.request) && plan.request.product_sha256 === initialProduct
      && output.effect_status === 'confirmed' && output.facts.baseline_recorded === true && output.facts.baseline_promotion_completed === false);
    const promotion = { record_operation_id: record.operation_id, plan, output };
    const checkpoint = records[4], cp = checkpoint.preview.prepared.plan, cpOutput = checkpoint.results[0].output;
    require(validateJsonSchema(cp, checkpointSchema, '$', { contractKind: 'workflow-definition' }).length === 0
      && cp.input.record_operation_id === record.operation_id && cp.input.closure_operation_id === completed.closed.record.operation_id
      && cp.input.terminal_checkpoint_operation_id === completed.checkpoint.record.operation_id
      && cp.session_id === completed.proof.session_id && cp.cycle_id === completed.proof.cycle_id && cp.cycle_path === completed.proof.cycle_path
      && cpOutput.effect_status === 'confirmed' && cpOutput.facts.baseline_checkpoint_completed === true,
    'STANDARD_RETAINED_PROMOTION_CHECKPOINT_CHANGED');
    let evaluation = null, alignment = null;
    if (fresh || evaluationRequired) {
      evaluation = await authority.readRecordedDriftEvaluation(instance, records[6].preview.input);
    }
    if (fresh || evaluationRequired || alignmentRequired) {
      const retained = await completionSource.readObjectiveAlignment(instance.initial_parameters.entry_point, { readValidation, signal });
      require(retained.alignment !== null, 'STANDARD_RETAINED_PROMOTION_ALIGNMENT_REQUIRED');
      alignment = retained.alignment;
      if (evaluation) retainObjectiveAlignment(alignment, records[6].preview.input, evaluation);
    }
    if (fresh) {
      const sessions = artifacts.sessions().filter(row => row.session_id === completed.proof.session_id);
      require(sessions.length === 1, 'STANDARD_RETAINED_PROMOTION_FOCUS_CHANGED');
      const session = analyzeStructuredArtifact(sessions[0].content, { classification: { kind: 'session' } });
      const current = analyzeStructuredArtifact(artifacts.read('CURRENT-STATE.md', { required: true }).content).key_values;
      require(session.key_values.state === 'OPEN' && session.derived_session_context.attached_cycles.includes(completed.proof.cycle_id)
        && current.active_session === completed.proof.session_id && current.active_cycle === 'none' && current.mode === 'COMMITTING', 'STANDARD_RETAINED_PROMOTION_FOCUS_CHANGED');
      const git = createLocalGitAdapter(), expectedHead = cpOutput.observations.git.commit_sha ?? cpOutput.observations.git.head;
      require(git.getCurrentBranch(artifacts.root) === cp.git.observed.branch && git.getHeadCommit(artifacts.root) === expectedHead
        && git.execStatusPorcelain(artifacts.root, '', true).trim().length === 0, 'STANDARD_RETAINED_PROMOTION_HEAD_CHANGED');
      for (const change of plan.changes) require(artifacts.read(change.path, { required: true }).sha256 === change.after_sha256, 'STANDARD_RETAINED_PROMOTION_POSTIMAGE_CHANGED');
      const metadata = [...plan.changes.map(row => row.path), completed.proof.cycle_path + '/status.md']
        .map(path => ({ path, metadata_sha256: artifacts.metadataHash(path) })).sort((a, b) => a.path.localeCompare(b.path));
      require(H(metadata) === cp.postimage_metadata_sha256, 'STANDARD_RETAINED_PROMOTION_METADATA_CHANGED');
      require(!artifacts.ownerPending(), 'STANDARD_RETAINED_PROMOTION_OWNER_UNSETTLED');
    }
    const proof = assertRetainedPromotionProof({ original_instance_id: instance.instance_id, original_instance_sha256: instance.instance_sha256,
      original_configuration_sha256: H(execution), journals_sha256: H(before.pins.journals), native_journal_sha256: H(diagnostic.journal),
      retained_completion_proof_sha256: H(completed.proof), question_sha256: H(human.question(records[2])), product_sha256: initialProduct,
      record_operation_id: record.operation_id, record_plan_sha256: H(plan), record_output_sha256: H(output),
      checkpoint_operation_id: checkpoint.operation_id, checkpoint_output_sha256: H(cpOutput),
      evaluation_operation_id: records[5].operation_id, evaluation_output_sha256: H(records[5].results[0].output),
      failed_finalization_operation_id: entry.failed_finalization_operation_id,
      session_id: completed.proof.session_id, cycle_id: completed.proof.cycle_id, cycle_path: completed.proof.cycle_path });
    require(!signal?.aborted && H(capture(entry).pins) === H(before.pins) && H(product()) === initialProduct
      && H(authority.inspectDiagnostic(instance).journal) === H(diagnostic.journal));
    return { proof, completed, promotion, evaluation, alignment, instance, records, checkpoint: { record: checkpoint, output: cpOutput } };
  }
  return Object.freeze({ inspect: (entry, options) => read(entry, options, true),
    readRecorded: (entry, options) => read(entry, options), readEvaluation: (entry, options) => read(entry, options, false, true),
    readAlignment: (entry, options) => read(entry, options, false, false, true) });
}
