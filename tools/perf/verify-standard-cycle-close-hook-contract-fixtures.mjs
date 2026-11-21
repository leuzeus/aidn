import assert from "node:assert/strict";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import inputSchema from "../../src/core/contracts/workflow-definition/standard-cycle-close-hook-input.v1.schema.json" with { type: "json" };
import planSchema from "../../src/core/contracts/workflow-definition/standard-cycle-close-hook-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../../src/core/contracts/workflow-definition/standard-cycle-close-hook-output.v1.schema.json" with { type: "json" };
import renewalSchema from "../../src/core/contracts/workflow-definition/standard-cycle-close-renewal-plan.v1.schema.json" with { type: "json" };
import outputV2Schema from "../../src/core/contracts/workflow-definition/standard-cycle-close-hook-output.v2.schema.json" with { type: "json" };
import selectionSchema from "../../src/core/contracts/workflow-definition/standard-cycle-close-selection-output.v1.schema.json" with { type: "json" };
const H = "a".repeat(64), operationId = "op_" + "a".repeat(40);
let checks = 0; const pass = name => { checks++; console.log("PASS " + name); };
for (const schema of [inputSchema, planSchema, outputSchema, renewalSchema, outputV2Schema, selectionSchema]) assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
pass("private checkpoint schemas use the supported vocabulary");
const errors = (value, schema) => validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" });
const anchor = { operation_id: operationId, receipt_sha256: H, plan_sha256: H, output_sha256: H, alignment_sha256: H, report_sha256: H, event_sha256: H, event_offset: 0 };
const renewal = { contract_version: "standard-cycle-close-renewal-plan.v1", input: { closure_operation_id: operationId }, operation_id: operationId,
  prepared_at_ms: 0, context_sha256: H, previous_completion: anchor, reason_code: "STANDARD_OBJECTIVE_DISPOSITION_EXPIRED" };
for (const reason_code of ["STANDARD_OBJECTIVE_DISPOSITION_EXPIRED", "STANDARD_OBJECTIVE_COMPLETION_EXPIRED"])
  assert.deepEqual(errors({ ...renewal, reason_code }, renewalSchema), []);
const embeddedInput = structuredClone(inputSchema); delete embeddedInput.$schema; delete embeddedInput.$id;
assert.deepEqual(renewalSchema.properties.input, embeddedInput, "embedding preserves the closed input shape and contract annotation");
pass("renewal plans accept both exact expiry reasons and preserve the complete nested input shape");
const badPlan = (mutate, at) => { const value = structuredClone(renewal); mutate(value); const issues = errors(value, renewalSchema);
  assert(issues.some(issue => issue.startsWith(at + ":")), JSON.stringify({ at, issues })); };
for (const [mutate, at] of [
  [v => { v.extra = true; }, "$.extra"], [v => { v.input.extra = true; }, "$.input.extra"],
  [v => { v.previous_completion.extra = true; }, "$.previous_completion.extra"],
  [v => { v.contract_version = "standard-cycle-close-hook-plan.v1"; }, "$.contract_version"],
  [v => { v.context_sha256 = "g".repeat(64); }, "$.context_sha256"],
  [v => { v.prepared_at_ms = "0"; }, "$.prepared_at_ms"], [v => { v.prepared_at_ms = -1; }, "$.prepared_at_ms"],
  [v => { v.previous_completion.event_offset = 0.5; }, "$.previous_completion.event_offset"],
  [v => { v.previous_completion.event_offset = -1; }, "$.previous_completion.event_offset"],
  [v => { v.reason_code = "STANDARD_HUMAN_SOURCE_REVOKED"; }, "$.reason_code"],
  [v => { v.input = null; }, "$.input"], [v => { v.previous_completion = []; }, "$.previous_completion"],
]) badPlan(mutate, at);
for (const key of ["operation_id", "input.closure_operation_id", ...Object.keys(anchor).map(key => "previous_completion." + key)]) {
  const parts = key.split("."), leaf = parts.pop(), at = "$.", invalid = leaf === "event_offset" ? "0" : "invalid";
  badPlan(v => { const parent = parts.reduce((value, part) => value[part], v); parent[leaf] = invalid; }, at + key);
}
pass("renewal extras, invalid identities, hashes, types and reasons are rejected at their data path");
const returned = { contract_version: "standard-cycle-close-hook-output.v2", operation_ref: "cycle_close_finalize", outcome: "completed", effect_status: "no_effect",
  facts: { cycle_close_completed: false, drift_completion_reviewed: false }, observations: { reason_code: renewal.reason_code, previous_completion: anchor }, evidence_refs: [] };
assert.deepEqual(errors(returned, outputV2Schema), []); assertStandardOperationOutput(returned);
for (const change of [{ effect_status: "confirmed" }, { outcome: "blocked" }, { outcome: "reconciliation_required", effect_status: "unknown" },
  { facts: { cycle_close_completed: true, drift_completion_reviewed: false } }, { observations: { ...returned.observations, reason_code: "STANDARD_HUMAN_SOURCE_REVOKED" } },
  { evidence_refs: [{ ref: "fixture:false-success", sha256: H }] }])
  assert.throws(() => assertStandardOperationOutput({ ...returned, ...change }), { code: "STANDARD_OPERATION_OUTPUT_INVALID" });
const selected = { contract_version: "standard-cycle-close-selection-output.v1", operation_ref: "cycle_close_completed_select", outcome: "completed", effect_status: "no_effect",
  facts: {}, observations: { closure_operation_id: operationId, receipt_sha256: H, output_sha256: H }, evidence_refs: [] };
assert.deepEqual(errors(selected, selectionSchema), []); assertStandardOperationOutput(selected);
for (const change of [{ facts: { cycle_close_completed: true } }, { effect_status: "confirmed" }, { observations: returned.observations },
  { observations: { ...selected.observations, receipt_sha256: "invalid" } }])
  assert.throws(() => assertStandardOperationOutput({ ...selected, ...change }), { code: "STANDARD_OPERATION_OUTPUT_INVALID" });
assert(errors(returned, selectionSchema).length); assert(errors(selected, outputV2Schema).length); assert(errors(renewal, planSchema).length);
pass("renewal returns, confirmed-close selections and historical plans remain incompatible typed outputs");
const binding = standardWorkflowOperationBindings().find(row => row.id === "cycle_close_finalize");
assert.equal(binding.executor_kind, "deterministic"); assert.equal(binding.effect_class, "executor"); assert.equal(binding.skill_id, "cycle-close");
assert.deepEqual(binding.allowed_modes, ["COMMITTING"]);
assertStandardOperationInput(binding.id, { closure_operation_id: operationId });
for (const extra of [{ module: "arbitrary.mjs" }, { authorized: true }, { checkpoint: { ok: true } }, { target_state: "DONE" }])
  assert.throws(() => assertStandardOperationInput(binding.id, { closure_operation_id: operationId, ...extra }), { code: "STANDARD_OPERATION_INPUT_INVALID" });
pass("fixed deterministic input cannot supply a permission or successful checkpoint");
const completed = state => ({ contract_version: "standard-cycle-close-hook-output.v1", operation_ref: "cycle_close_finalize", outcome: "completed", effect_status: "confirmed",
  facts: { cycle_close_completed: true, cycle_retained: state === "DONE" }, observations: { target_state: state }, evidence_refs: Array.from({ length: 4 }, (_, i) => ({ ref: "fixture:confirmed:" + i, sha256: H })) });
for (const state of ["DONE", "NO_GO", "DROPPED"]) assertStandardOperationOutput(completed(state));
pass("confirmed terminal dispositions remain distinct");
const unknown = { ...completed("DONE"), outcome: "reconciliation_required", effect_status: "unknown", facts: {}, observations: { reason_code: "FIXTURE_LOST_CONFIRMATION" }, evidence_refs: [] };
assertStandardOperationOutput(unknown); assertStandardOperationOutput({ ...unknown, outcome: "blocked", effect_status: "no_effect" });
for (const bad of [{ ...unknown, facts: completed("DONE").facts }, { ...unknown, evidence_refs: completed("DONE").evidence_refs }, { ...completed("DONE"), facts: {} },
  { ...completed("DONE"), effect_status: "unknown" }, { ...completed("NO_GO"), facts: completed("DONE").facts },
  { ...unknown, outcome: "blocked", effect_status: "confirmed" }, { ...unknown, outcome: "completed", effect_status: "no_effect" }])
  assert.throws(() => assertStandardOperationOutput(bad), { code: "STANDARD_OPERATION_OUTPUT_INVALID" });
pass("closed gates, lost confirmation and schema-valid hybrid outcomes cannot imply success");
console.log(JSON.stringify({ status: "PASS", checks, proof: "final-checkpoint-contract", application_host: "NOT_RUN", checkpoint_execution: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
