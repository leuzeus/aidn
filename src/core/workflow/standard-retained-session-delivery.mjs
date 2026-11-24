import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import entrySchema from '../contracts/workflow-definition/standard-retained-session-delivery-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-session-delivery-proof.v1.schema.json' with { type: 'json' };
const valid = (value, schema) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    throw Object.assign(Error('STANDARD_RETAINED_SESSION_DELIVERY_CONTRACT_INVALID'), { code: 'STANDARD_RETAINED_SESSION_DELIVERY_CONTRACT_INVALID' });
  return value;
};
export const assertRetainedSessionDeliveryEntry = value => valid(value, entrySchema);
export const assertRetainedSessionDeliveryProof = value => valid(value, proofSchema);
export const retainedSessionDeliveryContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, finalization_operation_id: proof.finalization_operation_id,
  metadata_basis: proof.metadata_basis, proof_sha256: H(assertRetainedSessionDeliveryProof(proof)) });
