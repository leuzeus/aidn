import requestSchema from "../contracts/workflow-definition/process-control-request.v1.schema.json" with { type: "json" };
import sourceSchema from "../contracts/workflow-definition/process-control-source.v1.schema.json" with { type: "json" };
import inboxSchema from "../contracts/workflow-definition/process-control-inbox.v1.schema.json" with { type: "json" };
import inboxV2 from "../contracts/workflow-definition/process-control-inbox.v2.schema.json" with { type: "json" };
import inboxV3 from "../contracts/workflow-definition/process-control-inbox.v3.schema.json" with { type: "json" };
import reservationSchema from "../contracts/workflow-definition/process-control-reservation.v1.schema.json" with { type: "json" };
import { assertExternalMergeControl, externalMergeControlRef, externalMergeEventKey } from "./standard-pr-external-merge.mjs";
import reviewPayloadSchema from "../contracts/workflow-definition/standard-session-pr-review-content-output.v1.schema.json" with { type: "json" };
import eventSchema from "../contracts/workflow-definition/github-pr-review-event.v1.schema.json" with { type: "json" };
import payloadSchema from "../contracts/workflow-definition/process-pr-review-payload.v1.schema.json" with { type: "json" };
import { createHash } from "node:crypto";
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
// Both source types arbitrate the same durable occurrence before a source-keyed
// capture is written. The source-keyed record still prevents cross-wait reuse.
export const controlReservationId = ({ scope_id, instance_id, model_sha256, occurrence_id }) =>
  "control_" + shadowHash({ kind: "review-wait", scope_id, instance_id, model_sha256, occurrence_id }).slice(0, 40);

export function assertControlInbox(value) {
  if (value?.contract_version === "process-control-reservation.v1") {
    schema(value, reservationSchema, "PROCESS_CONTROL_INBOX_INVALID");
    assertControlRequest(value.request);
    if (!value.request.event_keys.includes(externalMergeEventKey) || value.inbox_id !== controlReservationId(value.request)
      || value.capture_id === value.inbox_id) fail("PROCESS_CONTROL_INBOX_BINDING_CHANGED");
    return value;
  }
  schema(value, value?.contract_version === "process-control-inbox.v3" ? inboxV3
    : value?.contract_version === "process-control-inbox.v2" ? inboxV2 : inboxSchema, "PROCESS_CONTROL_INBOX_INVALID");
  assertControlSource(value.source, value.request);
  if (value.contract_version === "process-control-inbox.v2") assertControlReviewPayload(value.payload, value.source, value.request);
  if (value.contract_version === "process-control-inbox.v3") {
    if (value.source_ref !== externalMergeControlRef) fail("PROCESS_CONTROL_INBOX_BINDING_CHANGED");
    assertExternalMergeControl(value.payload, value.source, value.request);
  }
  if (value.inbox_id !== controlInboxId(value.source) || shadowHash(value.delivery) !== shadowHash(controlDelivery(value.request, value.source))
    || (value.phase === "delivered") !== (value.delivered_instance_sha256 !== null)) fail("PROCESS_CONTROL_INBOX_BINDING_CHANGED");
  assertProcessControlEvent(value.delivery, { instance: { ...value.request, instance_sha256: value.request.instance_sha256, revision: value.request.instance_revision },
    occurrence: value.request });
  return value;
}

// A v2 record retains the complete provider evidence before reducer delivery.
// It is a new explicit capture format; v1 claims are never upgraded on read.
export function assertControlReviewPayload(value, source, request) {
  schema(value, payloadSchema, "PROCESS_CONTROL_REVIEW_PAYLOAD_INVALID");
  const { observation, event } = value;
  schema(observation, reviewPayloadSchema, "PROCESS_CONTROL_REVIEW_PAYLOAD_INVALID");
  assertControlReviewEvent(event);
  assertControlSource(source, request);
  if (observation.outcome !== "completed" || source.source_kind !== "external"
    || !["review_snapshot", "checks_snapshot"].includes(source.event_key)
    || event.event_key !== source.event_key || event.source_event_id !== source.source_event_id
    || event.authority_id !== source.authority_id || shadowHash(event.actor) !== source.subject_sha256
    || source.payload_sha256 !== shadowHash(value)) fail("PROCESS_CONTROL_REVIEW_PAYLOAD_INVALID");
  const { evidence, threads, head_oid, base_oid } = observation.observations, p = evidence.pull_request, t = threads.pull_request;
  if (request.head !== head_oid || p.head_oid !== head_oid || t.head_oid !== head_oid
    || p.base_oid !== base_oid || t.base_oid !== base_oid || request.branch !== p.head_ref || t.head_ref !== p.head_ref
    || p.base_ref !== t.base_ref || p.node_id !== t.node_id || p.number !== t.number
    || p.state !== "OPEN" || t.state !== "OPEN" || p.is_draft || t.is_draft
    || shadowHash(evidence.repository) !== shadowHash(threads.repository)
    || event.repository_id !== evidence.repository.node_id || event.pull_request_id !== p.node_id || event.pull_request_number !== p.number
    || event.head_oid !== head_oid || event.base_oid !== base_oid || event.head_ref !== p.head_ref || event.base_ref !== p.base_ref)
    fail("PROCESS_CONTROL_REVIEW_PAYLOAD_INVALID");
  const { repository, pull_request, reviews, checks, rollup_state } = evidence;
  if (evidence.evidence_sha256 !== shadowHash({ repository, pull_request, reviews, checks, rollup_state })
    || threads.observation_sha256 !== shadowHash({ repository: threads.repository, pull_request: t, threads: threads.threads }))
    fail("PROCESS_CONTROL_REVIEW_PAYLOAD_INVALID");
  const sha = text => createHash("sha256").update(text, "utf8").digest("hex");
  for (const rows of [reviews, threads.threads.flatMap(row => row.comments)]) {
    let bytes = 0;
    for (const row of rows) {
      const text = row.body_chunks.join(""), size = Buffer.byteLength(text); bytes += size;
      if (size > 65536 || sha(text) !== row.body_sha256) fail("PROCESS_CONTROL_REVIEW_PAYLOAD_INVALID");
    }
    if (bytes > 1048576) fail("PROCESS_CONTROL_REVIEW_PAYLOAD_INVALID");
  }
  return value;
}

export const assertControlReviewEvent = value => schema(value, eventSchema, "PROCESS_CONTROL_REVIEW_EVENT_INVALID");
