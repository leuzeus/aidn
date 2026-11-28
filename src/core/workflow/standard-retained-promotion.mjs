import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import entrySchema from '../contracts/workflow-definition/standard-retained-promotion-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-promotion-proof.v1.schema.json' with { type: 'json' };
import entrySchemaV2 from '../contracts/workflow-definition/standard-retained-promotion-entry.v2.schema.json' with { type: 'json' };
import proofSchemaV2 from '../contracts/workflow-definition/standard-retained-promotion-proof.v2.schema.json' with { type: 'json' };
const validate = (value, schema) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    throw Object.assign(Error('STANDARD_RETAINED_PROMOTION_CONTRACT_INVALID'), { code: 'STANDARD_RETAINED_PROMOTION_CONTRACT_INVALID' });
  return value;
};
export const assertRetainedPromotionEntry = value => validate(value, value?.version === 2 ? entrySchemaV2 : entrySchema);
export function assertRetainedPromotionProof(value) {
  validate(value, value?.version === 2 ? proofSchemaV2 : proofSchema);
  if (!value.cycle_path.startsWith('cycles/' + value.cycle_id + '-'))
    throw Object.assign(Error('STANDARD_RETAINED_PROMOTION_CONTRACT_INVALID'), { code: 'STANDARD_RETAINED_PROMOTION_CONTRACT_INVALID' });
  return value;
}
export const retainedPromotionContinuation = proof => proof?.version === 2 ? ({ version: 2, source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, record_operation_id: proof.record_operation_id,
  checkpoint_operation_id: proof.checkpoint_operation_id, native_dispatch_id: proof.native_dispatch_id,
  proof_sha256: H(assertRetainedPromotionProof(proof)) }) : ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, record_operation_id: proof.record_operation_id,
  failed_finalization_operation_id: proof.failed_finalization_operation_id, proof_sha256: H(assertRetainedPromotionProof(proof)) });
