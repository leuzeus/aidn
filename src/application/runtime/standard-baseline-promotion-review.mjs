import inputSchema from "../../core/contracts/workflow-definition/standard-baseline-promotion-review-input.v1.schema.json" with { type: "json" };
import planSchema from "../../core/contracts/workflow-definition/standard-baseline-promotion-review-plan.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { assertBaselinePromotionReview, baselinePromotionChoices } from "../../core/workflow/standard-baseline-promotion-decision.mjs";
import { checkShadowJson, shadowHash } from "../../core/workflow/shadow-json.mjs";
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
// The fixed host reader authenticates accepted application receipts and physical
// evidence. An authored successful closure is not a replacement for that reader.
export function createStandardBaselinePromotionReview({ readClosure, promotion, now = Date.now }) {
  if (typeof readClosure !== "function" || typeof promotion?.observeContext !== "function") fail("STANDARD_PROMOTION_REVIEW_AUTHORITY_REQUIRED");
  async function observe(instance, input) {
    if (!valid(input, inputSchema)) fail("STANDARD_PROMOTION_REVIEW_INPUT_INVALID");
    const closure = await readClosure(instance, input), output = closure?.output;
    if (closure?.operation_id !== input.closure_operation_id || closure.instance_id !== instance.instance_id || closure.scope_id !== instance.scope_id
      || output?.operation_ref !== "cycle_close_finalize" || output.outcome !== "completed" || output.effect_status !== "confirmed"
      || output.facts?.cycle_close_completed !== true || output.facts.cycle_retained !== true || output.observations?.target_state !== "DONE") fail("STANDARD_PROMOTION_COMPLETED_CLOSURE_REQUIRED");
    const observed = await promotion.observeContext(closure);
    if (observed.blocked) return { can_apply: false, reason_code: observed.blocked };
    if (observed.context.mode !== "COMMITTING" || observed.context.cycle_state !== "DONE" || observed.context.active_session !== closure.session_id) fail("STANDARD_PROMOTION_REVIEW_CONTEXT_CHANGED");
    const baseline = observed.documents.find(row => row.path === "baseline/current.md"), history = observed.documents.find(row => row.path === "baseline/history.md");
    const review = { session_id: closure.session_id, cycle_id: closure.cycle_id, cycle_path: closure.cycle_path, closure_operation_id: closure.operation_id,
      closure_output_sha256: shadowHash(output), context_sha256: observed.context_sha256, product_sha256: closure.product_sha256,
      baseline_sha256: baseline.sha256, history_sha256: history.sha256, current_version: analyzeStructuredArtifact(baseline.content).key_values.baseline,
      evidence_refs: [{ ref: "aidn:operation-output/" + closure.operation_id + "/0", sha256: shadowHash(output) }] };
    return { can_apply: true, review };
  }
  return Object.freeze({
    async prepare(instance, input) {
      const observed = await observe(instance, input); if (!observed.can_apply) return observed;
      const plan = { contract_version: "standard-baseline-promotion-review-plan.v1", operation_ref: "baseline_promotion_decision", input,
        prepared_at_ms: now(), review: observed.review, choices: [...baselinePromotionChoices] };
      if (!valid(plan, planSchema)) fail("STANDARD_PROMOTION_REVIEW_PLAN_INVALID");
      assertBaselinePromotionReview(plan.review);
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    },
    async assertFresh(instance, plan) {
      if (!valid(plan, planSchema)) fail("STANDARD_PROMOTION_REVIEW_PLAN_INVALID");
      const current = await observe(instance, plan.input);
      if (!current.can_apply || shadowHash(current.review) !== shadowHash(plan.review)) fail("STANDARD_PROMOTION_REVIEW_CHANGED");
      return current;
    },
  });
}
