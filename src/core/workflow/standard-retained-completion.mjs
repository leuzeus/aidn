import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import entrySchema from '../contracts/workflow-definition/standard-retained-completion-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-completion-proof.v1.schema.json' with { type: 'json' };
const validate = (value, schema) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    throw Object.assign(Error('STANDARD_RETAINED_COMPLETION_CONTRACT_INVALID'), { code: 'STANDARD_RETAINED_COMPLETION_CONTRACT_INVALID' });
  return value;
};
export const assertRetainedCompletionEntry = value => validate(value, entrySchema);
export function assertRetainedCompletionProof(value) {
  validate(value, proofSchema);
  if (!value.cycle_path.startsWith('cycles/' + value.cycle_id + '-'))
    throw Object.assign(Error('STANDARD_RETAINED_COMPLETION_CONTRACT_INVALID'), { code: 'STANDARD_RETAINED_COMPLETION_CONTRACT_INVALID' });
  return value;
}
export const retainedCompletionContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, closure_operation_id: proof.closure_operation_id,
  proof_sha256: H(assertRetainedCompletionProof(proof)) });
