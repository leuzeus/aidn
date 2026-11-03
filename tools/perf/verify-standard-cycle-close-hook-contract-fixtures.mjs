import assert from "node:assert/strict";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import inputSchema from "../../src/core/contracts/workflow-definition/standard-cycle-close-hook-input.v1.schema.json" with { type: "json" };
import planSchema from "../../src/core/contracts/workflow-definition/standard-cycle-close-hook-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../../src/core/contracts/workflow-definition/standard-cycle-close-hook-output.v1.schema.json" with { type: "json" };
const H = "a".repeat(64), operationId = "op_" + "a".repeat(40);
let checks = 0; const pass = name => { checks++; console.log("PASS " + name); };
for (const schema of [inputSchema, planSchema, outputSchema]) assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
pass("private checkpoint schemas use the supported vocabulary");
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
