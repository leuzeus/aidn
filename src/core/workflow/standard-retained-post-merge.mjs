import entrySchema from '../contracts/workflow-definition/standard-retained-post-merge-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-post-merge-proof.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import { inspectAgenticProcess } from './agentic-process.mjs';
const require = (ok, code = 'STANDARD_RETAINED_POST_MERGE_BOUNDARY_CHANGED') => { if (!ok) throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => {
  require(!checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length,
    'STANDARD_RETAINED_POST_MERGE_CONTRACT_INVALID'); return value;
};
export const assertRetainedPostMergeEntry = value => valid(value, entrySchema);
export const assertRetainedPostMergeProof = value => valid(value, proofSchema);
export const retainedPostMergeContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, update_operation_id: proof.update_operation_id,
  fetch_operation_id: proof.fetch_operation_id, proof_sha256: H(assertRetainedPostMergeProof(proof)) });

// Deliberately one settled captured-merge prefix, before the R09 decision.
// No UNKNOWN, partially accepted operation, control delivery or Native replay.
export function assertRetainedPostMergeBoundary({ instance, records, entry }) {
  assertRetainedPostMergeEntry(entry);
  const expected = ['workflow_entry_select', 'session_pr_retained_merge_select', 'session_pr_external_merge_disposition',
    'session_pr_merge_basis', 'session_pr_post_merge_fetch', 'session_pr_post_merge_measure'];
  const intents = instance.events.filter(row => row.kind === 'operation_intent');
  require(instance.initial_parameters?.entry_point?.kind === 'retained_external_merge_capture'
    && records.length === expected.length && intents.length === expected.length
    && !instance.events.some(row => row.kind === 'control'));
  let previous = -1;
  records.forEach((record, i) => {
    const result = record.results[0], at = instance.events.indexOf(intents[i]);
    const end = instance.events.findIndex(row => row.kind === 'operation_result' && H(row.receipt) === H(result?.receipt));
    require(record.intent.binding_ref === expected[i] && H(record.intent) === H(intents[i].intent)
      && record.phase === 'receipted' && record.results.length === 1 && result.receipt.outcome === 'completed'
      && result.output.outcome === 'completed' && result.receipt.output_sha256 === H(result.output)
      && result.receipt.effect_status === result.output.effect_status
      && (i === 4 ? ['confirmed', 'no_effect'].includes(result.output.effect_status) : result.output.effect_status === 'no_effect')
      && at > previous && end > at);
    previous = end;
  });
  require(records[4].operation_id === entry.fetch_operation_id
    && records[4].preview.input.merge_operation_id === records[2].operation_id
    && records[3].results[0].output.observations.merge_operation_id === records[2].operation_id
    && records[5].preview.input.fetch_operation_id === entry.fetch_operation_id
    && records[2].results[0].output.observations.choice === 'acknowledge_external_merge_for_r09'
    && records[2].results[0].output.observations.severity === 'L1_LOW');
  const cursor = inspectAgenticProcess(instance);
  require(cursor.occurrences.some(row => row.node_id === 'pr_post_merge_decision' && row.status === 'READY'));
  return { entryRecord: records[0], disposition: records[2], fetch: records[4], measurement: records[5] };
}
