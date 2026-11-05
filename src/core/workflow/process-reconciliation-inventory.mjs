import schema from "../contracts/workflow-definition/process-reconciliation-inventory.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson } from "./shadow-json.mjs";

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
