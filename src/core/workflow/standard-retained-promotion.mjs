import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import entrySchema from '../contracts/workflow-definition/standard-retained-promotion-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-promotion-proof.v1.schema.json' with { type: 'json' };
const validate = (value, schema) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    throw Object.assign(Error('STANDARD_RETAINED_PROMOTION_CONTRACT_INVALID'), { code: 'STANDARD_RETAINED_PROMOTION_CONTRACT_INVALID' });
  return value;
};
export const assertRetainedPromotionEntry = value => validate(value, entrySchema);
export function assertRetainedPromotionProof(value) {
  validate(value, proofSchema);
  if (!value.cycle_path.startsWith('cycles/' + value.cycle_id + '-'))
    throw Object.assign(Error('STANDARD_RETAINED_PROMOTION_CONTRACT_INVALID'), { code: 'STANDARD_RETAINED_PROMOTION_CONTRACT_INVALID' });
  return value;
}
export const retainedPromotionContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, record_operation_id: proof.record_operation_id,
  failed_finalization_operation_id: proof.failed_finalization_operation_id, proof_sha256: H(assertRetainedPromotionProof(proof)) });
