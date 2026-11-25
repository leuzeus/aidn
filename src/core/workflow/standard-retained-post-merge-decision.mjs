import entrySchema from '../contracts/workflow-definition/standard-retained-post-merge-decision-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-post-merge-decision-proof.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import { inspectAgenticProcess } from './agentic-process.mjs';
import { postMergeDecisionQuestion, postMergeRecoveryResult, assertPostMergeDecisionOutput } from './standard-pr-post-merge-decision.mjs';
const require = ok => { if (!ok) throw Object.assign(Error('STANDARD_RETAINED_POST_MERGE_DECISION_CHANGED'), { code: 'STANDARD_RETAINED_POST_MERGE_DECISION_CHANGED' }); };
function valid(value, schema) { require(!checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length); return value; }
export const assertRetainedPostMergeDecisionEntry = value => valid(value, entrySchema);
export const assertRetainedPostMergeDecisionProof = value => valid(value, proofSchema);
export const retainedPostMergeDecisionContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, update_operation_id: proof.update_operation_id,
  fetch_operation_id: proof.fetch_operation_id, decision_operation_id: proof.recorded_decision_operation_id,
  proof_sha256: H(assertRetainedPostMergeDecisionProof(proof)) });

// Only the known no-effect receipt at the end of an admitted R09 suffix.
// Optional predecessor questions must be accepted system recovery dispositions.
// No result is imported into the original reducer, including its unaccepted H.
export function assertRetainedPostMergeDecisionBoundary({ instance, records, entry }) {
  assertRetainedPostMergeDecisionEntry(entry);
  const intents = instance.events.filter(e => e.kind === 'operation_intent');
  require(instance.initial_parameters?.entry_point?.kind === 'retained_post_merge'
    && records.length >= 4 && records.length <= 36 && intents.length === records.length
    && !instance.events.some(e => e.kind === 'control'));
  let previous = -1;
  for (let i = 0; i < records.length; i++) {
    const r = records[i], result = r.results[0], at = instance.events.indexOf(intents[i]);
    const end = instance.events.findIndex(e => e.kind === 'operation_result' && H(e.receipt) === H(result?.receipt));
    require(H(r.intent) === H(intents[i].intent) && r.intent.instance_id === instance.instance_id
      && r.phase === 'receipted' && r.results.length === 1 && result.output.effect_status === 'no_effect'
      && result.receipt.effect_status === 'no_effect' && result.receipt.output_sha256 === H(result.output) && at > previous);
    if (i < 3) require(r.intent.binding_ref === ['workflow_entry_select', 'session_pr_retained_merge_select', 'session_pr_post_merge_measure'][i]
      && result.receipt.outcome === 'completed' && result.output.outcome === 'completed' && end > at);
    else if (i < records.length - 1) require(r.intent.binding_ref === 'session_pr_post_merge_decision'
      && postMergeRecoveryResult(r) && result.receipt.outcome === 'deferred' && end > at);
    else require(r.intent.binding_ref === 'session_pr_post_merge_decision' && r.operation_id === entry.decision_operation_id
      && end === -1 && result.receipt.outcome === 'completed' && assertPostMergeDecisionOutput(result.output).observations.choice === 'fast_forward'
      && /^[a-f0-9]{64}$/.test(r.decision_claim_sha256 ?? ''));
    previous = end >= 0 ? end : at;
  }
  const decision = records.at(-1), question = postMergeDecisionQuestion(decision);
  require(question.subject.measurement_operation_id === records[2].operation_id
    && question.subject.measurement_receipt_sha256 === H(records[2].results[0].receipt)
    && decision.preview.input.measurement_operation_id === records[2].operation_id
    && question.subject.alignment.fetch_operation_id === instance.initial_parameters.entry_point.fetch_operation_id);
  for (let i = 4; i < records.length; i++) require(records[i].preview.prepared.replaces?.operation_id === records[i - 1].operation_id
    && records[i].preview.prepared.replaces.disposition_receipt_sha256 === H(records[i - 1].results[0].receipt));
  const waits = inspectAgenticProcess(instance).occurrences.filter(r => r.operation?.intent?.operation_id === decision.operation_id);
  require(waits.length === 1 && waits[0].status === 'WAITING' && !waits[0].operation.receipt);
  return { decision, question, measurement: records[2] };
}
