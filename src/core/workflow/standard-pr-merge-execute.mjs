import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';
import inputSchema from '../contracts/workflow-definition/standard-pr-merge-execute-input.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-pr-merge-execute-output.v1.schema.json' with { type: 'json' };
import renewalOutputSchema from '../contracts/workflow-definition/standard-pr-merge-execute-output.v2.schema.json' with { type: 'json' };
import waitInputSchema from '../contracts/workflow-definition/standard-pr-post-merge-wait-input.v1.schema.json' with { type: 'json' };
import waitOutputSchema from '../contracts/workflow-definition/standard-pr-post-merge-wait-output.v1.schema.json' with { type: 'json' };

export const mergeExecuteOperation = 'session_pr_merge_execute';
export const mergeExecuteOutputVersion = 'standard-pr-merge-execute-output.v2';
export const mergeCompletedFact = 'session_pr_merge_completed';
export const postMergeWaitOperation = 'session_pr_post_merge_wait';
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value)
  && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;

export function assertMergeExecuteInput(operation, value) {
  if (!valid(value, operation === mergeExecuteOperation ? inputSchema : waitInputSchema)) fail('STANDARD_OPERATION_INPUT_INVALID');
  return value;
}

export function assertMergeExecuteOutput(value) {
  const renewal = value?.contract_version === mergeExecuteOutputVersion;
  if (!valid(value, renewal ? renewalOutputSchema : outputSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  const { observations: { merge }, outcome, effect_status, evidence_refs } = value;
  if (renewal && outcome === 'completed') {
    if (value.facts[mergeCompletedFact] !== Boolean(merge)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
    if (!merge) {
      if (value.observations.reason_code !== 'STANDARD_PLAN_EXPIRED' || effect_status !== 'no_effect' || evidence_refs.length)
        fail('STANDARD_OPERATION_OUTPUT_INVALID');
      return value;
    }
  } else if (renewal && Object.keys(value.facts).length) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  if (outcome !== 'completed') {
    if (merge || evidence_refs.length || effect_status !== (outcome === 'reconciliation_required' ? 'unknown' : 'no_effect'))
      fail('STANDARD_OPERATION_OUTPUT_INVALID');
    return value;
  }
  const pr = merge?.provider.pull_request, [proof] = evidence_refs;
  if (!pr?.merged || pr.state !== 'MERGED' || pr.is_draft || !pr.merged_by || !pr.commit_body_sha256 || !pr.merge_oid
    || pr.merge_parent_oids.length !== 2 || pr.merge_parent_oids[1] !== pr.head_oid
    || pr.head_repository_id !== merge.provider.repository.node_id
    || effect_status !== (merge.confirmation === 'acknowledged' ? 'confirmed' : 'no_effect')
    || proof?.ref !== 'github:pr-merge/' + pr.node_id || proof.sha256 !== shadowHash(merge))
    fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return value;
}

export function assertPostMergeWaitOutput(value) {
  if (!valid(value, waitOutputSchema) || (value.outcome === 'deferred') !== Boolean(value.observations.merge_receipt_sha256))
    fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return value;
}
