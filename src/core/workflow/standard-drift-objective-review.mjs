import renewalSchema from "../contracts/workflow-definition/standard-drift-recovery-plan.v3.schema.json" with { type: "json" };
import schema from "../contracts/workflow-definition/standard-drift-recovery-plan.v2.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { assertStandardDriftReport } from "./native-activity-output.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
export const objectiveReviewChoices = Object.freeze(["confirm_alignment", "request_diagnosis"]);
// This is a review of a suspect signal, not confirmed findings or permission
// to discharge that signal. Finalization keeps its independent guard.
export function assertObjectiveReview(plan) {
  if (checkShadowJson(plan) || validateJsonSchema(plan, plan?.contract_version === "standard-drift-recovery-plan.v3" ? renewalSchema : schema, "$", { contractKind: "workflow-definition" }).length
    || Buffer.byteLength(JSON.stringify(plan)) > 98304) fail("STANDARD_OBJECTIVE_REVIEW_INVALID");
  const report = assertStandardDriftReport(plan.report), gate = plan.gate_constraints;
  const left = plan.session_objective.toLowerCase().trim(), right = plan.cycle_objective.toLowerCase().trim();
  if (!left || !right || left === right || left.includes(right) || right.includes(left)
    || report.context_sha256 !== plan.context_sha256 || report.original_objective !== plan.cycle_objective
    || report.current_objective !== report.original_objective || report.drift_level !== "none" || report.objective_changed !== false || report.changes.length
    || gate.level1.decision === "stop" || gate.level3.required !== false
    || shadowHash(gate.other_signals) !== shadowHash(["objective_delta"])
    || shadowHash(plan.choices) !== shadowHash(objectiveReviewChoices)) fail("STANDARD_OBJECTIVE_REVIEW_INVALID");
  return plan;
}
