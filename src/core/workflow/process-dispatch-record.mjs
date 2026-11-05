import schema from "../contracts/workflow-definition/process-dispatch-record.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { shadowHash, checkShadowJson } from "./shadow-json.mjs";

const fail = () => { throw Object.assign(Error("PROCESS_DISPATCH_RECORD_INVALID"), { code: "PROCESS_DISPATCH_RECORD_INVALID" }); };
export function dispatchRecordPath(id) {
  if (!/^op_[a-f0-9]{40}$/.test(id)) fail();
  return `workflows/dispatch-records/${id}.json`;
}
export function assertProcessDispatchRecord(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length) fail();
  if ((value.phase === "returned") !== (value.output !== null) || (value.phase === "returned") !== (value.context_after_sha256 !== null)
    || value.output_sha256 !== (value.output === null ? null : shadowHash(value.output))) fail();
  return value;
}
