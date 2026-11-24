import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import entrySchema from '../contracts/workflow-definition/standard-retained-closure-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-closure-proof.v1.schema.json' with { type: 'json' };

const validate = (value, schema) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    throw Object.assign(Error('STANDARD_RETAINED_CLOSURE_CONTRACT_INVALID'), { code: 'STANDARD_RETAINED_CLOSURE_CONTRACT_INVALID' });
  return value;
};
export const assertRetainedClosureEntry = value => validate(value, entrySchema);
export function assertRetainedClosureProof(value) {
  validate(value, proofSchema);
  if (value.context.mode !== 'COMMITTING' || value.context.cycle_state !== 'VERIFYING' || value.product_sha256 !== value.context.product_sha256)
    throw Object.assign(Error('STANDARD_RETAINED_CLOSURE_CONTEXT_INVALID'), { code: 'STANDARD_RETAINED_CLOSURE_CONTEXT_INVALID' });
  return value;
}
export const retainedClosureContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, decision_operation_id: proof.decision_operation_id,
  proof_sha256: H(assertRetainedClosureProof(proof)) });
