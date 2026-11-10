import schema from "../contracts/workflow-definition/process-reconciliation-inventory.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import ownerSchema from "../contracts/workflow-definition/process-owner-observation.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(new Error(code), { code }); };
export const RECONCILIATION_DISCOVERY_DOMAINS = Object.freeze(["deterministic", "native", "human", "control", "process", "git", "provider"]);

// A complete retained inventory is only the starting observation. It cannot
// attest independent external discovery, closure, absence of an effect, fresh
// consent, or a refund. Unknown accounting always retains its observed minimum.
export function assertProcessReconciliationInventory(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length)
    fail("PROCESS_RECONCILIATION_INVENTORY_INVALID");
  if (new Set(value.resources.map(row => row.ref)).size !== value.resources.length
    || value.discovery.length !== RECONCILIATION_DISCOVERY_DOMAINS.length
    || value.discovery.some((row, index) => row.domain !== RECONCILIATION_DISCOVERY_DOMAINS[index])
    || value.accounting.native_known !== (value.accounting.unresolved_native_allocations === 0)
    || value.operations.length !== new Set(value.operations.map(row => row.operation_id)).size
    || value.operations.some(row => row.results.length && row.phase !== "receipted" || !row.results.length && row.phase === "receipted"))
    fail("PROCESS_RECONCILIATION_INVENTORY_INVALID");
  return value;
}

// The observation covers one original process identity. It is deliberately
// incapable of certifying its tree, an effect or authority to recover.
export function assertProcessOwnerObservation(value, inventory) {
  assertProcessReconciliationInventory(inventory);
  if (checkShadowJson(value) || validateJsonSchema(value, ownerSchema, "$", { contractKind: "workflow-definition" }).length)
    fail("PROCESS_OWNER_OBSERVATION_INVALID");
  const operation = inventory.operations.find(row => row.operation_id === value.operation_id);
  const dispatch = inventory.resources.find(row => row.ref === "dispatch:" + value.operation_id);
  const identity = dispatch?.details.process_identity;
  if (value.instance_id !== inventory.instance_id || value.instance_sha256 !== inventory.instance_sha256
    || value.key_id !== inventory.key_id || value.observed_at_ms !== inventory.observed_at_ms
    || value.first_sample_started_at_ms > value.last_sample_completed_at_ms || value.last_sample_completed_at_ms > value.observed_at_ms
    || value.inventory_sha256 !== shadowHash(inventory)
    || operation?.effect_status !== "unknown" || operation.record_sha256 !== value.operation_record_sha256
    || value.dispatch_sha256 !== (dispatch?.sha256 ?? null)
    || value.process_identity_sha256 !== (identity ? shadowHash(identity) : null)
    || (dispatch && (dispatch.kind !== "local_evidence" || !identity || identity.pid !== operation.owner?.pid))
    || (!dispatch && value.owner_status !== "unresolved"))
    fail("PROCESS_OWNER_OBSERVATION_SUBJECT_CHANGED");
  return value;
}
