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
import { checkShadowJson } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
export function normalizeStandardOperationInput(operation, value) {
  assertStandardOperationInput(operation, value);
  if (operation === "session_initialize") return { ...value, mode: value.mode ?? "UNKNOWN" };
  if (operation === "cycle_initialize") return { ...value, objective: value.objective.replace(/\s+/gu, " ").trim() };
  return structuredClone(value);
}
export function assertStandardOperationInput(operation, value) {
  const schema = operation === "session_initialize" ? initialize : ["context_reload", "session_admit", "cycle_admit"].includes(operation) ? empty
    : ["mode_decision", "session_start_finalize", "cycle_context_refresh"].includes(operation) ? sessionRef : operation === "session_mode_apply" ? modeApply
    : operation === "cycle_initialize" ? cycleInput : ["branch_cycle_audit", "cycle_checkpoint_finalize"].includes(operation) ? cycleRef : operation === "drift_report_evaluate" ? driftInput
    : ["drift_check_finalize", "drift_recovery_decision"].includes(operation) ? driftFollowup : operation === "drift_recovery_record" ? recoveryInput
    : operation === "drift_change_request_record" ? changeRequestInput : operation === "drift_recovery_context_refresh" ? driftCycleContext
    : operation === "drift_recovery_cycle_initialize" ? driftCycleInput : operation === "drift_recovery_checkpoint_observe" ? driftCycleCheckpoint
    : operation === "cycle_plan_evaluate" ? cyclePlanInput : operation === "cycle_plan_record" ? cyclePlanRecordInput
    : operation === "cycle_readiness_evaluate" ? readinessInput : operation === "cycle_implementation_enter" ? implementationInput : operation === "cycle_work_evaluate" ? workInput : operation === "cycle_validation_execute" ? validationInput : null;
  if (!schema || checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length)
    fail(operation === "session_initialize" ? "STANDARD_SESSION_INPUT_INVALID" : "STANDARD_OPERATION_INPUT_INVALID");
  return value;
}
// observations is the opaque, host-owned business payload. Full normative
// documents stay outside reducer events: receipts carry their immutable hash.
export function assertStandardOperationOutput(value) {
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
