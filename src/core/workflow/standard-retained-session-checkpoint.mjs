import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import entrySchema from '../contracts/workflow-definition/standard-retained-session-checkpoint-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-session-checkpoint-proof.v1.schema.json' with { type: 'json' };
const valid = (value, schema) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    throw Object.assign(Error('STANDARD_RETAINED_SESSION_CHECKPOINT_CONTRACT_INVALID'), { code: 'STANDARD_RETAINED_SESSION_CHECKPOINT_CONTRACT_INVALID' });
  return value;
};
export const assertRetainedSessionCheckpointEntry = value => valid(value, entrySchema);
export const assertRetainedSessionCheckpointProof = value => valid(value, proofSchema);
export const retainedSessionCheckpointContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, recovery_operation_id: proof.recovery_operation_id, record_operation_id: proof.record_operation_id, checkpoint_operation_id: proof.checkpoint_operation_id,
  proof_sha256: H(assertRetainedSessionCheckpointProof(proof)) });
