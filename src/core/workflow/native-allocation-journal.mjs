import schema from "../contracts/workflow-definition/native-allocation-journal.v1.schema.json" with { type: "json" };
import schemaV2 from "../contracts/workflow-definition/native-allocation-journal.v2.schema.json" with { type: "json" };
import schemaV3 from "../contracts/workflow-definition/native-allocation-journal.v3.schema.json" with { type: "json" };
import { assertNativeEpochHistory, nativeEpochForGeneration, nativeAllocationTotals, nativeLimitsOf } from "./native-authorization-epoch.mjs";
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { assertNativeHostState } from "./native-host-state.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const nativeJournalId = ({ instance_id, scope_id }) => "native_" + shadowHash({ instance_id, scope_id }).slice(0, 40);
export function nativeJournalPath(id) {
  if (!/^native_[a-f0-9]{40}$/.test(id)) fail("NATIVE_ALLOCATION_ID_INVALID");
  return `workflows/native-allocations/${id}.json`;
}
export function assertNativeAllocationJournal(value) {
  const epochs = value?.contract_version === "native-allocation-journal.v2";
  const initialEpoch = value?.contract_version === "native-allocation-journal.v3";
  if (checkShadowJson(value) || validateJsonSchema(value, initialEpoch ? schemaV3 : epochs ? schemaV2 : schema, "$", { contractKind: "workflow-definition" }).length) fail("NATIVE_ALLOCATION_JOURNAL_INVALID");
  if (initialEpoch) assertNativeEpochHistory(value);
  if (epochs) {
    const { initial_authorization, origin_journal, epochs: history, ...legacy } = value;
    // Same allocation schema, without changing the historical v1 revision cap.
    if (validateJsonSchema({ ...legacy, contract_version: "native-allocation-journal.v1", revision: Math.min(value.revision, 64) }, schema, "$", { contractKind: "workflow-definition" }).length)
      fail("NATIVE_ALLOCATION_JOURNAL_INVALID");
    assertNativeEpochHistory(value);
    assertNativeAllocationJournal(origin_journal);
    if (origin_journal.contract_version !== "native-allocation-journal.v1"
      || shadowHash(origin_journal) !== history[0].request.journal_sha256
      || origin_journal.instance_id !== value.instance_id || origin_journal.scope_id !== value.scope_id || origin_journal.model_sha256 !== value.model_sha256
      || shadowHash(origin_journal.allocations) !== history[0].request.allocations_sha256) fail("NATIVE_EPOCH_ORIGINAL_JOURNAL_CHANGED");
  }
  if (value.journal_id !== nativeJournalId(value)) fail("NATIVE_ALLOCATION_SCOPE_CHANGED");
  for (const [index, entry] of value.allocations.entries()) {
    if (entry.generation !== index + 1 || entry.limits.configuration_sha256 !== entry.configuration_sha256
      || entry.limits.workflow_deadline_ms > entry.limits.global_deadline_ms || entry.limits.authorized_at_ms >= entry.limits.global_deadline_ms) fail("NATIVE_ALLOCATION_GENERATION_INVALID");
    if (index < value.allocations.length - 1 && entry.phase !== "closed") fail("NATIVE_ALLOCATION_PREDECESSOR_UNRESOLVED");
    if (entry.phase === "reserved" && ([entry.owned_result_sha256, entry.tree_proof_sha256, entry.checkpoint, entry.closure_ref,
      entry.consumption, entry.owned_status, entry.first_failure].some(item => item !== null) || entry.tree_closed)) fail("NATIVE_ALLOCATION_RESERVATION_INVALID");
    if (entry.phase !== "reserved" && (entry.owned_status === null || entry.owned_result_sha256 === null || entry.tree_proof_sha256 === null)) fail("NATIVE_ALLOCATION_OBSERVATION_MISSING");
    if (entry.phase === "closed" && (!entry.tree_closed || entry.first_failure !== null || entry.owned_status === "FAILED"
      || entry.checkpoint === null || entry.closure_ref === null || entry.consumption === null)) fail("NATIVE_ALLOCATION_CLOSURE_UNCONFIRMED");
    if (entry.consumption && (entry.consumption.responses_observed !== entry.consumption.response_sha256.length
      || new Set(entry.consumption.response_sha256).size !== entry.consumption.response_sha256.length)) fail("NATIVE_ALLOCATION_CONSUMPTION_INVALID");
    if (entry.phase === "closed" && (entry.consumption.responses_observed > entry.limits.max_responses
      || entry.consumption.storage_debit_bytes > entry.limits.max_bytes)) fail("NATIVE_ALLOCATION_CONSUMPTION_EXCEEDS_LIMIT");
    const epoch = nativeEpochForGeneration(value, entry.generation);
    if (epoch) {
      const totals = nativeAllocationTotals(value.allocations.slice(0, index)), grant = epoch.grant.authorization;
      const effective = { ...grant, max_responses: grant.max_responses - totals.responses, max_bytes: grant.max_bytes - totals.bytes };
      if (!totals.known || shadowHash(entry.limits) !== shadowHash(nativeLimitsOf(effective))
        || entry.authorization_sha256 !== shadowHash(effective)) fail("NATIVE_EPOCH_ALLOCATION_UNBOUND");
    } else if (index) {
      const ceiling = value.allocations[0].limits;
      if (["max_responses", "max_bytes", "max_turn_ms", "global_deadline_ms", "workflow_deadline_ms"].some(key => entry.limits[key] > ceiling[key])) fail("NATIVE_ALLOCATION_LIMIT_INCREASE_UNAUTHORIZED");
    }
  }
  return value;
}
export function assertNativeCheckpointEvidence(value, { instanceId, scopeId, modelSha256, authorizationSha256, limits }) {
  const fields = ["state", "response_sha256", "responses_observed", "authorized_budget_sha256", "authorized_limits", "resume_authority"];
  if (checkShadowJson(value) || !value || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))
    || !Array.isArray(value.response_sha256) || value.response_sha256.length > 120 || value.response_sha256.some(item => !digest(item))
    || value.responses_observed !== value.response_sha256.length || new Set(value.response_sha256).size !== value.response_sha256.length
    || value.authorized_budget_sha256 !== authorizationSha256 || shadowHash(value.authorized_limits) !== shadowHash(limits)
    || value.resume_authority !== "NOT_ESTABLISHED_SUPERVISOR_AND_AUTHENTICATED_JOURNAL_REQUIRED") fail("NATIVE_ALLOCATION_CHECKPOINT_INVALID");
  assertNativeHostState(value.state);
  if (value.state.instance.instance_id !== instanceId || value.state.instance.scope_id !== scopeId || value.state.instance.model_sha256 !== modelSha256) fail("NATIVE_ALLOCATION_CHECKPOINT_FOREIGN");
  return value;
}
