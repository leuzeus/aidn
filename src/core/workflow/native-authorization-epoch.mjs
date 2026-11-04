import authorizationSchema from "../contracts/workflow-definition/native-authorization.v1.schema.json" with { type: "json" };
import requestSchema from "../contracts/workflow-definition/native-authorization-epoch-request.v1.schema.json" with { type: "json" };
import initialRequestSchema from "../contracts/workflow-definition/native-authorization-epoch-request.v2.schema.json" with { type: "json" };
import grantSchema from "../contracts/workflow-definition/native-authorization-epoch-grant.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const valid = (value, schema, code) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length) fail(code);
  return value;
};
export const nativeLimitKeys = ["configuration_sha256", "authorized_at_ms", "global_deadline_ms", "workflow_deadline_ms", "max_turn_ms", "max_responses", "max_bytes"];
export const nativeLimitsOf = auth => Object.fromEntries(nativeLimitKeys.map(key => [key, auth[key]]));
export function assertNativeAuthorization(value) {
  valid(value, authorizationSchema, "NATIVE_EPOCH_AUTHORIZATION_INVALID");
  if (value.authorized_at_ms >= value.workflow_deadline_ms || value.workflow_deadline_ms > value.global_deadline_ms
    || value.global_deadline_ms - value.authorized_at_ms > 10800000) fail("NATIVE_EPOCH_AUTHORIZATION_INVALID");
  return value;
}
export function nativeAllocationTotals(entries) {
  if (entries.some(entry => entry.phase !== "closed" || !entry.consumption)) return { known: false, responses: null, bytes: null };
  return { known: true, responses: entries.reduce((sum, entry) => sum + entry.consumption.responses_observed, 0),
    bytes: entries.reduce((sum, entry) => sum + entry.consumption.storage_debit_bytes, 0) };
}
export function assertNativeEpochRequest(value) {
  valid(value, value?.contract_version === "native-authorization-epoch-request.v2" ? initialRequestSchema : requestSchema, "NATIVE_EPOCH_REQUEST_INVALID"); assertNativeAuthorization(value.initial_authorization);
  if (value.expires_at_ms - value.issued_at_ms !== 300000 || value.resources.length !== new Set(value.resources.map(shadowHash)).size
    || value.configuration_sha256 !== value.initial_authorization.configuration_sha256) fail("NATIVE_EPOCH_REQUEST_INVALID");
  return value;
}
export function assertNativeEpochGrant(value, request) {
  valid(value, grantSchema, "NATIVE_EPOCH_GRANT_INVALID"); assertNativeAuthorization(value.authorization);
  const closure = value.closure, counts = request.consumption;
  if (value.request_sha256 !== shadowHash(request) || closure.request_sha256 !== shadowHash(request)
    || closure.inventory_sha256 !== shadowHash(request.resources) || closure.resources.length !== request.resources.length
    || shadowHash(closure.resources.map(row => row.resource_sha256).sort()) !== shadowHash(request.resources.map(shadowHash).sort())
    || value.authorization.configuration_sha256 !== request.configuration_sha256
    || value.authorization.authorized_at_ms < request.issued_at_ms || value.authorization.authorized_at_ms > closure.observed_at_ms
    || closure.observed_at_ms >= request.expires_at_ms || closure.observed_at_ms < request.issued_at_ms
    || value.authorization.max_responses <= counts.responses || value.authorization.max_bytes - counts.bytes < 1048576)
    fail("NATIVE_EPOCH_GRANT_UNBOUND");
  return value;
}
export function assertNativeEpochHistory(record) {
  assertNativeAuthorization(record.initial_authorization);
  const first = record.allocations[0], initialEntry = record.contract_version === "native-allocation-journal.v3";
  if (!initialEntry && (shadowHash(record.initial_authorization) !== first.authorization_sha256
    || shadowHash(nativeLimitsOf(record.initial_authorization)) !== shadowHash(first.limits))) fail("NATIVE_EPOCH_ORIGINAL_AUTHORIZATION_CHANGED");
  if (initialEntry && (record.origin_journal !== null || record.epochs[0].start_generation !== 1
    || record.epochs[0].request.contract_version !== "native-authorization-epoch-request.v2"
    || record.epochs[0].request.journal_sha256 !== shadowHash(null)
    || record.epochs[0].request.issued_at_ms < Math.min(record.initial_authorization.global_deadline_ms, record.initial_authorization.workflow_deadline_ms)))
    fail("NATIVE_EPOCH_INITIAL_ORIGIN_INVALID");
  let previousStart = 1, previous = null;
  const sources = new Set();
  for (const [index, epoch] of record.epochs.entries()) {
    const request = assertNativeEpochRequest(epoch.request), grant = assertNativeEpochGrant(epoch.grant, request);
    const prefix = record.allocations.slice(0, epoch.start_generation - 1), consumption = nativeAllocationTotals(prefix);
    const sourceId = shadowHash([grant.authority_id, grant.source_event_id]);
    if (epoch.epoch !== index + 2 || request.epoch !== epoch.epoch || request.next_generation !== epoch.start_generation
      || epoch.start_generation < previousStart || epoch.start_generation > record.allocations.length + 1
      || request.instance_id !== record.instance_id || request.scope_id !== record.scope_id || request.model_sha256 !== record.model_sha256
      || request.configuration_sha256 !== record.initial_authorization.configuration_sha256 || shadowHash(request.initial_authorization) !== shadowHash(record.initial_authorization)
      || request.allocations_sha256 !== shadowHash(prefix) || !consumption.known || shadowHash(request.consumption) !== shadowHash(consumption)
      || request.previous_epoch_sha256 !== (previous === null ? null : shadowHash(previous)) || sources.has(sourceId)) fail("NATIVE_EPOCH_HISTORY_INVALID");
    if (!prefix.length && (!initialEntry || request.contract_version !== "native-authorization-epoch-request.v2"
      || shadowHash(request.resources) !== shadowHash([nativeInitialScope(request)]))) fail("NATIVE_EPOCH_INITIAL_INVENTORY_INVALID");
    sources.add(sourceId); previous = epoch; previousStart = epoch.start_generation;
  }
  return record;
}
export const nativeInitialScope = value => ({ kind: "native_scope", instance_id: value.instance_id, scope_id: value.scope_id, configuration_sha256: value.configuration_sha256 });
export const nativeEpochForGeneration = (record, generation) => record.epochs?.findLast(row => row.start_generation <= generation) ?? null;
export function effectiveNativeEpochAuthorization(record, authorization) {
  const active = record.epochs.at(-1);
  if (shadowHash(authorization) !== shadowHash(active.grant.authorization)) fail("NATIVE_EPOCH_EXACT_GRANT_REQUIRED");
  const totals = nativeAllocationTotals(record.allocations);
  if (!totals.known) fail("NATIVE_ALLOCATION_CONSUMPTION_UNKNOWN");
  return { ...authorization, max_responses: authorization.max_responses - totals.responses, max_bytes: authorization.max_bytes - totals.bytes };
}
