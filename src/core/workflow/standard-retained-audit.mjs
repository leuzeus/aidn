import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import entrySchema from '../contracts/workflow-definition/standard-retained-audit-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-audit-proof.v1.schema.json' with { type: 'json' };

const fail = () => { throw Object.assign(Error('STANDARD_RETAINED_AUDIT_CONTRACT_INVALID'), { code: 'STANDARD_RETAINED_AUDIT_CONTRACT_INVALID' }); };
const valid = (value, schema) => { if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length) fail(); return value; };
export const assertRetainedAuditEntry = value => valid(value, entrySchema);
export function assertRetainedAuditProof(value) {
  valid(value, proofSchema);
  if (value.context.cycle_state !== 'VERIFYING' || value.context.mode !== 'COMMITTING' || value.context.product_sha256 !== value.product_sha256) fail();
  return value;
}
export const retainedAuditContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, failed_evaluation_operation_id: proof.failed_evaluation_operation_id,
  report_occurrence_id: proof.report_occurrence_id, proof_sha256: H(assertRetainedAuditProof(proof)) });
