import reviewSchema from "../contracts/workflow-definition/standard-spike-review.v1.schema.json" with { type: "json" };
import questionSchema from "../contracts/workflow-definition/standard-spike-question.v1.schema.json" with { type: "json" };
import sourceSchema from "../contracts/workflow-definition/human-spike-decision.v1.schema.json" with { type: "json" };
import selectionSchema from "../contracts/workflow-definition/standard-spike-selection.v1.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-spike-decision-output.v1.schema.json" with { type: "json" };
import questionSchemaV2 from "../contracts/workflow-definition/standard-spike-question.v2.schema.json" with { type: "json" };
import sourceSchemaV2 from "../contracts/workflow-definition/human-spike-decision.v2.schema.json" with { type: "json" };
import outputSchemaV2 from "../contracts/workflow-definition/standard-spike-decision-output.v2.schema.json" with { type: "json" };
import { assertModeWorkReview } from "./standard-mode-work-continuation.mjs";
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
export const spikeConversionChoices = Object.freeze(["convert-to-spike", "refused", "deferred", "cancelled"]);
export const spikeConversionChoicesV2 = Object.freeze(["convert-to-spike", "continue_analysis", "refused", "deferred", "cancelled"]);
export function assertSpikeSelection(value) {
  if (!valid(value, selectionSchema) || Object.values(value).some(text => text !== text.replace(/\s+/gu, " ").trim())
    || value.chosen_mode === "COMMITTING" && value.branch_action !== "create") fail("STANDARD_SPIKE_SELECTION_INVALID");
  return value;
}
export function assertSpikeReview(value) {
  if (!valid(value, reviewSchema)) fail("STANDARD_SPIKE_REVIEW_INVALID");
  assertModeWorkReview(value.analysis);
  if (value.analysis.mode !== "EXPLORING" || value.analysis.report.disposition !== "retain_requested") fail("STANDARD_SPIKE_RETENTION_REQUEST_REQUIRED");
  return value;
}
export function assertSpikeQuestion(value) {
  const current = value?.contract_version === "standard-spike-question.v2";
  if (!valid(value, current ? questionSchemaV2 : questionSchema) || Buffer.byteLength(JSON.stringify(value)) > 131072) fail("STANDARD_SPIKE_QUESTION_INVALID");
  assertSpikeReview(value.review);
  if (value.session_id !== value.review.analysis.session_id || shadowHash(value.choices) !== shadowHash(current ? spikeConversionChoicesV2 : spikeConversionChoices)) fail("STANDARD_SPIKE_QUESTION_INVALID");
  return value;
}
export function assertHumanSpikeDecision(value, question) {
  if (!valid(value, value?.contract_version === "human-spike-decision.v2" ? sourceSchemaV2 : sourceSchema) || !value.rationale.trim()
    || new Set(value.evidence_refs.map(row => row.ref)).size !== value.evidence_refs.length) fail("STANDARD_SPIKE_DECISION_INVALID");
  if (value.choice === "convert-to-spike") assertSpikeSelection(value.selection);
  else if (value.selection !== null) fail("STANDARD_SPIKE_DECISION_INVALID");
  if (question) {
    assertSpikeQuestion(question);
    if (value.question_sha256 !== shadowHash(question) || value.subject_sha256 !== shadowHash(question.review)) fail("PROCESS_HUMAN_QUESTION_CHANGED");
    if (!question.choices.includes(value.choice)) fail("PROCESS_HUMAN_CHOICE_NOT_OFFERED");
    if (value.selection && Number(value.selection.cycle_id.slice(1)) < question.review.minimum_cycle_number) fail("STANDARD_SPIKE_CYCLE_ALREADY_EXISTS");
  }
  return value;
}
export function observeHumanSpikeDecision({ question, decision }) {
  assertHumanSpikeDecision(decision, question);
  const accepted = decision.choice === "convert-to-spike", continuing = decision.choice === "continue_analysis";
  const current = question.contract_version === "standard-spike-question.v2";
  return { outcome: accepted || continuing ? "completed" : decision.choice === "refused" ? "rejected" : decision.choice, effect_status: "no_effect",
    facts: accepted ? { spike_conversion_requested: true, ...(current ? { mode_analysis_loop_complete: true, mode_analysis_completed: false } : {}) }
      : continuing ? { spike_conversion_requested: false, mode_analysis_loop_complete: false, mode_work_continue_requested: true, mode_analysis_completed: false } : {}, observations: {
      question_sha256: shadowHash(question), review_sha256: shadowHash(question.review), source_sha256: shadowHash(decision),
      choice: decision.choice, selection: structuredClone(decision.selection),
      product_effects_authorized: false, retention_authorized: false, native_authority_renewed: false } };
}
export function assertSpikeDecisionOutput(value) {
  const current = value?.contract_version === "standard-spike-decision-output.v2";
  if (!valid(value, current ? outputSchemaV2 : outputSchema)) fail("STANDARD_SPIKE_DECISION_OUTPUT_INVALID");
  const accepted = value.observations.choice === "convert-to-spike", continuing = value.observations.choice === "continue_analysis";
  const expectedFacts = accepted ? { spike_conversion_requested: true, ...(current ? { mode_analysis_loop_complete: true, mode_analysis_completed: false } : {}) }
    : continuing ? { spike_conversion_requested: false, mode_analysis_loop_complete: false, mode_work_continue_requested: true, mode_analysis_completed: false } : {};
  if (value.outcome !== (accepted || continuing ? "completed" : value.observations.choice === "refused" ? "rejected" : value.observations.choice)
    || shadowHash(value.facts) !== shadowHash(expectedFacts)
    || !accepted && value.observations.selection !== null) fail("STANDARD_SPIKE_DECISION_OUTPUT_INVALID");
  if (accepted) assertSpikeSelection(value.observations.selection);
  return value;
}
