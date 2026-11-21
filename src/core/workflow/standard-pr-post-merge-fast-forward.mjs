import inputSchema from '../contracts/workflow-definition/standard-pr-post-merge-fast-forward-input.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-pr-post-merge-fast-forward-output.v1.schema.json' with { type: 'json' };
import planSchema from '../contracts/workflow-definition/standard-pr-post-merge-fast-forward-plan.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';

export const postMergeFastForwardOperation = 'session_pr_post_merge_fast_forward';
function check(value, schema, code) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    throw Object.assign(Error(code), { code, effect_status: 'no_effect' });
  return value;
}
export const assertPostMergeFastForwardInput = value => check(value, inputSchema, 'STANDARD_OPERATION_INPUT_INVALID');
export const assertPostMergeFastForwardPlan = value => check(value, planSchema, 'STANDARD_PR_POST_MERGE_FAST_FORWARD_PLAN_INVALID');

export function assertPostMergeFastForwardOutput(value) {
  const code = 'STANDARD_OPERATION_OUTPUT_INVALID';
  check(value, outputSchema, code);
  const { outcome, effect_status, observations: { fast_forward }, evidence_refs: [evidence] } = value;
  const valid = fast_forward ? outcome === 'completed' && fast_forward.local_head !== fast_forward.remote_head
    && effect_status === (fast_forward.confirmation === 'executed' ? 'confirmed' : 'no_effect')
    && evidence?.ref === 'git:' + fast_forward.source_ref && evidence.sha256 === shadowHash(fast_forward)
    : !evidence && (outcome === 'blocked' && effect_status === 'no_effect' || outcome === 'reconciliation_required' && effect_status === 'unknown');
  if (!valid) throw Object.assign(Error(code), { code });
  return value;
}
