import spikeReviewInput from "../contracts/workflow-definition/standard-spike-review-input.v1.schema.json" with { type: "json" };
import spikeExperimentInput from "../contracts/workflow-definition/standard-spike-experiment-input.v1.schema.json" with { type: "json" };
import spikeExperimentOutput from "../contracts/workflow-definition/standard-spike-experiment-admission-output.v1.schema.json" with { type: "json" };
import spikeExperimentOutputV2 from "../contracts/workflow-definition/standard-spike-experiment-admission-output.v2.schema.json" with { type: "json" };
import spikeExperimentOutputV3 from "../contracts/workflow-definition/standard-spike-experiment-admission-output.v3.schema.json" with { type: "json" };
import planSelectionOutput from "../contracts/workflow-definition/standard-cycle-plan-selection-output.v1.schema.json" with { type: "json" };
import spikeInitializeInput from "../contracts/workflow-definition/standard-spike-initialize-input.v1.schema.json" with { type: "json" };
import spikeFinalizeInput from "../contracts/workflow-definition/standard-spike-finalize-input.v1.schema.json" with { type: "json" };
import spikeOutput from "../contracts/workflow-definition/standard-spike-output.v1.schema.json" with { type: "json" };
import { assertSpikeDecisionOutput } from "./standard-spike-decision.mjs";
import modeWorkPreflight from "../contracts/workflow-definition/standard-mode-work-preflight-input.v1.schema.json" with { type: "json" };
import modeWorkEvaluate from "../contracts/workflow-definition/standard-mode-work-evaluate-input.v1.schema.json" with { type: "json" };
import modeWorkOutput from "../contracts/workflow-definition/standard-mode-work-output.v1.schema.json" with { type: "json" };
import modeWorkDecisionInput from "../contracts/workflow-definition/standard-mode-work-decision-input.v1.schema.json" with { type: "json" };
import { assertModeWorkObservationOutput, assertModeWorkDecisionOutput } from "./standard-mode-work-continuation.mjs";
import prCorrectionReviewInputV2 from "../contracts/workflow-definition/standard-pr-correction-review-input.v2.schema.json" with { type: "json" };
import prCorrectionReviewInputV3 from "../contracts/workflow-definition/standard-pr-correction-review-input.v3.schema.json" with { type: "json" };
import prCorrectionCycleInput from '../contracts/workflow-definition/standard-pr-correction-cycle-input.v1.schema.json' with { type: 'json' };
import prCorrectionCycleOutput from '../contracts/workflow-definition/standard-pr-correction-cycle-output.v1.schema.json' with { type: 'json' };
import prCorrectionReviewInput from "../contracts/workflow-definition/standard-pr-correction-review-input.v1.schema.json" with { type: "json" };
import { assertPrCorrectionDecisionOutput } from "./standard-pr-correction-decision.mjs";
import prCorrectionCheckpointInput from "../contracts/workflow-definition/standard-pr-correction-checkpoint-input.v1.schema.json" with { type: "json" };
import prCorrectionCheckpointPlan from "../contracts/workflow-definition/standard-pr-correction-checkpoint-plan.v1.schema.json" with { type: "json" };
import prCorrectionCheckpointOutput from "../contracts/workflow-definition/standard-pr-correction-checkpoint-output.v1.schema.json" with { type: "json" };
import prTriageSelectInput from "../contracts/workflow-definition/standard-pr-triage-select-input.v1.schema.json" with { type: "json" };
import prCorrectionInput from "../contracts/workflow-definition/standard-pr-correction-reopen-input.v1.schema.json" with { type: "json" };
import prCorrectionPlan from "../contracts/workflow-definition/standard-pr-correction-reopen-plan.v1.schema.json" with { type: "json" };
import prCorrectionOutput from "../contracts/workflow-definition/standard-pr-correction-reopen-output.v1.schema.json" with { type: "json" };
import prTriageEvaluateInput from "../contracts/workflow-definition/standard-pr-triage-evaluate-input.v1.schema.json" with { type: "json" };
import prTriageSelectOutput from "../contracts/workflow-definition/standard-pr-triage-select-output.v1.schema.json" with { type: "json" };
import prTriageOutput from "../contracts/workflow-definition/standard-pr-triage-output.v1.schema.json" with { type: "json" };
import prReceiveInput from "../contracts/workflow-definition/standard-session-pr-review-receive-input.v1.schema.json" with { type: "json" };
import prReceiveOutput from "../contracts/workflow-definition/standard-session-pr-review-receive-output.v1.schema.json" with { type: "json" };
import prReviewContentOutput from "../contracts/workflow-definition/standard-session-pr-review-content-output.v1.schema.json" with { type: "json" };
import prReviewInput from "../contracts/workflow-definition/standard-session-pr-review-observe-input.v1.schema.json" with { type: "json" };
import prReviewOutput from "../contracts/workflow-definition/standard-session-pr-review-observe-output.v1.schema.json" with { type: "json" };
import prCheckpointInput from "../contracts/workflow-definition/standard-session-pr-checkpoint-input.v1.schema.json" with { type: "json" };
import prCheckpointOutput from "../contracts/workflow-definition/standard-session-pr-checkpoint-output.v1.schema.json" with { type: "json" };
import prRedeliveryInput from "../contracts/workflow-definition/standard-session-pr-redelivery-push-input.v1.schema.json" with { type: "json" };
import prRedeliveryOutput from "../contracts/workflow-definition/standard-session-pr-redelivery-push-output.v1.schema.json" with { type: "json" };
import prUpdateInput from "../contracts/workflow-definition/standard-session-pr-update-push-input.v1.schema.json" with { type: "json" };
import prUpdateOutput from "../contracts/workflow-definition/standard-session-pr-update-push-output.v1.schema.json" with { type: "json" };
import prRecordInput from "../contracts/workflow-definition/standard-session-pr-record-input.v1.schema.json" with { type: "json" };
import prRecordOutput from "../contracts/workflow-definition/standard-session-pr-record-output.v1.schema.json" with { type: "json" };
import prOpenInput from "../contracts/workflow-definition/standard-session-pr-open-input.v1.schema.json" with { type: "json" };
import prOpenOutput from "../contracts/workflow-definition/standard-session-pr-open-output.v1.schema.json" with { type: "json" };
import pushInput from "../contracts/workflow-definition/standard-session-push-input.v1.schema.json" with { type: "json" };
import pushOutput from "../contracts/workflow-definition/standard-session-push-output.v1.schema.json" with { type: "json" };
import prAdmissionInput from "../contracts/workflow-definition/standard-session-pr-admission-input.v1.schema.json" with { type: "json" };
import prAdmissionOutput from "../contracts/workflow-definition/standard-session-pr-admission-output.v1.schema.json" with { type: "json" };
import deliveryInput from "../contracts/workflow-definition/standard-session-delivery-checkpoint-input.v1.schema.json" with { type: "json" };
import deliveryOutput from "../contracts/workflow-definition/standard-session-delivery-checkpoint-output.v1.schema.json" with { type: "json" };
import precloseInput from "../contracts/workflow-definition/standard-session-preclose-checkpoint-input.v1.schema.json" with { type: "json" };
import precloseOutput from "../contracts/workflow-definition/standard-session-preclose-checkpoint-output.v1.schema.json" with { type: "json" };
import sessionCloseHookInput from "../contracts/workflow-definition/standard-session-close-hook-input.v1.schema.json" with { type: "json" };
import sessionCloseHookOutput from "../contracts/workflow-definition/standard-session-close-hook-output.v1.schema.json" with { type: "json" };
import sessionCloseCheckpointInput from "../contracts/workflow-definition/standard-session-close-checkpoint-input.v1.schema.json" with { type: "json" };
import sessionCloseCheckpointOutput from "../contracts/workflow-definition/standard-session-close-checkpoint-output.v1.schema.json" with { type: "json" };
import sessionClosureInput from "../contracts/workflow-definition/standard-session-closure-review-input.v1.schema.json" with { type: "json" };
import sessionCloseInput from "../contracts/workflow-definition/standard-session-close-input.v1.schema.json" with { type: "json" };
import sessionCloseOutput from "../contracts/workflow-definition/standard-session-close-output.v1.schema.json" with { type: "json" };
import { assertSessionClosureDecisionOutput } from "./standard-session-closure-decision.mjs";
import sessionCloseAdmissionOutput from "../contracts/workflow-definition/standard-session-close-admission-output.v1.schema.json" with { type: "json" };
import promotionCheckpointInput from "../contracts/workflow-definition/standard-baseline-promotion-checkpoint-input.v1.schema.json" with { type: "json" };
import promotionCheckpointOutput from "../contracts/workflow-definition/standard-baseline-promotion-checkpoint-output.v1.schema.json" with { type: "json" };
import terminalCheckpointInput from "../contracts/workflow-definition/standard-cycle-terminal-checkpoint-input.v1.schema.json" with { type: "json" };
import terminalCheckpointOutput from "../contracts/workflow-definition/standard-cycle-terminal-checkpoint-output.v1.schema.json" with { type: "json" };
import gitCheckpointInput from "../contracts/workflow-definition/standard-session-git-checkpoint-input.v1.schema.json" with { type: "json" };
import gitCheckpointOutput from "../contracts/workflow-definition/standard-session-git-checkpoint-output.v1.schema.json" with { type: "json" };
import promotionHookInput from "../contracts/workflow-definition/standard-baseline-promotion-hook-input.v1.schema.json" with { type: "json" };
import promotionHookOutput from "../contracts/workflow-definition/standard-baseline-promotion-hook-output.v1.schema.json" with { type: "json" };
import promotionReviewInput from "../contracts/workflow-definition/standard-baseline-promotion-review-input.v1.schema.json" with { type: "json" };
import promotionDecisionOutput from "../contracts/workflow-definition/standard-baseline-promotion-decision-output.v1.schema.json" with { type: "json" };
import promotionInput from "../contracts/workflow-definition/standard-baseline-promotion-input.v1.schema.json" with { type: "json" };
import promotionOutput from "../contracts/workflow-definition/standard-baseline-promotion-output.v1.schema.json" with { type: "json" };
import closeHookInput from "../contracts/workflow-definition/standard-cycle-close-hook-input.v1.schema.json" with { type: "json" };
import closeHookOutput from "../contracts/workflow-definition/standard-cycle-close-hook-output.v1.schema.json" with { type: "json" };
import closeHookOutputV2 from "../contracts/workflow-definition/standard-cycle-close-hook-output.v2.schema.json" with { type: "json" };
import closeSelectionOutput from "../contracts/workflow-definition/standard-cycle-close-selection-output.v1.schema.json" with { type: "json" };
import closeInput from "../contracts/workflow-definition/standard-cycle-close-input.v1.schema.json" with { type: "json" };
import closeOutput from "../contracts/workflow-definition/standard-cycle-close-output.v1.schema.json" with { type: "json" };
import closureInput from "../contracts/workflow-definition/standard-cycle-closure-review-input.v1.schema.json" with { type: "json" };
import closureOutput from "../contracts/workflow-definition/standard-cycle-closure-decision-output.v1.schema.json" with { type: "json" };
import auditSelectInput from "../contracts/workflow-definition/standard-cycle-audit-select-input.v1.schema.json" with { type: "json" };
import auditEvaluateInput from "../contracts/workflow-definition/standard-cycle-audit-evaluate-input.v1.schema.json" with { type: "json" };
import auditSelectOutput from "../contracts/workflow-definition/standard-cycle-audit-selection-output.v1.schema.json" with { type: "json" };
import auditOutput from "../contracts/workflow-definition/standard-cycle-audit-output.v1.schema.json" with { type: "json" };
import empty from "../contracts/workflow-definition/standard-empty-input.v1.schema.json" with { type: "json" };
import initialize from "../contracts/workflow-definition/standard-session-initialize-input.v1.schema.json" with { type: "json" };
import output from "../contracts/workflow-definition/standard-operation-output.v1.schema.json" with { type: "json" };
import plan from "../contracts/workflow-definition/standard-session-initialize-plan.v1.schema.json" with { type: "json" };
import outputV2 from "../contracts/workflow-definition/standard-operation-output.v2.schema.json" with { type: "json" };
import outputV3 from "../contracts/workflow-definition/standard-operation-output.v3.schema.json" with { type: "json" };
import sessionRef from "../contracts/workflow-definition/standard-session-reference-input.v1.schema.json" with { type: "json" };
import modeApply from "../contracts/workflow-definition/standard-mode-apply-input.v1.schema.json" with { type: "json" };
import cycleInput from "../contracts/workflow-definition/standard-cycle-initialize-input.v1.schema.json" with { type: "json" };
import cycleRef from "../contracts/workflow-definition/standard-cycle-reference-input.v1.schema.json" with { type: "json" };
import cycleOutput from "../contracts/workflow-definition/standard-cycle-output.v1.schema.json" with { type: "json" };
import cycleCheckpointOutput from "../contracts/workflow-definition/standard-cycle-checkpoint-output.v1.schema.json" with { type: "json" };
import cyclePlanInput from "../contracts/workflow-definition/standard-cycle-plan-evaluate-input.v1.schema.json" with { type: "json" };
import cyclePlanRecordInput from "../contracts/workflow-definition/standard-cycle-plan-record-input.v1.schema.json" with { type: "json" };
import cyclePlanningOutput from "../contracts/workflow-definition/standard-cycle-planning-output.v1.schema.json" with { type: "json" };
import readinessInput from "../contracts/workflow-definition/standard-cycle-readiness-evaluate-input.v1.schema.json" with { type: "json" };
import implementationInput from "../contracts/workflow-definition/standard-cycle-implementation-enter-input.v1.schema.json" with { type: "json" };
import readinessOutput from "../contracts/workflow-definition/standard-cycle-readiness-output.v1.schema.json" with { type: "json" };
import workInput from "../contracts/workflow-definition/standard-cycle-work-evaluate-input.v1.schema.json" with { type: "json" };
import workOutput from "../contracts/workflow-definition/standard-cycle-work-output.v1.schema.json" with { type: "json" };
import validationInput from "../contracts/workflow-definition/standard-cycle-validation-input.v1.schema.json" with { type: "json" };
import validationOutput from "../contracts/workflow-definition/standard-cycle-validation-output.v1.schema.json" with { type: "json" };
import validationEvaluationInput from "../contracts/workflow-definition/standard-cycle-validation-evaluate-input.v2.schema.json" with { type: "json" };
import verificationInput from "../contracts/workflow-definition/standard-cycle-verification-enter-input.v1.schema.json" with { type: "json" };
import taskInput from "../contracts/workflow-definition/standard-cycle-task-select-input.v1.schema.json" with { type: "json" };
import taskAdvanceInput from "../contracts/workflow-definition/standard-cycle-task-advance-input.v1.schema.json" with { type: "json" };
import taskOutput from "../contracts/workflow-definition/standard-cycle-task-output.v1.schema.json" with { type: "json" };
import taskWorkOutput from "../contracts/workflow-definition/standard-cycle-task-work-output.v1.schema.json" with { type: "json" };
import verificationOutput from "../contracts/workflow-definition/standard-cycle-verification-output.v1.schema.json" with { type: "json" };
import driftInput from "../contracts/workflow-definition/standard-drift-evaluate-input.v1.schema.json" with { type: "json" };
import driftFollowup from "../contracts/workflow-definition/standard-drift-followup-input.v1.schema.json" with { type: "json" };
import driftRouteOutput from "../contracts/workflow-definition/standard-drift-route-output.v1.schema.json" with { type: "json" };
import driftOutput from "../contracts/workflow-definition/standard-drift-output.v1.schema.json" with { type: "json" };
import recoveryInput from "../contracts/workflow-definition/standard-drift-recovery-record-input.v1.schema.json" with { type: "json" };
import recoveryOutput from "../contracts/workflow-definition/standard-drift-recovery-output.v1.schema.json" with { type: "json" };
import changeRequestInput from "../contracts/workflow-definition/standard-drift-change-request-input.v1.schema.json" with { type: "json" };
import changeRequestOutput from "../contracts/workflow-definition/standard-drift-change-request-output.v1.schema.json" with { type: "json" };
import driftCycleContext from "../contracts/workflow-definition/standard-drift-cycle-context-input.v1.schema.json" with { type: "json" };
import driftCycleCheckpoint from "../contracts/workflow-definition/standard-drift-cycle-checkpoint-input.v1.schema.json" with { type: "json" };
import driftCycleInput from "../contracts/workflow-definition/standard-drift-cycle-initialize-input.v1.schema.json" with { type: "json" };
import driftCycleOutput from "../contracts/workflow-definition/standard-drift-cycle-output.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
export function normalizeStandardOperationInput(operation, value) {
  assertStandardOperationInput(operation, value);
  if (operation === "session_initialize") return { ...value, mode: value.mode ?? "UNKNOWN" };
  if (operation === "cycle_initialize") return { ...value, objective: value.objective.replace(/\s+/gu, " ").trim() };
  return structuredClone(value);
}
export function assertStandardOperationInput(operation, value) {
  if (operation === "cycle_plan_select") {
    if (checkShadowJson(value) || validateJsonSchema(value, empty, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_INPUT_INVALID");
    return value;
  }
  if (operation === "spike_experiment_execution_admit") {
    if (checkShadowJson(value) || validateJsonSchema(value, spikeExperimentInput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_INPUT_INVALID");
    return value;
  }
  if (["spike_conversion_admit", "spike_conversion_decision", "spike_cycle_initialize", "spike_conversion_finalize", "spike_experiment_admit"].includes(operation)) {
    const schema = operation === "spike_cycle_initialize" ? spikeInitializeInput : ["spike_conversion_finalize", "spike_experiment_admit"].includes(operation) ? spikeFinalizeInput : spikeReviewInput;
    if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_INPUT_INVALID");
    return value;
  }
  if (["mode_work_preflight", "mode_work_evaluate", "mode_work_observe", "mode_work_continue_decision"].includes(operation)) {
    if (checkShadowJson(value) || validateJsonSchema(value, operation === "mode_work_continue_decision" ? modeWorkDecisionInput : operation === "mode_work_preflight" ? modeWorkPreflight : modeWorkEvaluate, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_INPUT_INVALID");
    return value;
  }
  if (operation === 'session_pr_correction_cycle_initialize') {
    if (checkShadowJson(value) || validateJsonSchema(value, prCorrectionCycleInput, '$', { contractKind: 'workflow-definition' }).length) fail('STANDARD_OPERATION_INPUT_INVALID');
    return value;
  }
  if (operation === "session_pr_correction_decision") {
    if (checkShadowJson(value) || validateJsonSchema(value, value?.contract_version === "standard-pr-correction-review-input.v3" ? prCorrectionReviewInputV3 : value?.contract_version === "standard-pr-correction-review-input.v2" ? prCorrectionReviewInputV2 : prCorrectionReviewInput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_INPUT_INVALID");
    return value;
  }
  if (["session_pr_correction_checkpoint", "session_pr_correction_reopen"].includes(operation)) {
    if (checkShadowJson(value) || validateJsonSchema(value, operation === "session_pr_correction_checkpoint" ? prCorrectionCheckpointInput : prCorrectionInput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_INPUT_INVALID");
    return value;
  }
  if (["session_pr_triage_select", "session_pr_triage_evaluate"].includes(operation)) {
    if (checkShadowJson(value) || validateJsonSchema(value, operation === "session_pr_triage_select" ? prTriageSelectInput : prTriageEvaluateInput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_INPUT_INVALID");
    return value;
  }
  if (operation === "session_pr_review_receive") {
    if (checkShadowJson(value) || validateJsonSchema(value, prReceiveInput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_INPUT_INVALID");
    return value;
  }
  if (["session_pr_review_content_observe", "session_pr_review_observe"].includes(operation)) {
    if (checkShadowJson(value) || validateJsonSchema(value, prReviewInput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_INPUT_INVALID");
    return value;
  }
  const schema = operation === "session_pr_redelivery_push" ? prRedeliveryInput : operation === "session_pr_checkpoint" ? prCheckpointInput : operation === "session_pr_update_push" ? prUpdateInput : operation === "session_pr_record" ? prRecordInput : operation === "session_pr_open" ? prOpenInput : operation === "session_push" ? pushInput : operation === "session_pr_admit" ? prAdmissionInput : operation === "session_branch_integration_decision" ? integrationReviewInput : operation === "session_branch_integrate" ? integrationInput : operation === "session_delivery_checkpoint" ? deliveryInput : operation === "session_preclose_checkpoint" ? precloseInput : operation === "session_close_finalize" ? sessionCloseHookInput : operation === "session_close_checkpoint" ? sessionCloseCheckpointInput : operation === "session_close_record" ? sessionCloseInput : operation === "session_closure_decision" ? sessionClosureInput : operation === "baseline_promotion_checkpoint" ? promotionCheckpointInput : operation === "cycle_terminal_checkpoint" ? terminalCheckpointInput : operation === "session_git_checkpoint" ? gitCheckpointInput : operation === "baseline_promotion_finalize" ? promotionHookInput : operation === "baseline_promotion_decision" ? promotionReviewInput : operation === "baseline_promotion_record" ? promotionInput : operation === "cycle_close_finalize" ? closeHookInput : operation === "cycle_close_record" ? closeInput : operation === "cycle_closure_decision" ? closureInput : operation === "cycle_audit_select" ? auditSelectInput : operation === "cycle_audit_evaluate" ? auditEvaluateInput : operation === "session_initialize" ? initialize : ["context_reload", "session_admit", "cycle_admit", "drift_completion_decision", "drift_completion_select", "cycle_close_completed_select"].includes(operation) ? empty
    : ["mode_decision", "session_start_finalize", "cycle_context_refresh", "session_close_admit"].includes(operation) ? sessionRef : operation === "session_mode_apply" ? modeApply
    : operation === "cycle_initialize" ? cycleInput : ["branch_cycle_audit", "cycle_checkpoint_finalize"].includes(operation) ? cycleRef : operation === "drift_report_evaluate" ? driftInput
    : ["drift_check_finalize", "drift_recovery_decision", "drift_followup_select"].includes(operation) ? driftFollowup : operation === "drift_recovery_record" ? recoveryInput
    : operation === "drift_change_request_record" ? changeRequestInput : operation === "drift_recovery_context_refresh" ? driftCycleContext
    : operation === "drift_recovery_cycle_initialize" ? driftCycleInput : operation === "drift_recovery_checkpoint_observe" ? driftCycleCheckpoint
    : operation === "cycle_plan_evaluate" ? cyclePlanInput : operation === "cycle_plan_record" ? cyclePlanRecordInput
    : operation === "cycle_readiness_evaluate" ? readinessInput : operation === "cycle_implementation_enter" ? implementationInput : operation === "cycle_work_evaluate" ? workInput : operation === "cycle_validation_execute" ? validationInput
    : operation === "cycle_task_select" ? taskInput : operation === "cycle_task_advance" ? taskAdvanceInput : operation === "cycle_task_work_evaluate" ? workInput
    : operation === "cycle_validation_evaluate" ? validationEvaluationInput : operation === "cycle_verification_enter" ? verificationInput : null;
  if (!schema || checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length)
    fail(operation === "session_initialize" ? "STANDARD_SESSION_INPUT_INVALID" : "STANDARD_OPERATION_INPUT_INVALID");
  return value;
}
// observations is the opaque, host-owned business payload. Full normative
// documents stay outside reducer events: receipts carry their immutable hash.
export function assertStandardOperationOutput(value) {
  if (value?.contract_version === "standard-cycle-close-selection-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, closeSelectionOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-operation-output.v3") {
    const choice = value.observations?.choice, accepted = ["THINKING", "EXPLORING", "COMMITTING"].includes(choice);
    if (checkShadowJson(value) || validateJsonSchema(value, outputV3, "$", { contractKind: "workflow-definition" }).length
      || value.effect_status !== "no_effect"
      || value.outcome !== (accepted ? "completed" : choice === "refused" ? "rejected" : choice)
      || shadowHash(value.facts) !== shadowHash(accepted ? { mode_thinking: choice === "THINKING", mode_exploring: choice === "EXPLORING",
        mode_committing: choice === "COMMITTING", cycle_work_requested: choice === "COMMITTING" } : {})) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-spike-experiment-admission-output.v3") {
    if (checkShadowJson(value) || validateJsonSchema(value, spikeExperimentOutputV3, "$", { contractKind: "workflow-definition" }).length
      || shadowHash(value.facts) !== shadowHash(value.outcome === "completed" ? { spike_experiment_execution_admitted: true, cycle_work_requested: true } : {})) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-cycle-plan-selection-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, planSelectionOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-spike-experiment-admission-output.v2") {
    if (checkShadowJson(value) || validateJsonSchema(value, spikeExperimentOutputV2, "$", { contractKind: "workflow-definition" }).length
      || shadowHash(value.facts) !== shadowHash(value.outcome !== "completed" ? {} : value.operation_ref === "spike_experiment_execution_admit"
        ? { spike_experiment_execution_admitted: true } : { spike_experiment_planning_admitted: true, spike_experiment_committing: value.facts.spike_experiment_committing })) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-spike-experiment-admission-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, spikeExperimentOutput, "$", { contractKind: "workflow-definition" }).length
      || value.outcome === "completed" && (value.operation_ref !== "spike_experiment_admit"
        || typeof value.facts.spike_experiment_committing !== "boolean"
        || shadowHash(value.facts) !== shadowHash({ spike_experiment_planning_admitted: true, spike_experiment_committing: value.facts.spike_experiment_committing }))
      || value.outcome !== "completed" && Object.keys(value.facts).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-spike-decision-output.v1") return assertSpikeDecisionOutput(value);
  if (value?.contract_version === "standard-spike-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, spikeOutput, "$", { contractKind: "workflow-definition" }).length
      || (value.outcome === "reconciliation_required") !== (value.effect_status === "unknown")
      || value.outcome !== "completed" && Object.keys(value.facts).length
      || value.outcome === "completed" && (value.operation_ref === "spike_conversion_admit" ? value.effect_status !== "no_effect" || typeof value.facts.mode_work_spike_requested !== "boolean"
        : value.operation_ref === "spike_cycle_initialize" ? value.effect_status !== "confirmed" || shadowHash(value.facts) !== shadowHash({ spike_cycle_initialized: true, spike_conversion_completed: false, spike_experiments_pending: true })
        : value.operation_ref === "spike_conversion_finalize" ? value.effect_status !== "confirmed" || shadowHash(value.facts) !== shadowHash({ spike_conversion_completed: true, spike_experiments_pending: true, mode_analysis_completed: true }) : true)) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-mode-work-observation-output.v1") return assertModeWorkObservationOutput(value);
  if (value?.contract_version === "standard-mode-work-decision-output.v1") return assertModeWorkDecisionOutput(value);
  if (value?.contract_version === "standard-mode-work-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, modeWorkOutput, "$", { contractKind: "workflow-definition" }).length
      || (value.outcome === "blocked" ? Object.keys(value.facts).length !== 0
        : value.operation_ref === "mode_work_preflight" ? shadowHash(value.facts) !== shadowHash({ mode_work_ready: true })
        : value.facts.mode_analysis_completed !== true || typeof value.facts.exploration_nonretained !== "boolean" || Object.keys(value.facts).length !== 2)) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === 'standard-pr-correction-cycle-output.v1') {
    if (checkShadowJson(value) || validateJsonSchema(value, prCorrectionCycleOutput, '$', { contractKind: 'workflow-definition' }).length
      || (value.outcome === 'completed' ? value.effect_status !== 'confirmed' || value.facts.session_pr_correction_cycle_initialized !== true || value.facts.cycle_dor_ready !== false : Object.keys(value.facts).length !== 0)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
    return value;
  }
  if (["standard-pr-correction-decision-output.v1", "standard-pr-correction-decision-output.v2", "standard-pr-correction-decision-output.v3"].includes(value?.contract_version)) return assertPrCorrectionDecisionOutput(value);
  if (["standard-pr-correction-checkpoint-output.v1", "standard-pr-correction-reopen-output.v1"].includes(value?.contract_version)) {
    if (checkShadowJson(value) || validateJsonSchema(value, value.contract_version === "standard-pr-correction-checkpoint-output.v1" ? prCorrectionCheckpointOutput : prCorrectionOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (["standard-pr-triage-select-output.v1", "standard-pr-triage-output.v1"].includes(value?.contract_version)) {
    const selection = value.contract_version === "standard-pr-triage-select-output.v1";
    if (checkShadowJson(value) || validateJsonSchema(value, selection ? prTriageSelectOutput : prTriageOutput, "$", { contractKind: "workflow-definition" }).length
      || (value.outcome === "blocked" ? Object.keys(value.facts).length !== 0
        : selection ? value.facts.session_pr_triage_source_selected !== true
        : value.facts.session_pr_findings_classified !== true || !["session_pr_corrections_required", "session_pr_responses_required"].every(key => typeof value.facts[key] === "boolean")
          || value.observations.triage_completion !== "pending-effects-and-verification" || value.observations.checks_acceptance !== "not-established"
          || value.observations.merge_authorization !== "not-established")) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-session-pr-review-receive-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, prReceiveOutput, "$", { contractKind: "workflow-definition" }).length
      || (value.outcome === "completed" ? value.facts.session_pr_review_event_received !== true || value.facts.session_pr_triage_required !== true
        || value.observations.acceptance !== "pending-triage-and-policy-evaluation" || value.observations.merge_authorization !== "not-established"
        : Object.keys(value.facts).length !== 0)) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-session-pr-review-content-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, prReviewContentOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-session-pr-review-observe-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, prReviewOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (["standard-session-pr-redelivery-push-output.v1", "standard-session-pr-checkpoint-output.v1", "standard-session-pr-update-push-output.v1"].includes(value?.contract_version)) {
    const schema = value.contract_version === "standard-session-pr-redelivery-push-output.v1" ? prRedeliveryOutput : value.contract_version === "standard-session-pr-checkpoint-output.v1" ? prCheckpointOutput : prUpdateOutput;
    if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-session-pr-record-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, prRecordOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-session-pr-open-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, prOpenOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-session-push-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, pushOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-session-pr-admission-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, prAdmissionOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    const facts = value.facts, completed = value.outcome === "completed";
    if (completed ? facts.session_pr_admitted !== true || typeof facts.session_push_required !== "boolean" || typeof facts.session_pr_open_required !== "boolean"
      || facts.session_push_required === facts.session_pr_open_required || value.evidence_refs.length !== 1
      : Object.keys(facts).length !== 0 || value.evidence_refs.length !== 0) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-session-branch-integration-decision-output.v1") return assertSessionBranchIntegrationDecisionOutput(value);
  if (value?.contract_version === "standard-session-branch-integrate-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, integrationOutput, "$", { contractKind: "workflow-definition" }).length
      || value.effect_status !== ({ completed: "confirmed", blocked: "no_effect", reconciliation_required: "unknown" })[value.outcome]
      || shadowHash(value.facts) !== shadowHash(value.outcome === "completed" ? { session_branch_integrated: true } : {})) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if(value?.contract_version === "standard-session-delivery-checkpoint-output.v1") {
    if(checkShadowJson(value) || validateJsonSchema(value,deliveryOutput,"$",{contractKind:"workflow-definition"}).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-session-preclose-checkpoint-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, precloseOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-session-close-hook-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, sessionCloseHookOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-session-close-checkpoint-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, sessionCloseCheckpointOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-session-close-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, sessionCloseOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-session-closure-decision-output.v1") return assertSessionClosureDecisionOutput(value);
  if (value?.contract_version === "standard-session-close-admission-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, sessionCloseAdmissionOutput, "$", { contractKind: "workflow-definition" }).length
      || value.outcome === "completed" && value.facts.session_close_admission_satisfied !== true
      || value.outcome !== "completed" && Object.keys(value.facts).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-baseline-promotion-checkpoint-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, promotionCheckpointOutput, "$", { contractKind: "workflow-definition" }).length
      || value.outcome !== "completed" && Object.keys(value.facts).length
      || (value.outcome === "reconciliation_required") !== (value.effect_status === "unknown")
      || value.outcome === "completed" && (value.effect_status !== "confirmed" || value.facts.baseline_checkpoint_completed !== true
        || value.facts.baseline_promotion_completed !== false || typeof value.facts.baseline_checkpoint_commit_created !== "boolean")) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-cycle-terminal-checkpoint-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, terminalCheckpointOutput, "$", { contractKind: "workflow-definition" }).length
      || value.outcome !== "completed" && Object.keys(value.facts).length
      || (value.outcome === "reconciliation_required") !== (value.effect_status === "unknown")
      || value.outcome === "completed" && (value.effect_status !== "confirmed" || value.facts.cycle_terminal_checkpoint_completed !== true
        || value.facts.cycle_close_completed !== false || typeof value.facts.cycle_terminal_commit_created !== "boolean")) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-session-git-checkpoint-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, gitCheckpointOutput, "$", { contractKind: "workflow-definition" }).length
      || value.outcome !== "completed" && Object.keys(value.facts).length
      || (value.outcome === "reconciliation_required") !== (value.effect_status === "unknown")
      || value.outcome === "completed" && value.facts.session_git_ready_for_cycle !== true) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }

  if (["standard-baseline-promotion-hook-output.v1", "standard-baseline-promotion-decision-output.v1", "standard-baseline-promotion-output.v1"].includes(value?.contract_version)) {
    const schema = value.contract_version === "standard-baseline-promotion-hook-output.v1" ? promotionHookOutput : value.contract_version === "standard-baseline-promotion-output.v1" ? promotionOutput : promotionDecisionOutput;
    if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (["standard-cycle-close-hook-output.v1", "standard-cycle-close-hook-output.v2"].includes(value?.contract_version)) {
    if (checkShadowJson(value) || validateJsonSchema(value, value.contract_version.endsWith(".v2") ? closeHookOutputV2 : closeHookOutput, "$", { contractKind: "workflow-definition" }).length
      || value.effect_status === "confirmed" && (!["DONE", "NO_GO", "DROPPED"].includes(value.observations.target_state)
        || value.facts.cycle_retained !== (value.observations.target_state === "DONE"))) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }

  if (value?.contract_version === "standard-cycle-close-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, closeOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    if (value.outcome === "completed" && (!["DONE", "NO_GO", "DROPPED"].includes(value.observations.target_state)
      || value.facts.cycle_retained !== (value.observations.target_state === "DONE") || value.observations.closure_hook !== "pending" || value.observations.skill_completion !== "pending")) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }

  if (value?.contract_version === "standard-cycle-closure-decision-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, closureOutput, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    const choice = value.observations.choice, accepted = ["retain", "no_go", "drop"].includes(choice);
    const expected = accepted ? { cycle_closure_choice_recorded: true, cycle_retention_requested: choice === "retain", cycle_no_go_requested: choice === "no_go", cycle_drop_requested: choice === "drop" } : {};
    if (value.outcome !== (accepted ? "completed" : choice === "refused" ? "rejected" : choice)
      || Object.keys(value.facts).sort().join(",") !== Object.keys(expected).sort().join(",")
      || Object.keys(expected).some(key => value.facts[key] !== expected[key])) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }

  if (["standard-cycle-audit-selection-output.v1", "standard-cycle-audit-output.v1"].includes(value?.contract_version)) {
    if (checkShadowJson(value) || validateJsonSchema(value, value.contract_version === "standard-cycle-audit-output.v1" ? auditOutput : auditSelectOutput, "$", { contractKind: "workflow-definition" }).length
      || value.outcome !== "completed" && Object.keys(value.facts).length) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }

  if (value?.contract_version === "standard-cycle-task-output.v1" || value?.contract_version === "standard-cycle-task-work-output.v1") {
    const readOnly = value.operation_ref !== "cycle_task_advance";
    if (checkShadowJson(value) || validateJsonSchema(value, value.contract_version === "standard-cycle-task-work-output.v1" ? taskWorkOutput : taskOutput, "$", { contractKind: "workflow-definition" }).length
      || value.outcome !== "completed" && Object.keys(value.facts).length || (value.outcome === "reconciliation_required") !== (value.effect_status === "unknown")
      || readOnly && value.effect_status !== "no_effect" || value.outcome === "blocked" && value.effect_status !== "no_effect"
      || value.outcome === "completed" && !readOnly && value.effect_status !== "confirmed") fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }

  if (value?.contract_version === "standard-cycle-verification-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, verificationOutput, "$", { contractKind: "workflow-definition" }).length
      || value.outcome !== "completed" && Object.keys(value.facts).length || (value.outcome === "reconciliation_required") !== (value.effect_status === "unknown")
      || value.operation_ref === "cycle_validation_evaluate" && value.effect_status !== "no_effect"
      || value.outcome === "blocked" && value.effect_status !== "no_effect"
      || value.outcome === "completed" && value.operation_ref === "cycle_verification_enter" && value.effect_status !== "confirmed") fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-cycle-validation-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, validationOutput, "$", { contractKind: "workflow-definition" }).length
      || value.outcome !== "completed" && Object.keys(value.facts).length || (value.outcome === "reconciliation_required") !== (value.effect_status === "unknown")
      || value.outcome === "blocked" && value.effect_status !== "no_effect"
      || value.outcome === "completed" && (value.effect_status !== "confirmed" || !["passed", "failed", "unavailable"].includes(value.observations.status)
        || value.facts.cycle_validation_passed !== (value.observations.status === "passed") || value.facts.cycle_validation_available !== (value.observations.status !== "unavailable")
        || !["fixture", "native"].includes(value.observations.proof_class) || value.evidence_refs.length !== 1)) fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-cycle-work-output.v1") {
    if (validateJsonSchema(value, workOutput, "$", { contractKind: "workflow-definition" }).length
      || value.outcome !== "completed" && Object.keys(value.facts).length || value.effect_status !== "no_effect") fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  if (value?.contract_version === "standard-cycle-readiness-output.v1") {
    if (validateJsonSchema(value, readinessOutput, "$", { contractKind: "workflow-definition" }).length
      || value.outcome !== "completed" && Object.keys(value.facts).length
      || (value.outcome === "reconciliation_required") !== (value.effect_status === "unknown")
      || ["blocked", "deferred"].includes(value.outcome) && value.effect_status !== "no_effect") fail("STANDARD_OPERATION_OUTPUT_INVALID");
    return value;
  }
  const schema = value?.contract_version === "standard-drift-route-output.v1" ? driftRouteOutput : value?.contract_version === "standard-cycle-planning-output.v1" ? cyclePlanningOutput : value?.contract_version === "standard-cycle-checkpoint-output.v1" ? cycleCheckpointOutput : value?.contract_version === "standard-drift-cycle-output.v1" ? driftCycleOutput : value?.contract_version === "standard-drift-change-request-output.v1" ? changeRequestOutput : value?.contract_version === "standard-drift-recovery-output.v1" ? recoveryOutput : value?.contract_version === "standard-drift-output.v1" ? driftOutput : value?.contract_version === "standard-cycle-output.v1" ? cycleOutput : value?.contract_version === "standard-operation-output.v2" ? outputV2 : output;
  if (validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length
    || value.outcome !== "completed" && Object.keys(value.facts).length
    || (value.outcome === "reconciliation_required") !== (value.effect_status === "unknown")
    || ["blocked", "deferred"].includes(value.outcome) && value.effect_status !== "no_effect") fail("STANDARD_OPERATION_OUTPUT_INVALID");
  return value;
}
export function assertStandardSessionPlan(value) {
  if (validateJsonSchema(value, plan, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_PLAN_INVALID");
  assertStandardOperationInput("session_initialize", value.input);
  if (value.input.mode !== "UNKNOWN" || value.changes[0].path !== `sessions/${value.input.session_id}.md`
    || value.changes[0].before_sha256 !== null || value.changes[1].path !== "CURRENT-STATE.md" || value.changes[1].before_sha256 === null) fail("STANDARD_PLAN_INVALID");
  return value;
}
export function assertStandardPrCorrectionPlan(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, prCorrectionPlan, "$", { contractKind: "workflow-definition" }).length
    || shadowHash(value.source) !== value.source_sha256 || value.source.triage_operation_id !== value.input.triage_operation_id) fail("STANDARD_PLAN_INVALID");
  assertStandardOperationInput("session_pr_correction_reopen", value.input);
  return value;
}
import integrationReviewInput from "../contracts/workflow-definition/standard-session-branch-integration-review-input.v1.schema.json" with { type: "json" };
import integrationInput from "../contracts/workflow-definition/standard-session-branch-integrate-input.v1.schema.json" with { type: "json" };
import integrationOutput from "../contracts/workflow-definition/standard-session-branch-integrate-output.v1.schema.json" with { type: "json" };
import { assertSessionBranchIntegrationDecisionOutput } from "./standard-session-branch-integration-decision.mjs";

export function assertStandardPrCorrectionCheckpointPlan(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, prCorrectionCheckpointPlan, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_PLAN_INVALID");
  assertStandardOperationInput("session_pr_correction_checkpoint", value.input);
  const approved = new Set([`docs/audit/sessions/${value.session_id}.md`, "docs/audit/CURRENT-STATE.md", "docs/audit/snapshots/context-snapshot.md"]);
  if (value.git.files.length > 3 || new Set(value.git.files.map(row => row.path)).size !== value.git.files.length || value.git.files.some(row => !approved.has(row.path))) fail("STANDARD_PLAN_INVALID");
  return value;
}
