import path from 'node:path';
import { createAgenticProcessStore } from '../../adapters/runtime/agentic-process-store.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { createProcessDecisionInboxStore } from '../../adapters/runtime/process-decision-inbox-store.mjs';
import { createStandardHostAuthority } from '../../adapters/runtime/standard-host-authority.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import { assertRetainedPromotionEntry, assertRetainedPromotionProof } from '../../core/workflow/standard-retained-promotion.mjs';
import { assertNativeAllocationAssessment } from '../../core/workflow/native-allocation-assessment.mjs';
import { assertNativeAllocationJournal } from '../../core/workflow/native-allocation-journal.mjs';
import { assertNativeOwnerDispositionRecord, nativeOwnerDispositionPath } from '../../core/workflow/native-owner-disposition.mjs';
import { assertNativeDispatchRecord, nativeDispatchPath } from '../../core/workflow/native-dispatch-record.mjs';
import { buildBaselinePromotionRequest } from '../../core/workflow/standard-baseline-promotion-decision.mjs';
import { createLocalGitAdapter } from '../../adapters/runtime/local-git-adapter.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { readAgenticProductSnapshot } from './agentic-process-execution-composition.mjs';
import { createStandardHumanDecisions } from './standard-workflow-human-decisions.mjs';
import { observeReadOnlyNativeRejectedAnswer } from './native-readonly-rejected-answer.mjs';
import { inspectRetiredNativeOwnerWitness } from './local-native-owner-retirement.mjs';
import { readRetainedObjectiveCompletion } from './standard-retained-objective-completion.mjs';
import { analyzeStructuredArtifact } from '../../lib/workflow/structured-artifact-parser-lib.mjs';
import recordSchema from '../../core/contracts/workflow-definition/standard-baseline-promotion-plan.v1.schema.json' with { type: 'json' };
import checkpointSchema from '../../core/contracts/workflow-definition/standard-baseline-promotion-checkpoint-plan.v1.schema.json' with { type: 'json' };

const require = (value, code = 'STANDARD_CHECKPOINTED_PROMOTION_SOURCE_CHANGED') => {
  if (!value) throw Object.assign(Error(code), { code });
};
const inside = (root, file) => { const relative = path.relative(root, file);
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };

// A settled promotion checkpoint followed by exactly one rejected read-only R05.
// This reader carries accepted history; it grants no execution or accounting
// reconciliation and never treats the rejected answer as a report.
export function createCheckpointedPromotionSource({ configuration, environment }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options);
  function capture(entry) {
    assertRetainedPromotionEntry(entry); require(entry.version === 2);
    const roots = configuration.native.protected_roots;
    require([entry.original_configuration.path, entry.native_assessment.path].every(file => roots.some(root => inside(root, file))),
      'STANDARD_CHECKPOINTED_PROMOTION_EVIDENCE_UNPROTECTED');
    const execution = readAgentRunFile(entry.original_configuration.path, { sha256: entry.original_configuration.sha256 }).value;
    require(execution.instance_id !== configuration.instance_id && execution.target_root === configuration.target_root
      && execution.product_root === configuration.product_root && H(execution.product_files) === H(configuration.product_files)
      && H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ['executable', 'sha256', 'home', 'model', 'effort', 'startup'].every(k => H(execution.native[k]) === H(configuration.native[k]))
      && execution.native.protected_roots.every(root => roots.includes(root)), 'STANDARD_CHECKPOINTED_PROMOTION_BINDING_CHANGED');
    const instance = instances.read(execution.instance_id).record;
    require(instance?.initial_parameters.entry_point === 'session' && instance.model.model_id === 'aidn-standard'
      && instance.instance_sha256 === entry.original_instance_sha256, 'STANDARD_CHECKPOINTED_PROMOTION_ORIGIN_UNSUPPORTED');
    const host = createStandardHostAuthority({ configuration: execution, environment }, { useProvider: false });
    const signer = createOperationJournalSigner(host.readKey), intents = instance.events.filter(e => e.kind === 'operation_intent');
    require(intents.at(-1)?.intent.operation_id === entry.checkpoint_operation_id
      && intents.at(-1).intent.binding_ref === 'baseline_promotion_checkpoint', 'STANDARD_CHECKPOINTED_PROMOTION_BOUNDARY_CHANGED');
    const records = intents.map(e => journals.read(e.intent.operation_id).record);
    for (const [i, record] of records.entries()) {
      require(record); signer.verify(record); signer.verify(record.preview);
      require(H(record.intent) === H(intents[i].intent) && record.intent.instance_id === instance.instance_id
        && record.intent.scope_id === instance.scope_id && record.phase === 'receipted'
        && record.preview.snapshot.native.configuration_sha256 === H(execution)
        && record.results.every(r => H(r.output) === r.receipt.output_sha256
          && r.output.outcome === r.receipt.outcome && r.output.effect_status === r.receipt.effect_status)
        && instance.events.some(e => e.kind === 'operation_result' && H(e.receipt) === H(record.results.at(-1)?.receipt))
        && ['confirmed', 'no_effect'].includes(record.results.at(-1)?.receipt.effect_status), 'STANDARD_CHECKPOINTED_PROMOTION_EFFECT_UNSETTLED');
    }
    const accepted = (id, binding) => {
      const record = records.find(r => r.operation_id === id), result = record?.results.at(-1);
      require(record?.intent.binding_ref === binding && result && result.receipt.outcome === 'completed'
        && instance.events.some(e => e.kind === 'operation_result' && H(e.receipt) === H(result.receipt)));
      return { record, output: result.output };
    };
    const assessmentFile = readAgentRunFile(entry.native_assessment.path, { sha256: entry.native_assessment.sha256 }).value;
    require(assessmentFile && Object.keys(assessmentFile).sort().join(',') === 'assessment,inventory');
    signer.verify(assessmentFile.inventory); signer.verify(assessmentFile.assessment); signer.verify(assessmentFile.assessment.base_assessment);
    const assessment = assertNativeAllocationAssessment(assessmentFile.assessment.base_assessment, assessmentFile.inventory);
    require(assessmentFile.inventory.runtime_binding_sha256 === H(artifacts.describe()), 'STANDARD_CHECKPOINTED_PROMOTION_BINDING_CHANGED');
    require(assessment.instance_id === instance.instance_id && assessment.instance_sha256 === instance.instance_sha256
      && assessment.dispatch_id === entry.native_dispatch_id && assessment.generation === entry.native_generation);
    const journal = assertNativeAllocationJournal(JSON.parse(artifacts.read('workflows/native-allocations/' + assessment.journal_id + '.json', { required: true }).content));
    const dispatch = assertNativeDispatchRecord(JSON.parse(artifacts.read(nativeDispatchPath(entry.native_dispatch_id), { required: true }).content));
    const owner = assertNativeOwnerDispositionRecord(JSON.parse(artifacts.read(nativeOwnerDispositionPath(entry.native_dispatch_id), { required: true }).content));
    for (const value of [journal, dispatch, owner, owner.plan, owner.receipt]) signer.verify(value);
    require(H(owner) === entry.native_owner_disposition_sha256 && owner.phase === 'confirmed'
      && owner.plan.instance_sha256 === instance.instance_sha256 && owner.plan.configuration_sha256 === H(execution)
      && owner.plan.journal_sha256 === H(journal) && owner.plan.dispatch_sha256 === H(dispatch)
      && owner.plan.generation === entry.native_generation && journal.allocations.at(-1).generation === entry.native_generation
      && owner.receipt.effect === 'owner_lock_retired' && owner.receipt.original_failure_preserved
      && !owner.receipt.permits_resume && !owner.receipt.permits_native_renewal && !owner.receipt.accounting_reconciled
      && !owner.receipt.complete_resource_closure, 'STANDARD_CHECKPOINTED_PROMOTION_OWNER_UNSETTLED');
    return { execution, instance, signer, host, accepted, records, assessmentFile, assessment, journal, dispatch, owner,
      pins: { instance: H(instance), records: records.map(H), journal: H(journal), dispatch: H(dispatch), owner: H(owner) } };
  }
  async function read(entry, { signal } = {}, fresh = false, alignmentRequired = false) {
    require(!signal?.aborted, 'STANDARD_CHECKPOINTED_PROMOTION_CANCELLED');
    const before = capture(entry), { execution, instance, signer, host, accepted, journal, dispatch, owner, assessment } = before;
    const product = () => H(readAgenticProductSnapshot(execution.product_root, execution.product_files)), initialProduct = product();
    const readonly = observeReadOnlyNativeRejectedAnswer({ instance, journal, configuration: execution, signer, artifacts, productSha256: initialProduct, assessment });
    require(readonly, 'STANDARD_CHECKPOINTED_PROMOTION_READONLY_REJECTION_REQUIRED');
    const retired = inspectRetiredNativeOwnerWitness({ targetRoot: artifacts.root, dispatchId: entry.native_dispatch_id,
      originalLease: dispatch.leases[0], expectedLockSha256: owner.plan.lock_sha256 });
    const checkpoint = accepted(entry.checkpoint_operation_id, 'baseline_promotion_checkpoint'), cp = checkpoint.record.preview.prepared.plan;
    require(validateJsonSchema(cp, checkpointSchema, '$', { contractKind: 'workflow-definition' }).length === 0);
    const recorded = accepted(cp.input.record_operation_id, 'baseline_promotion_record'), plan = recorded.record.preview.prepared.plan;
    require(validateJsonSchema(plan, recordSchema, '$', { contractKind: 'workflow-definition' }).length === 0);
    const selected = accepted(plan.input.decision_operation_id, 'baseline_promotion_decision');
    const closed = accepted(cp.input.closure_operation_id, 'cycle_close_finalize');
    const terminalRecord = accepted(closed.record.preview.prepared.plan.input.closure_operation_id, 'cycle_close_record');
    const terminalCheckpoint = accepted(cp.input.terminal_checkpoint_operation_id, 'cycle_terminal_checkpoint');
    const closureChoice = accepted(terminalRecord.record.preview.prepared.plan.input.decision_operation_id, 'cycle_closure_decision');
    const human = createStandardHumanDecisions({ inbox: createProcessDecisionInboxStore(options), signer, source: host.humanSource, projectionRequired: false });
    const question = human.question(selected.record), decision = human.captured(selected.record).source;
    const closureQuestion = human.question(closureChoice.record), closureDecision = human.captured(closureChoice.record).source;
    require(H(buildBaselinePromotionRequest(question, decision)) === H(plan.request)
      && question.review.closure_output_sha256 === H(closed.output) && question.review.product_sha256 === initialProduct
      && closureQuestion.review.product_sha256 === initialProduct && closureChoice.output.facts.cycle_retention_requested === true
      && recorded.output.effect_status === 'confirmed' && recorded.output.facts.baseline_recorded === true
      && recorded.output.facts.baseline_promotion_completed === false && checkpoint.output.effect_status === 'confirmed'
      && checkpoint.output.facts.baseline_checkpoint_completed === true && closed.output.effect_status === 'confirmed'
      && closed.output.facts.cycle_close_completed === true && closed.output.facts.cycle_retained === true
      && closed.output.observations.target_state === 'DONE' && terminalCheckpoint.output.effect_status === 'confirmed'
      && terminalCheckpoint.output.facts.cycle_terminal_checkpoint_completed === true
      && cp.cycle_id === closureQuestion.review.cycle_id && cp.session_id === question.session_id
      && cp.cycle_path === terminalRecord.record.preview.prepared.plan.cycle_path && plan.request.product_sha256 === initialProduct);
    if (fresh) {
      const sessions = artifacts.sessions().filter(r => r.session_id === cp.session_id), cycles = artifacts.cycles().filter(r => r.cycle_id === cp.cycle_id);
      require(sessions.length === 1 && cycles.length === 1 && cycles[0].path === cp.cycle_path + '/status.md', 'STANDARD_CHECKPOINTED_PROMOTION_FOCUS_CHANGED');
      const session = analyzeStructuredArtifact(sessions[0].content, { classification: { kind: 'session' } });
      const cycle = analyzeStructuredArtifact(cycles[0].content).key_values;
      const current = analyzeStructuredArtifact(artifacts.read('CURRENT-STATE.md', { required: true }).content).key_values;
      require(session.key_values.state === 'OPEN' && session.derived_session_context.mode === 'COMMITTING'
        && cycle.state === 'DONE' && cycle.session_owner === cp.session_id && session.derived_session_context.attached_cycles.includes(cp.cycle_id)
        && current.active_session === cp.session_id && current.active_cycle === 'none' && current.mode === 'COMMITTING', 'STANDARD_CHECKPOINTED_PROMOTION_FOCUS_CHANGED');
      const git = createLocalGitAdapter(), head = checkpoint.output.observations.git.commit_sha ?? checkpoint.output.observations.git.head;
      require(git.getCurrentBranch(artifacts.root) === cp.git.observed.branch && git.getHeadCommit(artifacts.root) === head
        && git.execStatusPorcelain(artifacts.root, '', true).trim() === '', 'STANDARD_CHECKPOINTED_PROMOTION_HEAD_CHANGED');
      for (const row of plan.changes) require(artifacts.read(row.path, { required: true }).sha256 === row.after_sha256, 'STANDARD_CHECKPOINTED_PROMOTION_POSTIMAGE_CHANGED');
      const metadata = [...plan.changes.map(r => r.path), cp.cycle_path + '/status.md']
        .map(path => ({ path, metadata_sha256: artifacts.metadataHash(path) })).sort((a,b) => a.path.localeCompare(b.path));
      require(H(metadata) === cp.postimage_metadata_sha256, 'STANDARD_CHECKPOINTED_PROMOTION_METADATA_CHANGED');
      require(!artifacts.ownerPending(), 'STANDARD_CHECKPOINTED_PROMOTION_OWNER_UNSETTLED');
    }
    const proof = assertRetainedPromotionProof({ version: 2, original_instance_id: instance.instance_id,
      original_instance_sha256: instance.instance_sha256, original_configuration_sha256: H(execution), journals_sha256: H(before.pins.records),
      native_journal_sha256: H(journal), question_sha256: H(question), product_sha256: initialProduct,
      record_operation_id: recorded.record.operation_id, record_plan_sha256: H(plan), record_output_sha256: H(recorded.output),
      checkpoint_operation_id: checkpoint.record.operation_id, checkpoint_output_sha256: H(checkpoint.output),
      closure_operation_id: closed.record.operation_id, terminal_operation_id: terminalRecord.record.operation_id,
      terminal_checkpoint_operation_id: terminalCheckpoint.record.operation_id,
      completed_cycle_material_sha256: H({ closed, terminal: terminalRecord, terminalCheckpoint, question: closureQuestion, decision: closureDecision }),
      native_dispatch_id: entry.native_dispatch_id, native_generation: entry.native_generation,
      native_assessment_sha256: H(before.assessmentFile), native_owner_disposition_sha256: H(owner), native_readonly_witness_sha256: H(readonly),
      retired_lock_sha256: retired.sha256, session_id: cp.session_id, cycle_id: cp.cycle_id, cycle_path: cp.cycle_path,
      new_native_required: true, accounting_reconciled: false });
    const terminal = { record_operation_id: terminalRecord.record.operation_id, plan: terminalRecord.record.preview.prepared.plan,
      output: terminalRecord.output, closure_question: closureQuestion };
    const closure = { operation_id: closed.record.operation_id, instance_id: instance.instance_id, scope_id: instance.scope_id,
      session_id: cp.session_id, cycle_id: cp.cycle_id, cycle_path: cp.cycle_path, product_sha256: initialProduct, output: closed.output };
    const completed = { proof, closed, terminal, checkpoint: terminalCheckpoint, closure, instance, records: before.records,
      native_allocation_count: journal.allocations.length };
    const alignment = alignmentRequired ? await readRetainedObjectiveCompletion({ source: completed, configuration: execution, environment }) : null;
    require(!signal?.aborted && H(capture(entry).pins) === H(before.pins) && product() === initialProduct);
    return { proof, completed, promotion: { record_operation_id: recorded.record.operation_id, plan, output: recorded.output },
      checkpoint, instance, records: before.records, evaluation: null, alignment };
  }
  return Object.freeze({ inspect: (entry, options) => read(entry, options, true), readRecorded: (entry, options) => read(entry, options),
    readAlignment: (entry, options) => read(entry, options, false, true),
    readEvaluation: () => { throw Object.assign(Error('STANDARD_CHECKPOINTED_PROMOTION_FRESH_DRIFT_REQUIRED'), { code: 'STANDARD_CHECKPOINTED_PROMOTION_FRESH_DRIFT_REQUIRED' }); } });
}
