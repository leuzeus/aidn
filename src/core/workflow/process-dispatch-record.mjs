import schema from "../contracts/workflow-definition/process-dispatch-record.v1.schema.json" with { type: "json" };
import schemaV2 from "../contracts/workflow-definition/process-dispatch-record.v2.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { shadowHash, checkShadowJson } from "./shadow-json.mjs";

const fail = () => { throw Object.assign(Error("PROCESS_DISPATCH_RECORD_INVALID"), { code: "PROCESS_DISPATCH_RECORD_INVALID" }); };
export function dispatchRecordPath(id) {
  if (!/^op_[a-f0-9]{40}$/.test(id)) fail();
  return `workflows/dispatch-records/${id}.json`;
}
export function assertProcessDispatchRecord(value) {
  const selected = value?.contract_version === "process-dispatch-record.v2" ? schemaV2 : schema;
  if (checkShadowJson(value) || validateJsonSchema(value, selected, "$", { contractKind: "workflow-definition" }).length) fail();
  if ((value.phase === "returned") !== (value.output !== null) || (value.phase === "returned") !== (value.context_after_sha256 !== null)
    || value.output_sha256 !== (value.output === null ? null : shadowHash(value.output))) fail();
  if (value.contract_version === "process-dispatch-record.v2") {
    const tokens = new Set(), fenceTokens = new Set();
    for (const intention of value.local_owner_intentions) {
      const proposed = intention.resource_fence.record;
      if (tokens.has(intention.owner.token) || fenceTokens.has(proposed.token) || intention.owner.pid !== value.process_identity.pid
        || proposed.state !== "held" || proposed.physical_root_sha256 !== value.physical_root_sha256
        || shadowHash(proposed.process_identity) !== shadowHash(value.process_identity)) fail();
      tokens.add(intention.owner.token);
      fenceTokens.add(proposed.token);
    }
    for (const lease of value.leases) {
      const intention = value.local_owner_intentions.find(row => shadowHash(row.owner) === shadowHash(lease.owner));
      if (!intention || shadowHash(intention.resource_fence.record) !== shadowHash(lease.resource_fence)) fail();
    }
  }
  return value;
}
