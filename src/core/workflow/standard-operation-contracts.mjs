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
  const schema = operation === "session_pr_open" ? prOpenInput : operation === "session_push" ? pushInput : operation === "session_pr_admit" ? prAdmissionInput : operation === "session_branch_integration_decision" ? integrationReviewInput : operation === "session_branch_integrate" ? integrationInput : operation === "session_delivery_checkpoint" ? deliveryInput : operation === "session_preclose_checkpoint" ? precloseInput : operation === "session_close_finalize" ? sessionCloseHookInput : operation === "session_close_checkpoint" ? sessionCloseCheckpointInput : operation === "session_close_record" ? sessionCloseInput : operation === "session_closure_decision" ? sessionClosureInput : operation === "baseline_promotion_checkpoint" ? promotionCheckpointInput : operation === "cycle_terminal_checkpoint" ? terminalCheckpointInput : operation === "session_git_checkpoint" ? gitCheckpointInput : operation === "baseline_promotion_finalize" ? promotionHookInput : operation === "baseline_promotion_decision" ? promotionReviewInput : operation === "baseline_promotion_record" ? promotionInput : operation === "cycle_close_finalize" ? closeHookInput : operation === "cycle_close_record" ? closeInput : operation === "cycle_closure_decision" ? closureInput : operation === "cycle_audit_select" ? auditSelectInput : operation === "cycle_audit_evaluate" ? auditEvaluateInput : operation === "session_initialize" ? initialize : ["context_reload", "session_admit", "cycle_admit"].includes(operation) ? empty
    : ["mode_decision", "session_start_finalize", "cycle_context_refresh", "session_close_admit"].includes(operation) ? sessionRef : operation === "session_mode_apply" ? modeApply
    : operation === "cycle_initialize" ? cycleInput : ["branch_cycle_audit", "cycle_checkpoint_finalize"].includes(operation) ? cycleRef : operation === "drift_report_evaluate" ? driftInput
    : ["drift_check_finalize", "drift_recovery_decision"].includes(operation) ? driftFollowup : operation === "drift_recovery_record" ? recoveryInput
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
  if (value?.contract_version === "standard-cycle-close-hook-output.v1") {
    if (checkShadowJson(value) || validateJsonSchema(value, closeHookOutput, "$", { contractKind: "workflow-definition" }).length
      || value.outcome === "completed" && (!["DONE", "NO_GO", "DROPPED"].includes(value.observations.target_state)
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
  const schema = value?.contract_version === "standard-cycle-planning-output.v1" ? cyclePlanningOutput : value?.contract_version === "standard-cycle-checkpoint-output.v1" ? cycleCheckpointOutput : value?.contract_version === "standard-drift-cycle-output.v1" ? driftCycleOutput : value?.contract_version === "standard-drift-change-request-output.v1" ? changeRequestOutput : value?.contract_version === "standard-drift-recovery-output.v1" ? recoveryOutput : value?.contract_version === "standard-drift-output.v1" ? driftOutput : value?.contract_version === "standard-cycle-output.v1" ? cycleOutput : value?.contract_version === "standard-operation-output.v2" ? outputV2 : output;
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
import integrationReviewInput from "../contracts/workflow-definition/standard-session-branch-integration-review-input.v1.schema.json" with { type: "json" };
import integrationInput from "../contracts/workflow-definition/standard-session-branch-integrate-input.v1.schema.json" with { type: "json" };
import integrationOutput from "../contracts/workflow-definition/standard-session-branch-integrate-output.v1.schema.json" with { type: "json" };
import { assertSessionBranchIntegrationDecisionOutput } from "./standard-session-branch-integration-decision.mjs";
