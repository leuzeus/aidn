import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';
import inputSchema from '../contracts/workflow-definition/standard-pr-post-merge-fetch-input.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-pr-post-merge-fetch-output.v1.schema.json' with { type: 'json' };
import alignmentInputSchema from '../contracts/workflow-definition/standard-pr-post-merge-alignment-input.v1.schema.json' with { type: 'json' };
import alignmentOutputSchema from '../contracts/workflow-definition/standard-pr-post-merge-alignment-output.v1.schema.json' with { type: 'json' };

import measurementSchema from '../contracts/workflow-definition/standard-pr-post-merge-measure-output.v1.schema.json' with { type: 'json' };

export const postMergeMeasureOperation = 'session_pr_post_merge_measure';
export const postMergeFetchOperation = 'session_pr_post_merge_fetch';
export const postMergeAlignmentOperation = 'session_pr_post_merge_alignment';
export const alignedReason = 'STANDARD_PR_POST_MERGE_ALIGNED';
export const divergentReason = 'STANDARD_PR_POST_MERGE_DIVERGENCE';
export const pendingAlignmentReasons = Object.freeze([
  'WORKFLOW_POST_MERGE_FRESH_FETCH_REQUIRED',
  'WORKFLOW_POST_MERGE_REMOTE_MOVED',
  'WORKFLOW_POST_MERGE_LOCAL_CHANGED',
]);
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value)
  && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;

export function assertPostMergeFetchInput(value) {
  if (!valid(value, inputSchema)) fail('STANDARD_OPERATION_INPUT_INVALID');
  return value;
}

export function assertPostMergeAlignmentInput(value) {
  if (!valid(value, alignmentInputSchema)) fail('STANDARD_OPERATION_INPUT_INVALID');
  return value;
}

export function assertPostMergeFetchOutput(value) {
  if (!valid(value, outputSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  const { outcome, effect_status, observations: { fetch }, evidence_refs } = value;
  if (outcome !== 'completed') {
    if (fetch || evidence_refs.length || effect_status !== (outcome === 'blocked' ? 'no_effect' : 'unknown'))
      fail('STANDARD_OPERATION_OUTPUT_INVALID');
    return value;
  }
  const [proof] = evidence_refs;
  if (!fetch || effect_status !== (fetch.confirmation === 'executed' ? 'confirmed' : 'no_effect')
    || (fetch.ahead === 0 && fetch.behind === 0) !== (fetch.local_head === fetch.fetched_head)
    || proof?.ref !== 'git:' + fetch.proof_ref || proof.sha256 !== shadowHash(fetch))
    fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return value;
}

export function assertPostMergeAlignmentOutput(value) {
  if (!valid(value, alignmentOutputSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  const { outcome, observations: { reason_code: reason, alignment }, evidence_refs: evidence } = value;
  if (!alignment) {
    if (evidence.length || reason === alignedReason || reason === divergentReason
      || (outcome !== 'blocked' && (outcome !== 'deferred' || !pendingAlignmentReasons.includes(reason))))
      fail('STANDARD_OPERATION_OUTPUT_INVALID');
    return value;
  }
  const aligned = alignment.ahead === 0 && alignment.behind === 0, [proof] = evidence;
  if (aligned !== (alignment.local_head === alignment.remote_head)
    || (aligned ? outcome !== 'completed' || reason !== alignedReason : outcome !== 'deferred' || reason !== divergentReason)
    || proof?.ref !== 'git:' + alignment.proof_ref || proof.sha256 !== shadowHash(alignment))
    fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return value;
}

export function assertPostMergeMeasureOutput(value) {
  if (!valid(value, measurementSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  const { observations: { reason_code: reason, alignment }, outcome, facts } = value;
  const diverged = reason === divergentReason;
  const expectedFacts = outcome === 'completed' ? { session_pr_post_merge_diverged: diverged } : {};
  if (diverged && outcome !== 'completed' || shadowHash(facts) !== shadowHash(expectedFacts))
    fail('STANDARD_OPERATION_OUTPUT_INVALID');
  // Use the historical shape to check exact witness and count semantics.
  if (reason === 'WORKFLOW_POST_MERGE_REMOTE_REF_REQUIRED' && !alignment && outcome === 'deferred'
    && value.evidence_refs.length === 0) return value;
  assertPostMergeAlignmentOutput({ ...value, contract_version: 'standard-pr-post-merge-alignment-output.v1',
    operation_ref: postMergeAlignmentOperation, outcome: diverged ? 'deferred' : outcome, facts: {} });
  return value;
}
