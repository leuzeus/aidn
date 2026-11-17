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
// Structural view of the exact interrupted operation only. The owning host
// separately authenticates the record, original receipt, creator, held fence
// and current disposition grant. No stored event or old result is rewritten.
export function handoffPublicationInterruptedPrefix(instance, record) {
  assertAgenticProcessInstance(instance);
  if (record?.phase !== 'receipted' || !Array.isArray(record.results) || !record.results.length || record.results.length > 32
    || record.intent?.binding_ref !== handoffPublicationOperation || record.preview?.binding?.id !== handoffPublicationOperation)
    fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
  const prepared = assertHandoffOperationPreparation(record.preview.prepared);
  if (!prepared.can_apply) fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
  const plan = prepared.plan, inner = decodeHandoffPacketPlan(plan), original = record.results[0];
  const output = assertHandoffOperationOutput(original.output), receipt = original.receipt;
  if (output.outcome !== 'reconciliation_required' || output.effect_status !== 'unknown'
    || output.observations.plan_sha256 !== prepared.plan_sha256
    || output.observations.packet_plan_sha256 !== plan.packet_plan_sha256
    || output.observations.resource_material_sha256 !== inner.resource_material_sha256
    || receipt?.operation_id !== record.operation_id || receipt.intent_sha256 !== H(record.intent)
    || receipt.output_sha256 !== H(output) || receipt.outcome !== output.outcome
    || receipt.effect_status !== output.effect_status || H(receipt.facts) !== H(output.facts)
    || record.intent.occurrence_id !== plan.occurrence_id || H(record.preview.input) !== H(plan.input))
    fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
  for (const [index, row] of record.results.entries()) {
    const out = assertHandoffOperationOutput(row.output), rec = row.receipt;
    if (rec?.operation_id !== record.operation_id || rec.intent_sha256 !== H(record.intent)
      || rec.output_sha256 !== H(out) || rec.outcome !== out.outcome || rec.effect_status !== out.effect_status
      || H(rec.facts) !== H(out.facts) || out.observations.plan_sha256 !== prepared.plan_sha256
      || out.observations.packet_plan_sha256 !== plan.packet_plan_sha256
      || out.observations.resource_material_sha256 !== inner.resource_material_sha256
      || rec.receipt_id !== 'receipt_' + record.operation_id.slice(3) + (index ? '_' + index : '')
      || index < record.results.length - 1 && out.outcome !== 'reconciliation_required'
      || !['completed','reconciliation_required'].includes(out.outcome)
      || out.outcome === 'completed' && out.observations.packet_sha256 !== inner.after_sha256)
      fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
  }
  const own = instance.events.map((event,index) => ({event,index})).filter(row => row.event.kind === 'operation_intent'
    && row.event.intent.operation_id === record.operation_id);
  if (own.length !== 1 || H(own[0].event.intent) !== H(record.intent)) fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
  const accepted = instance.events.slice(own[0].index + 1);
  let next = 0;
  for (const event of accepted) {
    if (event.kind !== 'operation_result' || event.occurrence_id !== record.intent.occurrence_id)
      fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
    const matched = record.results.findIndex((row,index) => index >= next && H(row.receipt) === H(event.receipt));
    if (event.kind !== 'operation_result' || event.occurrence_id !== record.intent.occurrence_id
      || matched < 0 || next === 0 && matched !== 0) fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
    next = matched + 1;
  }
  const { instance_sha256, ...body } = instance;
  body.events = body.events.slice(0, own[0].index + 1); body.revision -= accepted.length;
  const pending = { ...body, instance_sha256: H(body) }; assertAgenticProcessInstance(pending);
  const prefix = handoffPublicationIntentPrefix(pending, { ...record, phase: 'dispatching', results: [] });
  if (prefix.instance_sha256 !== inner.context.instance_sha256)
    fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
  return prefix;
}

// Structural view for an original unreturned dispatch only. The fixed host must
// authenticate its immutable running capsule, absent original output, actual
// producer death and held owner before selecting this reader. Results here are
// genuine controller confirmations; no original result or receipt is invented.
export function handoffPublicationUnreturnedPrefix(instance, record) {
  assertAgenticProcessInstance(instance);
  if (!Array.isArray(record?.results) || record.results.length > 31
    || record.phase !== (record.results.length ? 'receipted' : 'dispatching')
    || record.intent?.binding_ref !== handoffPublicationOperation || record.preview?.binding?.id !== handoffPublicationOperation)
    fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
  const prepared = assertHandoffOperationPreparation(record.preview.prepared);
  if (!prepared.can_apply) fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
  const plan = prepared.plan, inner = decodeHandoffPacketPlan(plan);
  if (record.intent.occurrence_id !== plan.occurrence_id || H(record.preview.input) !== H(plan.input))
    fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
  for (const [index, row] of record.results.entries()) {
    const out = assertHandoffOperationOutput(row.output), rec = row.receipt;
    if (rec?.operation_id !== record.operation_id || rec.intent_sha256 !== H(record.intent)
      || rec.output_sha256 !== H(out) || rec.outcome !== out.outcome || rec.effect_status !== out.effect_status
      || H(rec.facts) !== H(out.facts) || out.observations.plan_sha256 !== prepared.plan_sha256
      || out.observations.packet_plan_sha256 !== plan.packet_plan_sha256
      || out.observations.resource_material_sha256 !== inner.resource_material_sha256
      || rec.receipt_id !== 'receipt_' + record.operation_id.slice(3) + (index ? '_' + index : '')
      || index < record.results.length - 1 && out.outcome !== 'reconciliation_required'
      || !['completed','reconciliation_required'].includes(out.outcome)
      || out.outcome === 'completed' && out.observations.packet_sha256 !== inner.after_sha256)
      fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
  }
  const own = instance.events.map((event,index) => ({event,index})).filter(row => row.event.kind === 'operation_intent'
    && row.event.intent.operation_id === record.operation_id);
  if (own.length !== 1 || H(own[0].event.intent) !== H(record.intent)) fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
  const accepted = instance.events.slice(own[0].index + 1);
  let next = 0;
  for (const event of accepted) {
    if (event.kind !== 'operation_result' || event.occurrence_id !== record.intent.occurrence_id)
      fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
    const matched = record.results.findIndex((row,index) => index >= next && H(row.receipt) === H(event.receipt));
    if (event.kind !== 'operation_result' || event.occurrence_id !== record.intent.occurrence_id
      || matched < 0) fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
    next = matched + 1;
  }
  const { instance_sha256, ...body } = instance;
  body.events = body.events.slice(0, own[0].index + 1); body.revision -= accepted.length;
  const pending = { ...body, instance_sha256: H(body) }; assertAgenticProcessInstance(pending);
  const prefix = handoffPublicationIntentPrefix(pending, { ...record, phase: 'dispatching', results: [] });
  if (prefix.instance_sha256 !== inner.context.instance_sha256)
    fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
  return prefix;
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
