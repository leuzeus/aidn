import { createHash } from "node:crypto";
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import schema from "../contracts/context/agent-working-memory.v1.schema.json" with { type: "json" };

export const sha256 = value => createHash("sha256").update(value).digest("hex");
export const memoryFailure = code => { throw Object.assign(new Error(code), { code }); };

export function stableContextJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableContextJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${stableContextJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function validateWorkingMemory(memory) {
  if (validateJsonSchema(memory, schema, "$", { contractKind: "context" }).length) memoryFailure("WORKING_MEMORY_INPUT_INVALID");
  const refs = new Set(memory.evidence_refs.map(e => e.ref));
  const claims = [...memory.decisions, ...(memory.verified_facts ?? []), ...(memory.dead_ends ?? []),
    ...(memory.recent_test_results ?? []), ...(memory.tool_output_summaries ?? [])];
  if (refs.size !== memory.evidence_refs.length || claims.some(d => d.evidence_refs.some(ref => !refs.has(ref)))) {
    memoryFailure("WORKING_MEMORY_EVIDENCE_LINK_INVALID");
  }
  if (memory.execution_result_ref && !refs.has(memory.execution_result_ref)) memoryFailure("WORKING_MEMORY_EVIDENCE_LINK_INVALID");
}

export function canCaptureWorkingMemory(checkpoint, admission) {
  return checkpoint.ok === true && checkpoint.reload?.decision !== "stop" && checkpoint.gate?.result === "ok"
    && checkpoint.gate?.skip_reason !== "SKIPPED_BY_CHECKPOINT_OPTION"
    && checkpoint.index_sync_check?.in_sync !== false
    && admission?.activation?.active === true && admission?.ok === true
    && ["admitted", "admitted_with_warnings"].includes(admission.admission_status);
}
