import inputSchema from '../../core/contracts/workflow-definition/standard-pr-correction-review-input.v1.schema.json' with { type: 'json' };
import planSchema from '../../core/contracts/workflow-definition/standard-pr-correction-review-plan.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertPrCorrectionReview, prCorrectionChoices } from '../../core/workflow/standard-pr-correction-decision.mjs';
import inputV2 from '../../core/contracts/workflow-definition/standard-pr-correction-review-input.v2.schema.json' with { type: 'json' };
import planV2 from '../../core/contracts/workflow-definition/standard-pr-correction-review-plan.v2.schema.json' with { type: 'json' };
const planSchemaFor = plan => plan?.contract_version === 'standard-pr-correction-review-plan.v2' ? planV2 : planSchema;
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;

// The host authenticates the accepted checkpoint, finite postimages, unchanged
// product/provider and exact current Git boundary. V2 also presents the proposed
// cycle in the authenticated question; a proposal itself grants no effect.
export function createStandardPrCorrectionReview({ readCheckpoint }) {
  if (typeof readCheckpoint !== 'function') fail('STANDARD_PR_CORRECTION_REVIEW_AUTHORITY_REQUIRED');
  async function prepare(instance, input, operationId, { signal } = {}) {
    if (!valid(input, input?.contract_version === 'standard-pr-correction-review-input.v2' ? inputV2 : inputSchema) || !/^op_[a-f0-9]{40}$/.test(operationId ?? '')) fail('STANDARD_PR_CORRECTION_REVIEW_INPUT_INVALID');
    if (signal?.aborted) fail('STANDARD_PR_CORRECTION_ABORTED');
    const review = assertPrCorrectionReview(await readCheckpoint(instance, input, { signal }));
    if (signal?.aborted) fail('STANDARD_PR_CORRECTION_ABORTED');
    if (review.checkpoint_operation_id !== input.checkpoint_operation_id) fail('STANDARD_PR_CORRECTION_REVIEW_SOURCE_CHANGED');
    const v2 = input.contract_version === 'standard-pr-correction-review-input.v2';
    const plan = { ...(v2 ? { candidate_cycle: structuredClone(input.candidate_cycle) } : {}), contract_version: v2 ? 'standard-pr-correction-review-plan.v2' : 'standard-pr-correction-review-plan.v1', review_operation_id: operationId,
      checkpoint_operation_id: input.checkpoint_operation_id, review, choices: [...prCorrectionChoices] };
    if (!valid(plan, planSchemaFor(plan))) fail('STANDARD_PR_CORRECTION_REVIEW_PLAN_INVALID');
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({ prepare, async assertFresh(instance, plan, options) {
    if (!valid(plan, planSchemaFor(plan))) fail('STANDARD_PR_CORRECTION_REVIEW_PLAN_INVALID');
    const fresh = await prepare(instance, { ...(plan.contract_version === 'standard-pr-correction-review-plan.v2' ? { candidate_cycle: plan.candidate_cycle } : {}),
      contract_version: plan.contract_version === 'standard-pr-correction-review-plan.v2' ? 'standard-pr-correction-review-input.v2' : 'standard-pr-correction-review-input.v1',
      checkpoint_operation_id: plan.checkpoint_operation_id }, plan.review_operation_id, options);
    if (fresh.plan_sha256 !== shadowHash(plan)) fail('STANDARD_PR_CORRECTION_REVIEW_STALE');
  } });
}
