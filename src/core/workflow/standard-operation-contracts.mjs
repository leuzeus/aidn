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
import driftInput from "../contracts/workflow-definition/standard-drift-evaluate-input.v1.schema.json" with { type: "json" };
import driftFollowup from "../contracts/workflow-definition/standard-drift-followup-input.v1.schema.json" with { type: "json" };
import driftOutput from "../contracts/workflow-definition/standard-drift-output.v1.schema.json" with { type: "json" };
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
    : operation === "cycle_initialize" ? cycleInput : ["branch_cycle_audit"].includes(operation) ? cycleRef : operation === "drift_report_evaluate" ? driftInput
    : operation === "drift_check_finalize" ? driftFollowup : null;
  if (!schema || checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length)
    fail(operation === "session_initialize" ? "STANDARD_SESSION_INPUT_INVALID" : "STANDARD_OPERATION_INPUT_INVALID");
  return value;
}
// observations is the opaque, host-owned business payload. Full normative
// documents stay outside reducer events: receipts carry their immutable hash.
export function assertStandardOperationOutput(value) {
  const schema = value?.contract_version === "standard-drift-output.v1" ? driftOutput : value?.contract_version === "standard-cycle-output.v1" ? cycleOutput : value?.contract_version === "standard-operation-output.v2" ? outputV2 : output;
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
