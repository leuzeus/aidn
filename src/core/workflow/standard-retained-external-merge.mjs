import entrySchema from '../contracts/workflow-definition/standard-retained-external-merge-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-external-merge-proof.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import { inspectAgenticProcess } from './agentic-process.mjs';
const require = (ok, code = 'STANDARD_RETAINED_EXTERNAL_MERGE_BOUNDARY_CHANGED') => {
  if (!ok) throw Object.assign(Error(code), { code });
};
const valid = (value, schema) => {
  require(!checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length,
    'STANDARD_RETAINED_EXTERNAL_MERGE_CONTRACT_INVALID');
  return value;
};
export const assertRetainedExternalMergeEntry = value => valid(value, entrySchema);
export const assertRetainedExternalMergeProof = value => valid(value, proofSchema);
export const retainedExternalMergeContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, update_operation_id: proof.update_operation_id,
  proof_sha256: H(assertRetainedExternalMergeProof(proof)) });

// No in-flight effect, control capture, Native work or accepted review can be
// transferred. The source additionally authenticates journals and live state.
export function assertRetainedExternalMergeBoundary({ instance, records, entry }) {
  const names = ['workflow_entry_select', 'session_pr_record', 'session_pr_checkpoint', 'session_pr_update_push', 'session_pr_review_content_observe'];
  const intents = instance.events.filter(row => row.kind === 'operation_intent');
  require(instance.initial_parameters?.entry_point?.kind === 'retained_session_pr_open'
    && intents.length === records.length && H(records.map(row => row.intent.binding_ref)) === H(names)
    && records[3].operation_id === entry.update_operation_id && !instance.events.some(row => row.kind === 'control'));
  for (const [index, record] of records.entries()) {
    const result = record.results[0];
    require(H(record.intent) === H(intents[index].intent) && record.intent.instance_id === instance.instance_id
      && record.intent.scope_id === instance.scope_id && record.intent.model_sha256 === instance.model_sha256
      && record.phase === 'receipted' && record.results.length === 1 && result.receipt.outcome === 'completed'
      && result.output.outcome === 'completed' && result.receipt.effect_status === result.output.effect_status
      && (index === 1 ? result.output.effect_status === 'confirmed' : [2, 3].includes(index)
        ? ['confirmed', 'no_effect'].includes(result.output.effect_status) : result.output.effect_status === 'no_effect')
      && result.receipt.output_sha256 === H(result.output)
      && instance.events.some(row => row.kind === 'operation_result' && H(row.receipt) === H(result.receipt)));
  }
  const cursor = inspectAgenticProcess(instance);
  const waits = cursor.occurrences.filter(row => row.node_id === 'session_pr_review_wait' && row.status !== 'COMPLETED');
  require(waits.length === 1);
  const call = cursor.occurrences.find(row => row.occurrence_id === waits[0].call_scope_id);
  require(call?.node_id === 'session_pr_review_capture');
  return { update: records[3], wait: waits[0] };
}
