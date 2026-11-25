import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import entrySchema from '../contracts/workflow-definition/standard-retained-session-closure-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-session-closure-proof.v1.schema.json' with { type: 'json' };
const valid = (value, schema) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    throw Object.assign(Error('STANDARD_RETAINED_SESSION_CLOSURE_CONTRACT_INVALID'), { code: 'STANDARD_RETAINED_SESSION_CLOSURE_CONTRACT_INVALID' });
  return value;
};
export const assertRetainedSessionClosureEntry = value => valid(value, entrySchema);
export const assertRetainedSessionClosureProof = value => valid(value, proofSchema);
export const retainedSessionClosureContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, decision_operation_id: proof.decision_operation_id,
  proof_sha256: H(assertRetainedSessionClosureProof(proof)) });
