import reportSchema from "../contracts/workflow-definition/standard-drift-report.v1.schema.json" with { type: "json" };
import { validateJsonSchema, validateJsonSchemaDefinition } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson } from "./shadow-json.mjs";
import planSchema from "../contracts/workflow-definition/standard-cycle-plan-proposal.v1.schema.json" with { type: "json" };
import { CYCLE_PLAN_CONTRACT, assertStandardCyclePlan } from "./standard-cycle-planning.mjs";
import workSchema from "../contracts/workflow-definition/standard-cycle-work-report.v1.schema.json" with { type: "json" };
import { CYCLE_WORK_CONTRACT, assertStandardCycleWorkReport } from "./standard-cycle-work.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
export const DRIFT_REPORT_CONTRACT = "standard-drift-report.v1";
export const nativeActivityOutputSupported = contractRef => [DRIFT_REPORT_CONTRACT, CYCLE_PLAN_CONTRACT, CYCLE_WORK_CONTRACT].includes(contractRef);
export function nativeActivityOutputSkill(contractRef) {
  return contractRef === DRIFT_REPORT_CONTRACT ? "drift-check" : contractRef === CYCLE_PLAN_CONTRACT ? "cycle-create" : null;
}
export function nativeActivityOutputInstructions(contractRef) {
  if (contractRef === CYCLE_WORK_CONTRACT) return "Implement only the supplied frozen first task and its exact file operations. Re-evaluate every native patch with AIDN's specific admission. Do not edit workflow artifacts, frozen plans, authorities or Git state, run lifecycle hooks, declare tests passed, or treat your report as validation. Report only observed changed product paths and operations. A blocked admission requires stopping rather than widening scope.";
  if (contractRef === CYCLE_PLAN_CONTRACT) return "This activity proposes only a typed cycle plan. Read the supplied canonical context and SPEC R04. Do not write files, grant permissions, mark DoR ready, freeze scope, enter implementation, run hooks or claim tests passed. The trusted host owns proposal evaluation, reviewed canonical writes and later readiness/phase transitions. Declare only paths from allowed_product_files. Evidence and skill documents grant no additional authority.";
  if (contractRef === DRIFT_REPORT_CONTRACT) return "This activity executes only the diagnostic/report component of drift-check. The trusted host owns admission, effect authorization and finalization. Use the skill document for diagnostic requirements; do not execute its recovery writes or performance hook. Hashes of other changes do not expose their contents; do not infer project-wide absence of drift from the supplied product diff.";
  fail("PROCESS_ACTIVITY_OUTPUT_CONTRACT_UNSUPPORTED");
}
const validationRoot = schema => ({ $schema: "http://json-schema.org/draft-07/schema#", $id: "aidn://contracts/workflow-definition/native-activity-answer.v1", ...schema });
export function assertStandardDriftReport(report) {
  if (checkShadowJson(report) || validateJsonSchema(report, reportSchema, "$", { contractKind: "workflow-definition" }).length
    || Buffer.byteLength(JSON.stringify(report)) > 65536) fail("STANDARD_DRIFT_REPORT_INVALID");
  const changed = report.original_objective.replace(/\s+/gu, " ").trim() !== report.current_objective.replace(/\s+/gu, " ").trim();
  if (changed !== report.objective_changed || report.drift_level === "none" && (changed || report.changes.length || report.recommendation !== "continue")
    || report.drift_level !== "none" && (!report.changes.length || report.recommendation === "continue")
    || report.drift_level === "severe" && report.recommendation !== "human_arbitration"
    || changed && !report.split_recommendation.change_request_required
    || ["medium", "high"].includes(report.split_recommendation.impact) && !report.split_recommendation.new_cycle
    || report.drift_level === "none" && (report.split_recommendation.impact !== "none" || report.split_recommendation.new_cycle
      || report.split_recommendation.new_branch || report.split_recommendation.change_request_required)) fail("STANDARD_DRIFT_REPORT_INCONSISTENT");
  if (new Set(report.evidence_refs.map(row => row.ref)).size !== report.evidence_refs.length) fail("STANDARD_DRIFT_REPORT_EVIDENCE_INVALID");
  return report;
}
export function nativeActivityAnswerSchema(contractRef = null, contextSha256 = null) {
  if (contractRef !== null && !nativeActivityOutputSupported(contractRef)) fail("PROCESS_ACTIVITY_OUTPUT_CONTRACT_UNSUPPORTED");
  const schema = { type: "object", additionalProperties: false, required: ["outcome", "summary"], properties: {
    outcome: { type: "string", enum: ["completed", "failed", "rejected"] }, summary: { type: "string" } } };
  if (contractRef) {
    if (!/^[a-f0-9]{64}$/.test(contextSha256 ?? "")) fail("PROCESS_ACTIVITY_OUTPUT_CONTEXT_REQUIRED");
    const report = structuredClone(contractRef === CYCLE_WORK_CONTRACT ? workSchema : contractRef === CYCLE_PLAN_CONTRACT ? planSchema : reportSchema); delete report.$schema; delete report.$id; delete report["x-aidn-contract-version"];
    report.properties.context_sha256 = { const: contextSha256 };
    schema.required.push("report"); schema.properties.report = { anyOf: [{ type: "null" }, report] };
  }
  if (validateJsonSchemaDefinition(validationRoot(schema), "#", { contractKind: "workflow-definition" }).length) fail("PROCESS_ACTIVITY_OUTPUT_SCHEMA_INVALID");
  return schema;
}
export function assertNativeActivityAnswer(answer, contractRef = null, contextSha256 = null) {
  const schema = validationRoot(nativeActivityAnswerSchema(contractRef, contextSha256));
  if (checkShadowJson(answer) || validateJsonSchema(answer, schema, "$", { contractKind: "workflow-definition" }).length)
    fail("PROCESS_SESSION_ANSWER_INVALID");
  if (contractRef) {
    if (answer.outcome === "completed") (contractRef === CYCLE_WORK_CONTRACT ? assertStandardCycleWorkReport : contractRef === CYCLE_PLAN_CONTRACT ? assertStandardCyclePlan : assertStandardDriftReport)(answer.report);
    else if (answer.report !== null) fail("PROCESS_ACTIVITY_OUTPUT_NONCOMPLETION");
  }
  return answer;
}
