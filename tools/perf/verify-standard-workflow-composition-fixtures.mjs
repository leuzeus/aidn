import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadStandardWorkflowAssets, STANDARD_WORKFLOW_MODEL_PATH, STANDARD_WORKFLOW_CATALOG_PATH } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { verifyStandardWorkflowComponentAssets, assertStandardWorkflowActivityOutputs } from "../../src/core/workflow/standard-workflow-model-catalog.mjs";
import { createAgenticProcess, inspectAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const root = new URL("../../", import.meta.url), read = name => fs.readFileSync(new URL(name, root));
const assets = loadStandardWorkflowAssets();
const fresh = () => ({ catalog: structuredClone(assets.catalog), model: structuredClone(assets.model),
  bindings: standardWorkflowOperationBindings(), specification: read("docs/SPEC.md"),
  skills: Object.fromEntries([...new Set(assets.catalog.bindings.map(row => row.skill_source.path))].map(name => [name, read(name)])) });
let checks = 0;
const test = (name, run) => { run(); checks++; console.log("PASS " + name); };
const reject = (name, change, code) => test(name, () => {
  const input = fresh(); change(input); assert.throws(() => verifyStandardWorkflowComponentAssets(input), { code });
});
test("the published JSON is loaded as the exact common IR with fixed real operation bindings", () => {
  assert.equal(assets.model.model_id, "aidn-standard"); assert.equal(assets.model.contract_version, "agentic-process-model.v2");
  assert.deepEqual(verifyStandardWorkflowComponentAssets(fresh()), assets.source);
  assert.equal(assets.catalog.bindings.length, 43); assert.equal(assets.catalog.activities.length, 7);
});
test("session close admission is a deterministic read-only continuation, separate from closure", () => {
  const node = assets.model.nodes.find(row => row.id === "session_close_admit");
  const binding = assets.catalog.bindings.find(row => row.node_id === node.id).binding;
  assert.equal(node.kind, "operation"); assert.equal(binding.skill_id, "close-session"); assert.equal(binding.effect_class, "read-only");
  assert.equal(binding.input_contract, "standard-session-reference-input.v1"); assert.equal(binding.output_contract, "standard-session-close-admission-output.v1");
  const children = assets.model.nodes.find(row => row.id === "committing").children;
  assert.equal(children.indexOf("session_close_admit"), children.indexOf("promotion_eligibility") + 1);
  assert.ok(assets.catalog.scope.remaining_activities.includes("session_close"));
});

test("completion of this component cannot claim completion of the standard workflow", () => {
  assert.equal(assets.catalog.scope.complete_standard_workflow, false);
  for (const id of ["existing_session_resume", "thinking_work", "exploring_work_and_spike_conversion", "cycle_choice_and_carryover",
    "startup_and_work_drift_routes", "incidents_and_recovery", "session_close", "pr_review_and_merge", "post_merge_sync", "full_mixed_resume"])
    assert.ok(assets.catalog.scope.remaining_activities.includes(id));
});
reject("changing the graph order cannot retain its source identity", x => x.model.nodes.find(row => row.id === "committing").children.reverse(), "PROCESS_INPUT_SOURCE_NOT_ORDERED");
reject("the partial catalog cannot be relabeled as complete", x => { x.catalog.scope.complete_standard_workflow = true; }, "STANDARD_STARTUP_CATALOG_INVALID");
reject("native activities cannot disappear from the provenance catalog", x => { x.catalog.activities.pop(); }, "STANDARD_ACTIVITY_COVERAGE_INVALID");
reject("duplicate native activity identities are rejected", x => { x.catalog.activities[1].node_id = x.catalog.activities[0].node_id; }, "STANDARD_ACTIVITY_COVERAGE_INVALID");
reject("a domain implementation activity cannot acquire an invented governance skill", x => { x.catalog.activities[1].skill_sources.push(x.catalog.activities[0].skill_sources[0]); }, "STANDARD_ACTIVITY_BINDING_INVALID");
reject("a native activity must reference actual current SPEC rules", x => { x.catalog.activities[0].rule_refs = ["SPEC-R99"]; }, "STANDARD_STARTUP_CATALOG_INVALID");
reject("native skill bytes cannot be changed behind the source descriptor", x => { x.catalog.activities[0].skill_sources[0].sha256 = "0".repeat(64); }, "STANDARD_ACTIVITY_SKILL_CHANGED");
reject("an operation's changed implementation is rejected rather than repaired", x => { x.bindings[0].implementation_sha256 = "0".repeat(64); }, "STANDARD_STARTUP_IMPLEMENTATION_CHANGED");
test("native configuration must use exactly the declared typed activity reports", () => {
  const outputs = Object.fromEntries(assets.catalog.activities.map(row => [row.node_id, row.output_contract]));
  assertStandardWorkflowActivityOutputs(assets.source, assets.model, outputs);
  assert.throws(() => assertStandardWorkflowActivityOutputs(assets.source, assets.model, { ...outputs, implement: outputs.plan }), { code: "STANDARD_ACTIVITY_OUTPUT_CONTRACT_CHANGED" });
  assert.throws(() => assertStandardWorkflowActivityOutputs(assets.source, assets.model, { ...outputs, extra: outputs.plan }), { code: "STANDARD_ACTIVITY_OUTPUT_CONTRACT_CHANGED" });
});
test("execution and simulation start the same model and reducer with the same durable identity", () => {
  const options = { instanceId: "standard-composition-fixture", model: assets.model, scopeId: "offline-composition", policyPins: agenticPolicyPins(assets.model), facts: {},
    parameters: { session: { session_id: "S900", session_branch: "session/example", objective: "Disposable composition qualification" },
      cycle: { cycle_id: "C900", cycle_type: "FEATURE", title: "Example", objective: "Example" } } };
  const instance = createAgenticProcess(options), cursor = inspectAgenticProcess(instance);
  const simulation = simulateAgenticProcess({ ...options, events: [] });
  assert.equal(simulation.trace.at(-1).instance_sha256, instance.instance_sha256);
  assert.equal(cursor.occurrences.find(row => row.status === "READY").node_id, "context_reload");
  assert.equal(instance.events.length, 0);
});
test("optional continuation is structural and requests no dummy context operation or native activity", () => {
  for (const id of ["task_continue", "promotion_not_requested"])
    assert.deepEqual(assets.model.nodes.find(row => row.id === id).children, []);
});
test("source authoring preview leaves the exact published JSON bytes unchanged", () => {
  const names = [STANDARD_WORKFLOW_MODEL_PATH, STANDARD_WORKFLOW_CATALOG_PATH], before = names.map(name => shadowHash([...read(name)]));
  const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("tools/author/build-standard-workflow-model.mjs", root))], { encoding: "utf8", windowsHide: true }));
  assert.equal(result.write, false); assert.deepEqual(names.map(name => shadowHash([...read(name)])), before);
  assert.equal(result.model_sha256, assets.source.model_sha256);
});
console.log(JSON.stringify({ status: "PASS", checks, scope: "offline-source-composition", application_ports: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN", full_standard_workflow: "NOT_COMPLETE" }));
