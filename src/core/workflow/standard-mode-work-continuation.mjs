import reviewSchema from "../contracts/workflow-definition/standard-mode-work-review.v1.schema.json" with { type: "json" };
import questionSchema from "../contracts/workflow-definition/standard-mode-work-question.v1.schema.json" with { type: "json" };
import sourceSchema from "../contracts/workflow-definition/human-mode-work-decision.v1.schema.json" with { type: "json" };
import observationSchema from "../contracts/workflow-definition/standard-mode-work-observation-output.v1.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-mode-work-decision-output.v1.schema.json" with { type: "json" };
import { evaluateStandardModeWork, assertStandardModeWorkReport } from "./standard-mode-work.mjs";
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
export const modeWorkContinuationChoices = Object.freeze(["continue_analysis", "refused", "deferred", "cancelled"]);
export function assertModeWorkReview(value) {
  if (!valid(value, reviewSchema) || Buffer.byteLength(JSON.stringify(value)) > 98304) fail("STANDARD_MODE_WORK_REVIEW_INVALID");
  assertStandardModeWorkReport(value.report);
  if (value.report_sha256 !== shadowHash(value.report) || value.report.context_sha256 !== value.context_sha256
    || value.report.mode !== value.mode) fail("STANDARD_MODE_WORK_REVIEW_INVALID");
  return value;
}
// Completion here acknowledges a received report, never the analysis outcome.
// The original blocked evaluation remains verbatim in the observation.
export function observeModeWorkReport(authenticated, current) {
  const evaluation = evaluateStandardModeWork(authenticated, current);
  const review = assertModeWorkReview({ contract_version: "standard-mode-work-review.v1", session_id: current.context.session_id,
    mode: current.context.mode, context_sha256: current.context_sha256, product_sha256: current.context.product_sha256,
    head: current.context.git.head, branch: current.context.git.branch, report: authenticated.report,
    report_sha256: shadowHash(authenticated.report), producer: authenticated.producer, reference: authenticated.reference });
  return assertModeWorkObservationOutput({ contract_version: "standard-mode-work-observation-output.v1", operation_ref: "mode_work_observe",
    outcome: "completed", effect_status: "no_effect", facts: { mode_work_report_complete: evaluation.outcome === "completed", mode_analysis_completed: false },
    observations: { review, evaluation }, evidence_refs: [authenticated.reference] });
}
export function assertModeWorkObservationOutput(value) {
  if (!valid(value, observationSchema)) fail("STANDARD_MODE_WORK_OBSERVATION_INVALID");
  assertModeWorkReview(value.observations.review);
  const complete = ["thinking_complete", "nonretained"].includes(value.observations.review.report.disposition);
  if (shadowHash(value.facts) !== shadowHash({ mode_work_report_complete: complete, mode_analysis_completed: false })
    || value.observations.evaluation.outcome !== (complete ? "completed" : "blocked")
    || shadowHash(value.observations.evaluation.observations?.report ?? null) !== value.observations.review.report_sha256
    || shadowHash(value.observations.evaluation.facts) !== shadowHash(complete ? { mode_analysis_completed: true, exploration_nonretained: value.observations.review.report.disposition === "nonretained" } : {})
    || value.observations.evaluation.observations.product_effects_authorized !== false
    || value.observations.evaluation.observations.retention_authorized !== false
    || value.observations.evaluation.observations.session_closure_completed !== false) fail("STANDARD_MODE_WORK_OBSERVATION_INVALID");
  return value;
}
export function assertModeWorkQuestion(value) {
  if (!valid(value, questionSchema) || Buffer.byteLength(JSON.stringify(value)) > 114688) fail("STANDARD_MODE_WORK_QUESTION_INVALID");
  assertModeWorkReview(value.review);
  if (value.session_id !== value.review.session_id || !["waiting", "retain_requested"].includes(value.review.report.disposition)
    || shadowHash(value.choices) !== shadowHash(modeWorkContinuationChoices)) fail("STANDARD_MODE_WORK_QUESTION_INVALID");
  return value;
}
export function assertHumanModeWorkDecision(value, question) {
  if (!valid(value, sourceSchema) || !value.rationale.trim()
    || new Set(value.evidence_refs.map(row => row.ref)).size !== value.evidence_refs.length) fail("STANDARD_MODE_WORK_DECISION_INVALID");
  if (question) {
    assertModeWorkQuestion(question);
    if (value.question_sha256 !== shadowHash(question) || value.subject_sha256 !== shadowHash(question.review)) fail("PROCESS_HUMAN_QUESTION_CHANGED");
    if (!question.choices.includes(value.choice)) fail("PROCESS_HUMAN_CHOICE_NOT_OFFERED");
  }
  return value;
}
export function observeHumanModeWorkDecision({ question, decision }) {
  assertHumanModeWorkDecision(decision, question);
  const accepted = decision.choice === "continue_analysis";
  return { outcome: accepted ? "completed" : decision.choice === "refused" ? "rejected" : decision.choice, effect_status: "no_effect",
    facts: accepted ? { mode_work_continue_requested: true, mode_analysis_completed: false } : {},
    observations: { question_sha256: shadowHash(question), review_sha256: shadowHash(question.review), source_sha256: shadowHash(decision),
      choice: decision.choice, product_effects_authorized: false, retention_authorized: false, native_authority_renewed: false } };
}
export function assertModeWorkDecisionOutput(value) {
  if (!valid(value, outputSchema)) fail("STANDARD_MODE_WORK_DECISION_OUTPUT_INVALID");
  const accepted = value.observations.choice === "continue_analysis";
  if (value.outcome !== (accepted ? "completed" : value.observations.choice === "refused" ? "rejected" : value.observations.choice)
    || shadowHash(value.facts) !== shadowHash(accepted ? { mode_work_continue_requested: true, mode_analysis_completed: false } : {})
    || value.observations.product_effects_authorized !== false || value.observations.retention_authorized !== false
    || value.observations.native_authority_renewed !== false) fail("STANDARD_MODE_WORK_DECISION_OUTPUT_INVALID");
  return value;
}
