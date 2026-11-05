import assert from "node:assert/strict";
import fs from "node:fs";
import { MODE_WORK_CONTRACT, assertStandardModeWorkReport, evaluateStandardModeWork } from "../../src/core/workflow/standard-mode-work.mjs";
import { assertNativeActivityAnswer, nativeActivityOutputInstructions, nativeActivityAnswerSchema } from "../../src/core/workflow/native-activity-output.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { preflightStandardComposedFixture } from "./standard-composed-preflight-fixture-lib.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const H = "a".repeat(64), reference = { ref: "fixture/native-result.json", sha256: H };
const { model, catalog } = loadStandardWorkflowAssets();
const scenario = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/standard-workflow/composed-positive.v1.json", import.meta.url)));
const context = mode => { const context = { mode, objective: "Understand the observed behavior", preflight_operation_id: "mode-preflight" };
  return { context, context_sha256: shadowHash(context), evidence_refs: [reference] }; };
const report = (mode, disposition) => ({ contract_version: MODE_WORK_CONTRACT, context_sha256: context(mode).context_sha256, mode,
  objective: context(mode).context.objective, disposition, findings: ["The supplied behavior has a bounded explanation."], rationale: "Read-only analysis of the supplied evidence", evidence_refs: [reference] });
const evaluate = value => evaluateStandardModeWork({ report: value, producer: { proof_class: "fixture" }, reference }, context(value.mode));
let checks = 0;
const test = (name, run) => { run(); checks++; console.log("PASS " + name); };
for (const [prefix, mode, disposition] of [["thinking", "THINKING", "thinking_complete"], ["exploring", "EXPLORING", "nonretained"]]) {
  test(`${mode} has real preflight, analysis and evaluation nodes with read-only permissions`, () => {
    const node = id => model.nodes.find(row => row.id === id);
    assert.deepEqual(node(prefix + "_preflight").children, [prefix + "_admit"]);
    assert.deepEqual(node(prefix + "_handoff").children, [prefix + "_analysis_loop"]);
    assert.deepEqual(node(prefix + "_analysis_iteration").children, [prefix + "_analysis", prefix + "_observe", prefix + "_after_report"]);
    assert.equal(node(prefix + "_analysis_loop").until, "mode_analysis_completed");
    assert.equal(node(prefix + "_continue_decide").binding_ref, "mode_work_continue_decision");
    assert.equal(node(prefix + "_admit").binding_ref, "mode_work_preflight");
    assert.equal(node(prefix + "_evaluate").binding_ref, "mode_work_evaluate");
    const policy = model.policies.find(row => row.id === node(prefix + "_analysis").policy_ref);
    assert.equal(policy.mode, mode); assert.deepEqual(policy.allowed_permissions, ["read:product"]);
    assert.deepEqual(policy.required_permissions, ["read:product"]);
    assert.equal(catalog.activities.find(row => row.node_id === prefix + "_analysis").output_contract, MODE_WORK_CONTRACT);
  });
  test(`${mode} typed findings bind their exact context and never grant product or retention effects`, () => {
    const value = report(mode, disposition), output = evaluate(value);
    assertNativeActivityAnswer({ outcome: "completed", summary: "Observed", report: value }, MODE_WORK_CONTRACT, value.context_sha256);
    nativeActivityAnswerSchema(MODE_WORK_CONTRACT, value.context_sha256);
    assertStandardOperationOutput(output); assert.equal(output.outcome, "completed"); assert.equal(output.effect_status, "no_effect");
    assert.deepEqual(output.facts, { mode_analysis_completed: true, exploration_nonretained: mode === "EXPLORING" });
    assert.equal(output.observations.retention_authorized, false); assert.equal(output.observations.product_effects_authorized, false);
    assert.equal(output.observations.session_closure_completed, false);
    assert.match(nativeActivityOutputInstructions(MODE_WORK_CONTRACT), /do not edit product/);
  });
  test(`${mode} missing information remains explicitly waiting without success facts`, () => {
    const output = evaluate(report(mode, "waiting")); assertStandardOperationOutput(output);
    assert.equal(output.outcome, "blocked"); assert.deepEqual(output.facts, {}); assert.equal(output.effect_status, "no_effect");
  });
  test(`${mode} routes through the SAME published IR and reducer replay with one synthetic analysis`, () => {
    const result = preflightStandardComposedFixture({ model, scenario: { ...scenario, mode } });
    assert.equal(result.responses_required, 1); assert.equal(result.replay_exact, true); assert.equal(result.planned_status, "COMPLETED");
    assert.deepEqual(result.native_occurrences.map(row => row.node_id), [prefix + "_analysis"]);
    assert.ok(result.operations.includes(prefix + "_admit")); assert.ok(result.operations.includes(prefix + "_evaluate"));
    assert.ok(!result.operations.includes("cycle_initialize")); assert.equal(result.write_authorization, false);
  });
  test(`${mode} blocked evaluation stops the common reducer and its replay remains non-success`, () => {
    const result = preflightStandardComposedFixture({ model, scenario: { ...scenario, mode, interruption: { node_id: prefix + "_evaluate", outcome: "blocked" } } });
    assert.equal(result.planned_status, "WAITING"); assert.equal(result.replay_exact, true); assert.equal(result.responses_required, 1);
    assert.equal(result.interrupted, true);
  });
}
test("EXPLORING retention requests require separate SPIKE admission and remain blocked", () => {
  const output = evaluate(report("EXPLORING", "retain_requested")); assertStandardOperationOutput(output);
  assert.equal(output.outcome, "blocked"); assert.deepEqual(output.facts, {});
  assert.equal(output.observations.reason_code, "STANDARD_SPIKE_ADMISSION_REQUIRED");
});
test("mode/disposition substitutions, stale context, foreign evidence and forged success facts refuse", () => {
  assert.throws(() => assertStandardModeWorkReport(report("THINKING", "nonretained")), { code: "STANDARD_MODE_WORK_DISPOSITION_INVALID" });
  assert.throws(() => assertStandardModeWorkReport(report("EXPLORING", "thinking_complete")), { code: "STANDARD_MODE_WORK_DISPOSITION_INVALID" });
  assert.throws(() => evaluate({ ...report("THINKING", "thinking_complete"), context_sha256: H }), { code: "STANDARD_MODE_WORK_CONTEXT_CHANGED" });
  assert.throws(() => evaluate({ ...report("THINKING", "thinking_complete"), objective: "Other" }), { code: "STANDARD_MODE_WORK_CONTEXT_CHANGED" });
  assert.throws(() => evaluate({ ...report("THINKING", "thinking_complete"), evidence_refs: [{ ...reference, sha256: "b".repeat(64) }] }), { code: "STANDARD_MODE_WORK_EVIDENCE_INVALID" });
  assert.throws(() => assertStandardOperationOutput({ ...evaluate(report("EXPLORING", "retain_requested")), facts: { mode_analysis_completed: true } }), { code: "STANDARD_OPERATION_OUTPUT_INVALID" });
  assert.throws(() => assertNativeActivityAnswer({ outcome: "failed", summary: "Failed", report: report("THINKING", "thinking_complete") }, MODE_WORK_CONTRACT, context("THINKING").context_sha256), { code: "PROCESS_ACTIVITY_OUTPUT_NONCOMPLETION" });
});
test("preflight cannot receive COMMITTING or an invented session identity", () => {
  assertStandardOperationInput("mode_work_preflight", { session_id: "S001", mode: "THINKING" });
  assert.throws(() => assertStandardOperationInput("mode_work_preflight", { session_id: "S001", mode: "COMMITTING" }), { code: "STANDARD_OPERATION_INPUT_INVALID" });
  assert.throws(() => assertStandardOperationInput("mode_work_preflight", { session_id: "other", mode: "THINKING" }), { code: "STANDARD_OPERATION_INPUT_INVALID" });
});
console.log(JSON.stringify({ status: "PASS", checks, proof_class: "offline-contract-and-synthetic-reducer", native: "NOT_RUN", application_ports: "NOT_RUN", complete_standard_workflow: false }));
