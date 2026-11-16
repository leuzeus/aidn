import reviewSchema from "../contracts/workflow-definition/standard-mode-work-review.v1.schema.json" with { type: "json" };
import questionSchema from "../contracts/workflow-definition/standard-mode-work-question.v1.schema.json" with { type: "json" };
import sourceSchema from "../contracts/workflow-definition/human-mode-work-decision.v1.schema.json" with { type: "json" };
import observationSchema from "../contracts/workflow-definition/standard-mode-work-observation-output.v1.schema.json" with { type: "json" };
import observationSchemaV2 from "../contracts/workflow-definition/standard-mode-work-observation-output.v2.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-mode-work-decision-output.v1.schema.json" with { type: "json" };
import questionSchemaV2 from "../contracts/workflow-definition/standard-mode-work-question.v2.schema.json" with { type: "json" };
import sourceSchemaV2 from "../contracts/workflow-definition/human-mode-work-decision.v2.schema.json" with { type: "json" };
import outputSchemaV2 from "../contracts/workflow-definition/standard-mode-work-decision-output.v2.schema.json" with { type: "json" };
import { assertHandoffPublicationInput } from "./standard-handoff-publication.mjs";
import { evaluateStandardModeWork, assertStandardModeWorkReport } from "./standard-mode-work.mjs";
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
export const modeWorkContinuationChoices = Object.freeze(["continue_analysis", "refused", "deferred", "cancelled"]);
export const modeWorkHandoffChoices = Object.freeze(["continue_analysis", "handoff", "refused", "deferred", "cancelled"]);
export const modeWorkDecisionSubject = question => question.contract_version === "standard-mode-work-question.v2"
  ? { review: question.review, current_context: question.current_context } : question.review;
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
  return assertModeWorkObservationOutput({ contract_version: "standard-mode-work-observation-output.v2", operation_ref: "mode_work_observe",
    outcome: "completed", effect_status: "no_effect", facts: { mode_work_report_complete: evaluation.outcome === "completed", mode_analysis_completed: false, mode_analysis_loop_complete: evaluation.outcome === "completed" },
    observations: { review, evaluation }, evidence_refs: [authenticated.reference] });
}
export function assertModeWorkObservationOutput(value) {
  const current = value?.contract_version === "standard-mode-work-observation-output.v2";
  if (!valid(value, current ? observationSchemaV2 : observationSchema)) fail("STANDARD_MODE_WORK_OBSERVATION_INVALID");
  if (current && value.outcome === "blocked") return value;
  assertModeWorkReview(value.observations.review);
  const complete = ["thinking_complete", "nonretained"].includes(value.observations.review.report.disposition);
  if (shadowHash(value.facts) !== shadowHash({ mode_work_report_complete: complete, mode_analysis_completed: false, ...(current ? { mode_analysis_loop_complete: complete } : {}) })
    || value.observations.evaluation.outcome !== (complete ? "completed" : "blocked")
    || shadowHash(value.observations.evaluation.observations?.report ?? null) !== value.observations.review.report_sha256
    || shadowHash(value.observations.evaluation.facts) !== shadowHash(complete ? { mode_analysis_completed: true, exploration_nonretained: value.observations.review.report.disposition === "nonretained" } : {})
    || value.observations.evaluation.observations.product_effects_authorized !== false
    || value.observations.evaluation.observations.retention_authorized !== false
    || value.observations.evaluation.observations.session_closure_completed !== false) fail("STANDARD_MODE_WORK_OBSERVATION_INVALID");
  return value;
}
export function assertModeWorkQuestion(value) {
  const current = value?.contract_version === "standard-mode-work-question.v2";
  if (!valid(value, current ? questionSchemaV2 : questionSchema) || Buffer.byteLength(JSON.stringify(value)) > 114688) fail("STANDARD_MODE_WORK_QUESTION_INVALID");
  assertModeWorkReview(value.review);
  if (value.session_id !== value.review.session_id || !["waiting", "retain_requested"].includes(value.review.report.disposition)
    || shadowHash(value.choices) !== shadowHash(current ? modeWorkHandoffChoices : modeWorkContinuationChoices)
    || current && (value.current_context.session_id !== value.session_id || value.current_context.mode !== value.review.mode)) fail("STANDARD_MODE_WORK_QUESTION_INVALID");
  return value;
}
export function assertHumanModeWorkDecision(value, question) {
  const current = value?.contract_version === "human-mode-work-decision.v2";
  if (!valid(value, current ? sourceSchemaV2 : sourceSchema) || !value.rationale.trim()
    || new Set(value.evidence_refs.map(row => row.ref)).size !== value.evidence_refs.length) fail("STANDARD_MODE_WORK_DECISION_INVALID");
  if (current) {
    if ((value.choice === "handoff") !== (value.handoff !== null)) fail("STANDARD_MODE_WORK_DECISION_INVALID");
    if (value.handoff) assertHandoffPublicationInput(value.handoff);
  }
  if (question) {
    assertModeWorkQuestion(question);
    if (current !== (question.contract_version === "standard-mode-work-question.v2")
      || value.question_sha256 !== shadowHash(question) || value.subject_sha256 !== shadowHash(modeWorkDecisionSubject(question))) fail("PROCESS_HUMAN_QUESTION_CHANGED");
    if (!question.choices.includes(value.choice)) fail("PROCESS_HUMAN_CHOICE_NOT_OFFERED");
  }
  return value;
}
export function observeHumanModeWorkDecision({ question, decision }) {
  assertHumanModeWorkDecision(decision, question);
  const accepted = decision.choice === "continue_analysis";
  const current = question.contract_version === "standard-mode-work-question.v2", handoff = current && decision.choice === "handoff";
  return { outcome: accepted || handoff ? "completed" : decision.choice === "refused" ? "rejected" : decision.choice, effect_status: "no_effect",
    facts: accepted || handoff ? { mode_work_continue_requested: accepted, mode_analysis_completed: false,
      ...(current ? { mode_work_handoff_requested: handoff } : {}) } : {},
    observations: { question_sha256: shadowHash(question), review_sha256: shadowHash(question.review), source_sha256: shadowHash(decision),
      choice: decision.choice, ...(current ? { current_context_sha256: shadowHash(question.current_context), handoff: structuredClone(decision.handoff) } : {}),
      product_effects_authorized: false, retention_authorized: false, native_authority_renewed: false } };
}
export function assertModeWorkDecisionOutput(value) {
  const current = value?.contract_version === "standard-mode-work-decision-output.v2";
  if (!valid(value, current ? outputSchemaV2 : outputSchema)) fail("STANDARD_MODE_WORK_DECISION_OUTPUT_INVALID");
  const accepted = value.observations.choice === "continue_analysis", handoff = current && value.observations.choice === "handoff";
  if (current && handoff !== (value.observations.handoff !== null)) fail("STANDARD_MODE_WORK_DECISION_OUTPUT_INVALID");
  if (handoff) assertHandoffPublicationInput(value.observations.handoff);
  if (value.outcome !== (accepted || handoff ? "completed" : value.observations.choice === "refused" ? "rejected" : value.observations.choice)
    || shadowHash(value.facts) !== shadowHash(accepted || handoff ? { mode_work_continue_requested: accepted, mode_analysis_completed: false,
      ...(current ? { mode_work_handoff_requested: handoff } : {}) } : {})
    || value.observations.product_effects_authorized !== false || value.observations.retention_authorized !== false
    || value.observations.native_authority_renewed !== false) fail("STANDARD_MODE_WORK_DECISION_OUTPUT_INVALID");
  return value;
}
