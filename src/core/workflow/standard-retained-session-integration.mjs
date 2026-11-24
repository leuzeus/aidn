import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import entrySchema from '../contracts/workflow-definition/standard-retained-session-integration-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-session-integration-proof.v1.schema.json' with { type: 'json' };
const valid = (value, schema) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    throw Object.assign(Error('STANDARD_RETAINED_SESSION_INTEGRATION_CONTRACT_INVALID'), { code: 'STANDARD_RETAINED_SESSION_INTEGRATION_CONTRACT_INVALID' });
  return value;
};
export const assertRetainedSessionIntegrationEntry = value => valid(value, entrySchema);
export const assertRetainedSessionIntegrationProof = value => valid(value, proofSchema);
export const retainedSessionIntegrationContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, decision_operation_id: proof.decision_operation_id,
  proof_sha256: H(assertRetainedSessionIntegrationProof(proof)) });

// Pure boundary validation. Signature, source, canonical/Git and current-owner
// authentication are separate fixed-host requirements; this grants no effect.
export function assertRetainedSessionIntegrationBoundary({ instance, execution, records, entry }) {
  const require = (ok, code = 'STANDARD_RETAINED_SESSION_INTEGRATION_BOUNDARY_CHANGED') => { if (!ok) throw Object.assign(Error(code), { code }); };
  const sequence = ['workflow_entry_select', 'session_delivery_checkpoint', 'cycle_close_completed_select', 'session_branch_integration_decision'];
  const intents = instance.events.filter(row => row.kind === 'operation_intent');
  require(intents.length === records.length);
  require(H(records.map(row => row?.intent.binding_ref)) === H(sequence), 'STANDARD_RETAINED_SESSION_INTEGRATION_BOUNDARY_CHANGED');
  const decision = records.at(-1);
  require(decision.operation_id === entry.decision_operation_id, 'STANDARD_RETAINED_SESSION_INTEGRATION_DECISION_REQUIRED');
  for (const [i, row] of records.entries()) {
    require(row.phase === 'receipted' && row.results.length === 1);
    const result = row.results[0], accepted = instance.events.some(event => event.kind === 'operation_result' && H(event.receipt) === H(result.receipt));
    require(H(row.intent) === H(intents[i].intent) && row.intent.instance_id === instance.instance_id && row.intent.scope_id === instance.scope_id
    && row.intent.model_sha256 === instance.model_sha256 && row.preview.snapshot.native.configuration_sha256 === H(execution)
    && result.receipt.outcome === 'completed' && result.output.outcome === 'completed' && result.receipt.output_sha256 === H(result.output)
    && result.receipt.effect_status === result.output.effect_status && result.output.effect_status === 'no_effect'
    && (row === decision ? !accepted : accepted), 'STANDARD_RETAINED_SESSION_INTEGRATION_BOUNDARY_CHANGED');
  }
  return records.at(-1);
}
