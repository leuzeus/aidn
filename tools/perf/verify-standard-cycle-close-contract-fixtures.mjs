import assert from "node:assert/strict";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import inputSchema from "../../src/core/contracts/workflow-definition/standard-cycle-close-input.v1.schema.json" with { type: "json" };
import planSchema from "../../src/core/contracts/workflow-definition/standard-cycle-close-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../../src/core/contracts/workflow-definition/standard-cycle-close-output.v1.schema.json" with { type: "json" };
const H = "a".repeat(64), operationId = "op_" + "a".repeat(40);
let checks = 0; const pass = name => { checks++; console.log("PASS " + name); };
for (const schema of [inputSchema, planSchema, outputSchema]) assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
pass("private closure schemas use supported validation vocabulary");
const binding = standardWorkflowOperationBindings().find(row => row.id === "cycle_close_record");
assert.equal(binding.executor_kind, "deterministic"); assert.equal(binding.effect_class, "mutating"); assert.equal(binding.skill_id, "cycle-close");
assert.deepEqual(binding.allowed_modes, ["COMMITTING"]); assert.equal(binding.input_contract, "standard-cycle-close-input.v1"); assert.equal(binding.output_contract, "standard-cycle-close-output.v1");
assertStandardOperationInput(binding.id, { decision_operation_id: operationId });
for (const extra of [{ module: "arbitrary.mjs" }, { authorized: true }, { target_state: "DONE" }, { report: {} }])
  assert.throws(() => assertStandardOperationInput(binding.id, { decision_operation_id: operationId, ...extra }));
pass("fixed deterministic binding accepts only a decision identity and grants no authored authority");
const completed = state => ({ contract_version: "standard-cycle-close-output.v1", operation_ref: "cycle_close_record", outcome: "completed", effect_status: "confirmed",
  facts: { cycle_terminal_recorded: true, cycle_retained: state === "DONE", cycle_close_completed: false },
  observations: { target_state: state, closure_hook: "pending", skill_completion: "pending" }, evidence_refs: Array.from({ length: 6 }, (_, i) => ({ ref: "fixture:artifact:" + i, sha256: H })) });
for (const state of ["DONE", "NO_GO", "DROPPED"]) assertStandardOperationOutput(completed(state));
pass("terminal metadata outcomes remain distinct from final hook and skill completion");
const unknown = { ...completed("DONE"), outcome: "reconciliation_required", effect_status: "unknown", facts: {}, observations: { committed: ["fixture:status"], reason_code: "FIXTURE_PARTIAL" }, evidence_refs: [] };
assertStandardOperationOutput(unknown); assertStandardOperationOutput({ ...unknown, outcome: "blocked", effect_status: "no_effect" });
for (const bad of [{ ...unknown, facts: completed("DONE").facts }, { ...unknown, evidence_refs: completed("DONE").evidence_refs }, { ...completed("DONE"), facts: {} },
  { ...completed("DONE"), effect_status: "unknown" }, { ...completed("NO_GO"), facts: completed("DONE").facts },
  { ...completed("DONE"), observations: { target_state: "DONE", closure_hook: "completed", skill_completion: "completed" } }])
  assert.throws(() => assertStandardOperationOutput(bad), { code: "STANDARD_OPERATION_OUTPUT_INVALID" });
pass("uncertainty, blocked admission and incomplete confirmation cannot inherit successful facts");
console.log(JSON.stringify({ status: "PASS", checks, proof: "terminal-metadata-contract", application_host: "NOT_RUN", human_authentication: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
