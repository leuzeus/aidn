import bindingSchema from "../contracts/workflow-definition/process-operation-binding.v1.schema.json" with { type: "json" };
import intentSchema from "../contracts/workflow-definition/process-operation-intent.v1.schema.json" with { type: "json" };
import receiptSchema from "../contracts/workflow-definition/process-operation-receipt.v1.schema.json" with { type: "json" };
import controlSchema from "../contracts/workflow-definition/process-control-event.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
function assertSchema(value, schema, code) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length) fail(code);
}
export function assertProcessOperationBinding(value) {
  assertSchema(value, bindingSchema, "PROCESS_OPERATION_BINDING_INVALID");
  if (value.skill_id !== null && !/^[a-z][a-z0-9_-]{0,63}$/.test(value.skill_id)
    || [value.rule_refs, value.allowed_modes].some(items => new Set(items).size !== items.length)) fail("PROCESS_OPERATION_BINDING_INVALID");
  return value;
}
export function assertProcessOperationIntent(value, { instance, node, occurrenceId, revision = instance.revision, expectedInstanceSha256 = instance.instance_sha256, model = instance.model } = {}) {
  assertSchema(value, intentSchema, "PROCESS_OPERATION_INTENT_INVALID");
  if (node.kind !== "operation" || value.binding_ref !== node.binding_ref || value.scope_id !== instance.scope_id
    || value.instance_revision !== revision || value.binding_sha256 !== model.operation_pins?.[node.binding_ref]
    || value.instance_id !== instance.instance_id || value.instance_sha256 !== expectedInstanceSha256
    || value.model_sha256 !== instance.model_sha256 || value.occurrence_id !== occurrenceId) fail("PROCESS_OPERATION_INTENT_BINDING_CHANGED");
  return value;
}
export function assertProcessOperationReceipt(value, intent) {
  assertSchema(value, receiptSchema, "PROCESS_OPERATION_RECEIPT_INVALID");
  if (value.operation_id !== intent.operation_id || value.intent_sha256 !== shadowHash(intent)
    || value.authority_id !== intent.authority_id) fail("PROCESS_OPERATION_RECEIPT_BINDING_CHANGED");
  if (Object.keys(value.facts).some(key => !/^[a-z][a-z0-9_-]{0,63}$/.test(key))
    || value.outcome !== "completed" && Object.keys(value.facts).length) fail("PROCESS_OPERATION_FACTS_INVALID");
  if ((value.outcome === "reconciliation_required") !== (value.effect_status === "unknown")
    || ["blocked", "deferred"].includes(value.outcome) && value.effect_status !== "no_effect") fail("PROCESS_OPERATION_EFFECT_INVALID");
  return value;
}
export function assertProcessControlEvent(value, { instance, occurrence, revision = instance.revision, expectedInstanceSha256 = instance.instance_sha256 }) {
  assertSchema(value, controlSchema, "PROCESS_CONTROL_INVALID");
  if (value.instance_id !== instance.instance_id || value.scope_id !== instance.scope_id || value.instance_revision !== revision
    || value.occurrence_id !== occurrence.occurrence_id || value.correlation_id !== occurrence.correlation_id
    || value.instance_sha256 !== expectedInstanceSha256 || value.model_sha256 !== instance.model_sha256) fail("PROCESS_CONTROL_BINDING_CHANGED");
  return value;
}
