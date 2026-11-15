import { checkShadowJson, freezeShadow, shadowHash } from './shadow-json.mjs';
import { assertAgenticProcessInstance, inspectAgenticProcess } from './agentic-process.mjs';
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import closurePortPlanSchema from '../contracts/workflow-definition/standard-incident-close-plan.v1.schema.json' with { type: 'json' };
import inputSchema from '../contracts/workflow-definition/standard-pr-incident-close-input.v1.schema.json' with { type: 'json' };
import planSchema from '../contracts/workflow-definition/standard-pr-incident-close-plan.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-pr-incident-close-output.v1.schema.json' with { type: 'json' };

export const prIncidentCloseOperation = 'session_pr_incident_close';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
export function assertPrIncidentCloseInput(value) {
  if (!valid(value, inputSchema)) fail('STANDARD_PR_INCIDENT_CLOSE_INPUT_INVALID');
  return value;
}
const traceMaxBytes = closurePortPlanSchema.properties.traces.items.properties.after.maxLength;
const closureEncoding = 'base64-trace-utf8-v1';
function assertPortPlan(value) {
  if (checkShadowJson(value, { maxStringLength: traceMaxBytes })
    || validateJsonSchema(value, closurePortPlanSchema, '$', { contractKind: 'workflow-definition' }).length
    || value.traces.some(row => Buffer.byteLength(row.after, 'utf8') > traceMaxBytes))
    fail('STANDARD_PR_INCIDENT_CLOSE_PLAN_INVALID');
  return value;
}
export function encodePrIncidentClosurePlan(value) {
  assertPortPlan(value);
  const encoded = { ...value, traces: value.traces.map(row => ({ ...row, after: Buffer.from(row.after, 'utf8').toString('base64') })) };
  const text = JSON.stringify(encoded), chunks = [];
  for (let at = 0; at < text.length; at += 8192) chunks.push(text.slice(at, at + 8192));
  if (chunks.length > planSchema.properties.closure_plan_chunks.maxItems) fail('STANDARD_PR_INCIDENT_CLOSE_PLAN_INVALID');
  return { closure_plan_encoding: closureEncoding, closure_plan_sha256: shadowHash(value), closure_plan_chunks: chunks };
}
export function decodePrIncidentClosurePlan(value) {
  if (!valid(value, planSchema)) fail('STANDARD_PR_INCIDENT_CLOSE_PLAN_INVALID');
  let encoded;
  try { encoded = JSON.parse(value.closure_plan_chunks.join('')); } catch { fail('STANDARD_PR_INCIDENT_CLOSE_PLAN_INVALID'); }
  if (value.closure_plan_encoding !== closureEncoding || !encoded || !Array.isArray(encoded.traces)
    || encoded.traces.length !== 2) fail('STANDARD_PR_INCIDENT_CLOSE_PLAN_INVALID');
  const traces = encoded.traces.map(row => {
    if (!row || typeof row.after !== 'string' || row.after.length > 4 * Math.ceil(traceMaxBytes / 3))
      fail('STANDARD_PR_INCIDENT_CLOSE_PLAN_INVALID');
    const bytes = Buffer.from(row.after, 'base64'), text = bytes.toString('utf8');
    if (bytes.length > traceMaxBytes || bytes.toString('base64') !== row.after || !Buffer.from(text, 'utf8').equals(bytes))
      fail('STANDARD_PR_INCIDENT_CLOSE_PLAN_INVALID');
    return { ...row, after: text };
  });
  const decoded = assertPortPlan({ ...encoded, traces });
  if (shadowHash(decoded) !== value.closure_plan_sha256) fail('STANDARD_PR_INCIDENT_CLOSE_PLAN_INVALID');
  return decoded;
}

export function assertPrIncidentClosePlan(value) {
  if (!valid(value, planSchema) || value.source_sha256 !== shadowHash(value.source)
    || value.input.origin_operation_id !== value.source.origin_operation_id
    || value.source.severity !== 'L2_MEDIUM' || value.source.resolution === null)
    fail('STANDARD_PR_INCIDENT_CLOSE_PLAN_INVALID');
  const inner = decodePrIncidentClosurePlan(value);
  if (shadowHash(inner) !== value.closure_plan_sha256 || inner.incident_id !== value.source.incident_id
    || inner.instance_id !== value.source.instance_id || inner.scope_id !== value.source.scope_id)
    fail('STANDARD_PR_INCIDENT_CLOSE_PLAN_INVALID');
  return value;
}
export function assertPrIncidentCloseOutput(value) {
  if (!valid(value, outputSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  if (value.outcome === 'completed') {
    if (!['confirmed', 'no_effect'].includes(value.effect_status) || value.observations.reason_code !== null
      || Object.keys(value.facts).join(',') !== 'session_pr_incident_cleanup_completed'
      || value.facts.session_pr_incident_cleanup_completed !== true || value.evidence_refs.length !== 2)
      fail('STANDARD_OPERATION_OUTPUT_INVALID');
  } else if (Object.keys(value.facts).length || !value.observations.reason_code
    || (value.outcome === 'reconciliation_required') !== (value.effect_status === 'unknown')
    || value.effect_status === 'unknown' && value.evidence_refs.length) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return value;
}

// Structural causal check only. The fixed host must separately authenticate the
// retained journal/preview MAC, claimed owner and current explicit effect grant.
// The reconstructed prefix is never persisted or admitted as a new current state.
export function prIncidentCloseIntentPrefix(instance, record) {
  assertAgenticProcessInstance(instance);
  const intent = record?.intent, event = instance.events.at(-1);
  if (record?.phase !== 'dispatching' || !Array.isArray(record.results) || record.results.length !== 0
    || intent?.binding_ref !== prIncidentCloseOperation || record.operation_id !== intent.operation_id
    || intent.instance_id !== instance.instance_id || intent.scope_id !== instance.scope_id
    || record.preview?.binding?.id !== prIncidentCloseOperation
    || event?.kind !== 'operation_intent' || shadowHash(event.intent) !== shadowHash(intent)
    || !inspectAgenticProcess(instance).occurrences.some(frame => frame.status === 'WAITING'
      && frame.operation?.intent.operation_id === intent.operation_id)) fail('STANDARD_PR_INCIDENT_CLOSE_OWN_INTENT_REQUIRED');
  const { instance_sha256, ...body } = instance;
  body.events = body.events.slice(0, -1); body.revision--;
  const before = { ...body, instance_sha256: shadowHash(body) };
  assertAgenticProcessInstance(before); inspectAgenticProcess(before);
  if (before.instance_sha256 !== intent.instance_sha256
    || before.instance_sha256 !== record.preview.instance_sha256) fail('STANDARD_PR_INCIDENT_CLOSE_PREFIX_CHANGED');
  return freezeShadow(before);
}
