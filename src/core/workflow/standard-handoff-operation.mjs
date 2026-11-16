import planSchema from '../contracts/workflow-definition/standard-handoff-operation-plan.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-handoff-operation-output.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, freezeShadow, shadowHash as H } from './shadow-json.mjs';
import { assertAgenticProcessInstance, inspectAgenticProcess } from './agentic-process.mjs';
import { assertHandoffPublicationInput, assertHandoffPublicationPlan } from './standard-handoff-publication.mjs';
export const handoffPublicationOperation = 'handoff_packet_publish';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
export function encodeHandoffPacketPlan(plan) {
  assertHandoffPublicationPlan(plan); const text = JSON.stringify(plan), chunks = [];
  for (let at = 0; at < text.length; at += 8192) chunks.push(text.slice(at, at + 8192));
  if (chunks.length > 128) fail('STANDARD_HANDOFF_OPERATION_PLAN_INVALID');
  return { packet_plan_encoding: 'json-utf8-v1', packet_plan_sha256: H(plan), packet_plan_chunks: chunks };
}
export function decodeHandoffPacketPlan(value) {
  if (!valid(value, planSchema)) fail('STANDARD_HANDOFF_OPERATION_PLAN_INVALID');
  const text = value.packet_plan_chunks.join('');
  if (Buffer.byteLength(text) > 700000) fail('STANDARD_HANDOFF_OPERATION_PLAN_INVALID');
  let plan; try { plan = JSON.parse(text); } catch { fail('STANDARD_HANDOFF_OPERATION_PLAN_INVALID'); }
  assertHandoffPublicationPlan(plan);
  if (H(plan) !== value.packet_plan_sha256) fail('STANDARD_HANDOFF_OPERATION_PLAN_INVALID');
  return freezeShadow(plan);
}
export function assertHandoffOperationPlan(value) {
  const inner = decodeHandoffPacketPlan(value); assertHandoffPublicationInput(value.input);
  if (H(inner.input) !== H(value.input) || value.instance_resource.ref !== 'artifact:workflows/process-instances/' + inner.context.instance_id + '.json')
    fail('STANDARD_HANDOFF_OPERATION_PLAN_INVALID');
  return value;
}
export function assertHandoffOperationPreparation(value) {
  if (checkShadowJson(value)) fail('STANDARD_HANDOFF_OPERATION_PREPARATION_INVALID');
  if (value?.can_apply === false) {
    if (Object.keys(value).sort().join(',') !== 'can_apply,reason_code,status,written' || !['BLOCKED','WAITING'].includes(value.status)
      || value.written !== false || !/^[A-Z][A-Z0-9_]{0,127}$/.test(value.reason_code ?? '')) fail('STANDARD_HANDOFF_OPERATION_PREPARATION_INVALID');
  } else if (value?.can_apply !== true || Object.keys(value).sort().join(',') !== 'can_apply,plan,plan_sha256'
    || H(assertHandoffOperationPlan(value.plan)) !== value.plan_sha256) fail('STANDARD_HANDOFF_OPERATION_PREPARATION_INVALID');
  return value;
}
// Structural comparison only. The fixed host separately authenticates the
// current journal/preview MAC, live grant, claimed owner and signed dispatch.
export function handoffPublicationIntentPrefix(instance, record) {
  assertAgenticProcessInstance(instance); const intent = record?.intent, event = instance.events.at(-1);
  if (record?.phase !== 'dispatching' || !Array.isArray(record.results) || record.results.length || intent?.binding_ref !== handoffPublicationOperation
    || record.operation_id !== intent.operation_id || record.preview?.binding?.id !== handoffPublicationOperation
    || intent.instance_id !== instance.instance_id || intent.scope_id !== instance.scope_id || event?.kind !== 'operation_intent'
    || H(event.intent) !== H(intent) || !inspectAgenticProcess(instance).occurrences.some(frame => frame.status === 'WAITING'
      && frame.operation?.intent.operation_id === intent.operation_id)) fail('STANDARD_HANDOFF_OPERATION_OWN_INTENT_REQUIRED');
  const { instance_sha256, ...body } = instance; body.events = body.events.slice(0, -1); body.revision--;
  const before = { ...body, instance_sha256: H(body) }; assertAgenticProcessInstance(before); inspectAgenticProcess(before);
  if (before.instance_sha256 !== intent.instance_sha256 || before.instance_sha256 !== record.preview.instance_sha256)
    fail('STANDARD_HANDOFF_OPERATION_PREFIX_CHANGED');
  return freezeShadow(before);
}
export function assertHandoffOperationOutput(value) {
  if (!valid(value, outputSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  const o = value.observations, completed = value.outcome === 'completed';
  if (H(value.facts) !== H(completed ? { handoff_packet_published: true } : {}) || (completed
    ? (value.effect_status !== 'confirmed' || o.reason_code !== null || !o.plan_sha256 || !o.packet_plan_sha256
      || !o.packet_sha256 || !o.resource_material_sha256 || value.evidence_refs.length !== 1 || value.evidence_refs[0].sha256 !== o.packet_sha256)
    : !o.reason_code || o.packet_sha256 !== null || o.packet_metadata_sha256 !== null || value.evidence_refs.length !== 0
      || value.effect_status !== (value.outcome === 'reconciliation_required' ? 'unknown' : 'no_effect'))) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return value;
}
export function handoffOperationResult(prepared, result = null, reason = null, effectStatus = 'no_effect') {
  assertHandoffOperationPreparation(prepared);
  const inner = prepared.can_apply ? decodeHandoffPacketPlan(prepared.plan) : null, completed = result?.status === 'packet_written';
  const unknown = result?.effect_status === 'unknown' || effectStatus === 'unknown';
  const outcome = completed ? 'completed' : unknown ? 'reconciliation_required' : prepared.status === 'WAITING' || result?.status === 'waiting' ? 'deferred' : 'blocked';
  return freezeShadow(assertHandoffOperationOutput({ contract_version: 'standard-handoff-operation-output.v1', operation_ref: handoffPublicationOperation,
    outcome, effect_status: completed ? 'confirmed' : unknown ? 'unknown' : 'no_effect', facts: completed ? { handoff_packet_published: true } : {},
    observations: { plan_sha256: prepared.can_apply ? prepared.plan_sha256 : null, packet_plan_sha256: inner ? H(inner) : null,
      packet_sha256: completed ? result.packet_sha256 : null, packet_metadata_sha256: completed ? result.packet_metadata_sha256 : null,
      resource_material_sha256: inner?.resource_material_sha256 ?? null, reason_code: completed ? null : reason ?? result?.reason_code ?? prepared.reason_code ?? 'STANDARD_HANDOFF_OPERATION_UNCONFIRMED',
      complete_resource_closure: false, permits_handoff: false, permits_effects: false }, evidence_refs: completed ? result.evidence_refs : [] }));
}
