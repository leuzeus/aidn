import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { createValidationProfileFixture } from "./standard-cycle-validation-fixture-lib.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";

export function taskProgressModel(model) {
  const op = (id, binding_ref) => ({ id, kind: "operation", participant_ref: "delivery", binding_ref });
  model.nodes[0].children = model.nodes[0].children.filter(id => !["implement", "work_evaluate", "validate"].includes(id));
  model.nodes[0].children.splice(-1, 0, "task_loop");
  model.nodes.find(row => row.id === "work_evaluate").binding_ref = "cycle_task_work_evaluate";
  model.nodes.push({ id: "task_loop", kind: "loop", participant_ref: "delivery", child: "task_iteration", until: "cycle_tasks_finished", max_iterations: 2 },
    { id: "task_iteration", kind: "sequence", participant_ref: "delivery", children: ["task_select", "implement", "work_evaluate", "validate", "task_validation", "task_advance", "task_route"] },
    op("task_select", "cycle_task_select"), op("task_validation", "cycle_validation_evaluate"), op("task_advance", "cycle_task_advance"),
    { id: "task_route", kind: "xor", participant_ref: "delivery", branches: [
      { flow_id: "finished", node_id: "final_verification", condition: "cycle_tasks_finished" }, { flow_id: "continue", node_id: "task_continue", condition: null }] },
    op("task_continue", "context_reload"),
    { id: "final_verification", kind: "sequence", participant_ref: "delivery", children: ["final_validation", "verification_enter"] },
    op("final_validation", "cycle_validation_evaluate"), op("verification_enter", "cycle_verification_enter"));
  model.data_bindings.inputs.find(row => row.node_id === "implement").fields = { task_operation_id: { source: "operation_id", node_id: "task_select" } };
  model.data_bindings.inputs.push(
    { node_id: "task_select", fields: { implementation_operation_id: { source: "operation_id", node_id: "implementation_enter" } } },
    { node_id: "task_validation", fields: { validation_operation_id: { source: "operation_id", node_id: "validate" } } },
    { node_id: "task_advance", fields: { evaluation_operation_id: { source: "operation_id", node_id: "task_validation" } } },
    { node_id: "task_continue", fields: {} },
    { node_id: "final_validation", fields: { validation_operation_id: { source: "operation_id", node_id: "validate" }, progress_operation_id: { source: "operation_id", node_id: "task_advance" } } },
    { node_id: "verification_enter", fields: { evaluation_operation_id: { source: "operation_id", node_id: "final_validation" } } });
  model.operation_pins = Object.fromEntries(standardWorkflowOperationBindings().filter(row => model.nodes.some(node => node.binding_ref === row.id)).map(row => [row.id, shadowHash(row)]));
}
export function taskProgressProposal(report, unchanged = false) {
  report.tasks[0].done_criteria = ["The intermediate exported value is 2 and its interface is unchanged"];
  report.tests[0].expected = "The exported value is at least 2 and its interface is unchanged";
  report.tasks.push({ ...structuredClone(report.tasks[0]), id: "TASK-002", task: "Complete the second admitted value requirement", test_refs: ["TEST-002"], done_criteria: ["The final exported value is " + (unchanged ? 2 : 3) + " and its interface is unchanged"] });
  report.tests.push({ ...structuredClone(report.tests[0]), id: "TEST-002", expected: "The final exported value is " + (unchanged ? 2 : 3) + " and its interface is unchanged" });
  report.usage_matrix[0].test_refs.push("TEST-002");
  return report;
}
export function taskProgressValidationProfile(base, unchanged) {
  const fixture = createValidationProfileFixture(base, { testRef: "TEST-001" });
  fixture.profile.checks = [1, 2].map(index => {
    const file = path.join(path.dirname(fixture.profileRef.path), `task-check-${index}.mjs`);
    const content = `import {pathToFileURL} from "node:url"; import path from "node:path"; const subject=await import(pathToFileURL(path.resolve("app.mjs")).href); process.stdout.write(JSON.stringify({contract_version:"agent-verification-check.v1",validation_id:"TEST-00${index}",status:subject.value${index === 1 ? ">=2" : "===" + (unchanged ? 2 : 3)} && Object.keys(subject).join()==="value"?"passed":"failed"}));\n`;
    fs.writeFileSync(file, content);
    return { test_ref: `TEST-00${index}`, script: { path: file, sha256: createHash("sha256").update(content).digest("hex") }, snapshot_path: `_aidn_checks/task-${index}.mjs`, args: [] };
  });
  const bytes = JSON.stringify(fixture.profile); fs.writeFileSync(fixture.profileRef.path, bytes);
  fixture.profileRef.sha256 = createHash("sha256").update(bytes).digest("hex"); return fixture;
}
export async function verifyTaskProgressExecution({ f, artifacts, cyclePath, selected, auth, verifier, script, audit = false, setAllowed }) {
  const operations = [], advances = [], originalScope = artifacts.read(`${cyclePath}/plan.md`).content.split("## Native write scope")[1].split("```")[1];
  let restarted = false;
  for (let step = 0; step < 25; step++) {
    const before = f.open().inspect(), ready = before.cursor.occurrences.find(row => row.status === "READY");
    if (!ready || before.cursor.status === "WAITING") break;
    const node = before.record.model.nodes.find(row => row.id === ready.node_id);
    let result;
    if (node?.binding_ref === "cycle_task_advance") {
      const preview = await f.open().step();
      assert.equal(preview.preview.prepared.can_apply, true, JSON.stringify(preview));
      assert.equal(preview.preview.prepared.plan.changes.length, 3);
      const prior = [cyclePath + "/plan.md", cyclePath + "/status.md", "CURRENT-STATE.md"].map(name => artifacts.read(name).sha256);
      setAllowed(false); await assert.rejects(f.open().step({ write: true }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" }); setAllowed(true);
      assert.deepEqual([cyclePath + "/plan.md", cyclePath + "/status.md", "CURRENT-STATE.md"].map(name => artifacts.read(name).sha256), prior);
      if (selected === "partial") {
        const db = new (getDatabaseSync())(resolveRuntimeSqliteFile({ targetRoot: f.configuration.target_root }));
        try { db.exec(`CREATE TRIGGER fixture_abort_task_progress BEFORE INSERT ON artifacts WHEN NEW.path='${cyclePath}/status.md' BEGIN SELECT RAISE(ABORT,'fixture progress interrupted'); END`); } finally { db.close(); }
      }
      if (selected === "files" && !restarted) {
        const file = path.join(f.base, "task-restart.json"); fs.writeFileSync(file, JSON.stringify({ fixture: { configuration: f.configuration, dirs: f.dirs, base: f.base }, key_hex: f.key.toString("hex"), validation_profile: verifier.profileRef }));
        const child = spawnSync(process.execPath, [script, "--recovery-record", file], { encoding: "utf8", shell: false, windowsHide: true, timeout: 900000 });
        assert.equal(child.status, 0, child.stderr); result = JSON.parse(child.stdout); assert.equal(result.launches, 0); assert.equal(result.sessions, 0); restarted = true;
      }
    }
    if (!result) {
      const write = fs.writeFileSync;
      try {
        if (selected === "projection" && node?.binding_ref === "cycle_task_advance") fs.writeFileSync = (file, ...args) => {
          if (typeof file === "string" && path.resolve(file) === path.resolve(f.configuration.target_root, "docs/audit", cyclePath, "status.md")) return;
          return write(file, ...args);
        };
        result = await f.open().step({ write: true, authorization: { ...auth, authorized_at_ms: Date.now() } });
      } finally { fs.writeFileSync = write; }
    }
    if (result.operation_id) {
      const record = f.open().readOperation(result.operation_id), output = record.results.at(-1)?.output;
      operations.push(record);
      console.log(`STEP cycle tasks ${selected}: ${record.intent.binding_ref} ${output?.outcome ?? result.status}`);
      if (record.intent.binding_ref === "cycle_task_advance") {
        const digest = shadowHash(record), calls = verifier.calls();
        assert.equal((await f.open().dispatchOperation(record.operation_id, { write: true })).status, "retained_result");
        assert.equal(shadowHash(f.open().readOperation(record.operation_id)), digest); assert.equal(verifier.calls(), calls);
        if (["partial", "projection"].includes(selected)) {
          assert.equal(output.outcome, "reconciliation_required", JSON.stringify(output)); assert.equal(output.effect_status, "unknown"); assert.deepEqual(output.facts, {});
          assert.equal(output.observations.committed.length, selected === "partial" ? 1 : 3); assert.equal(artifacts.ownerPending(), true);
          assert.equal((await f.open().step({ write: true })).kind, "reconciliation"); break;
        }
        assert.equal(output.effect_status, "confirmed", JSON.stringify(output)); advances.push(output);
        assert.equal(artifacts.read(`${cyclePath}/plan.md`).content.split("## Native write scope")[1].split("```")[1], originalScope);
      } else assert.equal(output?.outcome, "completed", JSON.stringify(output));
    } else if (result.kind === "native") assert.equal(result.journal_phase, "closed", JSON.stringify(result));
  }
  const state = f.open().inspect();
  if (!["partial", "projection"].includes(selected)) {
    assert.equal(advances.length, 2); assert.deepEqual(advances.map(row => row.observations.task_id), ["TASK-001", "TASK-002"]);
    assert.equal(advances[0].facts.cycle_tasks_finished, false); assert.equal(advances[1].facts.cycle_tasks_finished, true);
    assert.equal(advances[1].observations.previous_progress_operation_id, operations.find(row => row.intent.binding_ref === "cycle_task_advance").operation_id);
    const validations = operations.filter(row => row.intent.binding_ref === "cycle_validation_execute").map(row => row.results.at(-1).output);
    assert.deepEqual(validations.map(row => row.observations.checks.map(check => check.test_ref)), [["TEST-001"], ["TEST-001", "TEST-002"]]);
    for (const validation of validations) assert.ok(validation.observations.checks.every(row => row.status === "passed"), JSON.stringify(validation));
    const finalEvaluation = operations.filter(row => row.intent.binding_ref === "cycle_validation_evaluate").at(-1).results.at(-1).output;
    assert.equal(finalEvaluation.facts.cycle_work_complete, true); assert.equal(finalEvaluation.facts.cycle_checks_passed, true);
    assert.deepEqual(finalEvaluation.observations.pending_test_refs, []);
    assert.equal(verifier.calls(), 3); assert.equal(f.t.sessions.length, audit ? 4 : 3); assert.ok(f.t.sessions.every(row => row.closed));
    assert.equal(fs.readFileSync(path.join(f.configuration.product_root, "app.mjs"), "utf8"), `export const value = ${selected === "unchanged" ? 2 : 3};\n`);
    assert.match(artifacts.read(`${cyclePath}/status.md`).content, /^state: VERIFYING$/m);
    assert.equal(operations.find(row => row.intent.binding_ref === "cycle_verification_enter").results.at(-1).output.facts.cycle_verification_started, true); assert.equal(artifacts.ownerPending(), false);
    if (audit) {
      const selectedSource = operations.find(row => row.intent.binding_ref === "cycle_audit_select"), evaluated = operations.at(-1);
      assert.equal(selectedSource.results.at(-1).output.facts.cycle_audit_source_selected, true);
      assert.equal(evaluated.intent.binding_ref, "cycle_audit_evaluate");
      assert.deepEqual(evaluated.results.at(-1).output.facts, { cycle_audit_observed: true, cycle_audit_blockers_present: false, cycle_closure_decision_required: true });
      assert.equal(evaluated.results.at(-1).output.observations.lifecycle_transition, "none");
      assert.equal(evaluated.results.at(-1).output.observations.skill_completion, "pending");
      assert.equal(evaluated.results.at(-1).output.effect_status, "no_effect");
    }
    if (selected === "unchanged") assert.equal(operations.filter(row => row.intent.binding_ref === "cycle_task_work_evaluate")[1].results.at(-1).output.observations.work_outcome, "unchanged");
  }
  const simulation = simulateAgenticProcess({ instanceId: state.record.instance_id, model: state.record.model, parameters: state.record.initial_parameters,
    policyPins: state.record.policy_pins, scopeId: state.record.scope_id, events: state.record.events });
  assert.equal(simulation.trace.at(-1).instance_sha256, state.record.instance_sha256);
}
