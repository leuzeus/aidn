import entrySchema from '../contracts/workflow-definition/standard-retained-session-pr-open-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-session-pr-open-proof.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
const valid = (value, schema) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    throw Object.assign(Error('STANDARD_RETAINED_SESSION_PR_OPEN_CONTRACT_INVALID'), { code: 'STANDARD_RETAINED_SESSION_PR_OPEN_CONTRACT_INVALID' });
  return value;
};
export const assertRetainedSessionPrOpenEntry = value => valid(value, entrySchema);
export const assertRetainedSessionPrOpenProof = value => valid(value, proofSchema);
export const retainedSessionPrOpenContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, open_operation_id: proof.open_operation_id,
  proof_sha256: H(assertRetainedSessionPrOpenProof(proof)) });

// The fixed source authenticates signatures, lineage, permission and current
// physical postimages. This pure prefix check alone never grants continuation.
export function assertRetainedSessionPrOpenBoundary({ instance, records, entry }) {
  const require = ok => { if (!ok) throw Object.assign(Error('STANDARD_RETAINED_SESSION_PR_OPEN_BOUNDARY_CHANGED'), { code: 'STANDARD_RETAINED_SESSION_PR_OPEN_BOUNDARY_CHANGED' }); };
  const names = ['workflow_entry_select', 'session_branch_integrate', 'session_pr_admit', 'session_push', 'session_pr_open'];
  const intents = instance.events.filter(row => row.kind === 'operation_intent');
  require(instance.initial_parameters?.entry_point?.kind === 'retained_session_integration'
    && intents.length === records.length && H(records.map(row => row.intent.binding_ref)) === H(names) && records.at(-1).operation_id === entry.open_operation_id);
  for (const [index, record] of records.entries()) {
    const result = record.results[0];
    require(H(record.intent) === H(intents[index].intent) && record.intent.instance_id === instance.instance_id
      && record.intent.scope_id === instance.scope_id && record.intent.model_sha256 === instance.model_sha256
      && record.phase === 'receipted' && record.results.length === 1 && result.receipt.outcome === 'completed'
      && result.output.outcome === 'completed' && result.receipt.effect_status === result.output.effect_status
      && result.output.effect_status === ([0, 2].includes(index) ? 'no_effect' : 'confirmed')
      && result.receipt.output_sha256 === H(result.output)
      && instance.events.some(row => row.kind === 'operation_result' && H(row.receipt) === H(result.receipt)));
  }
  return records.at(-1);
}
