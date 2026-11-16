import inputSchema from '../contracts/workflow-definition/standard-handoff-resource-operation-input.v1.schema.json' with { type: 'json' };
import planSchema from '../contracts/workflow-definition/standard-handoff-resource-operation-plan.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-handoff-resource-operation-output.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { assertHandoffResourceResult } from './standard-handoff-resources.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';
export const handoffResourceOperation = 'handoff_resources_observe';
const fail = () => { throw Object.assign(Error('STANDARD_HANDOFF_RESOURCE_OPERATION_INVALID'), { code: 'STANDARD_HANDOFF_RESOURCE_OPERATION_INVALID' }); };
const valid = (v, s) => { if (checkShadowJson(v) || validateJsonSchema(v, s, '$', { contractKind: 'workflow-definition' }).length) fail(); return v; };
export const assertHandoffResourceOperationInput = v => valid(v, inputSchema);
export function assertHandoffResourceOperationPreparation(v) {
  if (checkShadowJson(v) || Object.keys(v).sort().join(',') !== 'plan,plan_sha256' || shadowHash(valid(v.plan, planSchema)) !== v.plan_sha256) fail();
  return v;
}
export function assertHandoffResourceOperationOutput(v) {
  valid(v, outputSchema); assertHandoffResourceResult(v.observations.resource_result);
  if (shadowHash(v.facts) !== shadowHash({ handoff_resource_snapshot_observed: true })
    || v.observations.resource_result.complete_resource_closure !== true || v.observations.resource_result.snapshot_only !== true) fail();
  return v;
}
