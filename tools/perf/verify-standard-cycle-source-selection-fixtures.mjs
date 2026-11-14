import assert from "node:assert/strict";
import fs from "node:fs";
import { cyclePlanSourceSelection, assertCyclePlanSourceSelection, assertCycleExecutionSourceSelection } from "../../src/core/workflow/standard-cycle-source-selection.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
import { taskProgressProposal } from "./cycle-task-progress-fixture-lib.mjs";

if (process.argv.length !== 2) throw Error("STANDARD_SOURCE_SELECTION_FIXTURE_ARGUMENTS_INVALID");
const id = digit => "op_" + digit.repeat(40), H = "a".repeat(64), checks = [];
const test = (name, fn) => { fn(); checks.push(name); console.log("PASS " + name); };
const proposal = taskProgressProposal(cyclePlanProposal({ context_sha256: H, context: { session_id: "S001", cycle_id: "C001", cycle_type: "feature",
  mode: "COMMITTING", original_objective: "Continue the actual accepted source", allowed_product_files: ["product/app.mjs"] }, evidence_refs: [{ ref: "audit:SPEC.md", sha256: H }] }));
const context = phase => ({ session_id: "S001", cycle_id: "C001", cycle_path: "cycles/C001-feature-source", cycle_state: phase });
const choose = (phase, prefix, sourceKind = "canonical_progress") => cyclePlanSourceSelection({ recordOperationId: id("1"), recordSha256: H,
  proposal, sourceKind, phase, completedTaskIds: proposal.tasks.slice(0, prefix).map(row => row.id), context: context(phase), evidenceRefs: [] });

test("selection schemas are closed and reuse existing task limits without execution permission", () => {
  for (const name of ["standard-cycle-plan-selection-output.v2", "standard-cycle-execution-source-output.v1", "standard-workflow-catalog.v6"]) {
    const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/" + name + ".schema.json", import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  for (const extra of [{ phase: "VERIFYING" }, { authorized: true }, { observer: "caller" }, { implementation_operation_id: id("2") }])
    assert.throws(() => assertStandardOperationInput("cycle_execution_source_select", { record_operation_id: id("1"), ...extra }), /STANDARD_OPERATION_INPUT_INVALID/);
  assertStandardOperationInput("cycle_execution_source_select", { record_operation_id: id("1") });
});
test("historical plan selection v1 retains its exact closed reader", () => {
  const old = { contract_version: "standard-cycle-plan-selection-output.v1", operation_ref: "cycle_plan_select", outcome: "completed", effect_status: "no_effect",
    facts: {}, observations: { record_operation_id: id("1"), record_sha256: H, cycle_id: "C001", session_id: "S001", cycle_path: context("OPEN").cycle_path }, evidence_refs: [] };
  assertStandardOperationOutput(old);
  assert.throws(() => assertStandardOperationOutput({ ...old, contract_version: "standard-cycle-plan-selection-output.v2" }), /SOURCE_SELECTION_INVALID/);
  assert.throws(() => assertStandardOperationOutput({ ...old, observations: { ...old.observations, implementation_authorized: true } }), /STANDARD_OPERATION_OUTPUT_INVALID/);
});
test("fresh and canonical plan origins require actual implementation entry", () => {
  for (const kind of ["native_record", "canonical_plan"]) {
    const output = choose("OPEN", 0, kind);
    assert.equal(output.facts.cycle_implementation_entry_required, true);
    assert.equal(output.observations.implementation_authorized, false);
    assert.deepEqual(output.observations.remaining_task_ids, proposal.tasks.map(row => row.id));
    assert.throws(() => choose("IMPLEMENTING", 0, kind), /SOURCE_SELECTION_INVALID/);
    assert.throws(() => choose("OPEN", 1, kind), /SOURCE_SELECTION_INVALID/);
  }
});
test("canonical phase and ordered prefix select entry or current verification without a writer claim", () => {
  for (const [phase, prefix, required] of [["OPEN", 0, true], ["OPEN", 2, true], ["IMPLEMENTING", 1, true], ["IMPLEMENTING", 2, false], ["VERIFYING", 2, false]]) {
    const output = choose(phase, prefix);
    assert.equal(output.facts.cycle_implementation_entry_required, required);
    assert.deepEqual(output.observations.imported_completed_task_ids, proposal.tasks.slice(0, prefix).map(row => row.id));
    assertStandardOperationOutput(output);
  }
  assert.throws(() => cyclePlanSourceSelection({ recordOperationId: id("1"), recordSha256: H, proposal, sourceKind: "canonical_progress", phase: "IMPLEMENTING",
    completedTaskIds: ["TASK-002"], context: context("IMPLEMENTING"), evidenceRefs: [] }), /SOURCE_SELECTION_INVALID/);
});
test("plan selection rejects invented kind, partition, grant and context", () => {
  for (const mutate of [v => { v.observations.source_kind = "caller"; }, v => { v.observations.remaining_task_ids = ["TASK-001"]; },
    v => { v.observations.task_count++; }, v => { v.observations.implementation_authorized = true; },
    v => { v.facts.cycle_implementation_entry_required = false; }, v => { v.observations.approval = true; }]) {
    const value = choose("IMPLEMENTING", 1); mutate(value);
    assert.throws(() => assertCyclePlanSourceSelection(value), /SOURCE_SELECTION_INVALID/);
  }
  assert.throws(() => cyclePlanSourceSelection({ recordOperationId: id("1"), recordSha256: H, proposal, sourceKind: "canonical_progress", phase: "OPEN",
    completedTaskIds: [], context: { ...context("OPEN"), cycle_id: "C002" }, evidenceRefs: [] }), /SOURCE_SELECTION_INVALID/);
});
const execution = direct => ({ contract_version: "standard-cycle-execution-source-output.v1", operation_ref: "cycle_execution_source_select",
  outcome: "completed", effect_status: "no_effect", facts: { cycle_execution_source_selected: true, cycle_work_tasks_pending: !direct, cycle_work_product_ready: direct },
  observations: { record_operation_id: id("1"), implementation_operation_id: direct ? id("1") : id("2"),
    implementation_source_kind: direct ? "canonical_progress" : "implementation_entry", phase_source_sha256: H, context_sha256: H, scope_sha256: H,
    cycle_path: context("IMPLEMENTING").cycle_path, task_count: 2, completed_task_ids: direct ? ["TASK-001", "TASK-002"] : ["TASK-001"],
    remaining_task_ids: direct ? [] : ["TASK-002"], imported_completed_task_ids: direct ? ["TASK-001", "TASK-002"] : ["TASK-001"],
    implementation_authorized: false, current_native_work_evidence: false, current_validation_evidence: false }, evidence_refs: [] });
test("execution selection names a real distinct entry or complete canonical source", () => {
  for (const direct of [false, true]) {
    const output = execution(direct); assertCycleExecutionSourceSelection(output); assertStandardOperationOutput(output);
    assert.equal(output.facts.cycle_task_selected, undefined); assert.equal(output.facts.cycle_work_observed, undefined);
  }
});
test("execution selection refuses identity confusion and contradictory work or validation claims", () => {
  for (const [direct, mutate] of [[true, v => { v.observations.implementation_operation_id = id("2"); }],
    [false, v => { v.observations.implementation_operation_id = id("1"); }],
    [true, v => { v.observations.imported_completed_task_ids.pop(); }],
    [false, v => { v.observations.imported_completed_task_ids = ["TASK-002"]; }],
    [false, v => { v.facts.cycle_work_product_ready = true; }],
    [false, v => { v.observations.current_native_work_evidence = true; }],
    [false, v => { v.observations.current_validation_evidence = true; }],
    [false, v => { v.observations.implementation_authorized = true; }],
    [false, v => { v.observations.extra_grant = H; }]]) {
    const value = execution(direct); mutate(value);
    assert.throws(() => assertCycleExecutionSourceSelection(value), /SOURCE_SELECTION_INVALID/);
  }
});
console.log(JSON.stringify({ status: "PASS", checks: checks.length, scope: "PURE_TYPED_CYCLE_SOURCE_SELECTION_CONTRACTS", Native: 0, full_standard: false }));
