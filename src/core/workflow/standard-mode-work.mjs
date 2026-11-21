import schema from "../contracts/workflow-definition/standard-mode-work-report.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";

export const MODE_WORK_CONTRACT = "standard-mode-work-report.v1";
const fail = code => { throw Object.assign(new Error(code), { code }); };
export function assertStandardModeWorkReport(report) {
  if (checkShadowJson(report) || validateJsonSchema(report, schema, "$", { contractKind: "workflow-definition" }).length
    || Buffer.byteLength(JSON.stringify(report)) > 65536) fail("STANDARD_MODE_WORK_REPORT_INVALID");
  if (report.mode === "THINKING" && !["thinking_complete", "waiting"].includes(report.disposition)
    || report.mode === "EXPLORING" && report.disposition === "thinking_complete") fail("STANDARD_MODE_WORK_DISPOSITION_INVALID");
  if (new Set(report.evidence_refs.map(row => row.ref)).size !== report.evidence_refs.length) fail("STANDARD_MODE_WORK_EVIDENCE_INVALID");
  return report;
}
export function evaluateStandardModeWork(authenticated, current) {
  const report = assertStandardModeWorkReport(authenticated.report);
  if (report.context_sha256 !== current.context_sha256 || report.mode !== current.context.mode
    || report.objective !== current.context.objective) fail("STANDARD_MODE_WORK_CONTEXT_CHANGED");
  if (report.evidence_refs.some(ref => !current.evidence_refs.some(row => row.ref === ref.ref && row.sha256 === ref.sha256))) fail("STANDARD_MODE_WORK_EVIDENCE_INVALID");
  const complete = ["thinking_complete", "nonretained"].includes(report.disposition);
  return { contract_version: "standard-mode-work-output.v1", operation_ref: "mode_work_evaluate", outcome: complete ? "completed" : "blocked",
    effect_status: "no_effect", facts: complete ? { mode_analysis_completed: true, exploration_nonretained: report.disposition === "nonretained" } : {},
    observations: { report, report_sha256: shadowHash(report), producer: authenticated.producer, preflight_operation_id: current.context.preflight_operation_id,
      reason_code: complete ? "STANDARD_MODE_ANALYSIS_COMPLETE" : report.disposition === "retain_requested" ? "STANDARD_SPIKE_ADMISSION_REQUIRED" : "STANDARD_MODE_ANALYSIS_WAITING",
      product_effects_authorized: false, retention_authorized: false, session_closure_completed: false }, evidence_refs: [authenticated.reference] };
}
