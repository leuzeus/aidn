import { createStandardDriftRoute } from "./standard-drift-route.mjs";
import { createStandardSpikeConversion } from "./standard-spike-conversion.mjs";
import { createStandardPrCorrectionCycle } from "./standard-pr-correction-cycle.mjs";
import { createStandardPrCorrectionReview } from "./standard-pr-correction-review.mjs";
import { createStandardPrCorrectionCheckpoint } from "./standard-pr-correction-checkpoint.mjs";
import { createStandardPrMergeExecute } from "./standard-session-pr-merge-execute.mjs";
import { createStandardSessionPrPostMergeFetch } from "./standard-session-pr-post-merge-fetch.mjs";
import { createStandardPostMergeCompletion, postMergeProjectScope } from "./standard-session-pr-post-merge-completion.mjs";
import { postMergeCompleteOperation } from "../../core/workflow/standard-pr-post-merge-complete.mjs";
import { createStandardPostMergeDecision } from "./standard-session-pr-post-merge-decision.mjs";
import { alignedPostMergeSubject, assertPostMergeRecoveryPlan, postMergeDecisionMaxAgeMs, postMergeDecisionOperation,
  postMergeRecoveryOutput, postMergeRecoveryPlanVersion, postMergeRecoveryResult } from "../../core/workflow/standard-pr-post-merge-decision.mjs";
import { postMergeAlignmentOperation, postMergeFetchOperation, postMergeMeasureOperation } from "../../core/workflow/standard-pr-post-merge-fetch.mjs";
import { mergeExecuteOperation, postMergeWaitOperation } from "../../core/workflow/standard-pr-merge-execute.mjs";
import { createStandardPrMergeConsent } from "./standard-session-pr-merge-consent.mjs";
import { checksOperation, mergeConsentOperation } from "../../core/workflow/standard-pr-merge-consent.mjs";
import { createStandardPrReviewResolution } from "./standard-session-pr-review-resolution.mjs";
import { resolutionExceptionOperation } from "../../core/workflow/standard-pr-resolution-exception.mjs";
import { createStandardPrReviewReply } from "./standard-session-pr-review-reply.mjs";
import { createStandardPrReviewEffectsVerification } from "./standard-session-pr-review-effects.mjs";
import { createStandardSessionPrMergeObservation } from "./standard-session-pr-merge-observe.mjs";
import { createStandardSessionPrReviewAuthority } from "./standard-session-pr-review-authority.mjs";
import { createStandardPrTriageSource } from "./standard-pr-triage-source.mjs";
import { createStandardPrCorrectionAuthority } from "./standard-pr-correction-authority.mjs";
import { createStandardPrCorrectionReopen } from "./standard-pr-correction-reopen.mjs";
import { assertStandardPrCorrectionPlan } from "../../core/workflow/standard-operation-contracts.mjs";
import { createStandardSessionPrReviewObservation, createStandardSessionPrReviewContentObservation } from "./standard-session-pr-review-observe.mjs";
import { createStandardSessionPrRedeliveryAuthority } from "./standard-session-pr-redelivery-authority.mjs";
import { createLocalWorkflowBranchIntegration } from "../../adapters/runtime/local-workflow-branch-integration.mjs";
import { createStandardSessionPrSuccessorAuthority } from "./standard-session-pr-successor-authority.mjs";
import { createStandardSessionPrCheckpoint } from "./standard-session-pr-checkpoint.mjs";
import { createStandardSessionPrUpdatePush } from "./standard-session-pr-update-push.mjs";
import { createStandardSessionBranchIntegration } from "./standard-session-branch-integration.mjs";
import { createStandardSessionBranchIntegrationAuthority } from "./standard-session-branch-integration-authority.mjs";
import { createStandardSessionPrRecord } from "./standard-session-pr-record.mjs";
import { createStandardSessionPrRecordAuthority } from "./standard-session-pr-record-authority.mjs";
import { createStandardSessionPrOpen } from "./standard-session-pr-open.mjs";
import { createStandardSessionPush } from "./standard-session-push.mjs";
import { createStandardSessionPrAdmission } from "./standard-session-pr-admission.mjs";
import { createStandardSessionClosureAuthority } from "./standard-session-closure-authority.mjs";
import { createStandardSessionClosureReview } from "./standard-session-closure-review.mjs";
import { createStandardSessionCloseRecord } from "./standard-session-close-record.mjs";
import { createStandardSessionCloseCheckpoint } from "./standard-session-close-checkpoint.mjs";
import { createStandardSessionPrecloseCheckpoint, collectStandardSessionCheckpointPostimages } from "./standard-session-preclose-checkpoint.mjs";
import { createStandardSessionDeliveryCheckpoint } from "./standard-session-delivery-checkpoint.mjs";
import { sessionClosePaths } from "../../core/workflow/standard-session-close-render.mjs";
import { createStandardSessionCloseHook } from "./standard-session-close-hook.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { classifyAidnBranch } from "../../lib/workflow/branch-kind-lib.mjs";
import { createStandardBaselinePromotionCheckpoint } from "./standard-baseline-promotion-checkpoint.mjs";
import { baselinePromotionPaths } from "../../core/workflow/standard-baseline-promotion.mjs";
import { createStandardCycleTerminalCheckpoint } from "./standard-cycle-terminal-checkpoint.mjs";
import { createStandardWorkflowGitCheckpoint } from "./standard-workflow-git-checkpoint.mjs";
import { createStandardBaselinePromotionHook } from "./standard-baseline-promotion-hook.mjs";
import { createStandardBaselinePromotionAuthority } from "./standard-baseline-promotion-authority.mjs";
import { createStandardBaselinePromotion, baselinePromotionSourceMaterialSha256 } from "./standard-baseline-promotion.mjs";
import { createStandardBaselinePromotionReview } from "./standard-baseline-promotion-review.mjs";
import { createStandardCycleCloseHook } from "./standard-cycle-close-hook.mjs";
import { createStandardCycleCloseRecord } from "./standard-cycle-close-record.mjs";
import { createStandardCycleClosureReview } from "./standard-cycle-closure-review.mjs";
import { observeStandardCycleAudit } from "../../core/workflow/standard-cycle-audit.mjs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings } from "./standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createStandardDriftFinalization } from "./standard-drift-finalization.mjs";
import { createStandardDriftRecovery } from "./standard-drift-recovery.mjs";
import { createStandardDriftChangeRequest } from "./standard-drift-change-request.mjs";
import { createStandardDriftCycle } from "./standard-drift-cycle.mjs";
import { createStandardCyclePlanRecord } from "./standard-cycle-plan-record.mjs";
import { createStandardCycleImplementation } from "./standard-cycle-implementation.mjs";
import { createStandardCycleValidation } from "./standard-cycle-validation.mjs";
import { createStandardCycleTaskAdvance } from "./standard-cycle-task-advance.mjs";
import { createStandardCycleVerification } from "./standard-cycle-verification.mjs";
import { evaluateStandardCycleValidation } from "../../core/workflow/standard-cycle-verification.mjs";
import { readWorkflowProjectExecutionAuthority } from "./workflow-instance-composition.mjs";
import { createAgenticProcessService } from "./agentic-process-service.mjs";
import { createAgenticProcessStore } from "../../adapters/runtime/agentic-process-store.mjs";
import { createProcessOperationJournalStore } from "../../adapters/runtime/process-operation-journal-store.mjs";
import { createProcessDecisionInboxStore } from "../../adapters/runtime/process-decision-inbox-store.mjs";
import { createProcessControlInboxStore } from "../../adapters/runtime/process-control-inbox-store.mjs";
import { createStandardHumanDecisions } from "./standard-workflow-human-decisions.mjs";
import { createStandardObjectiveDisposition } from "./standard-drift-objective-disposition.mjs";
import { createStandardObjectiveCompletion } from "./standard-drift-objective-completion.mjs";
import { createStandardControlInbox } from "./standard-workflow-control-inbox.mjs";
import { createStandardPrReviewControlSource } from "./standard-session-pr-review-control-source.mjs";
import { createStandardPrReviewReceiver } from "./standard-session-pr-review-receive.mjs";
import { inspectAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { assertControlRequest } from "../../core/workflow/process-control-inbox.mjs";
import { createAgenticProcess, advanceAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { processModels, processFrameNode, processFrameModel } from "../../core/workflow/process-call-model.mjs";
import { assertAgenticProcessModel, agenticPolicyPins, processId } from "../../core/workflow/agentic-process-model.mjs";
import { shadowHash, freezeShadow } from "../../core/workflow/shadow-json.mjs";
import { createOperationJournalSigner, operationJournalId, operationOutputRef } from "../../core/workflow/process-operation-journal.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput, assertStandardPrCorrectionCheckpointPlan } from "../../core/workflow/standard-operation-contracts.mjs";
import { assertProcessOperationBinding } from "../../core/workflow/process-operation-contracts.mjs";
import { assertStandardWorkflowModelSource } from "../../core/workflow/standard-workflow-model-catalog.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import previewSchema from "../../core/contracts/workflow-definition/standard-operation-preview.v1.schema.json" with { type: "json" };
import { processParameterOptions } from "../../core/workflow/process-data-contracts.mjs";
import { resolveStandardProcessInput, assertStandardResolvedPreview } from "./standard-process-inputs.mjs";
import { createStandardReconciliationInventory } from "./standard-reconciliation-inventory.mjs";
import { createStandardOperationDisposition } from "./standard-operation-disposition.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const prReviewWaitNodes = new Set(["session_pr_review_wait", "correction_pr_review_wait"]);
const receiptId = (id, index) => "receipt_" + id.slice(3) + (index ? "_" + index : "");
function controlCheckpoint(instance, eventId) {
  let replay = createAgenticProcess({ instanceId: instance.instance_id, model: instance.model, policyPins: instance.policy_pins,
    scopeId: instance.scope_id, facts: instance.initial_facts, ...processParameterOptions(instance) });
  for (const event of instance.events) {
    replay = advanceAgenticProcess(replay, event);
    if (event.event_id === eventId) return replay.instance_sha256;
  }
  fail("PROCESS_CONTROL_EVENT_UNAVAILABLE");
}
// Fixed local business adapters plus the common reducer/store. This host owns
// neither model routing nor human decisions. Signing/authorization capabilities
// must come from a trusted outer host, never authored JSON or a model tool.
export function createStandardWorkflowOperationHost({ targetRoot, model: suppliedModel, modelSource = null, readSigningKey, authorize, humanSource, controlSource, now = Date.now, processAuthority, validationProfile = null, sessionPushPort = null, sessionPullRequestPort = null, sessionReviewPort = null, sessionReviewEventPort = null, reconciliationConfiguration = null, dispositionSource = null }, { validationBoundaryFactory, dispatchCheckpoint } = {}) {
  if (processAuthority != null && (processAuthority.profile !== "standard-mixed.v1" || typeof processAuthority.authenticate !== "function")) fail("STANDARD_HOST_CONFIGURATION_INVALID");
  const model = freezeShadow(structuredClone(suppliedModel)); assertAgenticProcessModel(model);
  const driftFinalization = processAuthority ? createStandardDriftFinalization({ targetRoot, now,
    readEvaluation: (instance, input) => processAuthority.readDriftEvaluation(instance, input),
    readObjectiveAlignment: (instance, input, verified) => objectiveDisposition.read(instance, input, verified),
    readCurrent: id => current(id).record }) : null;
  const driftRoute = processAuthority ? createStandardDriftRoute({ targetRoot,
    authenticate: instance => processAuthority.authenticate(instance),
    readEvaluation: (instance, input) => processAuthority.readDriftEvaluation(instance, input),
    readOperation: id => retained(id).record, readCompletion: instance => objectiveCompletion.review(instance),
    readCurrentCompletion: instance => objectiveCompletion.read(instance) }) : null;
  const recovery = processAuthority ? createStandardDriftRecovery({ targetRoot, now,
    readEvaluation: (instance, input) => processAuthority.readDriftEvaluation(instance, input),
    observeContext: () => processAuthority.observeDriftContext(), readCurrent: id => current(id).record,
    readPreviousCompletion: instance => objectiveCompletion.review(instance) }) : null;
  const changeRequest = processAuthority ? createStandardDriftChangeRequest({ targetRoot, now,
    readRecovery: (instance, input) => recordedRecovery(instance, input),
    observeContext: () => processAuthority.observeDriftContext(), readCurrent: id => current(id).record }) : null;
  const source = modelSource === null ? null : freezeShadow(structuredClone(assertStandardWorkflowModelSource(modelSource, model)));
  if (model.contract_version !== "agentic-process-model.v2" || typeof authorize !== "function") fail("STANDARD_HOST_CONFIGURATION_INVALID");
  if (controlSource != null && ![["read", "verify"], ["readReview", "verifyReview"]].some(pair => pair.every(key => typeof controlSource[key] === "function")))
    fail("STANDARD_HOST_CONTROL_CONFIGURATION_INVALID");
  const operations = createStandardWorkflowOperations({ targetRoot, now }), artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const spike = processAuthority ? createStandardSpikeConversion({ targetRoot, operations, now, readAcceptedOperation: acceptedForPromotion,
    observeModeWork: (instance, input) => processAuthority.observeModeWork(instance, input), verifyDecision: record => verifyHumanRecord(record),
    readCurrent: id => current(id).record, observeProduct: () => processAuthority.observeProduct() }) : null;
  const cyclePlanRecord = processAuthority ? createStandardCyclePlanRecord({ targetRoot, now,
    readEvaluation: (instance, input) => processAuthority.readCyclePlanEvaluation(instance, input),
    observeContext: () => processAuthority.observeCyclePlanContext(), readCurrent: id => current(id).record }) : null;
  const cycleImplementation = processAuthority ? createStandardCycleImplementation({ targetRoot, now,
    readEvaluation: (instance, input) => processAuthority.readCycleReadinessEvaluation(instance, input),
    observeContext: () => processAuthority.observeCycleReadinessContext(), readCurrent: id => current(id).record }) : null;
  const cycleValidation = processAuthority ? createStandardCycleValidation({ targetRoot, now, profileRef: validationProfile,
    readWork: (instance, input) => processAuthority.readCycleWorkEvaluation(instance, input), readCurrent: id => current(id).record }, { boundaryFactory: validationBoundaryFactory }) : null;
  async function evaluateValidation(instance, input) {
    const source = await processAuthority.readCycleValidationExecution(instance, input), evidence = await cycleValidation.readResult(source);
    return { output: evaluateStandardCycleValidation({ source, evidence, validationOperationId: input.validation_operation_id }), source, evidence };
  }
  async function auditSource(instance, input) {
    const bridge = await processAuthority.readCycleVerificationExecution(instance, input), source = bridge.source;
    const evidence = await cycleValidation.readResult(source);
    // Recompute machine coverage against the same signed original subject hash.
    // Its owned VERIFYING metadata transition is authenticated separately above;
    // this historical hash is never presented as the current context authority.
    const original = evaluateStandardCycleValidation({ source: { ...source,
      progress_operation_id: bridge.evaluation.record.preview.input.progress_operation_id ?? null,
      context: { cycle_path: bridge.context.cycle_path }, context_sha256: bridge.evaluation.output.observations.context_sha256 },
      evidence, validationOperationId: source.record.operation_id });
    if (shadowHash(original) !== shadowHash(bridge.evaluation.output) || original.facts.cycle_work_complete !== true) fail("STANDARD_AUDIT_MACHINE_EVIDENCE_STALE");
    const validation = { contract_version: "standard-cycle-audit-machine-evidence.v1", validation_operation_id: source.record.operation_id,
      evaluation_operation_id: bridge.evaluation.record.operation_id, work_complete: original.facts.cycle_work_complete,
      checks_passed: original.facts.cycle_checks_passed, product_sha256: evidence.plan.product_sha256, profile_sha256: evidence.plan.profile_sha256,
      proof_class: evidence.plan.proof_class, status: evidence.manifest.status, checks: evidence.checks, evidence_refs: evidence.evidence_refs };
    const material = processAuthority.observeCycleAuditContext(bridge, validation);
    return { bridge, validation, material };
  }
  async function evaluateAuditSelection(instance, input) {
    assertStandardOperationInput("cycle_audit_select", input);
    const verified = await auditSource(instance, input), { bridge, material, validation } = verified;
    return { contract_version: "standard-cycle-audit-selection-output.v1", operation_ref: "cycle_audit_select", outcome: "completed", effect_status: "no_effect",
      facts: { cycle_audit_source_selected: true }, observations: { implementation_operation_id: input.implementation_operation_id,
        verification_operation_id: bridge.verification.record.operation_id, context_sha256: bridge.context_sha256,
        audit_context_sha256: material.context_sha256, validation }, evidence_refs: material.context.evidence_refs };
  }
  async function inspectAudit(instance, input) {
    const native = processAuthority.readCycleAuditActivity(instance, input), current = await auditSource(instance, native.selection.record.preview.input);
    const { audit_operation_id: selectionId, input_resolution: resolution, ...baseContext } = native.context;
    if (shadowHash(baseContext) !== current.material.context_sha256 || current.material.context_sha256 !== native.selection.output.observations.audit_context_sha256
      || current.bridge.verification.record.operation_id !== native.selection.output.observations.verification_operation_id) fail("STANDARD_AUDIT_CONTEXT_STALE");
    const output = observeStandardCycleAudit({ report: native.authenticated.report, context: native.context, contextSha256: shadowHash(native.context),
      producer: native.authenticated.producer, evidenceRefs: [...native.evidence_refs, ...current.validation.evidence_refs] });
    return { output, native, current };
  }
  const evaluateAudit = async (instance, input) => (await inspectAudit(instance, input)).output;
  async function readAcceptedAudit(instance, input) {
    const record = retained(input.audit_operation_id).record, receipt = record.results.at(-1)?.receipt;
    const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === "cycle_audit_evaluate").at(-1);
    if (latest?.intent.operation_id !== record.operation_id || record.intent.binding_ref !== "cycle_audit_evaluate"
      || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id || record.phase !== "receipted"
      || receipt?.outcome !== "completed" || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt))) fail("STANDARD_CLOSURE_ACCEPTED_AUDIT_REQUIRED");
    const verified = await inspectAudit(instance, record.preview.input);
    if (shadowHash(verified.output) !== shadowHash(record.results.at(-1).output)) fail("STANDARD_CLOSURE_AUDIT_CHANGED");
    return { ...verified, record };
  }
  const closureReview = processAuthority ? createStandardCycleClosureReview({ readAudit: readAcceptedAudit }) : null;
  async function readAcceptedClosureDecision(instance, input) {
    const record = retained(input.decision_operation_id).record, result = record.results.at(-1);
    const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === "cycle_closure_decision").at(-1);
    if (latest?.intent.operation_id !== record.operation_id || record.intent.binding_ref !== "cycle_closure_decision"
      || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id || record.phase !== "receipted"
      || result?.receipt.outcome !== "completed" || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(result.receipt))) fail("STANDARD_CYCLE_CLOSE_ACCEPTED_DECISION_REQUIRED");
    // The accepted, signed inbox proof survives provider disappearance. It is
    // neither a fresh effect grant nor a substitute for current audit evidence.
    const decision = human.captured(record).source, question = human.question(record);
    const verified = await closureReview.readFresh(instance, record.preview.prepared.plan);
    return { question, decision, report: verified.native.authenticated.report };
  }
  const cycleCloseRecord = processAuthority ? createStandardCycleCloseRecord({ targetRoot, now,
    readDecision: readAcceptedClosureDecision, observeContext: () => processAuthority.observeCycleCloseContext(), readCurrent: id => current(id).record }) : null;
  async function readAcceptedTerminalRecord(instance, input) {
    function accepted(id, binding) {
      const record = retained(id).record, result = record.results.at(-1);
      const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === binding).at(-1);
      if (latest?.intent.operation_id !== id || record.intent.binding_ref !== binding || record.intent.instance_id !== instance.instance_id
        || record.intent.scope_id !== instance.scope_id || record.phase !== "receipted" || result?.receipt.outcome !== "completed"
        || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(result.receipt))) fail("STANDARD_CYCLE_CLOSE_RECORDED_SOURCE_REQUIRED");
      return { record, output: result.output };
    }
    const closed = accepted(input.closure_operation_id, "cycle_close_record"), plan = closed.record.preview.prepared.plan;
    const selected = accepted(plan.input.decision_operation_id, "cycle_closure_decision");
    const question = human.question(selected.record), decision = human.captured(selected.record).source;
    const audit = accepted(selected.record.preview.prepared.plan.audit_operation_id, "cycle_audit_evaluate");
    const physical = processAuthority.readCycleCloseValidation(instance, audit.record.preview.input), evidence = await cycleValidation.readResult(physical);
    const report = physical.native.authenticated.report, machine = physical.machine;
    if (shadowHash({ question, decision, report }) !== plan.decision_material_sha256 || question.review.audit_output_sha256 !== shadowHash(audit.output)
      || question.review.report_sha256 !== shadowHash(report) || closed.output.effect_status !== "confirmed" || closed.output.facts.cycle_terminal_recorded !== true
      || closed.output.facts.cycle_close_completed !== false || evidence.plan.product_sha256 !== machine.product_sha256 || evidence.plan.profile_sha256 !== machine.profile_sha256
      || evidence.manifest.status !== machine.status || shadowHash(evidence.checks) !== shadowHash(machine.checks)
      || shadowHash(evidence.evidence_refs) !== shadowHash(machine.evidence_refs)) fail("STANDARD_CYCLE_CLOSE_RECORDED_PROVENANCE_CHANGED");
    return { record_operation_id: closed.record.operation_id, plan, output: closed.output };
  }
  const terminalCheckpoint = processAuthority && processModels(model).some(component => component.nodes.some(node => node.binding_ref === "cycle_terminal_checkpoint"))
    ? createStandardCycleTerminalCheckpoint({ targetRoot, now, readRecorded: readAcceptedTerminalRecord,
      observeContext: () => processAuthority.observeCycleCloseContext(), readCurrent: id => current(id).record }) : null;
  const cycleCloseHook = processAuthority ? createStandardCycleCloseHook({ targetRoot, now,
    readObjectiveCompletion: instance => objectiveCompletion.read(instance),
    readHistoricalCompletion: instance => objectiveCompletion.review(instance),
    readRecorded: readAcceptedTerminalRecord, observeContext: () => processAuthority.observeCycleCloseContext(), readCurrent: id => current(id).record }) : null;
  function selectCompletedClose(instance) {
    const intent = instance.events.findLast(event => event.kind === "operation_intent" && event.intent.binding_ref === "cycle_close_finalize")?.intent;
    if (!intent) fail("STANDARD_CYCLE_CLOSE_ACCEPTED_COMPLETION_REQUIRED");
    const record = retained(intent.operation_id).record, result = record.results.at(-1), output = assertStandardOperationOutput(result?.output);
    if (record.phase !== "receipted" || shadowHash(record.intent) !== shadowHash(intent)
      || result.receipt.outcome !== "completed" || output.outcome !== "completed" || output.effect_status !== "confirmed"
      || output.operation_ref !== "cycle_close_finalize" || output.facts.cycle_close_completed !== true
      || result.receipt.output_sha256 !== shadowHash(output)
      || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(result.receipt))
      || current(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail("STANDARD_CYCLE_CLOSE_ACCEPTED_COMPLETION_REQUIRED");
    return assertStandardOperationOutput({ contract_version: "standard-cycle-close-selection-output.v1", operation_ref: "cycle_close_completed_select",
      outcome: "completed", effect_status: "no_effect", facts: {}, evidence_refs: [],
      observations: { closure_operation_id: intent.operation_id, receipt_sha256: shadowHash(result.receipt), output_sha256: shadowHash(output) } });
  }
  function acceptedForPromotion(instance, id, binding, reason = "STANDARD_PROMOTION_ACCEPTED_SOURCE_REQUIRED") {
    const record = retained(id).record, result = record.results.at(-1);
    const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === binding).at(-1);
    if (latest?.intent.operation_id !== id || record.intent.binding_ref !== binding || record.intent.instance_id !== instance.instance_id
      || record.intent.scope_id !== instance.scope_id || record.phase !== "receipted" || result?.receipt.outcome !== "completed"
      || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(result.receipt))) fail(reason);
    return { record, output: result.output };
  }
  async function selectCyclePlan(instance) {
    const context = (await processAuthority.observeCyclePlanContext()).context;
    if (context.mode !== "COMMITTING") fail("STANDARD_CYCLE_PLAN_EXECUTION_MODE_REQUIRED");
    const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === "cycle_plan_record").at(-1);
    if (!latest) fail("STANDARD_CYCLE_PLAN_RECORD_REQUIRED");
    const selected = acceptedForPromotion(instance, latest.intent.operation_id, "cycle_plan_record", "STANDARD_CYCLE_PLAN_RECORD_REQUIRED");
    const plan = selected.record.preview.prepared.plan;
    if (selected.output.effect_status !== "confirmed" || selected.output.facts.cycle_plan_recorded !== true || plan.cycle_path !== context.cycle_path
      || plan.changes.some(row => artifacts.read(row.path, { required: true }).sha256 !== row.after_sha256)) fail("STANDARD_CYCLE_PLAN_RECORD_CHANGED");
    return assertStandardOperationOutput({ contract_version: "standard-cycle-plan-selection-output.v1", operation_ref: "cycle_plan_select",
      outcome: "completed", effect_status: "no_effect", facts: {}, observations: { record_operation_id: latest.intent.operation_id,
        cycle_id: context.cycle_id, session_id: context.session_id, cycle_path: context.cycle_path, record_sha256: shadowHash(selected) }, evidence_refs: selected.output.evidence_refs });
  }
  const sessionClosureAuthority = processAuthority ? createStandardSessionClosureAuthority({ targetRoot,
    readAcceptedOperation: acceptedForPromotion, readEvaluation: (instance, input) => processAuthority.readDriftEvaluation(instance, input) }) : null;
  const sessionClosureReview = sessionClosureAuthority ? createStandardSessionClosureReview({ readSource: (instance, input) => sessionClosureAuthority.readSource(instance, input) }) : null;
  async function readAcceptedSessionClosureDecision(instance, input) {
    const selected = acceptedForPromotion(instance, input.decision_operation_id, "session_closure_decision", "STANDARD_SESSION_CLOSE_DECISION_REQUIRED");
    await sessionClosureReview.assertFresh(instance, selected.record.preview.prepared.plan);
    return { question: human.question(selected.record), decision: human.captured(selected.record).source };
  }
  const sessionCloseRecord = processAuthority ? createStandardSessionCloseRecord({ targetRoot, now,
    readDecision: readAcceptedSessionClosureDecision, readCurrent: id => current(id).record }) : null;
  function readAcceptedSessionCloseRecord(instance, input) {
    const recorded = acceptedForPromotion(instance, input.record_operation_id, "session_close_record", "STANDARD_SESSION_CLOSE_RECORDED_SOURCE_REQUIRED");
    const plan = recorded.record.preview.prepared.plan, selected = acceptedForPromotion(instance, plan.input.decision_operation_id, "session_closure_decision");
    const question = human.question(selected.record), decision = human.captured(selected.record).source;
    if (shadowHash({ question, decision }) !== plan.decision_material_sha256 || recorded.output.effect_status !== "confirmed"
      || recorded.output.facts.session_close_report_recorded !== true || recorded.output.facts.session_close_completed !== false
      || selected.output.facts.session_closure_requested !== true || decision.choice !== "close") fail("STANDARD_SESSION_CLOSE_RECORDED_SOURCE_REQUIRED");
    const postimages = recorded.output.observations.postimages;
    if (postimages?.length !== 3 || plan.changes.some(change => !postimages.some(row => row.path === change.path && row.sha256 === change.after_sha256)))
      fail("STANDARD_SESSION_CLOSE_POSTIMAGE_CHANGED");
    for (const row of postimages) if (artifacts.read(row.path, { required: true }).sha256 !== row.sha256 || artifacts.metadataHash(row.path) !== row.metadata_sha256)
      fail("STANDARD_SESSION_CLOSE_POSTIMAGE_CHANGED");
    return { recorded, plan, question, decision };
  }
  function readSessionCheckpointSource(instance, input) {
    const source = readAcceptedSessionCloseRecord(instance, input), review = source.question.review;
    const owner = analyzeStructuredArtifact(artifacts.read(review.session_path, { required: true }).content).key_values;
    const currentState = analyzeStructuredArtifact(artifacts.read("CURRENT-STATE.md", { required: true }).content).key_values;
    if (owner.state !== "OPEN" || currentState.active_session !== review.session_id || currentState.active_cycle !== "none"
      || owner.session_closure_status !== "checkpoint_pending") fail("STANDARD_SESSION_CHECKPOINT_OWNER_CHANGED");
    const ownedPaths = artifacts.cycles().filter(row => analyzeStructuredArtifact(row.content).key_values.session_owner === review.session_id).map(row => row.path.slice(0, -10));
    const fixed = [review.session_path, "CURRENT-STATE.md", "RUNTIME-STATE.md", "snapshots/context-snapshot.md", "baseline/current.md", "baseline/history.md", "index.md"];
    const { approved, journals } = collectStandardSessionCheckpointPostimages({ instance, readRetained: retained, fixed, ownedPaths, closing: true });
    const admission = acceptedForPromotion(instance, review.admission_operation_id, "session_close_admit").output.observations.admission;
    const completionCycle = ["cycle", "intermediate"].includes(classifyAidnBranch(review.branch)) ? admission.mapped_cycle : null;
    if (completionCycle && (!["DONE", "NO_GO", "DROPPED"].includes(completionCycle.state) || completionCycle.session_owner !== review.session_id))
      fail("STANDARD_SESSION_CHECKPOINT_TERMINAL_OWNER_REQUIRED");
    return { record_operation_id: input.record_operation_id, session_id: review.session_id, branch: review.branch, parent_head: review.head,
      completion_cycle_id: completionCycle?.cycle_id ?? null, material_sha256: shadowHash({ plan: source.plan, journals }),
      postimages: [...approved.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256, metadata_sha256: artifacts.metadataHash(path) })) };
  }
  const sessionCloseCheckpoint = processAuthority ? createStandardSessionCloseCheckpoint({ targetRoot, now, readSource: readSessionCheckpointSource,
    readCurrent: id => current(id).record }) : null;
  // The final closure/promotion CAS happens after its earlier Git checkpoint.
  // Commit only their authenticated latest business postimages before asking
  // R05 to assess the session. Do not suppress its scope/integrity signals.
  async function readSessionPrecloseSource(instance, input) {
    const closed = acceptedForPromotion(instance, input.closure_operation_id, "cycle_close_finalize", "STANDARD_SESSION_PRECLOSE_CLOSURE_REQUIRED");
    const closePlan = closed.record.preview.prepared.plan, terminal = await readAcceptedTerminalRecord(instance, closePlan.input);
    const sessionId = closePlan.scope.session_id, cycleId = closePlan.scope.cycle_id;
    const selected = artifacts.sessions().filter(row => row.session_id === sessionId);
    if (selected.length !== 1 || closed.output.effect_status !== "confirmed" || closed.output.facts.cycle_close_completed !== true
      || !["DONE", "NO_GO", "DROPPED"].includes(closed.output.observations.target_state)
      || terminal.record_operation_id !== closePlan.input.closure_operation_id) fail("STANDARD_SESSION_PRECLOSE_CLOSURE_REQUIRED");
    const observed = closed.output.observations, eventFile = ".aidn/runtime/perf/workflow-events.ndjson";
    if (observed.event_file !== eventFile) fail("STANDARD_SESSION_PRECLOSE_CLOSURE_EVIDENCE_CHANGED");
    const bytes = readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, eventFile)), { json: false, maxBytes: 4194304 }).value;
    const offset = observed.event_offset, end = Number.isSafeInteger(offset) ? bytes.indexOf(10, offset) : -1;
    if (!Number.isSafeInteger(offset) || offset < 0 || end < offset || offset && bytes[offset - 1] !== 10)
      fail("STANDARD_SESSION_PRECLOSE_CLOSURE_EVIDENCE_CHANGED");
    const event = JSON.parse(bytes.subarray(offset, end).toString("utf8"));
    if (shadowHash(event) !== shadowHash(observed.event) || event.event !== "checkpoint_summary"
      || event.run_id !== "process_close_" + closed.record.operation_id.slice(3)) fail("STANDARD_SESSION_PRECLOSE_CLOSURE_EVIDENCE_CHANGED");
    const session = analyzeStructuredArtifact(selected[0].content).key_values;
    const currentState = analyzeStructuredArtifact(artifacts.read("CURRENT-STATE.md", { required: true }).content).key_values;
    if (session.state !== "OPEN" || currentState.active_session !== sessionId || currentState.active_cycle !== "none")
      fail("STANDARD_SESSION_PRECLOSE_OWNER_CHANGED");
    const owned = artifacts.cycles().filter(row => analyzeStructuredArtifact(row.content).key_values.session_owner === sessionId);
    if (owned.length > 48 || owned.some(row => !["DONE", "NO_GO", "DROPPED"].includes(analyzeStructuredArtifact(row.content).key_values.state)))
      fail("STANDARD_SESSION_PRECLOSE_UNRESOLVED_CYCLES");
    const terminalCycle = owned.filter(row => row.cycle_id === cycleId);
    if (terminalCycle.length !== 1 || analyzeStructuredArtifact(terminalCycle[0].content).key_values.state !== observed.target_state)
      fail("STANDARD_SESSION_PRECLOSE_CLOSURE_EVIDENCE_CHANGED");
    const fixed = [selected[0].path, "CURRENT-STATE.md", "RUNTIME-STATE.md", "snapshots/context-snapshot.md", "baseline/current.md", "baseline/history.md", "index.md"];
    const ownedPaths = owned.map(row => row.path.slice(0, -10));
    const { approved, journals } = collectStandardSessionCheckpointPostimages({ instance, readRetained: retained, fixed, ownedPaths });
    const prior = instance.events.filter(row => row.kind === "operation_result" && row.receipt.outcome === "completed")
      .map(row => retained(row.receipt.operation_id).record).filter(row => ["cycle_terminal_checkpoint", "baseline_promotion_checkpoint"].includes(row.intent.binding_ref)).at(-1);
    if (!prior) fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_REQUIRED");
    const checkpoint = acceptedForPromotion(instance, prior.operation_id, prior.intent.binding_ref);
    const git = checkpoint.output.observations.git, head = git?.commit_sha ?? git?.head;
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head ?? "") || checkpoint.output.effect_status !== "confirmed")
      fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_REQUIRED");
    return { closure_operation_id: input.closure_operation_id, session_id: sessionId, branch: closePlan.scope.branch, parent_head: head,
      completion_cycle_id: cycleId, material_sha256: shadowHash({ closure: closed.output, terminal, checkpoint: checkpoint.output, journals }),
      postimages: [...approved.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256, metadata_sha256: artifacts.metadataHash(path) })) };
  }
  const sessionPrecloseCheckpoint = processAuthority ? createStandardSessionPrecloseCheckpoint({ targetRoot, now, readSource: readSessionPrecloseSource,
    readCurrent: id => current(id).record }) : null;
  function readSessionCloseHookSource(instance, input) {
    const recorded = readAcceptedSessionCloseRecord(instance, input), review = recorded.question.review;
    const checkpoint = acceptedForPromotion(instance, input.checkpoint_operation_id, "session_close_checkpoint", "STANDARD_SESSION_CLOSE_CHECKPOINT_REQUIRED");
    const cp = checkpoint.record.preview.prepared.plan, source = readSessionCheckpointSource(instance, input);
    const startId = instance.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "session_start_finalize").at(-1)?.intent.operation_id;
    if (!startId || cp.input.record_operation_id !== input.record_operation_id || cp.source_sha256 !== shadowHash(source)) fail("STANDARD_SESSION_CLOSE_CHECKPOINT_REQUIRED");
    const start = acceptedForPromotion(instance, startId, "session_start_finalize", "STANDARD_SESSION_CLOSE_START_REQUIRED");
    if (start.record.preview.input.session_id !== review.session_id) fail("STANDARD_SESSION_CLOSE_START_REQUIRED");
    return { record_operation_id: input.record_operation_id, checkpoint_operation_id: input.checkpoint_operation_id,
      session_id: review.session_id, session_path: review.session_path, mode: review.mode, branch: review.branch,
      record_plan_sha256: shadowHash(recorded.plan), record_output_sha256: shadowHash(recorded.recorded.output),
      start_output: start.output, checkpoint_output: checkpoint.output };
  }
  const sessionCloseHook = processAuthority ? createStandardSessionCloseHook({ targetRoot, now, readSource: readSessionCloseHookSource,
    readCurrent: id => current(id).record }) : null;
  async function readSessionDeliverySource(instance, input) {
    const closed = acceptedForPromotion(instance, input.finalization_operation_id, "session_close_finalize", "STANDARD_SESSION_DELIVERY_FINALIZATION_REQUIRED");
    const plan = closed.record.preview.prepared.plan, output = closed.output, observed = output.observations;
    if (output.effect_status !== "confirmed" || output.facts.session_close_completed !== true || plan.operation_id !== input.finalization_operation_id
      || observed.run_id !== plan.run_id || observed.event_file !== ".aidn/runtime/perf/workflow-events.ndjson") fail("STANDARD_SESSION_DELIVERY_FINALIZATION_REQUIRED");
    const checkpoint = acceptedForPromotion(instance, plan.input.checkpoint_operation_id, "session_close_checkpoint");
    if (checkpoint.output.facts.session_close_checkpoint_completed !== true || checkpoint.output.observations.record_operation_id !== plan.input.record_operation_id
      || (checkpoint.output.observations.git?.commit_sha ?? checkpoint.output.observations.git?.head) !== plan.head) fail("STANDARD_SESSION_DELIVERY_CHECKPOINT_REQUIRED");
    const bytes = readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, observed.event_file)), { json: false, maxBytes: 4194304 }).value;
    const offset = observed.event_offset, end = Number.isSafeInteger(offset) ? bytes.indexOf(10, offset) : -1;
    if (!Number.isSafeInteger(offset) || offset < 0 || end < offset || offset && bytes[offset - 1] !== 10) fail("STANDARD_SESSION_DELIVERY_EVENT_CHANGED");
    const event = JSON.parse(bytes.subarray(offset, end).toString("utf8"));
    if (shadowHash(event) !== shadowHash(observed.event) || event.event !== "hook_session_close" || event.run_id !== plan.run_id || event.result !== "ok"
      || event.mode !== plan.mode || event.branch !== plan.branch) fail("STANDARD_SESSION_DELIVERY_EVENT_CHANGED");
    const session = analyzeStructuredArtifact(artifacts.read(plan.session_path, { required: true }).content).key_values;
    const currentState = analyzeStructuredArtifact(artifacts.read("CURRENT-STATE.md", { required: true }).content).key_values;
    if (session.state !== "CLOSED" || session.session_closure_status !== "completed" || currentState.active_session !== plan.session_id
      || currentState.active_cycle !== "none" || currentState.session_closure_status !== "completed") fail("STANDARD_SESSION_DELIVERY_OWNER_CHANGED");
    const names = sessionClosePaths(plan.session_path), postimages = names.map(name => {
      const refs = output.evidence_refs.filter(row => row.ref === "docs/audit/" + name), prior = plan.documents.find(row => row.path === name);
      if (refs.length !== 1 || !prior || artifacts.read(name, { required: true }).sha256 !== refs[0].sha256
        || artifacts.metadataHash(name) !== prior.metadata_sha256) fail("STANDARD_SESSION_DELIVERY_POSTIMAGE_CHANGED");
      return { path: name, sha256: refs[0].sha256, metadata_sha256: prior.metadata_sha256 };
    });
    if (shadowHash(observed.committed) !== shadowHash(names)) fail("STANDARD_SESSION_DELIVERY_POSTIMAGE_CHANGED");
    return { finalization_operation_id: input.finalization_operation_id, session_id: plan.session_id, session_path: plan.session_path,
      branch: plan.branch, parent_head: plan.head, material_sha256: shadowHash({ finalization: output, checkpoint: checkpoint.output }), postimages };
  }
  const sessionDeliveryCheckpoint = processAuthority ? createStandardSessionDeliveryCheckpoint({ targetRoot, now, readSource: readSessionDeliverySource,
    readCurrent: id => current(id).record }) : null;
  const integrationAuthority = processAuthority ? createStandardSessionBranchIntegrationAuthority({ targetRoot,
    readAcceptedOperation: acceptedForPromotion, readDeliverySource: readSessionDeliverySource }) : null;
  const sessionBranchIntegration = integrationAuthority ? createStandardSessionBranchIntegration({ targetRoot, now,
    readSource: (instance, input) => integrationAuthority.readSource(instance, input), readCurrent: id => current(id).record,
    async readDecision(instance, input) {
      const selected = acceptedForPromotion(instance, input.decision_operation_id, "session_branch_integration_decision", "STANDARD_SESSION_INTEGRATION_DECISION_REQUIRED");
      await verifyHumanRecord(selected.record);
      const capture = human.captured(selected.record), question = human.question(selected.record), output = selected.output;
      if (output.effect_status !== "no_effect" || output.facts.session_branch_integration_requested !== true || output.observations.choice !== "integrate-to-session"
        || output.observations.source_sha256 !== shadowHash(capture.source) || output.observations.question_sha256 !== shadowHash(question)
        || output.observations.review_sha256 !== shadowHash(question.review)) fail("STANDARD_SESSION_INTEGRATION_DECISION_REQUIRED");
      return { decision_operation_id: input.decision_operation_id, choice: capture.source.choice,
        source_sha256: shadowHash(capture.source), plan: selected.record.preview.prepared.plan };
    } }) : null;
  async function readSessionIntegration(instance, input) {
      const selected = acceptedForPromotion(instance, input.integration_operation_id, "session_branch_integrate", "STANDARD_SESSION_PR_INTEGRATION_REQUIRED");
      const plan = selected.record.preview.prepared.plan;
      const canonical = await integrationAuthority.readSource(instance, { contract_version: "standard-session-branch-integration-review-input.v1",
        delivery_operation_id: plan.review.delivery_operation_id, closure_operation_id: plan.review.closure_operation_id });
      const { git, ...prior } = plan.review;
      if (shadowHash(canonical) !== shadowHash(prior)) fail("STANDARD_SESSION_PR_CONTEXT_CHANGED");
      return { integration_operation_id: input.integration_operation_id, plan_sha256: shadowHash(plan), plan, output: selected.output, canonical };
  }
  const sessionPrAdmission = integrationAuthority ? createStandardSessionPrAdmission({ targetRoot, readIntegration: readSessionIntegration }) : null;
  async function readSessionPrAdmission(instance, input) {
    const selected = acceptedForPromotion(instance, input.admission_operation_id, "session_pr_admit", "STANDARD_SESSION_PUSH_ADMISSION_REQUIRED");
    const fresh = await sessionPrAdmission.prepare(instance, selected.record.preview.input);
    if (!fresh.can_apply || fresh.integration_source_sha256 !== selected.record.preview.prepared.integration_source_sha256)
      fail("STANDARD_SESSION_PUSH_ADMISSION_CHANGED");
    return { admission_operation_id: input.admission_operation_id, output: selected.output,
      integration_source_sha256: fresh.integration_source_sha256 };
  }
  const sessionPush = sessionPrAdmission && sessionPushPort ? createStandardSessionPush({ targetRoot, now, pushPort: sessionPushPort,
    readCurrent: id => current(id).record, readAdmission: readSessionPrAdmission }) : null;
  const sessionPrOpen = sessionPush && sessionPullRequestPort ? createStandardSessionPrOpen({ targetRoot, now, pullRequestPort: sessionPullRequestPort,
    readCurrent: id => current(id).record,
    async readPush(instance, input) {
      const selected = acceptedForPromotion(instance, input.push_operation_id, "session_push", "STANDARD_SESSION_PR_OPEN_PUSH_REQUIRED");
      const plan = selected.record.preview.prepared.plan, admission = await readSessionPrAdmission(instance, plan.input);
      if (shadowHash(admission) !== plan.admission_sha256 || selected.output.facts.session_remote_head_confirmed !== true)
        fail("STANDARD_SESSION_PR_OPEN_PUSH_CHANGED");
      const git = await sessionPushPort.inspect(plan.git.branch), result = selected.output.observations.git;
      if (git.head !== git.remote_head || git.head !== plan.git.head || git.local_sha256 !== plan.git.local_sha256
        || shadowHash({ ...git, changed: result.changed, effect_status: result.effect_status }) !== shadowHash(result)) fail("STANDARD_SESSION_PR_OPEN_REMOTE_CHANGED");
      return { push_operation_id: input.push_operation_id, output: selected.output, admission: admission.output,
        admission_source_sha256: shadowHash(admission) };
    } }) : null;
  const sessionPrRecordAuthority = sessionPrOpen ? createStandardSessionPrRecordAuthority({ targetRoot,
    readAcceptedOperation: acceptedForPromotion, pullRequestPort: sessionPullRequestPort }) : null;
  const sessionPrRecord = sessionPrRecordAuthority ? createStandardSessionPrRecord({ targetRoot, now,
    readSource: (instance, input) => sessionPrRecordAuthority.readSource(instance, input), readCurrent: id => current(id).record }) : null;
  const sessionPrSuccessor = sessionPrRecordAuthority ? createStandardSessionPrSuccessorAuthority({ targetRoot,
    readAcceptedOperation: acceptedForPromotion, historyAuthority: sessionPrRecordAuthority }) : null;
  const sessionPrCheckpoint = sessionPrSuccessor ? createStandardSessionPrCheckpoint({ targetRoot, now,
    readSource: (instance, input) => sessionPrSuccessor.readSource(instance, input), readCurrent: id => current(id).record }) : null;
  const sessionPrUpdatePush = sessionPrSuccessor ? createStandardSessionPrUpdatePush({ targetRoot, now,
    readCheckpoint: (instance, input) => sessionPrSuccessor.readCheckpoint(instance, input), readCurrent: id => current(id).record,
    pushPort: sessionPushPort, pullRequestPort: sessionPullRequestPort }) : null;
  function readAcceptedPrUpdate(instance, id) {
    const intent = instance.events.find(event => event.kind === "operation_intent" && event.intent.operation_id === id)?.intent;
    if (!["session_pr_update_push", "session_pr_redelivery_push"].includes(intent?.binding_ref)) fail("STANDARD_PR_REVIEW_UPDATE_REQUIRED");
    return acceptedForPromotion(instance, id, intent.binding_ref, "STANDARD_PR_REVIEW_UPDATE_REQUIRED");
  }
  const sessionPrRedeliveryAuthority = integrationAuthority ? createStandardSessionPrRedeliveryAuthority({
    readAcceptedOperation: acceptedForPromotion, readAcceptedUpdate: readAcceptedPrUpdate, readIntegration: readSessionIntegration,
    inspectIntegration: plan => createLocalWorkflowBranchIntegration({ targetRoot }).inspectIntegration({
      operation_id: plan.operation_id, plan_sha256: shadowHash(plan), observed: plan.review.git }) }) : null;
  const sessionPrRedeliveryPush = sessionPrRedeliveryAuthority && sessionPushPort && sessionPullRequestPort ? createStandardSessionPrUpdatePush({ targetRoot, now,
    redelivery: true, readCheckpoint: sessionPrRedeliveryAuthority.readSource, readCurrent: id => current(id).record,
    pushPort: sessionPushPort, pullRequestPort: sessionPullRequestPort }) : null;
  const sessionPrReviewAuthority = sessionPrSuccessor && sessionReviewPort ? createStandardSessionPrReviewAuthority({
    readAcceptedOperation: acceptedForPromotion, readAcceptedUpdate: readAcceptedPrUpdate, readRedelivery: sessionPrRedeliveryAuthority?.readSource,
    readCheckpoint: sessionPrSuccessor.readCheckpoint, inspectPush: (branch, options) => sessionPushPort.inspect(branch, options) }) : null;
  const sessionPrReview = sessionPrReviewAuthority ? createStandardSessionPrReviewObservation({ now, reviewPort: sessionReviewPort,
    readCurrent: id => current(id).record, readConfirmedHead: sessionPrReviewAuthority.readConfirmedHead }) : null;
  const reviewContentObserver = reviewPort => createStandardSessionPrReviewContentObservation({ now, reviewPort,
    readCurrent: id => current(id).record, readConfirmedHead: sessionPrReviewAuthority.readConfirmedHead });
  const sessionPrReviewContent = sessionPrReviewAuthority && processModels(model).some(component => component.nodes.some(node => node.binding_ref === "session_pr_review_content_observe"))
    ? reviewContentObserver(sessionReviewPort) : null;
  if (sessionReviewEventPort !== null && (!sessionPrReviewContent
    || ![sessionReviewEventPort.readEvent, sessionReviewEventPort.verifyEvent].every(fn => typeof fn === "function")))
    fail("STANDARD_HOST_REVIEW_EVENT_CONFIGURATION_INVALID");
  const reviewControlSource = sessionReviewEventPort && createStandardPrReviewControlSource({ now, observer: sessionPrReviewContent,
    readEvent: input => sessionReviewEventPort.readEvent(input), verifyEvent: input => sessionReviewEventPort.verifyEvent(input),
    withReviewReads: sessionReviewEventPort.withReviewReads, observerFor: reviewContentObserver,
    async readContext({ request, signal }) {
      if (signal?.aborted) fail("PROCESS_CONTROL_PR_ABORTED");
      const actual = controlRequest({ instanceId: request.instance_id, expectedSha256: request.instance_sha256, occurrenceId: request.occurrence_id });
      const state = current(request.instance_id), frame = state.cursor.occurrences.find(row => row.occurrence_id === request.occurrence_id);
      if (!prReviewWaitNodes.has(frame?.node_id) || shadowHash(actual) !== shadowHash(request)) fail("PROCESS_CONTROL_PR_CONTEXT_CHANGED");
      const latest = state.record.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "session_pr_review_content_observe").at(-1);
      const accepted = acceptedForPromotion(state.record, latest?.intent.operation_id, "session_pr_review_content_observe", "PROCESS_CONTROL_PR_OBSERVATION_REQUIRED");
      const input = accepted.record.preview.input;
      if (accepted.output.facts.session_pr_review_evidence_available !== true
        || accepted.output.observations.update_operation_id !== input.update_operation_id) fail("PROCESS_CONTROL_PR_OBSERVATION_REQUIRED");
      const update = readAcceptedPrUpdate(state.record, input.update_operation_id);
      const latestUpdate = state.record.events.findLast(row => row.kind === "operation_intent"
        && ["session_pr_update_push", "session_pr_redelivery_push"].includes(row.intent.binding_ref));
      const p = update.output.observations.pull_request, notBefore = update.record.preview.prepared.plan.prepared_at_ms;
      const { evidence } = accepted.output.observations, observed = evidence.pull_request;
      if (latestUpdate?.intent.operation_id !== input.update_operation_id || update.output.facts.session_pr_head_confirmed !== true
        || !Number.isSafeInteger(notBefore) || p.state !== "OPEN" || p.draft || p.head_oid !== request.head || p.head_branch !== request.branch
        || evidence.repository.node_id !== p.repository_id || observed.node_id !== p.node_id || observed.number !== p.number
        || observed.head_oid !== p.head_oid || observed.base_oid !== p.base_oid || observed.head_ref !== p.head_branch
        || observed.base_ref !== p.base_branch) fail("PROCESS_CONTROL_PR_OBSERVATION_REQUIRED");
      const reviewSubject = { repository_id: p.repository_id, pull_request_id: p.node_id, pull_request_number: p.number,
        head_oid: p.head_oid, base_oid: p.base_oid, head_ref: p.head_branch, base_ref: p.base_branch, not_before_ms: notBefore };
      return { instance: state.record, request_sha256: shadowHash(actual), input, reviewSubject };
    } });
  const activeControlSource = reviewControlSource ? { ...controlSource, ...reviewControlSource } : controlSource;
  function verifyPrReviewEvent(capture, options) {
    return reviewControlSource?.verifyCapturedEvent(capture, options) ?? fail("STANDARD_PR_RECEIVE_AUTHORITY_REQUIRED");
  }
  function readDeliveredPrReview(instance, input) {
      assertStandardOperationInput("session_pr_review_receive", input);
      const frames = inspectAgenticProcess(instance).occurrences;
      const candidates = instance.events.filter(row => row.kind === "control")
        .map(event => ({ event, frame: frames.find(row => row.occurrence_id === event.occurrence_id), capture: controls.read(event.delivery.delivery_id) }))
        .filter(row => prReviewWaitNodes.has(row.frame?.node_id) && row.capture.contract_version === "process-control-inbox.v2"
          && row.capture.payload.observation.observations.update_operation_id === input.update_operation_id);
      if (candidates.length !== 1 || candidates[0].frame.status !== "COMPLETED") fail("STANDARD_PR_RECEIVE_EVENT_REQUIRED");
      const { event, capture } = candidates[0];
      if (capture.contract_version !== "process-control-inbox.v2" || capture.phase !== "delivered"
        || shadowHash(capture.delivery) !== shadowHash(event.delivery) || capture.request.occurrence_id !== event.occurrence_id
        || capture.request.scope_id !== instance.scope_id || capture.request.model_sha256 !== instance.model_sha256
        || capture.request.instance_id !== instance.instance_id || capture.delivered_instance_sha256 !== controlCheckpoint(instance, event.event_id))
        fail("STANDARD_PR_RECEIVE_EVENT_REQUIRED");
      readAcceptedPrUpdate(instance, capture.payload.observation.observations.update_operation_id);
      return capture;
  }
  const sessionPrReviewReceiver = sessionPrReviewContent && createStandardPrReviewReceiver({ observer: sessionPrReviewContent,
    verifyEvent: verifyPrReviewEvent, readDelivered: readDeliveredPrReview });
  function acceptedReviewEffects(instance, triageId, binding, observation) {
    const receipts = new Map(instance.events.filter(event => event.kind === "operation_result" && event.receipt.outcome === "completed")
      .map(event => [event.receipt.operation_id, event.receipt]));
    return instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === binding
      && receipts.has(event.intent.operation_id)).flatMap(({ intent }) => {
      const record = retained(intent.operation_id).record, last = record.results.at(-1);
      if (record.phase !== "receipted" || shadowHash(record.intent) !== shadowHash(intent)
        || shadowHash(last.receipt) !== shadowHash(receipts.get(intent.operation_id))) fail("STANDARD_PR_REVIEW_EFFECT_HISTORY_CHANGED");
      if (record.preview.input.triage_operation_id !== triageId) return [];
      return [assertStandardOperationOutput(last.output).observations[observation]];
    });
  }
  const acceptedReviewPorts = { now, reviewPort: sessionReviewPort, readAccepted: acceptedForPromotion,
    readAcceptedUpdate: readAcceptedPrUpdate, readCurrent: id => current(id).record,
    readDelivered: readDeliveredPrReview, verifyEvent: verifyPrReviewEvent,
    readAcceptedReplies: (instance, triageId) => acceptedReviewEffects(instance, triageId, "session_pr_review_reply_publish", "reply") };
  const sessionPrMerge = createStandardSessionPrMergeObservation(acceptedReviewPorts);
  const sessionPrPremerge = createStandardSessionPrMergeObservation(acceptedReviewPorts, { preflight: true });
  const sessionPrEffects = createStandardPrReviewEffectsVerification(acceptedReviewPorts);
  const sessionPrReply = createStandardPrReviewReply(acceptedReviewPorts);
  const sessionPrResolution = createStandardPrReviewResolution({ ...acceptedReviewPorts,
    readAcceptedResolutions: (instance, triageId) => acceptedReviewEffects(instance, triageId, "session_pr_review_thread_resolve", "resolution") });
  const assertResolutionExceptionFresh = (instance, record, signal) => sessionPrResolution.assertExceptionFresh(
    instance, record.preview.input, record.preview.prepared, signal);
  const sessionPrConsent = createStandardPrMergeConsent({ ...acceptedReviewPorts, resolution: sessionPrResolution,
    verifyFreshDecision: (record, signal) => human.verifyCaptured(record, signal, { acknowledged: true }) });
  const assertMergeConsentFresh = (instance, record, signal) => sessionPrConsent.assertFresh(
    instance, record.preview.input, record.preview.prepared, signal);
  const sessionPrMergeEffect = createStandardPrMergeExecute({ ...acceptedReviewPorts, assertConsentFresh: assertMergeConsentFresh,
    verifyFreshDecision: (record, signal) => human.verifyCaptured(record, signal, { acknowledged: true }) });
  const postMerge = createStandardSessionPrPostMergeFetch(acceptedReviewPorts);
  const postMergeScope = () => postMergeProjectScope(targetRoot);
  const postMergeDecision = createStandardPostMergeDecision({ ...acceptedReviewPorts, artifacts, postMerge, scopeSha: postMergeScope, now });
  const assertPostMergeDecisionFresh = (instance, record, signal) => postMergeDecision.assertFresh(
    instance, record.preview.input, record.preview.prepared, signal);
  const postMergeCompletion = createStandardPostMergeCompletion({ ...acceptedReviewPorts, artifacts,
    readAlignmentSource: postMerge.alignmentSource, scopeSha: postMergeScope });
  const reviewEffects = new Map([
    [mergeExecuteOperation, sessionPrMergeEffect],
    [postMergeFetchOperation, postMerge],
    [postMergeCompleteOperation, postMergeCompletion],
    ["session_pr_review_reply_publish", sessionPrReply],
    ["session_pr_review_thread_resolve", sessionPrResolution],
  ]);
  const prTriage = processAuthority && sessionPrReviewReceiver ? createStandardPrTriageSource({
    readReceived: (instance, id) => acceptedForPromotion(instance, id, "session_pr_review_receive", "STANDARD_PR_TRIAGE_RECEIVED_REQUIRED"),
    observeReceived: (instance, input, options) => sessionPrReviewReceiver.observe(instance, input, options),
    observeProduct: () => processAuthority.observeProduct(), readNative: (instance, input) => processAuthority.readPrTriageActivity(instance, input) }) : null;
  const prCorrectionAuthority = prTriage && reviewControlSource ? createStandardPrCorrectionAuthority({
    readAcceptedUpdate: readAcceptedPrUpdate,
    readAcceptedOperation: acceptedForPromotion,
    reevaluateTriage: (instance, input, options) => prTriage.evaluate(instance, input, options),
    readControl: id => controls.read(id),
    verifyEvent: (capture, options) => reviewControlSource.verifyCapturedEvent(capture, options),
    observeProduct: () => processAuthority.observeProduct(),
    inspectPush: (branch, options) => sessionPushPort.inspect(branch, options),
    observeRemote: (branch, options) => {
      if (typeof sessionPushPort?.observeRemote !== 'function') fail('STANDARD_PR_CORRECTION_REMOTE_OBSERVATION_REQUIRED');
      return sessionPushPort.observeRemote(branch, options);
    },
    observeOwnedPush: (branch, options) => {
      if (typeof sessionPushPort?.observeOwned !== 'function') fail('STANDARD_PR_CORRECTION_OWNED_OBSERVATION_REQUIRED');
      return sessionPushPort.observeOwned(branch, options);
    },
    readCurrent: id => current(id).record, reviewPort: sessionReviewPort, now }) : null;
  const prCorrectionReopen = prCorrectionAuthority ? createStandardPrCorrectionReopen({ targetRoot, now,
    authority: prCorrectionAuthority, readCurrent: id => current(id).record,
    readCurrentPrefix: id => service.inspect(id).record }) : null;
  const prCorrectionCheckpoint = prCorrectionAuthority ? createStandardPrCorrectionCheckpoint({ targetRoot, now,
    authority: prCorrectionAuthority, readAcceptedOperation: acceptedForPromotion, readDispatchedOperation: readDispatchedCheckpoint,
    readCurrent: id => current(id).record }) : null;
  const prCorrectionCycle = prCorrectionCheckpoint ? createStandardPrCorrectionCycle({ targetRoot, now, operations,
    readAcceptedOperation: acceptedForPromotion, readCheckpoint: prCorrectionCheckpoint.readCompleted,
    verifyContinuationSource: prCorrectionAuthority.verifyContinuationSource, observeProduct: () => processAuthority.observeProduct(),
    readCurrent: id => current(id).record }) : null;
  const prCorrectionReview = prCorrectionCheckpoint ? createStandardPrCorrectionReview({ readCheckpoint: prCorrectionCheckpoint.readCompleted,
    readCycleInventory: () => artifacts.cycles().map(row => ({ cycle_id: row.cycle_id, path: row.path, sha256: row.sha256, metadata_sha256: artifacts.metadataHash(row.path) })) }) : null;
  const sessionGitCheckpoint = processModels(model).some(component => component.nodes.some(node => node.binding_ref === "session_git_checkpoint")) ? createStandardWorkflowGitCheckpoint({ targetRoot, now, readCurrent: id => current(id).record,
    readContext(instance, input) {
      const context = acceptedForPromotion(instance, input.context_operation_id, "cycle_context_refresh", "STANDARD_GIT_ACCEPTED_CONTEXT_REQUIRED");
      const startId = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === "session_start_finalize").at(-1)?.intent.operation_id;
      if (!startId) fail("STANDARD_GIT_ACCEPTED_START_REQUIRED");
      const start = acceptedForPromotion(instance, startId, "session_start_finalize", "STANDARD_GIT_ACCEPTED_START_REQUIRED");
      if (start.record.preview.input.session_id !== context.record.preview.prepared.plan.input.session_id) fail("STANDARD_GIT_ACCEPTED_START_REQUIRED");
      return { context_plan: context.record.preview.prepared.plan, context_output: context.output, start_operation_id: startId, start_output: start.output };
    } }) : null;
  const promotionAuthority = processAuthority ? createStandardBaselinePromotionAuthority({ targetRoot,
    readAcceptedOperation: acceptedForPromotion, readTerminalRecord: readAcceptedTerminalRecord,
    human: { question: record => human.question(record), captured: record => human.captured(record) } }) : null;
  const baselinePromotion = processAuthority ? createStandardBaselinePromotion({ targetRoot, now,
    readRequest: (instance, input) => promotionAuthority.readRequest(instance, input),
    observeProduct: () => processAuthority.observeProduct(), readCurrent: id => current(id).record }) : null;
  const promotionReview = processAuthority ? createStandardBaselinePromotionReview({
    readClosure: (instance, input) => promotionAuthority.readClosure(instance, input), promotion: baselinePromotion, now }) : null;

  async function readAcceptedBaselineRecord(instance, input) {
    const selected = acceptedForPromotion(instance, input.record_operation_id, "baseline_promotion_record"), plan = selected.record.preview.prepared.plan;
    const source = await promotionAuthority.readRequest(instance, plan.input);
    if (baselinePromotionSourceMaterialSha256(source) !== plan.source_material_sha256
      || selected.output.effect_status !== "confirmed" || selected.output.facts.baseline_recorded !== true || selected.output.facts.baseline_promotion_completed !== false)
      fail("STANDARD_PROMOTION_HOOK_RECORD_REQUIRED");
    return { record_operation_id: selected.record.operation_id, plan, output: selected.output };
  }
  async function readAcceptedPromotionCheckpointSource(instance, input) {
    const promoted = await readAcceptedBaselineRecord(instance, { record_operation_id: input.record_operation_id });
    const closure = acceptedForPromotion(instance, input.closure_operation_id, "cycle_close_finalize"), closedPlan = closure.record.preview.prepared.plan;
    const checkpoint = acceptedForPromotion(instance, input.terminal_checkpoint_operation_id, "cycle_terminal_checkpoint"), checkpointPlan = checkpoint.record.preview.prepared.plan;
    if (promoted.plan.request.closure_operation_id !== input.closure_operation_id
      || closedPlan.input.closure_operation_id !== checkpointPlan.input.closure_operation_id
      || checkpointPlan.cycle_id !== promoted.plan.request.cycle_id || checkpointPlan.cycle_path !== promoted.plan.request.cycle_path
      || closure.output.effect_status !== "confirmed" || closure.output.facts.cycle_close_completed !== true || closure.output.facts.cycle_retained !== true
      || checkpoint.output.effect_status !== "confirmed" || checkpoint.output.facts.cycle_terminal_checkpoint_completed !== true
      || checkpointPlan.target_state !== "DONE") fail("STANDARD_PROMOTION_CHECKPOINT_PROVENANCE_REQUIRED");
    const approved = new Map();
    for (const ref of closure.output.evidence_refs) if (ref.ref.startsWith("docs/audit/")) approved.set(ref.ref.slice(11), ref.sha256);
    for (const row of promoted.plan.changes) approved.set(row.path, row.after_sha256);
    const expected = [...baselinePromotionPaths, promoted.plan.request.cycle_path + "/status.md"].sort();
    if (shadowHash([...approved.keys()].sort()) !== shadowHash(expected)) fail("STANDARD_PROMOTION_CHECKPOINT_POSTIMAGES_REQUIRED");
    const git = checkpoint.output.observations.git;
    return { request: promoted.plan.request, session_id: checkpointPlan.session_id,
      source_material_sha256: shadowHash({ promoted, closure: { plan: closedPlan, output: closure.output }, checkpoint: { plan: checkpointPlan, output: checkpoint.output } }),
      record_context_sha256: promoted.output.observations.causal_transition.after_context_sha256,
      completion_boundary_sha256: promoted.output.observations.causal_transition.completion_boundary_sha256,
      parent_head: git.commit_sha ?? git.head, approved_postimages: [...approved.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256 })) };
  }
  const baselinePromotionCheckpoint = processAuthority && processModels(model).some(component => component.nodes.some(node => node.binding_ref === "baseline_promotion_checkpoint"))
    ? createStandardBaselinePromotionCheckpoint({ targetRoot, now, readSource: readAcceptedPromotionCheckpointSource,
      promotion: baselinePromotion, readCurrent: id => current(id).record }) : null;
  const baselinePromotionHook = processAuthority ? createStandardBaselinePromotionHook({ targetRoot, now,
    readRecorded: readAcceptedBaselineRecord, promotion: baselinePromotion, readCurrent: id => current(id).record }) : null;

  async function readValidationEvaluation(instance, input, operation = "cycle_verification_enter") {
      assertStandardOperationInput(operation, input);
      const record = retained(input.evaluation_operation_id).record, result = record.results.at(-1);
      if (record.intent.binding_ref !== "cycle_validation_evaluate" || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id
        || record.phase !== "receipted" || result?.receipt.outcome !== "completed"
        || !instance.events.some(row => row.kind === "operation_result" && shadowHash(row.receipt) === shadowHash(result.receipt))) fail("STANDARD_VERIFICATION_EVALUATION_REQUIRED");
      const verified = await evaluateValidation(instance, record.preview.input);
      if (shadowHash(verified.output) !== shadowHash(result.output)) fail("STANDARD_VERIFICATION_EVALUATION_STALE");
      return { output: verified.output, evaluation_sha256: shadowHash(verified.output), context: verified.source.context, context_sha256: verified.source.context_sha256, source: verified.source, evidence: verified.evidence };
  }
  const cycleVerification = processAuthority ? createStandardCycleVerification({ targetRoot, now,
    readEvaluation: readValidationEvaluation, observeContext: () => processAuthority.observeCycleVerificationContext(), readCurrent: id => current(id).record }) : null;
  const cycleTaskAdvance = processAuthority ? createStandardCycleTaskAdvance({ targetRoot, now,
    readEvaluation: (instance, input) => readValidationEvaluation(instance, input, "cycle_task_advance"),
    observeContext: () => processAuthority.observeCycleReadinessContext(), readCurrent: id => current(id).record }) : null;
  const recoveryCycle = processAuthority ? createStandardDriftCycle({ targetRoot, operations, now,
    readSource: (instance, operation, input) => cycleRecoverySource(instance, operation, input),
    observeContext: () => processAuthority.observeDriftContext(), readCurrent: id => current(id).record }) : null;
  const bindings = new Map(standardWorkflowOperationBindings().map(value => [value.id, value]));
  function assertCurrentBindings() {
    for (const component of processModels(model)) for (const node of component.nodes.filter(node => node.kind === "operation"))
      if (!bindings.has(node.binding_ref) || component.operation_pins[node.binding_ref] !== shadowHash(bindings.get(node.binding_ref))) fail("STANDARD_HOST_BINDING_CHANGED");
  }
  const signer = createOperationJournalSigner(readSigningKey), generation = randomUUID();
  const initialExecution = readWorkflowProjectExecutionAuthority({ targetRoot }), initial = initialExecution.project;
  const options = { targetRoot, stateMode: initial.stateMode }, store = createAgenticProcessStore(options), journal = createProcessOperationJournalStore(options);
  const projectionRequired = initial.stateMode === "dual" || initial.stateMode === "files" && initialExecution.persistence.backend === "postgres";
  const human = createStandardHumanDecisions({ inbox: createProcessDecisionInboxStore(options), signer, source: humanSource,
    projectionRequired });
  const objectiveDisposition = createStandardObjectiveDisposition({ now, human,
    readOperation: id => retained(id).record,
    assertFresh: async (instance, review) => { processAuthority.authenticate(instance); await recovery.assertFresh(instance, review); } });
  const objectiveCompletion = processAuthority ? createStandardObjectiveCompletion({ now,
    readOperation: id => retained(id).record,
    readEvaluation: (instance, input) => processAuthority.readDriftEvaluation(instance, input),
    readDisposition: (instance, input, verified) => objectiveDisposition.read(instance, input, verified),
    readHistoricalDisposition: (instance, input, verified, id) => objectiveDisposition.readHistorical(instance, input, verified, id),
    readRenewedDisposition: (instance, input, verified, anchor) => objectiveDisposition.readRenewed(instance, input, verified, anchor),
    readCurrent: id => current(id).record,
    readReport: name => artifacts.read(name, { required: true }),
    readEvent: ({ file, offset }) => {
      if (file !== ".aidn/runtime/perf/workflow-events.ndjson" || !Number.isSafeInteger(offset) || offset < 0)
        fail("STANDARD_OBJECTIVE_COMPLETION_EVENT_CHANGED");
      const bytes = readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, file)), { json: false, maxBytes: 4194304 }).value;
      const end = bytes.indexOf(10, offset);
      if (offset > 0 && bytes[offset - 1] !== 10 || end < offset || end - offset >= 65536)
        fail("STANDARD_OBJECTIVE_COMPLETION_EVENT_CHANGED");
      return bytes.subarray(offset, end + 1);
    } }) : null;
  function verifyHumanRecord(record, signal) {
    const accepted = current(record.intent.instance_id).record.events.some(event => event.kind === "operation_result"
      && event.receipt.operation_id === record.operation_id && record.results.some(result => shadowHash(result.receipt) === shadowHash(event.receipt)));
    return human.verifyCaptured(record, signal, { historical: accepted });
  }
  const controls = createStandardControlInbox({ store: createProcessControlInboxStore(options), signer, source: activeControlSource,
    projectionRequired });
  function readAuthority() {
    assertCurrentBindings();
    if (processAuthority) return processAuthority.read();
    // One complete fresh activation describes both authorities at this same
    // synchronous boundary. Never retain it for a later call or await.
    const { project, persistence } = readWorkflowProjectExecutionAuthority({ targetRoot });
    return executionAuthority({ project, persistence });
  }
  function executionAuthority({ project, persistence }) {
    if (project.stateMode !== initial.stateMode) fail("STANDARD_HOST_STATE_MODE_CHANGED");
    return { scope_id: shadowHash({ project: project.scope, persistence: persistence.binding_sha256,
      operation_host: { version: 1, state_mode: project.stateMode, key_id: signer.keyId, ...(source ? { model_source_sha256: shadowHash(source) } : {}),
        ...(activeControlSource ? { control_inbox_version: 1 } : {}) } }), model_sha256: shadowHash(model), policy_pins: agenticPolicyPins(model) };
  }
  function scope(instance) {
    const authority = readAuthority();
    if (instance.scope_id !== authority.scope_id || instance.model_sha256 !== authority.model_sha256
      || shadowHash(instance.policy_pins) !== shadowHash(authority.policy_pins)) fail("STANDARD_HOST_AUTHORITY_CHANGED");
  }
  function snapshot() {
    if (processAuthority) return processAuthority.snapshot();
    return snapshotWithScope(operations.observeScope());
  }
  function snapshotWithScope(context) {
    return { ...(source ? { model_source: source } : {}), context, documents: ["CURRENT-STATE.md", "SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md", "baseline/current.md", "snapshots/context-snapshot.md"]
      .map(path => { const row = artifacts.read(path, { required: true }); return { path, sha256: row.sha256 }; }) };
  }
  function observeBoundary() {
    if (processAuthority) return { authority: readAuthority(), context: snapshot() };
    assertCurrentBindings();
    const observed = operations.observeExecutionScope();
    return { authority: executionAuthority(observed.authority), context: snapshotWithScope(observed.context) };
  }
  function validatePreview(preview) {
    if (validateJsonSchema(preview, previewSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_HOST_PREVIEW_INVALID");
    signer.verify(preview); assertProcessOperationBinding(preview.binding); assertStandardOperationInput(preview.binding.id, preview.input);
    if (preview.binding.id === "session_pr_correction_reopen" && preview.prepared?.can_apply) {
      assertStandardPrCorrectionPlan(preview.prepared.plan);
      if (shadowHash(preview.prepared.plan) !== preview.prepared.plan_sha256
        || shadowHash(preview.input) !== shadowHash(preview.prepared.plan.input)) fail("STANDARD_HOST_PREVIEW_INVALID");
    }
    if (preview.binding.id === "session_pr_correction_checkpoint" && preview.prepared?.can_apply) {
      assertStandardPrCorrectionCheckpointPlan(preview.prepared.plan);
      if (shadowHash(preview.prepared.plan) !== preview.prepared.plan_sha256
        || shadowHash(preview.input) !== shadowHash(preview.prepared.plan.input)) fail("STANDARD_HOST_PREVIEW_INVALID");
    }
    assertStandardResolvedPreview(preview, model);
    if (shadowHash(bindings.get(preview.binding.id)) !== shadowHash(preview.binding)) fail("STANDARD_HOST_BINDING_CHANGED");
    return preview;
  }
  function retained(id) {
    const value = journal.read(id);
    if (!value.record) fail("PROCESS_JOURNAL_NOT_FOUND");
    signer.verify(value.record); validatePreview(value.record.preview);
    if (value.record.preview.binding.executor_kind === "human" && value.record.results.length) {
      const recovery = postMergeRecoveryResult(value.record);
      if (recovery) signer.verify(recovery.output.observations.plan);
      else human.captured(value.record);
    }
    return value;
  }
  function readDispatchedCheckpoint(instance, id) {
    return readDispatchedOperation(instance, id, 'session_pr_correction_checkpoint', 'STANDARD_PR_CORRECTION_CHECKPOINT_DISPATCH_REQUIRED');
  }
  function readDispatchedOperation(instance, id, binding, reason) {
    const record = retained(id).record, state = current(instance.instance_id);
    const frame = state.cursor.occurrences.find(row => row.occurrence_id === record.intent.occurrence_id);
    const receipt = record.results.at(-1)?.receipt;
    const unknown = record.phase === 'receipted' && receipt?.outcome === 'reconciliation_required' && receipt.effect_status === 'unknown';
    if (record.intent.binding_ref !== binding || !(record.phase === 'dispatching' && !record.results.length || unknown)
      || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id
      || state.record.instance_sha256 !== instance.instance_sha256 || frame?.status !== 'WAITING'
      || !frame.operation || frame.operation.receipt && shadowHash(frame.operation.receipt) !== shadowHash(receipt)
      || shadowHash(frame.operation.intent) !== shadowHash(record.intent))
      fail(reason);
    return record;
  }
  function persist(body, expected) {
    const record = signer.seal(body), result = journal.compareAndSwap(record, expected);
    if (result.projection === "pending") {
      try { journal.materialize(record.operation_id, { write: true }); }
      catch { fail("PROCESS_JOURNAL_PROJECTION_RECONCILIATION_REQUIRED"); }
    }
    return record;
  }
  async function grantFor(preview, signal, exactSha = shadowHash(preview)) {
    if (["read-only", "preview"].includes(preview.binding.effect_class)) return null;
    const controller = new AbortController(); let timer;
    const pending = Promise.resolve().then(() => authorize({ binding: structuredClone(preview.binding), input: structuredClone(preview.input),
      preview_sha256: exactSha, prepared: structuredClone(preview.prepared), scope_id: preview.scope_id, signal: signal ?? controller.signal }));
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("STANDARD_HOST_AUTHORIZATION_TIMEOUT"), { code: "STANDARD_HOST_AUTHORIZATION_TIMEOUT" })); }, 5000); });
    let grant;
    try { grant = await Promise.race([pending, timeout]); } finally { clearTimeout(timer); controller.abort(); }
    if (!grant || Object.keys(grant).sort().join(",") !== "authority_id,authorized,grant_sha256,principal_sha256" || grant.authorized !== true
      || !processId(grant.authority_id) || ![grant.principal_sha256, grant.grant_sha256].every(value => /^[a-f0-9]{64}$/.test(value))) fail("STANDARD_HOST_AUTHORIZATION_REQUIRED");
    return grant;
  }
  async function verifyGrant(record, signal) {
    if (shadowHash(await grantFor(record.preview, signal)) !== shadowHash(record.grant)) fail("STANDARD_HOST_AUTHORIZATION_CHANGED");
  }
  function recoveryGrant(record, plan, signal) {
    return grantFor({ ...record.preview, binding: { ...record.preview.binding, effect_class: "mutating" },
      prepared: { action: "question_recovery", plan } }, signal, shadowHash(plan));
  }
  async function verifyRecoveryGrant(record, result, signal) {
    const { plan, grant } = result.output.observations;
    if (shadowHash(await recoveryGrant(record, plan, signal)) !== shadowHash(grant)) fail("STANDARD_HOST_AUTHORIZATION_CHANGED");
  }
  let service, disposition;
  const authority = {
    readCallOperation({ instance, operation_id }) {
      scope(instance);
      return retained(operation_id).record;
    },
    prepare({ instance, occurrence }) {
      const record = retained(operationJournalId(instance, occurrence.occurrence_id)).record;
      if (record.phase !== "staged" || record.intent.instance_sha256 !== instance.instance_sha256) fail("PROCESS_OPERATION_INTENT_BINDING_CHANGED");
      return { binding: record.preview.binding, intent: record.intent };
    },
    async verifyIntent({ intent, binding, instance, signal }) {
      scope(instance); const record = retained(intent.operation_id).record; await verifyGrant(record, signal);
      if (shadowHash(intent) !== shadowHash(record.intent) || shadowHash(binding) !== shadowHash(record.preview.binding)) fail("PROCESS_OPERATION_INTENT_NOT_AUTHENTICATED");
      return { outcome: "verified", authority_id: intent.authority_id, intent_sha256: shadowHash(intent), binding_sha256: shadowHash(binding) };
    },
    readReceipt({ receipt_id, intent }) {
      const record = retained(intent.operation_id).record, result = record.results.find(row => row.receipt.receipt_id === receipt_id);
      if (record.phase !== "receipted" || !result || shadowHash(record.intent) !== shadowHash(intent)) fail("PROCESS_OPERATION_RECEIPT_UNAVAILABLE");
      return result.receipt;
    },
    async verifyReceipt({ receipt, intent, instance, signal }) {
      scope(instance); const record = retained(intent.operation_id).record;
      if (await disposition.verifyReceipt(record, receipt, signal)) {
        if (!record.results.some(row => shadowHash(row.receipt) === shadowHash(receipt)) || shadowHash(record.intent) !== shadowHash(intent)) fail("PROCESS_OPERATION_RESULT_NOT_AUTHENTICATED");
        return { outcome: "verified", authority_id: receipt.authority_id, receipt_sha256: shadowHash(receipt), intent_sha256: shadowHash(intent) };
      }
      const recovery = postMergeRecoveryResult(record);
      if (recovery) {
        if (shadowHash(recovery.receipt) !== shadowHash(receipt) || shadowHash(record.intent) !== shadowHash(intent))
          fail("PROCESS_OPERATION_RESULT_NOT_AUTHENTICATED");
        await verifyRecoveryGrant(record, recovery, signal);
        return { outcome: "verified", authority_id: receipt.authority_id, receipt_sha256: shadowHash(receipt), intent_sha256: shadowHash(intent) };
      }
      await verifyGrant(record, signal);
      if (record.intent.binding_ref === "cycle_closure_decision") await closureReview.assertFresh(instance, record.preview.prepared.plan);
      if (record.intent.binding_ref === "spike_conversion_decision") await spike.assertFresh(instance, record.preview.input, record.preview.prepared);
      if (record.intent.binding_ref === "mode_work_continue_decision") processAuthority.assertModeWorkContinuationFresh(instance, record.preview.input, record.preview.prepared);
      if (record.intent.binding_ref === "session_closure_decision") await sessionClosureReview.assertFresh(instance, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_branch_integration_decision") await sessionBranchIntegration.assertFresh(instance, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_pr_correction_decision") await prCorrectionReview.assertFresh(instance, record.preview.prepared.plan, { signal });
      if (record.preview.binding.executor_kind === "human") await verifyHumanRecord(record, signal);
      if (record.intent.binding_ref === resolutionExceptionOperation) await assertResolutionExceptionFresh(instance, record, signal);
      if (record.intent.binding_ref === postMergeDecisionOperation) {
        postMergeDecision.assertAge(record.preview.prepared);
        if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      }
      if (record.intent.binding_ref === mergeConsentOperation) {
        if (now() >= record.preview.prepared.expires_at_ms) fail("STANDARD_PR_MERGE_CONSENT_EXPIRED");
        if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      }
      if (record.intent.binding_ref === "cycle_closure_decision") await closureReview.assertFresh(instance, record.preview.prepared.plan);
      if (record.intent.binding_ref === "spike_conversion_decision") await spike.assertFresh(instance, record.preview.input, record.preview.prepared);
      if (record.intent.binding_ref === "mode_work_continue_decision") processAuthority.assertModeWorkContinuationFresh(instance, record.preview.input, record.preview.prepared);
      if (record.intent.binding_ref === "session_closure_decision") await sessionClosureReview.assertFresh(instance, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_branch_integration_decision") await sessionBranchIntegration.assertFresh(instance, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_pr_correction_decision") await prCorrectionReview.assertFresh(instance, record.preview.prepared.plan, { signal });
      if (!record.results.some(row => shadowHash(row.receipt) === shadowHash(receipt)) || shadowHash(record.intent) !== shadowHash(intent)) fail("PROCESS_OPERATION_RESULT_NOT_AUTHENTICATED");
      return { outcome: "verified", authority_id: receipt.authority_id, receipt_sha256: shadowHash(receipt), intent_sha256: shadowHash(intent) };
    },
  };
  const controlAuthority = activeControlSource ? {
    read({ delivery_id }) { return controls.read(delivery_id).delivery; },
    async verify({ delivery, signal }) {
      const capture = controls.read(delivery.delivery_id);
      if (shadowHash(snapshot()) !== capture.request.context_sha256) fail("PROCESS_CONTROL_CONTEXT_CHANGED");
      const verified = await controls.verifyDelivery(delivery.delivery_id, signal);
      if (shadowHash(snapshot()) !== capture.request.context_sha256 || shadowHash(verified) !== shadowHash(delivery)) fail("PROCESS_CONTROL_CONTEXT_CHANGED");
      return { outcome: "verified", authority_id: delivery.authority_id, delivery_sha256: shadowHash(delivery) };
    },
  } : undefined;
  service = createAgenticProcessService({ store, readAuthority, operationAuthority: authority, controlAuthority, authorityTimeoutMs: 5000 });
  const current = id => {
    const value = service.inspect(id); scope(value.record);
    return authenticateState(value);
  };
  function authenticateState(value) {
    if (processAuthority) { processAuthority.authenticate(value.record); return value; }
    if (Object.keys(value.record.initial_facts).length) fail("STANDARD_HOST_AUTHENTICATED_FACTS_REQUIRED");
    // Replay proves structure, not origin. Reopening a host must authenticate
    // every earlier operation result against its durable host journal as well.
    const seen = new Map();
    for (const event of value.record.events) {
      if (["facts", "message", "assign", "result"].includes(event.kind)) fail("STANDARD_HOST_HISTORY_AUTHORITY_REQUIRED");
      if (event.kind === "control") {
        const capture = controls.read(event.delivery.delivery_id);
        if (shadowHash(capture.delivery) !== shadowHash(event.delivery)
          || capture.phase === "delivered" && capture.delivered_instance_sha256 !== controlCheckpoint(value.record, event.event_id)) fail("STANDARD_HOST_CONTROL_HISTORY_NOT_AUTHENTICATED");
        continue;
      }
      const id = event.kind === "operation_intent" ? event.intent.operation_id : event.kind === "operation_result" ? event.receipt.operation_id : null;
      if (!id) continue;
      if (!seen.has(id)) seen.set(id, retained(id).record);
      const record = seen.get(id);
      if (event.kind === "operation_intent" && shadowHash(event.intent) !== shadowHash(record.intent)
        || event.kind === "operation_result" && !record.results.some(result => shadowHash(result.receipt) === shadowHash(event.receipt))) fail("STANDARD_HOST_RESULT_HISTORY_NOT_AUTHENTICATED");
    }
    return value;
  }
  function observeReconciliationSubject(id) {
    if (processAuthority) return { instance: current(id).record, authority: readAuthority(), context: snapshot() };
    // Inspect the canonical instance first, then derive its authority and context
    // from one fresh activation in this same synchronous observation. The second
    // inventory boundary repeats everything; no result crosses a call or await.
    const value = service.inspect(id), observed = observeBoundary(), record = value.record;
    if (record.scope_id !== observed.authority.scope_id || record.model_sha256 !== observed.authority.model_sha256
      || shadowHash(record.policy_pins) !== shadowHash(observed.authority.policy_pins)) fail("STANDARD_HOST_AUTHORITY_CHANGED");
    authenticateState(value);
    return { instance: record, ...observed };
  }
  function requireWrite(write, expected, actual) { if (write !== true || expected !== actual) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED"); }
  function controlRequest({ instanceId, expectedSha256, occurrenceId }) {
    if (!activeControlSource) fail("PROCESS_CONTROL_AUTHORITY_UNAVAILABLE");
    const state = current(instanceId);
    if (state.record.instance_sha256 !== expectedSha256) fail("PROCESS_REVISION_CONFLICT");
    const frame = state.cursor.occurrences.find(row => row.occurrence_id === occurrenceId), node = frame && processFrameNode(model, frame);
    if (node?.kind !== "event" || frame.status !== "WAITING") fail("PROCESS_CONTROL_ORDER_INVALID");
    const context = snapshot();
    return assertControlRequest({ contract_version: "process-control-request.v1", scope_id: state.record.scope_id,
      instance_id: state.record.instance_id, instance_sha256: state.record.instance_sha256, model_sha256: state.record.model_sha256,
      instance_revision: state.record.revision, occurrence_id: occurrenceId, correlation_id: frame.correlation_id,
      event_keys: node.branches.map(row => row.event_key), context_sha256: shadowHash(context), branch: context.context.branch, head: context.context.head });
  }
  function decisionInput(instance, input) {
    const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === "mode_decision").at(-1);
    if (!latest || latest.intent.operation_id !== input.decision_operation_id) fail("STANDARD_MODE_DECISION_REQUIRED");
    const record = retained(input.decision_operation_id).record, receipt = record.results.at(-1)?.receipt;
    if (receipt?.outcome !== "completed" || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt))) fail("STANDARD_MODE_DECISION_NOT_ACCEPTED");
    const source = human.captured(record).source;
    if (!["THINKING", "EXPLORING", "COMMITTING"].includes(source.choice)) fail("STANDARD_MODE_DECISION_REQUIRED");
    if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_MODE_DECISION_STALE");
    return { session_id: record.preview.input.session_id, mode: source.choice };
  }
  function resultReceipt(record, output) {
    assertStandardOperationOutput(output);
    const index = record.results.length;
    if (index >= 32) fail("PROCESS_JOURNAL_RESULTS_LIMIT");
    return { contract_version: "process-operation-receipt.v1", receipt_id: receiptId(record.operation_id, index), operation_id: record.operation_id,
      intent_sha256: shadowHash(record.intent), authority_id: record.intent.authority_id, outcome: output.outcome, effect_status: output.effect_status,
      output_sha256: shadowHash(output), facts: output.facts,
      // Physical proof filenames belong to the authenticated output document.
      // The reducer receipt carries its bounded logical reference, not a second
      // copy constrained by the receipt URI grammar.
      evidence_refs: [{ ref: operationOutputRef(record.operation_id, index), sha256: shadowHash(output) }] };
  }
  async function recoveryDecision(instance, input) {
    const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === "drift_recovery_decision").at(-1);
    if (!latest || latest.intent.operation_id !== input.decision_operation_id) fail("STANDARD_RECOVERY_DECISION_REQUIRED");
    const record = retained(input.decision_operation_id).record, receipt = record.results.at(-1)?.receipt;
    if (receipt?.outcome !== "completed" || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt))) fail("STANDARD_RECOVERY_DECISION_NOT_ACCEPTED");
    const choice = human.captured(record).source.choice, review = record.preview.prepared.plan;
    if (review.contract_version !== "standard-drift-recovery-plan.v1") fail("STANDARD_RECOVERY_CONFIRMED_FINDINGS_REQUIRED");
    if (!review.options.some(row => row.choice === choice)) fail("STANDARD_RECOVERY_CHOICE_REQUIRED");
    await recovery.assertFresh(instance, review);
    return { review, choice, decision_operation_id: input.decision_operation_id };
  }
  function recordedRecovery(instance, input, allowedChoices = ["requirements_delta"]) {
    const latest = binding => instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === binding).at(-1)?.intent.operation_id;
    const accepted = (id, binding) => {
      const record = retained(id).record, receipt = record.results.at(-1)?.receipt;
      if (record.phase !== "receipted" || record.intent.binding_ref !== binding || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id
        || receipt?.outcome !== "completed" || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt))) fail("STANDARD_CHANGE_REQUEST_ACCEPTED_RECOVERY_REQUIRED");
      return record;
    };
    if (latest("drift_recovery_record") !== input.recovery_record_operation_id) fail("STANDARD_CHANGE_REQUEST_ACCEPTED_RECOVERY_REQUIRED");
    const record = accepted(input.recovery_record_operation_id, "drift_recovery_record"), output = record.results.at(-1).output;
    const decision = accepted(record.preview.input.decision_operation_id, "drift_recovery_decision"), review = decision.preview.prepared.plan;
    const choice = human.captured(decision).source.choice;
    if (latest("drift_recovery_decision") !== decision.operation_id || latest("drift_report_evaluate") !== review.evaluation_operation_id
      || output.effect_status !== "confirmed" || output.facts.drift_recovery_recorded !== true
      || !allowedChoices.includes(choice) || output.observations.choice !== choice
      || shadowHash(record.preview.prepared.review) !== shadowHash(review)) fail("STANDARD_CHANGE_REQUEST_ACCEPTED_RECOVERY_REQUIRED");
    const evaluation = accepted(review.evaluation_operation_id, "drift_report_evaluate").results.at(-1).output;
    if (shadowHash(evaluation) !== review.evaluation_sha256 || evaluation.facts.drift_context_complete !== true || evaluation.facts.drift_present !== true
      || output.observations.causal_transition?.before_context_sha256 !== review.context_sha256) fail("STANDARD_CHANGE_REQUEST_ACCEPTED_RECOVERY_REQUIRED");
    return { record_operation_id: record.operation_id, choice, review, report: evaluation.observations.report, transition: output.observations.causal_transition };
  }
  function cycleRecoverySource(instance, operation, input) {
    function accepted(id, binding, effect = "confirmed") {
      const record = retained(id).record, output = record.results.at(-1)?.output, receipt = record.results.at(-1)?.receipt;
      const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === binding).at(-1);
      if (latest?.intent.operation_id !== id || record.intent.binding_ref !== binding || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id
        || record.phase !== "receipted" || receipt?.outcome !== "completed" || output?.effect_status !== effect
        || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt))) fail("STANDARD_RECOVERY_CYCLE_SOURCE_REQUIRED");
      return { record, output };
    }
    function base(id) {
      const record = retained(id).record;
      if (record.intent.binding_ref === "drift_recovery_record") return recordedRecovery(instance, { recovery_record_operation_id: id }, ["new_cycle"]);
      const cr = accepted(id, "drift_change_request_record"), selected = recordedRecovery(instance, cr.record.preview.input);
      if (cr.output.facts.drift_change_request_recorded !== true || cr.output.observations.new_cycle_required !== true
        || cr.output.observations.recovery_record_operation_id !== selected.record_operation_id
        || cr.output.observations.causal_transition?.before_context_sha256 !== selected.transition.after_context_sha256) fail("STANDARD_RECOVERY_CYCLE_SOURCE_REQUIRED");
      return { ...selected, source_operation_id: id, transition: cr.output.observations.causal_transition };
    }
    if (operation === "drift_recovery_context_refresh") return base(input.recovery_operation_id);
    function contextSource(id) {
      const refreshed = accepted(id, "drift_recovery_context_refresh"), selected = base(refreshed.record.preview.input.recovery_operation_id);
      if (refreshed.output.facts.drift_recovery_context_refreshed !== true
        || refreshed.record.preview.prepared.plan.source_sha256 !== shadowHash(selected)
        || refreshed.output.observations.causal_transition?.before_context_sha256 !== selected.transition.after_context_sha256) fail("STANDARD_RECOVERY_CYCLE_SOURCE_REQUIRED");
      return { ...selected, source_operation_id: id, transition: refreshed.output.observations.causal_transition };
    }
    if (operation === "drift_recovery_checkpoint_observe") return contextSource(input.context_operation_id);
    const checked = accepted(input.checkpoint_operation_id, "drift_recovery_checkpoint_observe", "no_effect"), selected = contextSource(checked.record.preview.input.context_operation_id);
    if (checked.output.facts.drift_recovery_checkpoint_verified !== true || checked.record.preview.prepared.plan.source_sha256 !== shadowHash(selected)
      || checked.output.observations.causal_transition?.before_context_sha256 !== selected.transition.after_context_sha256) fail("STANDARD_RECOVERY_CYCLE_SOURCE_REQUIRED");
    return { ...selected, source_operation_id: input.checkpoint_operation_id, transition: checked.output.observations.causal_transition };
  }
  async function commitIntent(id, { write = false } = {}) {
    if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
    const record = retained(id).record, state = current(record.intent.instance_id);
    const existing = state.record.events.find(event => event.kind === "operation_intent" && event.intent.operation_id === id);
    if (existing) {
      if (shadowHash(existing.intent) !== shadowHash(record.intent)) fail("STANDARD_HOST_INTENT_CHANGED");
      return state;
    }
    if (record.phase !== "staged" || state.record.instance_sha256 !== record.intent.instance_sha256
      || shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
    return service.prepareOperation({ instanceId: state.record.instance_id, expectedSha256: state.record.instance_sha256,
      occurrenceId: record.intent.occurrence_id, eventId: "intent_" + id.slice(3), write: true });
  }
  const reconciliationInventory = createStandardReconciliationInventory({ targetRoot, signer, now,
    configuration: reconciliationConfiguration, modelSource: source,
    readInstance: id => current(id).record, readAuthority, readContext: snapshot, readSubject: observeReconciliationSubject });
  disposition = createStandardOperationDisposition({ targetRoot, stateMode: initial.stateMode, signer, artifacts, now,
    readOperation: retained, readInstance: id => current(id).record, readAuthority, readContext: snapshot, observeBoundary,
    inventory: reconciliationInventory, dispositionSource, onBoundary: dispatchCheckpoint,
    appendResult(record, output) {
      const before = retained(record.operation_id);
      if (shadowHash(before.record) !== shadowHash(record)) fail("PROCESS_JOURNAL_OWNER_CHANGED");
      const receipt = resultReceipt(record, output), { authentication, key_id, ...body } = record;
      persist({ ...body, phase: "receipted", revision: record.revision + 1, results: [...record.results, { output, receipt }] }, before.content_sha256);
      return receipt;
    }, makeReceipt: resultReceipt });
  function recoveryTarget(id, expectedSha256) {
    const before = retained(id), { record } = before, state = current(record.intent.instance_id);
    if (state.record.instance_sha256 !== expectedSha256) fail("PROCESS_REVISION_CONFLICT");
    const frame = state.cursor.occurrences.find(row => row.occurrence_id === record.intent.occurrence_id);
    if (record.intent.binding_ref !== postMergeDecisionOperation || frame?.status !== "WAITING" || !frame.operation
      || frame.operation.receipt || shadowHash(frame.operation.intent) !== shadowHash(record.intent))
      fail("STANDARD_PR_POST_MERGE_RECOVERY_WAIT_REQUIRED");
    const result = postMergeRecoveryResult(record);
    if (!result && (record.phase !== "staged" || record.owner !== null || record.results.length))
      fail("STANDARD_PR_POST_MERGE_CAPTURE_RECONCILIATION_REQUIRED");
    if (artifacts.ownerPending()) fail("STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
    return { before, record, state, result };
  }
  async function observeQuestionRecovery(target, signal) {
    const { before, state, record } = target;
    const observation = await postMergeDecision.observeRecovery(state.record, record.preview.input, record.preview.prepared, signal);
    const latest = recoveryTarget(record.operation_id, state.record.instance_sha256);
    if (latest.before.content_sha256 !== before.content_sha256) fail("PROCESS_JOURNAL_OWNER_CHANGED");
    return observation;
  }
  function predecessorFor(occurrence) {
    const previous = occurrence.operation;
    if (!previous?.receipt) return null;
    const { record } = retained(previous.intent.operation_id);
    const result = postMergeRecoveryResult(record);
    if (!result) return null;
    if (shadowHash(result.receipt) !== shadowHash(previous.receipt)) fail("STANDARD_PR_POST_MERGE_RECOVERY_RESULT_CHANGED");
    return { operation_id: record.operation_id, intent_sha256: shadowHash(record.intent),
      disposition_receipt_sha256: shadowHash(result.receipt) };
  }
  const operationHost = {
    initialize(input) {
      if (input.facts && Object.keys(input.facts).length) fail("STANDARD_HOST_AUTHENTICATED_FACTS_REQUIRED");
      return service.initialize({ ...input, model, facts: {} });
    },
    async enterCall(input) { current(input.instanceId); return service.enterCall(input); },
    async returnCall(input) { current(input.instanceId); return service.returnCall(input); },
    inspect: id => current(id),
    prepareReconciliationInventory: (id, input) => reconciliationInventory.prepare(id, input),
    prepareOperationDisposition: (id, input) => disposition.prepare(id, input),
    applyOperationDisposition: (plan, input) => disposition.apply(plan, input),
    inspectDiagnostic(id) {
      if (!processAuthority) fail("STANDARD_HOST_DIAGNOSTIC_AUTHORITY_REQUIRED");
      const value = service.inspect(id);
      // This dedicated historical port authenticates the complete retained
      // scope/model/history. Current operation admission still uses scope().
      return { ...value, native: processAuthority.inspectDiagnostic(value.record) };
    },
    prepareDecision(id) {
      const { record } = retained(id);
      if (postMergeRecoveryResult(record)) fail("STANDARD_PR_POST_MERGE_QUESTION_DISPOSED");
      return structuredClone(human.question(record));
    },
    async prepareQuestionRecovery(id, { expectedSha256, signal } = {}) {
      const target = recoveryTarget(id, expectedSha256);
      if (target.result) return structuredClone(target.result.output.observations.plan);
      const { subject, observedAt, reason } = await observeQuestionRecovery(target, signal);
      if (!reason) return null;
      return assertPostMergeRecoveryPlan(signer.seal({ contract_version: postMergeRecoveryPlanVersion,
        operation_id: id, intent_sha256: shadowHash(target.record.intent), journal_sha256: shadowHash(target.record),
        instance_sha256: expectedSha256, reason, next_subject: subject, observed_at_ms: observedAt }));
    },
    async applyQuestionRecovery(plan, { write = false, expectedPlanSha256, signal } = {}) {
      plan = structuredClone(plan);
      assertPostMergeRecoveryPlan(plan);
      requireWrite(write, expectedPlanSha256, shadowHash(plan));
      signer.verify(plan);
      const target = recoveryTarget(plan.operation_id, plan.instance_sha256), { before, record, result } = target;
      if (result) {
        if (shadowHash(result.output.observations.plan) !== expectedPlanSha256) fail("STANDARD_PR_POST_MERGE_RECOVERY_PLAN_CHANGED");
        await verifyRecoveryGrant(record, result, signal);
        return { status: "retained_result", receipt: result.receipt };
      }
      if (shadowHash(record) !== plan.journal_sha256 || shadowHash(record.intent) !== plan.intent_sha256)
        fail("STANDARD_PR_POST_MERGE_RECOVERY_PLAN_CHANGED");
      const grant = await recoveryGrant(record, plan, signal);
      const { subject, observedAt, reason } = await observeQuestionRecovery(target, signal);
      if (observedAt < plan.observed_at_ms || observedAt - plan.observed_at_ms >= postMergeDecisionMaxAgeMs)
        fail("STANDARD_PR_POST_MERGE_RECOVERY_PLAN_EXPIRED");
      if (reason !== plan.reason || shadowHash(subject) !== shadowHash(plan.next_subject))
        fail("STANDARD_PR_POST_MERGE_RECOVERY_PLAN_CHANGED");
      if (shadowHash(await recoveryGrant(record, plan, signal)) !== shadowHash(grant))
        fail("STANDARD_HOST_AUTHORIZATION_CHANGED");
      if (signal?.aborted || recoveryTarget(plan.operation_id, plan.instance_sha256).before.content_sha256 !== before.content_sha256)
        fail("PROCESS_JOURNAL_OWNER_CHANGED");
      if (now() - plan.observed_at_ms >= postMergeDecisionMaxAgeMs) fail("STANDARD_PR_POST_MERGE_RECOVERY_PLAN_EXPIRED");
      const output = postMergeRecoveryOutput(plan, grant), receipt = resultReceipt(record, output);
      const { authentication, key_id, ...body } = record;
      persist({ ...body, phase: "receipted", revision: record.revision + 1, owner: { generation, pid: process.pid },
        results: [{ output, receipt }] }, before.content_sha256);
      return { status: "receipted", receipt };
    },
    prepareControl: input => structuredClone(controlRequest(input)),
    async captureControl({ instanceId, expectedSha256, occurrenceId, sourceRef, signal, captureKind = null, write = false }) {
      if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      const request = controlRequest({ instanceId, expectedSha256, occurrenceId });
      const standardReview = current(instanceId).cursor.occurrences.some(row => row.occurrence_id === occurrenceId && prReviewWaitNodes.has(row.node_id));
      const kind = captureKind ?? (standardReview ? "pr-review-content" : "claim");
      if (!["claim", "pr-review-content"].includes(kind) || standardReview && kind !== "pr-review-content") fail("PROCESS_CONTROL_CAPTURE_KIND_INVALID");
      if (standardReview && !reviewControlSource) fail("PROCESS_CONTROL_PR_EVENT_SOURCE_REQUIRED");
      const capture = await (kind === "pr-review-content" ? controls.reserveReview : controls.reserve)(request, sourceRef, { signal });
      if (!capture) return { status: "waiting_for_control", request };
      // A retained capture survives races/crashes, but may not wake a changed
      // instance or business context. Such a capture needs explicit reconciliation.
      const currentRequest = controlRequest({ instanceId, expectedSha256, occurrenceId });
      if (shadowHash(currentRequest) !== shadowHash(request)) fail("PROCESS_CONTROL_CONTEXT_CHANGED");
      return { status: "reserved", inbox_id: capture.inbox_id, delivery_sha256: shadowHash(capture.delivery) };
    },
    async deliverControl(id, { write = false } = {}) {
      if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      if (!activeControlSource) fail("PROCESS_CONTROL_AUTHORITY_UNAVAILABLE");
      const capture = controls.read(id), state = current(capture.request.instance_id), eventId = "control_" + id.slice(8);
      const retainedEvent = state.record.events.find(row => row.event_id === eventId);
      if (retainedEvent) {
        if (retainedEvent.kind !== "control" || shadowHash(retainedEvent.delivery) !== shadowHash(capture.delivery)) fail("STANDARD_HOST_CONTROL_HISTORY_NOT_AUTHENTICATED");
        controls.acknowledge(id, controlCheckpoint(state.record, eventId));
        let projection = "not_requested";
        if (projectionRequired) {
          try { store.materialize(state.record.instance_id, { write: true }); projection = "materialized"; }
          catch { projection = "reconciliation_required"; }
        }
        return { ...state, retained: true, projection };
      }
      if (capture.phase !== "reserved" || state.record.instance_sha256 !== capture.request.instance_sha256) fail("PROCESS_CONTROL_INSTANCE_CHANGED");
      if (state.cursor.occurrences.some(row => row.occurrence_id === capture.request.occurrence_id && prReviewWaitNodes.has(row.node_id))
        && (capture.contract_version !== "process-control-inbox.v2" || !reviewControlSource)) fail("PROCESS_CONTROL_PR_EVENT_SOURCE_REQUIRED");
      const result = await service.deliverControl({ instanceId: state.record.instance_id, expectedSha256: state.record.instance_sha256,
        occurrenceId: capture.request.occurrence_id, deliveryId: capture.delivery.delivery_id, eventId, write: true });
      controls.acknowledge(id, result.record.instance_sha256);
      return result;
    },
    readControl: id => structuredClone(controls.read(id)),
    async preview({ instanceId, expectedSha256, occurrenceId, input = {} }) {
      const state = current(instanceId);
      if (state.record.instance_sha256 !== expectedSha256) fail("PROCESS_REVISION_CONFLICT");
      const occurrence = state.cursor.occurrences.find(row => row.occurrence_id === occurrenceId);
      const node = occurrence && processFrameNode(model, occurrence), binding = bindings.get(node?.binding_ref);
      if (!binding || !(occurrence.status === "READY" || occurrence.status === "WAITING" && ["blocked", "deferred"].includes(occurrence.operation?.receipt?.outcome))) fail("PROCESS_OPERATION_ORDER_INVALID");
      const resolved = resolveStandardProcessInput({ instance: state.record, occurrenceId, input, readOperation: id => retained(id).record });
      input = resolved.input;
      assertStandardOperationInput(binding.id, input);
      const prepared = binding.id === "baseline_promotion_checkpoint" ? await baselinePromotionCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PROMOTION_CHECKPOINT_AUTHORITY_REQUIRED")
        : binding.id === "cycle_terminal_checkpoint" ? await terminalCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_TERMINAL_CHECKPOINT_AUTHORITY_REQUIRED")
        : binding.id === "session_git_checkpoint" ? await sessionGitCheckpoint.prepare(state.record, input, operationJournalId(state.record, occurrenceId))
        : binding.id === "spike_conversion_admit" ? await spike.admit(state.record, input)
        : binding.id === "spike_conversion_decision" ? await spike.prepareDecision(state.record, input)
        : binding.id === "spike_cycle_initialize" ? await spike.prepareInitialize(state.record, input)
        : binding.id === "spike_conversion_finalize" ? await spike.prepareFinalize(state.record, input)
        : binding.id === "spike_experiment_admit" ? await spike.experimentAdmission(state.record, input)
        : binding.id === "spike_experiment_execution_admit" ? await spike.experimentExecutionAdmission(state.record, input)
        : binding.id === "cycle_plan_select" ? await selectCyclePlan(state.record)
        : binding.id === "mode_work_preflight" ? await processAuthority?.preflightModeWork(state.record, input) ?? fail("STANDARD_MODE_WORK_AUTHORITY_REQUIRED")
        : binding.id === "mode_work_observe" ? await processAuthority?.observeModeWork(state.record, input) ?? fail("STANDARD_MODE_WORK_AUTHORITY_REQUIRED")
        : binding.id === "mode_work_continue_decision" ? await processAuthority?.prepareModeWorkContinuation(state.record, input) ?? fail("STANDARD_MODE_WORK_AUTHORITY_REQUIRED")
        : binding.id === "mode_work_evaluate" ? await processAuthority?.evaluateModeWork(state.record, input) ?? fail("STANDARD_MODE_WORK_AUTHORITY_REQUIRED")
        : binding.id === "drift_followup_select" ? await driftRoute?.select(state.record, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "drift_report_evaluate" ? await processAuthority?.evaluateDriftReport(state.record, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : ["drift_recovery_context_refresh", "drift_recovery_checkpoint_observe", "drift_recovery_cycle_initialize"].includes(binding.id) ? await recoveryCycle?.prepare(state.record, binding.id, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "drift_change_request_record" ? await changeRequest?.prepare(state.record, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "session_close_finalize" ? await sessionCloseHook?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_CLOSE_HOOK_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_checkpoint" ? await sessionPrCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PR_SUCCESSOR_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_redelivery_push" ? await sessionPrRedeliveryPush?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PR_REDELIVERY_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_update_push" ? await sessionPrUpdatePush?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PR_SUCCESSOR_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_triage_select" ? await prTriage?.select(state.record, input) ?? fail("STANDARD_PR_TRIAGE_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_triage_evaluate" ? await prTriage?.evaluate(state.record, input) ?? fail("STANDARD_PR_TRIAGE_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_correction_cycle_initialize" ? await prCorrectionCycle?.prepare(state.record, input) ?? fail("STANDARD_PR_CORRECTION_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_correction_decision" ? await prCorrectionReview?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PR_CORRECTION_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_correction_checkpoint" ? await prCorrectionCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PR_CORRECTION_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_correction_reopen" ? await prCorrectionReopen?.prepare(state.record, input) ?? fail("STANDARD_PR_CORRECTION_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_review_reply_select" ? sessionPrReply.prepareSelection(state.record, input)
        : binding.id === "session_pr_review_resolution_select" ? sessionPrResolution.prepareSelection(state.record, input)
        : binding.id === resolutionExceptionOperation ? await sessionPrResolution.prepareException(state.record, input)
        : reviewEffects.has(binding.id) ? await reviewEffects.get(binding.id).prepare(state.record, input, operationJournalId(state.record, occurrenceId))
        : binding.id === "session_pr_review_effects_verify" ? sessionPrEffects.prepare(state.record, input)
        : binding.id === "session_pr_premerge_observe" ? sessionPrPremerge.prepare(state.record, input)
        : [postMergeAlignmentOperation, postMergeMeasureOperation].includes(binding.id) ? postMerge.prepareAlignment(state.record, input)
        : binding.id === postMergeDecisionOperation ? await postMergeDecision.prepare(state.record, input, predecessorFor(occurrence))
        : binding.id === postMergeWaitOperation ? { can_apply: true }
        : binding.id === checksOperation ? { can_apply: true }
        : binding.id === mergeConsentOperation ? await sessionPrConsent.prepare(state.record, input)
        : binding.id === "session_pr_merge_observe" ? sessionPrMerge.prepare(state.record, input)
        : binding.id === "session_pr_review_receive" ? await sessionPrReviewReceiver?.prepare(state.record, input) ?? fail("STANDARD_PR_RECEIVE_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_review_content_observe" ? await sessionPrReviewContent?.prepare(state.record, input) ?? fail("STANDARD_PR_REVIEW_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_review_observe" ? await sessionPrReview?.prepare(state.record, input) ?? fail("STANDARD_PR_REVIEW_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_record" ? await sessionPrRecord?.prepare(state.record, input) ?? fail("STANDARD_PR_RECORD_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_open" ? await sessionPrOpen?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_PR_OPEN_TRANSPORT_REQUIRED")
        : binding.id === "session_push" ? await sessionPush?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_PUSH_TRANSPORT_REQUIRED")
        : binding.id === "session_pr_admit" ? await sessionPrAdmission?.prepare(state.record, input) ?? fail("STANDARD_SESSION_PR_AUTHORITY_REQUIRED")
        : binding.id === "session_branch_integration_decision" ? await sessionBranchIntegration?.prepareDecision(state.record, input) ?? fail("STANDARD_SESSION_INTEGRATION_AUTHORITY_REQUIRED")
        : binding.id === "session_branch_integrate" ? await sessionBranchIntegration?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_INTEGRATION_AUTHORITY_REQUIRED")
        : binding.id === "session_delivery_checkpoint" ? await sessionDeliveryCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_DELIVERY_AUTHORITY_REQUIRED")
        : binding.id === "session_preclose_checkpoint" ? await sessionPrecloseCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_AUTHORITY_REQUIRED")
        : binding.id === "session_close_checkpoint" ? await sessionCloseCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_CHECKPOINT_AUTHORITY_REQUIRED")
        : binding.id === "session_close_record" ? await sessionCloseRecord?.prepare(state.record, input) ?? fail("STANDARD_SESSION_CLOSE_AUTHORITY_REQUIRED")
        : binding.id === "session_closure_decision" ? await sessionClosureReview?.prepare(state.record, input) ?? fail("STANDARD_SESSION_CLOSURE_AUTHORITY_REQUIRED")
        : binding.id === "baseline_promotion_decision" ? await promotionReview?.prepare(state.record, input) ?? fail("STANDARD_PROMOTION_REVIEW_AUTHORITY_REQUIRED")
        : binding.id === "baseline_promotion_finalize" ? await baselinePromotionHook?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PROMOTION_HOOK_AUTHORITY_REQUIRED")
        : binding.id === "baseline_promotion_record" ? await baselinePromotion?.prepare(state.record, input) ?? fail("STANDARD_PROMOTION_AUTHORITY_REQUIRED")
        : binding.id === "cycle_close_completed_select" ? selectCompletedClose(state.record)
        : binding.id === "cycle_close_finalize" ? await cycleCloseHook?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_CYCLE_CLOSE_HOOK_AUTHORITY_REQUIRED")
        : binding.id === "cycle_close_record" ? await cycleCloseRecord?.prepare(state.record, input) ?? fail("STANDARD_CYCLE_CLOSE_AUTHORITY_REQUIRED")
        : binding.id === "cycle_closure_decision" ? await closureReview?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_CLOSURE_AUDIT_AUTHORITY_REQUIRED")
        : binding.id === "drift_completion_select" ? await driftRoute?.completion(state.record) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "drift_completion_decision" ? await recovery?.prepareRenewal(state.record, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "drift_recovery_decision" ? await recovery?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "drift_recovery_record" ? await (async () => { const body = { ...await recoveryDecision(state.record, input), prepared_at_ms: now() };
          return { ...body, can_apply: true, plan_sha256: shadowHash(body) }; })()
        : binding.id === "drift_check_finalize" ? await driftFinalization?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "session_initialize" ? await operations.prepareSession(input)
        : binding.id === "session_mode_apply" ? await operations.prepareMode(decisionInput(state.record, input))
        : binding.id === "session_start_finalize" ? await operations.prepareStart(input)
        : binding.id === "cycle_context_refresh" ? await operations.prepareCycleContext(input)
        : binding.id === "cycle_initialize" ? await operations.prepareCycle(input)
        : binding.id === "cycle_checkpoint_finalize" ? await operations.prepareCycleCheckpoint(input)
        : binding.id === "cycle_plan_record" ? await cyclePlanRecord?.prepare(state.record, input) ?? fail("STANDARD_CYCLE_PLAN_AUTHORITY_UNAVAILABLE")
        : binding.id === "cycle_implementation_enter" ? await cycleImplementation?.prepare(state.record, input) ?? fail("STANDARD_CYCLE_READINESS_AUTHORITY_UNAVAILABLE")
        : binding.id === "cycle_validation_execute" ? await cycleValidation?.prepare(state.record, input) ?? fail("STANDARD_VALIDATION_AUTHORITY_UNAVAILABLE")
        : binding.id === "cycle_verification_enter" ? await cycleVerification?.prepare(state.record, input) ?? fail("STANDARD_VERIFICATION_AUTHORITY_UNAVAILABLE")
        : binding.id === "cycle_task_advance" ? await cycleTaskAdvance?.prepare(state.record, input) ?? fail("STANDARD_TASK_PROGRESS_AUTHORITY_UNAVAILABLE") : null;
      return signer.seal({ contract_version: "standard-operation-preview.v1", instance_id: instanceId, instance_sha256: expectedSha256,
        scope_id: state.record.scope_id, model_sha256: state.record.model_sha256, occurrence_id: occurrenceId, binding,
        input: ["session_initialize", "cycle_initialize"].includes(binding.id) ? prepared?.plan?.input ?? input : input,
        ...(resolved.input_resolution ? { input_resolution: resolved.input_resolution } : {}), prepared, snapshot: snapshot(), prepared_at_ms: now() });
    },
    async reprepareExpiredOperation(id, options = {}) {
      if (!options || Object.keys(options).some(key => !["expectedSha256", "signal"].includes(key)))
        fail("STANDARD_HOST_REPREPARE_INPUT_INVALID");
      const { expectedSha256, signal } = options;
      const active = () => { if (signal?.aborted) fail("STANDARD_HOST_REPREPARE_ABORTED"); };
      active();
      const record = retained(id).record, state = current(record.intent.instance_id), result = record.results.at(-1);
      if (state.record.instance_sha256 !== expectedSha256) fail("PROCESS_REVISION_CONFLICT");
      const frame = state.cursor.occurrences.find(row => row.occurrence_id === record.intent.occurrence_id);
      const age = now() - record.preview.prepared?.plan?.prepared_at_ms;
      // An accepted, authenticated refusal is the predecessor. Neither an
      // unreceipted dispatch nor an unknown/confirmed effect can use this path.
      if (record.phase !== "receipted" || record.preview.binding.executor_kind !== "deterministic"
        || result?.receipt.outcome !== "blocked" || result.receipt.effect_status !== "no_effect"
        || result.output.observations?.reason_code !== "STANDARD_PLAN_EXPIRED"
        || !Number.isSafeInteger(age) || age <= 300000
        || frame?.status !== "WAITING" || shadowHash(frame.operation?.intent ?? null) !== shadowHash(record.intent)
        || shadowHash(frame.operation?.receipt ?? null) !== shadowHash(result.receipt)
        || !state.record.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(result.receipt)))
        fail("STANDARD_HOST_ACCEPTED_EXPIRED_NO_EFFECT_REQUIRED");
      if (artifacts.ownerPending()) fail("STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
      const preview = await operationHost.preview({ instanceId: state.record.instance_id, expectedSha256,
        occurrenceId: record.intent.occurrence_id, ...(model.data_bindings ? {} : { input: record.preview.input }) });
      active();
      if (shadowHash(preview.input) !== shadowHash(record.preview.input)) fail("STANDARD_HOST_REPREPARE_SUBJECT_CHANGED");
      if (current(state.record.instance_id).record.instance_sha256 !== expectedSha256
        || shadowHash(retained(id).record) !== shadowHash(record)) fail("PROCESS_REVISION_CONFLICT");
      if (artifacts.ownerPending()) fail("STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
      // Existing v2 intent semantics bind the successor to this exact accepted
      // history. Preparation writes nothing; stage still needs a fresh grant
      // and explicit write. All original plans, grants and receipts survive.
      return preview;
    },
    async stage(preview, { write = false, expectedPreviewSha256 } = {}) {
      preview = structuredClone(preview);
      validatePreview(preview); requireWrite(write, expectedPreviewSha256, shadowHash(preview));
      const state = current(preview.instance_id), age = now() - preview.prepared_at_ms;
      if (!Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_HOST_PREVIEW_EXPIRED");
      if (state.record.instance_sha256 !== preview.instance_sha256 || shadowHash(snapshot()) !== shadowHash(preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      if (model.data_bindings && shadowHash(resolveStandardProcessInput({ instance: state.record, occurrenceId: preview.occurrence_id,
        readOperation: id => retained(id).record }).input_resolution) !== shadowHash(preview.input_resolution)) fail("PROCESS_RESOLVED_INPUT_CHANGED");
      const grant = await grantFor(preview), id = operationJournalId(state.record, preview.occurrence_id);
      const intent = { contract_version: "process-operation-intent.v1", operation_id: id, binding_ref: preview.binding.id, binding_sha256: shadowHash(preview.binding),
        input_sha256: shadowHash(preview.input), preconditions_sha256: shadowHash({ snapshot: preview.snapshot, prepared: preview.prepared }),
        authorization_sha256: grant === null ? null : shadowHash(grant), authority_id: "standard_operation_host", scope_id: preview.scope_id,
        instance_id: preview.instance_id, instance_sha256: preview.instance_sha256, model_sha256: preview.model_sha256,
        occurrence_id: preview.occurrence_id, instance_revision: state.record.revision };
      const previous = journal.read(id);
      if (previous.record) {
        signer.verify(previous.record);
        if (shadowHash(previous.record.preview) !== shadowHash(preview) || shadowHash(previous.record.intent) !== shadowHash(intent)) fail("PROCESS_JOURNAL_ALREADY_STAGED");
      } else persist({ contract_version: "process-operation-journal.v1", operation_id: id, revision: 1, phase: "staged", preview,
        intent, grant, owner: null, results: [] }, null);
      const result = await commitIntent(id, { write: true });
      return { ...result, operation_id: id };
    },
    commitIntent,
    async dispatch(id, { write = false, signal } = {}) {
      if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      const before = retained(id), record = before.record, state = current(record.intent.instance_id);
      if (reviewEffects.has(record.intent.binding_ref)
        && (record.phase === "dispatching" || record.results.at(-1)?.receipt.outcome === "reconciliation_required"))
        return operationHost.reconcilePrReviewEffect(id, { write, signal });
      if (record.phase === "receipted") return { status: "retained_result", receipt: record.results.at(-1).receipt };
      if (record.phase !== "staged") return { status: "reconciliation_required", operation_id: id };
      const frame = state.cursor.occurrences.find(row => row.occurrence_id === record.intent.occurrence_id);
      if (frame?.status !== "WAITING" || !frame.operation || frame.operation.receipt || shadowHash(frame.operation.intent) !== shadowHash(record.intent)) fail("STANDARD_HOST_CANONICAL_INTENT_REQUIRED");
      if (record.preview.binding.executor_kind === "human") {
        if (record.intent.binding_ref === postMergeDecisionOperation && alignedPostMergeSubject(record.preview.prepared.subject))
          return { status: "question_recovery_required" };
        if (["drift_recovery_decision", "drift_completion_decision"].includes(record.intent.binding_ref)) await recovery.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "cycle_closure_decision") await closureReview.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "spike_conversion_decision") await spike.assertFresh(state.record, record.preview.input, record.preview.prepared);
      if (record.intent.binding_ref === "mode_work_continue_decision") processAuthority.assertModeWorkContinuationFresh(state.record, record.preview.input, record.preview.prepared);
      if (record.intent.binding_ref === "session_closure_decision") await sessionClosureReview.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_branch_integration_decision") await sessionBranchIntegration.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_pr_correction_decision") await prCorrectionReview.assertFresh(state.record, record.preview.prepared.plan, { signal });
      if (record.intent.binding_ref === "baseline_promotion_decision") await promotionReview.assertFresh(state.record, record.preview.prepared.plan);
        return { status: "waiting_for_human", question: human.question(record) };
      }
      await verifyGrant(record);
      if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      const { authentication, key_id, ...body } = record;
      const claimed = persist({ ...body, phase: "dispatching", revision: record.revision + 1, owner: { generation, pid: process.pid } }, before.content_sha256);
      const output = await disposition.run(claimed, async () => {
      let output;
      try {
        if (current(record.intent.instance_id).record.instance_sha256 !== state.record.instance_sha256)
          throw Object.assign(new Error("STANDARD_HOST_PROCESS_CHANGED"), { code: "STANDARD_HOST_PROCESS_CHANGED", effect_status: "no_effect" });
        if (record.intent.binding_ref === "context_reload") output = await operations.reload(record.preview.input);
        else if (record.intent.binding_ref === "session_admit") output = await operations.admitSession(record.preview.input);
        else if (record.intent.binding_ref === "session_close_admit") output = await operations.admitSessionClose(record.preview.input);
        else if (record.intent.binding_ref === "session_close_record") output = await sessionCloseRecord.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_pr_checkpoint") output = await sessionPrCheckpoint.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_pr_redelivery_push") output = await sessionPrRedeliveryPush.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_pr_update_push") output = await sessionPrUpdatePush.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_pr_record") output = await sessionPrRecord.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_pr_open") output = await sessionPrOpen.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_push") output = await sessionPush.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_pr_admit") output = await sessionPrAdmission.observe(state.record, record.preview.input);
        else if (record.intent.binding_ref === "session_pr_triage_select") output = await prTriage.select(state.record, record.preview.input, { signal });
        else if (record.intent.binding_ref === "session_pr_triage_evaluate") output = await prTriage.evaluate(state.record, record.preview.input, { signal });
        else if (record.intent.binding_ref === "session_pr_correction_cycle_initialize") output = await prCorrectionCycle.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record, signal), signal });
        else if (record.intent.binding_ref === "session_pr_correction_checkpoint") output = await prCorrectionCheckpoint.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record), signal });
        else if (record.intent.binding_ref === "session_pr_correction_reopen") output = await prCorrectionReopen.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record, signal), signal });
        else if (record.intent.binding_ref === "session_pr_review_reply_select") output = await sessionPrReply.select(state.record, record.preview.input,
          record.preview.prepared, { signal });
        else if (record.intent.binding_ref === "session_pr_review_resolution_select") output = await sessionPrResolution.select(state.record, record.preview.input,
          record.preview.prepared, { signal });
        else if (reviewEffects.has(record.intent.binding_ref)) output = await reviewEffects.get(record.intent.binding_ref).apply(state.record, record.preview.input,
          record.preview.prepared, { signal, operationId: id, assertAuthorized: async () => {
            await verifyGrant(record, signal);
            if (current(state.record.instance_id).record.instance_sha256 !== state.record.instance_sha256
              || shadowHash(retained(id).record) !== shadowHash(claimed)
              || shadowHash(snapshot()) !== shadowHash(record.preview.snapshot))
              throw Object.assign(Error("STANDARD_PR_REVIEW_EFFECT_OWNER_CHANGED"), { code: "STANDARD_PR_REVIEW_EFFECT_OWNER_CHANGED", effect_status: "no_effect" });
          } });
        else if (record.intent.binding_ref === "session_pr_review_effects_verify") output = await sessionPrEffects.observe(state.record, record.preview.input,
          { signal, sourceSha256: record.preview.prepared.source_sha256 });
        else if (record.intent.binding_ref === "session_pr_premerge_observe") output = await sessionPrPremerge.observe(state.record, record.preview.input,
          { signal, sourceSha256: record.preview.prepared.source_sha256 });
        else if (record.intent.binding_ref === checksOperation) output = await sessionPrConsent.acceptChecks(state.record, record.preview.input, signal);
        else if ([postMergeAlignmentOperation, postMergeMeasureOperation].includes(record.intent.binding_ref)) output = await postMerge.observeAlignment(
          state.record, record.preview.input, record.preview.prepared, { signal, operation: record.intent.binding_ref });
        else if (record.intent.binding_ref === postMergeWaitOperation) output = sessionPrMergeEffect.waitForSync(state.record, record.preview.input);
        else if (record.intent.binding_ref === "session_pr_merge_observe") output = await sessionPrMerge.observe(state.record, record.preview.input,
          { signal, sourceSha256: record.preview.prepared.source_sha256 });
        else if (record.intent.binding_ref === "session_pr_review_receive") output = await sessionPrReviewReceiver.observe(state.record, record.preview.input, { signal });
        else if (record.intent.binding_ref === "session_pr_review_content_observe") output = await sessionPrReviewContent.observe(state.record, record.preview.input, { signal });
        else if (record.intent.binding_ref === "session_pr_review_observe") output = await sessionPrReview.observe(state.record, record.preview.input, { signal });
        else if (record.intent.binding_ref === "session_branch_integrate") output = await sessionBranchIntegration.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_delivery_checkpoint") output = await sessionDeliveryCheckpoint.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_preclose_checkpoint") output = await sessionPrecloseCheckpoint.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_close_checkpoint") output = await sessionCloseCheckpoint.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_close_finalize") output = await sessionCloseHook.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_admit") output = await operations.admitCycle(record.preview.input);
        else if (record.intent.binding_ref === "branch_cycle_audit") output = await operations.auditCycle(record.preview.input);
        else if (record.intent.binding_ref === "drift_completion_select") output = await driftRoute?.completion(state.record) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
        else if (record.intent.binding_ref === "cycle_close_completed_select") output = selectCompletedClose(state.record);
        else if (record.intent.binding_ref === "drift_followup_select") output = await driftRoute?.select(state.record, record.preview.input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
        else if (record.intent.binding_ref === "drift_report_evaluate") output = await processAuthority?.evaluateDriftReport(state.record, record.preview.input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
        else if (record.intent.binding_ref === "cycle_plan_evaluate") output = await processAuthority?.evaluateCyclePlan(state.record, record.preview.input) ?? fail("STANDARD_CYCLE_PLAN_AUTHORITY_UNAVAILABLE");
        else if (record.intent.binding_ref === "cycle_readiness_evaluate") output = await processAuthority?.evaluateCycleReadiness(state.record, record.preview.input) ?? fail("STANDARD_CYCLE_READINESS_AUTHORITY_UNAVAILABLE");
        else if (record.intent.binding_ref === "cycle_work_evaluate") output = await processAuthority?.evaluateCycleWork(state.record, record.preview.input) ?? fail("STANDARD_CYCLE_WORK_AUTHORITY_UNAVAILABLE");
        else if (record.intent.binding_ref === "cycle_validation_evaluate") output = (await evaluateValidation(state.record, record.preview.input)).output;
        else if (record.intent.binding_ref === "cycle_audit_evaluate") output = await evaluateAudit(state.record, record.preview.input);
        else if (record.intent.binding_ref === "spike_conversion_admit") output = await spike.admit(state.record, record.preview.input);
        else if (record.intent.binding_ref === "spike_experiment_admit") output = await spike.experimentAdmission(state.record, record.preview.input);
        else if (record.intent.binding_ref === "spike_experiment_execution_admit") output = await spike.experimentExecutionAdmission(state.record, record.preview.input);
        else if (record.intent.binding_ref === "cycle_plan_select") output = await selectCyclePlan(state.record);
        else if (record.intent.binding_ref === "spike_cycle_initialize") output = await spike.initialize(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "spike_conversion_finalize") output = await spike.finalize(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "mode_work_preflight") output = await processAuthority.preflightModeWork(state.record, record.preview.input);
        else if (record.intent.binding_ref === "mode_work_observe") output = await processAuthority.observeModeWork(state.record, record.preview.input);
        else if (record.intent.binding_ref === "mode_work_evaluate") output = await processAuthority.evaluateModeWork(state.record, record.preview.input);
        else if (record.intent.binding_ref === "cycle_audit_select") output = await evaluateAuditSelection(state.record, record.preview.input);
        else if (record.intent.binding_ref === "cycle_task_select") output = await processAuthority.evaluateCycleTaskSelection(state.record, record.preview.input);
        else if (record.intent.binding_ref === "cycle_task_work_evaluate") output = await processAuthority.evaluateCycleTaskWork(state.record, record.preview.input);
        else if (record.intent.binding_ref === "drift_change_request_record") output = await changeRequest.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (!record.preview.prepared?.can_apply) output = { contract_version: record.preview.binding.output_contract, operation_ref: record.intent.binding_ref,
          outcome: "blocked", effect_status: "no_effect", facts: {}, observations: record.preview.prepared ?? {}, evidence_refs: [] };
        else if (["drift_recovery_context_refresh", "drift_recovery_checkpoint_observe", "drift_recovery_cycle_initialize"].includes(record.intent.binding_ref)) output = await recoveryCycle.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "drift_check_finalize") output = await driftFinalization.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "drift_recovery_record") {
          try {
            const selected = await recoveryDecision(state.record, record.preview.input);
            if (shadowHash(selected.review) !== shadowHash(record.preview.prepared.review) || selected.choice !== record.preview.prepared.choice) fail("STANDARD_RECOVERY_DECISION_CHANGED");
          } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
          output = await recovery.apply(state.record, record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        }
        else if (record.intent.binding_ref === "session_initialize") output = await operations.initializeSession(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
        else if (record.intent.binding_ref === "session_mode_apply") {
          if (shadowHash(decisionInput(state.record, record.preview.input)) !== shadowHash(record.preview.prepared.plan.input)) fail("STANDARD_MODE_DECISION_CHANGED");
          output = await operations.applyMode(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
        } else if (record.intent.binding_ref === "baseline_promotion_checkpoint") output = await baselinePromotionCheckpoint.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_terminal_checkpoint") output = await terminalCheckpoint.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_git_checkpoint") output = await sessionGitCheckpoint.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_context_refresh") output = await operations.refreshCycleContext(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
        else if (record.intent.binding_ref === "cycle_initialize") output = await operations.initializeCycle(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
        else if (record.intent.binding_ref === "baseline_promotion_finalize") output = await baselinePromotionHook.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "baseline_promotion_record") output = await baselinePromotion.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_close_finalize") output = await cycleCloseHook.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_close_record") output = await cycleCloseRecord.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_plan_record") output = await cyclePlanRecord.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_implementation_enter") output = await cycleImplementation.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_validation_execute") output = await cycleValidation.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_verification_enter") output = await cycleVerification.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_task_advance") output = await cycleTaskAdvance.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_checkpoint_finalize") output = await operations.finalizeCycleCheckpoint(record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record),
            assertCurrent: () => { if (current(state.record.instance_id).record.instance_sha256 !== state.record.instance_sha256) fail("STANDARD_CYCLE_CHECKPOINT_PROCESS_CHANGED"); } });
        else output = await operations.finalizeStart(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
        if (record.preview.binding.effect_class === "read-only" && shadowHash(snapshot()) !== shadowHash(record.preview.snapshot))
          throw Object.assign(new Error("STANDARD_HOST_PRECONDITIONS_CHANGED"), { effect_status: "no_effect" });
      } catch (cause) {
        const noEffect = record.preview.binding.effect_class === "read-only" || cause.effect_status === "no_effect" || cause.code === "STANDARD_PLAN_EXPIRED";
        output = { contract_version: record.preview.binding.output_contract, operation_ref: record.intent.binding_ref,
          outcome: noEffect ? "blocked" : "reconciliation_required", effect_status: noEffect ? "no_effect" : "unknown", facts: {},
          observations: { reason_code: /^[A-Z][A-Z0-9_]+$/.test(cause.code ?? "") ? cause.code : "STANDARD_HOST_DISPATCH_UNCONFIRMED" }, evidence_refs: [] };
      }
      return output;
      });
      const receipt = resultReceipt(record, output);
      const retainedClaim = retained(id);
      if (shadowHash(retainedClaim.record) !== shadowHash(claimed)) fail("PROCESS_JOURNAL_OWNER_CHANGED");
      const { authentication: oldMac, key_id: oldKey, ...claimedBody } = claimed;
      persist({ ...claimedBody, phase: "receipted", revision: claimed.revision + 1, results: [{ output, receipt }] }, retainedClaim.content_sha256);
      return { status: "receipted", receipt };
    },
    async reconcilePrReviewEffect(id, { write = false, signal } = {}) {
      if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      const before = retained(id), record = before.record, state = current(record.intent.instance_id);
      const binding = record.intent.binding_ref, effect = reviewEffects.get(binding);
      if (!effect) fail("STANDARD_PR_REVIEW_EFFECT_DISPATCH_REQUIRED");
      const reply = binding === "session_pr_review_reply_publish";
      const kind = reply ? "REPLY" : binding === mergeExecuteOperation ? "MERGE"
        : binding === postMergeFetchOperation ? "POST_MERGE_FETCH" : binding === postMergeCompleteOperation ? "POST_MERGE_COMPLETION" : "RESOLUTION";
      readDispatchedOperation(state.record, id, binding, "STANDARD_PR_" + kind + "_DISPATCH_REQUIRED");
      if (record.results.length >= 32) fail("PROCESS_JOURNAL_RESULTS_LIMIT");
      const output = await effect.recover(state.record, record.preview.input, record.preview.prepared, { signal, operationId: id,
        ...(binding === postMergeCompleteOperation ? { assertAuthorized: () => verifyGrant(record, signal) } : {}) });
      if (!output?.contract_version) return { status: "reconciliation_required", operation_id: id, effect_status: "unknown",
        reason_code: output?.reason_code ?? ("STANDARD_PR_" + kind + "_POSTIMAGE_UNAVAILABLE") };
      await verifyGrant(record, signal);
      if (signal?.aborted || current(state.record.instance_id).record.instance_sha256 !== state.record.instance_sha256
        || shadowHash(retained(id).record) !== shadowHash(record)
        || shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("PROCESS_JOURNAL_OWNER_CHANGED");
      const receipt = resultReceipt(record, output), { authentication, key_id, ...body } = record;
      persist({ ...body, phase: "receipted", revision: record.revision + 1, results: [...record.results, { output, receipt }] }, before.content_sha256);
      return { status: "receipted", receipt };
    },
    async reconcileCorrectionCheckpoint(id, { write = false, signal } = {}) {
      if (write !== true) fail('STANDARD_HOST_EXPLICIT_WRITE_REQUIRED');
      const before = retained(id), record = before.record;
      if (record.intent.binding_ref !== 'session_pr_correction_checkpoint') fail('STANDARD_PR_CORRECTION_CHECKPOINT_DISPATCH_REQUIRED');
      // A verified observation may follow an unknown result under the same
      // intent. Earlier results and their accepted events remain immutable.
      if (record.phase === 'receipted' && record.results.at(-1).receipt.outcome !== 'reconciliation_required')
        return { status: 'retained_result', receipt: record.results.at(-1).receipt };
      if (record.results.length >= 32) fail('PROCESS_JOURNAL_RESULTS_LIMIT');
      const state = current(record.intent.instance_id);
      readDispatchedCheckpoint(state.record, id);
      if (!prCorrectionCheckpoint) fail('STANDARD_PR_CORRECTION_AUTHORITY_REQUIRED');
      const output = await prCorrectionCheckpoint.reconcile(state.record, id,
        { assertAuthorized: () => verifyGrant(record, signal), signal });
      if (current(state.record.instance_id).record.instance_sha256 !== state.record.instance_sha256
        || shadowHash(retained(id).record) !== shadowHash(record)) fail('PROCESS_JOURNAL_OWNER_CHANGED');
      const receipt = resultReceipt(record, output), { authentication, key_id, ...body } = record;
      // Preserve the original dispatch owner, preview, intent and grant. The
      // CAS gives competing observers one result without another Git dispatch.
      persist({ ...body, phase: 'receipted', revision: record.revision + 1, results: [...record.results, { output, receipt }] }, before.content_sha256);
      return { status: 'receipted', receipt };
    },
    async receiveDecision(id, { sourceRef, write = false, signal } = {}) {
      if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      const before = retained(id), record = before.record, state = current(record.intent.instance_id);
      if (record.preview.binding.executor_kind !== "human" || ![postMergeDecisionOperation, mergeConsentOperation, resolutionExceptionOperation, "spike_conversion_decision", "mode_work_continue_decision", "session_pr_correction_decision", "session_branch_integration_decision", "session_closure_decision", "mode_decision", "drift_recovery_decision", "drift_completion_decision", "cycle_closure_decision", "baseline_promotion_decision"].includes(record.intent.binding_ref)) fail("PROCESS_HUMAN_OPERATION_REQUIRED");
      if (postMergeRecoveryResult(record)) fail("STANDARD_PR_POST_MERGE_QUESTION_DISPOSED");
      const r09 = record.intent.binding_ref === postMergeDecisionOperation;
      if (r09 && alignedPostMergeSubject(record.preview.prepared.subject)) fail("STANDARD_PR_POST_MERGE_QUESTION_UNAVAILABLE");
      if (record.phase === "receipted") {
        const capture = human.captured(record);
        if (capture.source_ref !== sourceRef) fail("PROCESS_HUMAN_DECISION_ALREADY_CAPTURED");
        human.acknowledge(capture.inbox_id, record.results.at(-1).receipt);
        return { status: "retained_result", receipt: record.results.at(-1).receipt };
      }
      const frame = state.cursor.occurrences.find(row => row.occurrence_id === record.intent.occurrence_id);
      if (frame?.status !== "WAITING" || !frame.operation || frame.operation.receipt || shadowHash(frame.operation.intent) !== shadowHash(record.intent)) fail("STANDARD_HOST_CANONICAL_INTENT_REQUIRED");
      if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      if (["drift_recovery_decision", "drift_completion_decision"].includes(record.intent.binding_ref)) await recovery.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "cycle_closure_decision") await closureReview.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "spike_conversion_decision") await spike.assertFresh(state.record, record.preview.input, record.preview.prepared);
      if (record.intent.binding_ref === "mode_work_continue_decision") processAuthority.assertModeWorkContinuationFresh(state.record, record.preview.input, record.preview.prepared);
      if (record.intent.binding_ref === "session_closure_decision") await sessionClosureReview.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_branch_integration_decision") await sessionBranchIntegration.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_pr_correction_decision") await prCorrectionReview.assertFresh(state.record, record.preview.prepared.plan, { signal });
      if (record.intent.binding_ref === "baseline_promotion_decision") await promotionReview.assertFresh(state.record, record.preview.prepared.plan);
      const assertFreshDecision = record.intent.binding_ref === mergeConsentOperation ? assertMergeConsentFresh
        : record.intent.binding_ref === resolutionExceptionOperation ? assertResolutionExceptionFresh
        : record.intent.binding_ref === postMergeDecisionOperation ? assertPostMergeDecisionFresh : null;
      let reservedOwner;
      const capture = await human.reserve(record, sourceRef, { signal,
        ...(assertFreshDecision ? { assertCurrent: () => assertFreshDecision(state.record, record, signal) } : {}),
        ...(r09 ? { claimDecision(claim) {
          if (current(record.intent.instance_id).record.instance_sha256 !== state.record.instance_sha256
            || shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
          if (signal?.aborted) fail("PROCESS_HUMAN_AUTHORITY_ABORTED");
          postMergeDecision.assertAge(record.preview.prepared);
          if (artifacts.ownerPending()) fail("STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
          const latest = retained(id), claimSha = shadowHash({ source_ref: sourceRef, source: claim });
          if (latest.record.phase === "dispatching" && latest.record.decision_claim_sha256 === claimSha) {
            reservedOwner = latest.record;
          } else {
            if (latest.content_sha256 !== before.content_sha256 || record.phase !== "staged")
              fail("STANDARD_PR_POST_MERGE_CAPTURE_RECONCILIATION_REQUIRED");
            const { authentication, key_id, ...body } = record;
            reservedOwner = persist({ ...body, phase: "dispatching", revision: record.revision + 1,
              owner: { generation, pid: process.pid }, decision_claim_sha256: claimSha }, before.content_sha256);
          }
        } } : {}) });
      if (!capture) return { status: "waiting_for_human", question: human.question(record) };
      if (r09) await dispatchCheckpoint?.("post_merge_decision_reserved");
      if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      if (["drift_recovery_decision", "drift_completion_decision"].includes(record.intent.binding_ref)) await recovery.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "cycle_closure_decision") await closureReview.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "spike_conversion_decision") await spike.assertFresh(state.record, record.preview.input, record.preview.prepared);
      if (record.intent.binding_ref === "mode_work_continue_decision") processAuthority.assertModeWorkContinuationFresh(state.record, record.preview.input, record.preview.prepared);
      if (record.intent.binding_ref === "session_closure_decision") await sessionClosureReview.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_branch_integration_decision") await sessionBranchIntegration.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_pr_correction_decision") await prCorrectionReview.assertFresh(state.record, record.preview.prepared.plan, { signal });
      if (record.intent.binding_ref === "baseline_promotion_decision") await promotionReview.assertFresh(state.record, record.preview.prepared.plan);
      if (assertFreshDecision) {
        await human.verifyReserved(record, capture, signal);
        if (record.intent.binding_ref === postMergeDecisionOperation) postMergeDecision.assertAge(record.preview.prepared);
        if (record.intent.binding_ref === mergeConsentOperation && now() >= record.preview.prepared.expires_at_ms)
          fail("STANDARD_PR_MERGE_CONSENT_EXPIRED");
        if (current(record.intent.instance_id).record.instance_sha256 !== state.record.instance_sha256
          || shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      }
      if (record.intent.binding_ref === "drift_completion_decision") {
        await human.verifyReserved(record, capture, signal);
        const review = record.preview.prepared.plan, age = now() - review.prepared_at_ms;
        if (!Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_OBJECTIVE_DISPOSITION_EXPIRED");
        if (current(record.intent.instance_id).record.instance_sha256 !== state.record.instance_sha256
          || shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      }
      const { authentication, key_id, ...body } = record;
      const claimed = reservedOwner ?? (record.phase === "staged" ? persist({ ...body, phase: "dispatching", revision: record.revision + 1,
        owner: { generation, pid: process.pid } }, before.content_sha256) : record);
      const output = human.output(claimed, capture), receipt = resultReceipt(claimed, output), latest = retained(id);
      if (shadowHash(latest.record) !== shadowHash(claimed)) fail("PROCESS_JOURNAL_OWNER_CHANGED");
      const { authentication: oldMac, key_id: oldKey, ...claimedBody } = claimed;
      persist({ ...claimedBody, phase: "receipted", revision: claimed.revision + 1, results: [{ output, receipt }] }, latest.content_sha256);
      human.acknowledge(capture.inbox_id, receipt);
      return { status: "receipted", receipt };
    },
    async accept(id, { write = false, receiptId: selectedReceiptId, signal } = {}) {
      if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      const record = retained(id).record, state = current(record.intent.instance_id);
      const index = selectedReceiptId === undefined ? record.results.length - 1 : record.results.findIndex(row => row.receipt.receipt_id === selectedReceiptId);
      const receipt = record.results[index]?.receipt;
      if (!receipt) fail("PROCESS_OPERATION_RECEIPT_UNAVAILABLE");
      if (state.record.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt))) return state;
      if (record.intent.binding_ref === mergeConsentOperation) {
        // Keep network observations outside the reducer's bounded authority
        // callback. Its acceptance still fences this exact instance and receipt.
        await assertMergeConsentFresh(state.record, record, signal);
        if (shadowHash(retained(id).record) !== shadowHash(record)) fail("PROCESS_JOURNAL_OWNER_CHANGED");
      }
      if (record.intent.binding_ref === postMergeDecisionOperation && !postMergeRecoveryResult(record)) {
        await human.verifyCaptured(record, signal, { acknowledged: true });
        await assertPostMergeDecisionFresh(state.record, record, signal);
        if (shadowHash(retained(id).record) !== shadowHash(record)) fail("PROCESS_JOURNAL_OWNER_CHANGED");
      }
      if (record.intent.binding_ref === postMergeCompleteOperation && receipt.outcome === "completed") {
        await postMergeCompletion.confirm(state.record, record.preview.input, record.preview.prepared,
          { signal, assertAuthorized: () => verifyGrant(record, signal) });
        if (shadowHash(retained(id).record) !== shadowHash(record)) fail("PROCESS_JOURNAL_OWNER_CHANGED");
      }
      return disposition.withReceiptAcceptance(id, () => service.acceptOperation({ instanceId: state.record.instance_id, expectedSha256: state.record.instance_sha256, occurrenceId: record.intent.occurrence_id,
        eventId: "result_" + id.slice(3) + (index ? "_" + index : ""), receiptId: receipt.receipt_id, write: true }));
    },
    readJournal: id => structuredClone(retained(id).record),
    readDecisionSource: ref => human.readSource(ref),
    readOutput(ref) {
      const match = /^aidn:operation-output\/(op_[a-f0-9]{40})\/(0|[1-9][0-9]?)$/.exec(ref);
      if (!match || Number(match[2]) >= 32) fail("PROCESS_JOURNAL_OUTPUT_REF_INVALID");
      const result = retained(match[1]).record.results[Number(match[2])];
      if (!result) fail("PROCESS_JOURNAL_OUTPUT_UNAVAILABLE");
      return structuredClone(result.output);
    },
  };
  return Object.freeze(operationHost);
}
