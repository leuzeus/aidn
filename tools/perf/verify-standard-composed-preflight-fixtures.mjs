import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { preflightStandardComposedFixture } from "./standard-composed-preflight-fixture-lib.mjs";

const model = loadStandardWorkflowAssets().model;
const scenario = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/standard-workflow/composed-positive.v1.json", import.meta.url)));
let checks = 0;
const test = (name, run) => { run(); checks++; console.log("PASS " + name); };
const plan = (changes = {}, stop = "component_complete") => preflightStandardComposedFixture({ model, scenario: { ...scenario, ...changes }, stop });
test("positive path selects nine native turns; its cold prefix keeps the same cumulative ceiling", () => {
  const result = plan();
  assert.equal(result.responses_required, 9); assert.equal(result.original_max_responses, 9);
  assert.equal(result.native_occurrences.filter(n => n.node_id === "implement").length, 1);
  assert.equal(result.cold_resume_checkpoints.length, 1); assert.equal(result.cold_resume_checkpoints[0].responses, 5);
  assert.equal(result.responses_required - result.cold_resume_checkpoints[0].responses, 4);
  assert.equal(result.planned_status, "COMPLETED"); assert.equal(result.replay_exact, true);
  assert.equal(result.write_authorization, false); assert.equal(result.product_qualification, "NOT_ESTABLISHED");
});
test("correction prefix stops at a real undecided human occurrence without inventing a negative decision", () => {
  const correction = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/standard-workflow/composed-correction.v2.json", import.meta.url)));
  const result = preflightStandardComposedFixture({ model, scenario: correction, stop: "session_pr_correction_decide" });
  assert.equal(result.planned_status, "RUNNING"); assert.equal(result.replay_exact, true);
  assert.ok(result.operations.includes("session_pr_correction_checkpoint"));
  assert.ok(!result.operations.includes("session_pr_correction_decide"));
  assert.ok(!result.operations.includes("correction_initialize"));
  assert.equal(result.write_authorization, false);
});
test("insufficient original allowance is refused before the long driver creates any fixture", () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("./verify-agentic-process-execution-fixtures.mjs", import.meta.url)),
    "--standard-composed-mode=files", "--standard-composed-stop=component_complete", "--standard-composed-max-responses=8", "--standard-composed-preflight-only"],
  { encoding: "utf8", windowsHide: true, timeout: 300000 });
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.match(child.stderr, /STANDARD_FIXTURE_RESPONSE_BUDGET_INSUFFICIENT/);
  assert.equal(child.stdout, "");
});
test("versioned correction route selects canonical reopening without another native response", () => {
  const correction = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/standard-workflow/composed-correction.v2.json", import.meta.url)));
  assert.throws(() => preflightStandardComposedFixture({ model, scenario: correction }), { code: "STANDARD_FIXTURE_PREFLIGHT_UNPLANNED_WAIT" });
  const result = preflightStandardComposedFixture({ model, scenario: correction, stop: "session_pr_correction_decide" });
  assert.equal(result.responses_required, 9); assert.ok(result.operations.includes("session_pr_correction_reopen"));
  assert.ok(result.operations.includes("session_pr_correction_checkpoint"));
  assert.equal(result.write_authorization, false); assert.equal(result.product_qualification, "NOT_ESTABLISHED");
  assert.ok(!plan().operations.includes("session_pr_correction_reopen"));
  assert.throws(() => preflightStandardComposedFixture({ model, scenario: { ...correction, review_disposition: "unknown" } }), { code: "STANDARD_FIXTURE_SCENARIO_INVALID" });
});
test('v3 plans both cycles through the same published model, new closure, redelivery and review', () => {
  const correction = JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/standard-workflow/composed-correction.v3.json', import.meta.url)));
  const result = preflightStandardComposedFixture({ model, scenario: correction });
  assert.equal(result.responses_required, 17); assert.equal(result.planned_status, 'COMPLETED');
  assert.ok(result.operations.includes('correction_initialize'));
  assert.ok(result.operations.includes('correction_session_branch_integrate'));
  assert.ok(result.operations.includes('correction_pr_redelivery_push'));
  assert.ok(result.operations.includes('correction_pr_triage_evaluate'));
  assert.equal(result.native_occurrences.filter(row => row.node_id === 'correction_implement').length, 1);
  assert.equal(result.replay_exact, true); assert.equal(result.write_authorization, false);
  assert.throws(() => preflightStandardComposedFixture({ model, scenario: { ...correction, max_responses: 16 } }), { code: 'STANDARD_FIXTURE_RESPONSE_BUDGET_INSUFFICIENT' });
  for (const outcome of ['blocked', 'deferred', 'rejected', 'failed', 'cancelled']) {
    const stopped = preflightStandardComposedFixture({ model, scenario: { ...correction, interruption: { node_id: 'session_pr_correction_decide', outcome } } });
    assert.equal(stopped.responses_required, 9); assert.equal(stopped.interrupted, true);
    assert.ok(!stopped.operations.includes('correction_initialize'));
    assert.notEqual(stopped.planned_status, 'COMPLETED');
  }
});
test("skipped promotion selects eight turns despite nine catalog activities", () => {
  const result = plan({ promotion: "skip", max_responses: 8 }); assert.equal(result.responses_required, 8);
  assert.ok(!result.native_occurrences.some(n => n.node_id === "promotion_drift_report"));
});
test("task-loop occurrences increase demand even though the catalog is unchanged", () => {
  const result = plan({ task_iterations: 2, max_responses: 10 }); assert.equal(result.responses_required, 10);
  assert.equal(result.native_occurrences.filter(n => n.node_id === "implement").length, 2);
});
test("non-retained closure bypasses promotion", () => {
  const result = plan({ closure: "drop", max_responses: 8 }); assert.equal(result.responses_required, 8);
  assert.ok(!result.operations.includes("promotion_decide"));
});
for (const mode of ["THINKING", "EXPLORING"]) {
  const prefix = mode.toLowerCase();
  test(mode + " plans analysis and closure drift; deterministic and human operations add no response", () => {
    const result = plan({ mode, cold_resume: false, max_responses: 2 });
    assert.equal(result.responses_required, 2);
    assert.deepEqual(result.native_occurrences.map(n => n.node_id), [prefix + "_analysis", prefix + "_session_closure_drift_report"]);
    assert.ok(result.operations.includes("mode_decision"));
    assert.ok(result.operations.includes(prefix + "_admit"));
    assert.ok(result.operations.includes(prefix + "_evaluate"));
    assert.ok(result.operations.includes(prefix + "_session_close_finalize"));
    assert.ok(!result.operations.includes("plan_select"));
    assert.throws(() => plan({ mode, max_responses: 1 }), { code: "STANDARD_FIXTURE_RESPONSE_BUDGET_INSUFFICIENT" });
    assert.equal(result.replay_exact, true); assert.equal(result.write_authorization, false);
    assert.equal(result.product_qualification, "NOT_ESTABLISHED");
    const analysis = model.nodes.find(n => n.id === prefix + "_analysis");
    assert.deepEqual(model.policies.find(p => p.id === analysis.policy_ref).allowed_permissions, ["read:product"]);
  });
  for (const outcome of ["blocked", "deferred", "rejected", "failed", "cancelled"]) {
    for (const nodeId of ["mode_decision", prefix + "_admit", prefix + "_evaluate"]) {
      test(mode + " " + nodeId + " " + outcome + " adds no model response or successful completion", () => {
        const result = plan({ mode, cold_resume: false, max_responses: 1, interruption: { node_id: nodeId, outcome } });
        const expected = nodeId === prefix + "_evaluate" ? [prefix + "_analysis"] : [];
        assert.equal(result.responses_required, expected.length);
        assert.deepEqual(result.native_occurrences.map(n => n.node_id), expected);
        assert.equal(result.interrupted, true);
        assert.equal(result.planned_status, ["blocked", "deferred"].includes(outcome) ? "WAITING" : outcome === "cancelled" ? "CANCELLED" : "FAILED");
        assert.equal(result.replay_exact, true); assert.equal(result.write_authorization, false);
      });
    }
  }
}
for (const outcome of ["blocked", "deferred", "rejected", "failed", "cancelled"]) test(outcome + " never becomes a positive closure", () => {
  const result = plan({ interruption: { node_id: "closure_decide", outcome }, max_responses: 5 });
  assert.equal(result.responses_required, 5); assert.equal(result.interrupted, true);
  assert.equal(result.planned_status, ["blocked", "deferred"].includes(outcome) ? "WAITING" : outcome === "cancelled" ? "CANCELLED" : "FAILED");
});
test("negative cycle admission selects just startup and no planning/implementation", () => {
  const result = plan({ interruption: { node_id: "cycle_admit", outcome: "blocked" }, max_responses: 1 });
  assert.deepEqual(result.native_occurrences.map(n => n.node_id), ["startup_drift_report"]);
});
test("native rejection remains failure and counts the response already consumed", () => {
  const result = plan({ interruption: { node_id: "implement", outcome: "rejected" }, max_responses: 4 });
  assert.equal(result.planned_status, "FAILED"); assert.equal(result.responses_required, 4);
});
test("short prefix stops at its selected ready node", () => { assert.equal(plan({}, "plan").responses_required, 2); });
test("malformed or unreachable scenarios fail explicitly", () => {
  assert.throws(() => plan({ max_responses: 0 }), { code: "STANDARD_FIXTURE_SCENARIO_INVALID" });
  assert.throws(() => plan({ task_iterations: 33 }), { code: "STANDARD_FIXTURE_SCENARIO_INVALID" });
  assert.throws(() => plan({ extra: true }), { code: "STANDARD_FIXTURE_SCENARIO_INVALID" });
  assert.throws(() => plan({ mode: "THINKING", interruption: { node_id: "implement", outcome: "failed" } }), { code: "STANDARD_FIXTURE_INTERRUPTION_NOT_REACHED" });
});
test("a new Node refuses a cold scenario or ceiling reset before creating its fixture", () => {
  const control = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-budget-guard-"));
  try {
    for (const change of [{ scenario: { ...scenario, max_responses: 8 } }, { authorization: { max_responses: 8 } }]) {
      const file = path.join(control, "resume.json");
      fs.writeFileSync(file, JSON.stringify({ scenario, authorization: { max_responses: 9 }, ...change }));
      const child = spawnSync(process.execPath, [fileURLToPath(new URL("./verify-agentic-process-execution-fixtures.mjs", import.meta.url)),
        "--standard-composed-mode=files", "--standard-composed-stop=component_complete", "--standard-composed-resume=" + file,
        "--standard-composed-preflight-only"], { encoding: "utf8", windowsHide: true, timeout: 30000 });
      assert.equal(child.status, 1); assert.equal(child.stdout, ""); assert.match(child.stderr, /Cold resume must preserve/);
    }
  } finally {
    // This test owns only the newly created small control directory.
    fs.rmSync(control, { recursive: true });
  }
});
console.log(JSON.stringify({ status: "PASS", checks, scope: "synthetic-budget-preflight", model_calls: 0,
  live_ports: "NOT_RUN", native_human_provider: "NOT_RUN", installed_archive: "NOT_RUN", full_standard_workflow: false }));
