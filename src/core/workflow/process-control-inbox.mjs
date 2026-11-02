import requestSchema from "../contracts/workflow-definition/process-control-request.v1.schema.json" with { type: "json" };
import sourceSchema from "../contracts/workflow-definition/process-control-source.v1.schema.json" with { type: "json" };
import inboxSchema from "../contracts/workflow-definition/process-control-inbox.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { assertProcessControlEvent } from "./process-operation-contracts.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
function schema(value, definition, code) {
  if (checkShadowJson(value) || validateJsonSchema(value, definition, "$", { contractKind: "workflow-definition" }).length) fail(code);
  return value;
}
export function assertControlRequest(value) {
  schema(value, requestSchema, "PROCESS_CONTROL_REQUEST_INVALID");
  if (new Set(value.event_keys).size !== value.event_keys.length) fail("PROCESS_CONTROL_REQUEST_INVALID");
  return value;
}
export function assertControlSource(value, request) {
  schema(value, sourceSchema, "PROCESS_CONTROL_SOURCE_INVALID"); assertControlRequest(request);
  if (value.request_sha256 !== shadowHash(request) || !request.event_keys.includes(value.event_key)) fail("PROCESS_CONTROL_SOURCE_BINDING_CHANGED");
  return value;
}
export const controlInboxId = source => "control_" + shadowHash({ authority_id: source.authority_id,
  source_kind: source.source_kind, source_event_id: source.source_event_id }).slice(0, 40);
export function controlInboxPath(id) {
  if (!/^control_[a-f0-9]{40}$/.test(id)) fail("PROCESS_CONTROL_INBOX_ID_INVALID");
  return `workflows/control-inbox/${id}.json`;
}
export function controlDelivery(request, source) {
  assertControlSource(source, request);
  const { contract_version, event_keys, context_sha256, branch, head, ...context } = request;
  return { contract_version: "process-control-event.v1", delivery_id: controlInboxId(source), ...context,
    authority_id: source.authority_id, source_kind: source.source_kind, source_event_id: source.source_event_id,
    subject_sha256: source.subject_sha256, event_key: source.event_key, payload_sha256: source.payload_sha256,
    evidence_refs: structuredClone(source.evidence_refs) };
}
export function assertControlInbox(value) {
  schema(value, inboxSchema, "PROCESS_CONTROL_INBOX_INVALID");
  assertControlSource(value.source, value.request);
  if (value.inbox_id !== controlInboxId(value.source) || shadowHash(value.delivery) !== shadowHash(controlDelivery(value.request, value.source))
    || (value.phase === "delivered") !== (value.delivered_instance_sha256 !== null)) fail("PROCESS_CONTROL_INBOX_BINDING_CHANGED");
  assertProcessControlEvent(value.delivery, { instance: { ...value.request, instance_sha256: value.request.instance_sha256, revision: value.request.instance_revision },
    occurrence: value.request });
  return value;
}
