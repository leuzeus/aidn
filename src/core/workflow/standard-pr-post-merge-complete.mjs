import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson } from './shadow-json.mjs';
import inputSchema from '../contracts/workflow-definition/standard-pr-post-merge-complete-input.v1.schema.json' with { type: 'json' };
import planSchema from '../contracts/workflow-definition/standard-pr-post-merge-complete-plan.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-pr-post-merge-complete-output.v1.schema.json' with { type: 'json' };

export const postMergeCompleteOperation = 'session_pr_post_merge_complete';
const valid = (value, schema) => !checkShadowJson(value)
  && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };

export function assertPostMergeCompleteInput(input) {
  if (!valid(input, inputSchema)) fail('STANDARD_OPERATION_INPUT_INVALID');
  return input;
}

export function assertPostMergeCompletePlan(plan) {
  if (!valid(plan, planSchema)) fail('STANDARD_PR_POST_MERGE_COMPLETION_PLAN_INVALID');
  return plan;
}

export function assertPostMergeCompleteOutput(output) {
  if (!valid(output, outputSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  const { outcome, observations, evidence_refs } = output;
  if (outcome === 'completed'
    ? !observations.plan_sha256 || evidence_refs.length !== 1 || evidence_refs[0].sha256 !== observations.plan_sha256
    : observations.plan_sha256 || evidence_refs.length) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return output;
}
