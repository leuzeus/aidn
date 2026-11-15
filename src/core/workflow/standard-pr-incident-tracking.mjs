import { checkShadowJson, shadowHash } from './shadow-json.mjs';
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import inputSchema from '../contracts/workflow-definition/standard-pr-incident-tracking-input.v1.schema.json' with { type: 'json' };
import planSchema from '../contracts/workflow-definition/standard-pr-incident-tracking-plan.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-pr-incident-tracking-output.v1.schema.json' with { type: 'json' };

export const prIncidentRecordOperation = 'session_pr_incident_record';
export const prIncidentResolveOperation = 'session_pr_incident_resolve';
export const prIncidentTrackingOperations = Object.freeze([prIncidentRecordOperation, prIncidentResolveOperation]);
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
export function assertPrIncidentTrackingInput(value) {
  if (!valid(value, inputSchema)) fail('STANDARD_PR_INCIDENT_INPUT_INVALID');
  return value;
}
export function assertPrIncidentTrackingPlan(value) {
  if (!valid(value, planSchema) || value.source_sha256 !== shadowHash(value.source)
    || value.instance_id !== value.source.instance_id || value.scope_id !== value.source.scope_id
    || value.input.origin_operation_id !== value.source.origin_operation_id
    || value.change.path !== `incidents/${value.source.incident_id}.md` || value.source.severity !== 'L2_MEDIUM'
    || (value.operation_ref === prIncidentRecordOperation) !== (value.source.resolution === null)) fail('STANDARD_PR_INCIDENT_PLAN_INVALID');
  return value;
}
export function assertPrIncidentTrackingOutput(value) {
  if (!valid(value, outputSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  const fact = value.operation_ref === prIncidentRecordOperation ? 'session_pr_incident_tracking_recorded' : 'session_pr_incident_resolution_verified';
  if (value.outcome === 'completed') {
    if (!['confirmed', 'no_effect'].includes(value.effect_status) || Object.keys(value.facts).join(',') !== fact || value.facts[fact] !== true
      || value.evidence_refs.length !== 1 || value.evidence_refs[0].sha256 !== value.observations.tracker_sha256
      || value.evidence_refs[0].ref !== `docs/audit/incidents/${value.observations.incident_id}.md`) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  } else if (!value.observations.reason_code || Object.keys(value.facts).length
    || (value.outcome === 'reconciliation_required') !== (value.effect_status === 'unknown')
    || value.effect_status === 'unknown' && value.evidence_refs.length) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return value;
}
