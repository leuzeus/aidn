import questionSchema from "../contracts/workflow-definition/standard-baseline-promotion-question.v1.schema.json" with { type: "json" };
import decisionSchema from "../contracts/workflow-definition/human-baseline-promotion-decision.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { assertBaselinePromotionRequest } from "./standard-baseline-promotion.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const uniqueRefs = refs => new Set(refs.map(row => row.ref)).size === refs.length;
export const baselinePromotionChoices = Object.freeze(["promote", "not_requested", "refused", "deferred", "cancelled"]);

const reviewSchema = { $schema: questionSchema.$schema, $id: questionSchema.$id + "#review", ...questionSchema.properties.review };
export function assertBaselinePromotionReview(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, reviewSchema, "$", { contractKind: "workflow-definition" }).length
    || value.cycle_path.split("/")[1].split("-")[0] !== value.cycle_id || !uniqueRefs(value.evidence_refs)) fail("PROCESS_PROMOTION_QUESTION_INVALID");
  return value;
}
// Shape and correlation checks do not authenticate the human or the completed
// cycle-close. The host must independently verify both before using a decision.
export function assertBaselinePromotionQuestion(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, questionSchema, "$", { contractKind: "workflow-definition" }).length
    || Buffer.byteLength(JSON.stringify(value)) > 65536 || value.session_id !== value.review.session_id
    || value.review.cycle_path.split("/")[1].split("-")[0] !== value.review.cycle_id
    || !uniqueRefs(value.review.evidence_refs) || shadowHash(value.choices) !== shadowHash(baselinePromotionChoices)) fail("PROCESS_PROMOTION_QUESTION_INVALID");
  assertBaselinePromotionReview(value.review);
  return value;
}
export function assertHumanBaselinePromotionDecision(value, question) {
  if (checkShadowJson(value) || validateJsonSchema(value, decisionSchema, "$", { contractKind: "workflow-definition" }).length
    || !value.rationale.trim() || !uniqueRefs(value.evidence_refs) || value.promotion && !value.promotion.summary.trim()) fail("PROCESS_PROMOTION_SOURCE_INVALID");
  if (!question) return value;
  assertBaselinePromotionQuestion(question);
  if (value.question_sha256 !== shadowHash(question) || value.subject_sha256 !== shadowHash(question.review)) fail("PROCESS_HUMAN_QUESTION_CHANGED");
  if (!question.choices.includes(value.choice)) fail("PROCESS_HUMAN_CHOICE_NOT_OFFERED");
  return value;
}
export function observeHumanBaselinePromotionDecision({ question, decision }) {
  assertHumanBaselinePromotionDecision(decision, question);
  const accepted = ["promote", "not_requested"].includes(decision.choice);
  return { choice: decision.choice, outcome: accepted ? "completed" : decision.choice === "refused" ? "rejected" : decision.choice,
    effect_status: "no_effect", facts: accepted ? { baseline_promotion_decision_recorded: true,
      baseline_promotion_requested: decision.choice === "promote", baseline_promotion_not_requested: decision.choice === "not_requested" } : {},
    observations: { question_sha256: shadowHash(question), review_sha256: shadowHash(question.review), source_sha256: shadowHash(decision),
      promotion: structuredClone(decision.promotion) } };
}
// This is data construction, never a grant. The application must build it from
// its authenticated inbox and accepted closure; it cannot trust caller flags.
export function buildBaselinePromotionRequest(question, decision) {
  assertHumanBaselinePromotionDecision(decision, question);
  if (decision.choice !== "promote") fail("PROCESS_PROMOTION_NOT_REQUESTED");
  const refs = new Map();
  for (const row of [...question.review.evidence_refs, ...decision.evidence_refs]) {
    if (refs.has(row.ref) && refs.get(row.ref).sha256 !== row.sha256) fail("PROCESS_PROMOTION_EVIDENCE_CHANGED");
    refs.set(row.ref, structuredClone(row));
  }
  if (refs.size > 16) fail("PROCESS_PROMOTION_EVIDENCE_LIMIT");
  const review = question.review;
  return assertBaselinePromotionRequest({ contract_version: "standard-baseline-promotion-request.v1", decision_operation_id: question.operation_id,
    closure_operation_id: review.closure_operation_id, instance_id: question.instance_id, scope_id: question.scope_id,
    cycle_id: review.cycle_id, cycle_path: review.cycle_path, baseline_sha256: review.baseline_sha256, history_sha256: review.history_sha256,
    product_sha256: review.product_sha256, ...structuredClone(decision.promotion), evidence_refs: [...refs.values()] });
}
