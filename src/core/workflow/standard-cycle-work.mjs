import schema from "../contracts/workflow-definition/standard-cycle-work-report.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
const fail = code => { throw Object.assign(new Error(code), { code }); };
export const CYCLE_WORK_CONTRACT = "standard-cycle-work-report.v1";
export function assertStandardCycleWorkReport(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length
    || Buffer.byteLength(JSON.stringify(value)) > 65536 || new Set(value.changes.map(row => row.path.toLowerCase())).size !== value.changes.length
    || [value.task, ...value.notes].some(text => text !== text.replace(/\s+/gu, " ").trim())) fail("STANDARD_CYCLE_WORK_REPORT_INVALID");
  return value;
}
export function assertWorkProductSnapshot(files) {
  if (checkShadowJson(files) || !Array.isArray(files) || !files.length || files.length > 64
    || new Set(files.map(row => row.path?.toLowerCase())).size !== files.length) fail("STANDARD_CYCLE_WORK_SNAPSHOT_INVALID");
  for (const row of files) if (!row || typeof row.path !== "string" || !row.path || row.path.length > 192 || /[:\\\0]/.test(row.path)
    || row.path.split("/").some(part => !part || [".", ".."].includes(part)) || typeof row.present !== "boolean"
    || Object.keys(row).sort().join(",") !== (row.present ? "bytes,path,present,sha256" : "path,present")
    || row.present && (!Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > 1048576 || !/^[a-f0-9]{64}$/.test(row.sha256))) fail("STANDARD_CYCLE_WORK_SNAPSHOT_INVALID");
  return files;
}
export function observeStandardCycleWork({ report, context, contextSha256, after, boundarySha256, producer, evidenceRefs }) {
  assertStandardCycleWorkReport(report); assertWorkProductSnapshot(context.product_snapshot); assertWorkProductSnapshot(after);
  if (shadowHash(context) !== contextSha256 || report.context_sha256 !== contextSha256 || report.task !== context.task.task
    || context.source_context.cycle_state !== "IMPLEMENTING" || context.source_context.mode !== "COMMITTING"
    || context.boundary_sha256 !== boundarySha256 || context.product_snapshot.length !== after.length) fail("STANDARD_CYCLE_WORK_SOURCE_STALE");
  const changes = [];
  for (const [index, before] of context.product_snapshot.entries()) {
    const row = after[index]; if (row.path !== before.path) fail("STANDARD_CYCLE_WORK_SNAPSHOT_INVALID");
    if (before.present === row.present && (!row.present || before.sha256 === row.sha256)) continue;
    changes.push({ path: context.product_prefix ? context.product_prefix + "/" + row.path : row.path,
      operation: !before.present ? "add" : !row.present ? "delete" : "update" });
  }
  if (!changes.length || changes.some(row => !context.task.paths.some(allowed => allowed.path === row.path && allowed.operations.includes(row.operation)))
    || shadowHash([...changes].sort((a, b) => a.path.localeCompare(b.path))) !== shadowHash([...report.changes].sort((a, b) => a.path.localeCompare(b.path)))) fail("STANDARD_CYCLE_WORK_SCOPE_UNCONFIRMED");
  return { contract_version: "standard-cycle-work-output.v1", operation_ref: "cycle_work_evaluate", outcome: "completed", effect_status: "no_effect",
    facts: { cycle_work_observed: true, cycle_validation_required: true }, observations: { task: context.task, producer, changes,
      implementation_operation_id: context.implementation_operation_id, scope_sha256: context.scope_sha256,
      before_product_sha256: shadowHash(context.product_snapshot), after_product_sha256: shadowHash(after),
      validation: "not_executed", authorship: "workspace_observation_not_per_file_writer_authentication" }, evidence_refs: evidenceRefs };
}
