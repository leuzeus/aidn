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
const finalVerificationOnly = process.argv.includes("--final-verification");
const cycleEntryOnly = process.argv.includes("--cycle-entry-only");
if (cycleEntryOnly && finalVerificationOnly) throw Error("STANDARD_PREFLIGHT_FOCUS_CONFLICT");
const test = (name, run, finalVerification = false) => {
  if (cycleEntryOnly && !["owned OPEN entry budget skips creation and planning in the delivered model", "setup uses pinned call data and deterministic/H operations without another native response"].includes(name)) return;
  if (finalVerificationOnly && !finalVerification) return;
  run(); checks++; console.log("PASS " + name);
};
const plan = (changes = {}, stop = "pr_effects_pending") => preflightStandardComposedFixture({ model, scenario: { ...scenario, ...changes }, stop });
function verifyPlanningOrigin(result, expectedBinding) {
  const expectedNode = expectedBinding === "cycle_owned_resume_admit" ? "owned_resume" : "plan_record";
  const origins = result.source_operations.filter(row => row.binding_ref === expectedBinding && row.node_id === expectedNode);
  assert.equal(origins.length, 1);
  const origin = origins[0], readiness = result.source_operations.find(row => row.node_id === "readiness");
  assert.equal(readiness.input.record_operation_id, origin.operation_id);
  const calls = result.call_transitions.filter(row => row.node_id === "work_prepare");
  assert.deepEqual(calls.map(row => row.kind), ["call_enter", "call_return"]);
  const returned = calls[1], selected = result.source_operations.find(row => row.binding_ref === "cycle_plan_select");
  assert.equal(returned.resolution.input.record_operation_id, origin.operation_id);
  assert.equal(returned.witnesses.length, 1);
  assert.equal(returned.witnesses[0].operation_id, selected.operation_id);
  const witness = returned.witnesses[0].results[0];
  assert.equal(witness.receipt.outcome, "completed");
  assert.equal(witness.output.observations.record_operation_id, origin.operation_id);
  const phase = result.source_operations.find(row => row.binding_ref === "cycle_execution_source_select");
  assert.equal(phase.input.record_operation_id, origin.operation_id);
  assert.equal(phase.sources[0].source, "call_output");
}

test("owned OPEN entry budget skips creation and planning in the delivered model", () => {
  const result = preflightStandardComposedFixture({ model, scenario: { ...scenario, max_responses: 1 }, stop: "task_select", cycleEntry: "owned_open" });
  assert.equal(result.proof_class, "synthetic-fixture-only"); assert.equal(result.product_qualification, "NOT_ESTABLISHED");
  assert.equal(result.responses_required, 1); assert.deepEqual(result.native_occurrences.map(row => row.node_id), ["startup_drift_report"]);
  for (const id of ["cycle_entry_observe", "owned_entry", "owned_resume", "plan_select", "readiness", "implementation_enter", "phase_select"]) assert.ok(result.operations.includes(id));
  for (const id of ["cycle_admit", "cycle_initialize", "plan_evaluate", "plan_record"]) assert.equal(result.operations.includes(id), false);
  assert.ok(result.operations.indexOf("cycle_refresh_before") < result.operations.indexOf("cycle_entry_observe"));
  assert.equal(result.operations.includes("session_git_checkpoint"), false);
  const work = preflightStandardComposedFixture({ model, scenario: { ...scenario, task_iterations: 2, cold_resume: false, max_responses: 6 }, stop: "audit_select", cycleEntry: "owned_open" });
  assert.equal(work.responses_required, 3); assert.equal(work.original_max_responses, 6);
  assert.deepEqual(work.native_occurrences.map(row => row.node_id), ["startup_drift_report", "implement", "implement"]);
  assert.equal(work.operations.filter(id => id === "task_advance").length, 2); assert.ok(work.operations.includes("verification_enter"));
  assert.equal(work.operations.includes("audit_select"), false); assert.equal(work.replay_exact, true); assert.equal(work.write_authorization, false);
  verifyPlanningOrigin(result, "cycle_owned_resume_admit");
  assert.deepEqual(result.call_transitions.filter(row => row.node_id === "owned_cycle").map(row => row.kind), ["call_enter", "call_return"]);
  assert.equal(result.operations.includes("plan_adopt"), false);
  assert.equal(result.replay_exact, true); assert.equal(result.write_authorization, false);
});
test("setup uses pinned call data and deterministic/H operations without another native response", () => {
  const result = plan(), transitions = result.call_transitions.filter(row => row.node_id === "session_setup");
  assert.ok(result.operations.indexOf("cycle_entry_observe") < result.operations.indexOf("session_git_checkpoint"));
  assert.ok(result.operations.indexOf("session_git_checkpoint") < result.operations.indexOf("cycle_entry"));
  assert.ok(result.operations.indexOf("session_git_checkpoint") < result.operations.indexOf("cycle_admit"));
  assert.deepEqual(transitions.map(row => row.kind), ["call_enter", "call_return"]);
  assert.deepEqual(transitions[0].resolution.input, { session_id: "S001", session_branch: "S001-standard", objective: "Synthetic fixture budget planning" });
  assert.deepEqual(transitions[1].resolution.input, {});
  assert.deepEqual(result.operations.slice(0, 6), ["context_reload", "session_admit", "session_initialize", "mode_decision", "session_mode_apply", "session_admit"]);
  assert.equal(result.responses_required, scenario.max_responses);
  const deferred = plan({ interruption: { node_id: "mode_decision", outcome: "deferred" }, max_responses: 1 });
  assert.deepEqual(deferred.call_transitions.map(row => [row.node_id, row.kind]), [["session_setup", "call_enter"]]);
  assert.equal(deferred.responses_required, 0); assert.equal(deferred.planned_status, "WAITING");
  assert.ok(!deferred.operations.includes("session_mode_apply"));
});
function verifyFinalVerificationCalls(result, sites) {
  const transitions = result.call_transitions.filter(row => sites.includes(row.node_id));
  assert.deepEqual(transitions.map(row => [row.node_id, row.kind]),
    sites.flatMap(site => [[site, "call_enter"], [site, "call_return"]]));
  assert.equal(result.verification_inputs.length, sites.length * 2);
  for (let index = 0; index < sites.length; index++) {
    const [entry, returned] = transitions.slice(index * 2, index * 2 + 2);
    const [evaluation, verification] = result.verification_inputs.slice(index * 2, index * 2 + 2);
    assert.deepEqual(entry.resolution.sources.map(source => [source.field, source.source, source.operation_id]),
      ["progress_operation_id", "validation_operation_id"].map(field => [field, "operation_id", entry.resolution.input[field]]));
    assert.deepEqual(evaluation.input, entry.resolution.input);
    assert.equal(evaluation.occurrence_id, entry.occurrence_id + "/call/0");
    assert.deepEqual(verification.input, { evaluation_operation_id: evaluation.operation_id });
    assert.equal(verification.occurrence_id, entry.occurrence_id + "/call/1");
    assert.equal(returned.occurrence_id, entry.occurrence_id);
    assert.deepEqual(returned.resolution.input, {});
    assert.deepEqual([entry.witnesses, returned.witnesses], [[], []]);
  }
  const inputs = transitions.filter(row => row.kind === "call_enter").flatMap(row => Object.values(row.resolution.input));
  assert.equal(new Set(inputs).size, inputs.length);
}
function verifyReviewCall(result, prefix) {
  const captureSites = prefix === "correction" ? ["session_pr_review_capture", "correction_pr_review_capture"] : ["session_pr_review_capture"];
  const captures = result.call_transitions.filter(row => captureSites.includes(row.node_id));
  assert.deepEqual(captures.map(({ node_id, kind }) => [node_id, kind]),
    captureSites.flatMap(site => [[site, "call_enter"], [site, "call_return"]]));
  for (const capture of captures) {
    assert.deepEqual(capture.resolution.input, {});
    assert.deepEqual(capture.resolution.sources, []);
    assert.deepEqual(capture.witnesses, []);
  }
  const [entry] = result.call_transitions.slice(-1);
  assert.equal(entry.node_id, prefix + "_pr_effects_pending");
  assert.equal(entry.kind, "call_enter");
  assert.equal(result.call_transitions.filter(row => row.node_id.endsWith("_pr_effects_pending")).length, 1);
  assert.deepEqual(entry.witnesses, []);
  const { triage_operation_id } = entry.resolution.input;
  assert.ok(triage_operation_id);
  assert.deepEqual(entry.resolution.sources.map(({ field, source, operation_id }) => [field, source, operation_id]),
    [["triage_operation_id", "operation_id", triage_operation_id]]);
  assert.equal(result.operations.at(-1), prefix + "_pr_premerge_observe");
}
test("positive path selects nine native turns; its cold prefix keeps the same cumulative ceiling", () => {
  const result = plan();
  assert.equal(result.responses_required, 9); assert.equal(result.original_max_responses, 9);
  assert.equal(result.native_occurrences.filter(n => n.node_id === "implement").length, 1);
  assert.equal(result.cold_resume_checkpoints.length, 1); assert.equal(result.cold_resume_checkpoints[0].responses, 5);
  assert.equal(result.responses_required - result.cold_resume_checkpoints[0].responses, 4);
  assert.equal(result.planned_status, "WAITING"); assert.equal(result.replay_exact, true);
  assert.equal(result.operations.length, 74); assert.equal(result.event_count, 178);
  verifyPlanningOrigin(result, "cycle_plan_record");
  assert.equal(result.operations.filter(id => id === "cycle_entry_observe").length, 1);
  assert.equal(result.operations.filter(id => id === "cycle_entry").length, 1);
  verifyFinalVerificationCalls(result, ["final_verification"]);
  verifyReviewCall(result, "session");
  assert.equal(result.write_authorization, false); assert.equal(result.product_qualification, "NOT_ESTABLISHED");
}, true);
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
    "--standard-composed-mode=files", "--standard-composed-stop=pr_effects_pending", "--standard-composed-max-responses=8", "--standard-composed-preflight-only"],
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
  const result = preflightStandardComposedFixture({ model, scenario: correction, stop: "pr_effects_pending" });
  assert.equal(result.responses_required, 17); assert.equal(result.planned_status, 'WAITING');
  assert.equal(result.operations.length, 137); assert.equal(result.event_count, 333);
  verifyPlanningOrigin(result, "cycle_plan_record");
  assert.equal(result.operations.filter(id => id === "cycle_entry_observe").length, 1);
  assert.equal(result.operations.filter(id => id === "cycle_entry").length, 1);
  const correctiveDrift = result.call_transitions.filter(row => row.node_id === "correction_cycle_drift_finalize");
  assert.deepEqual(correctiveDrift.map(row => row.kind), ["call_enter", "call_return"]);
  const evaluation = correctiveDrift[0].resolution.input.evaluation_operation_id;
  assert.deepEqual(correctiveDrift[0].resolution.sources.map(({ source, operation_id }) => [source, operation_id]), [["operation_id", evaluation]]);
  const decisionIndex = result.operations.indexOf("correction_cycle_drift_decide");
  assert.ok(decisionIndex > 0);
  assert.deepEqual(result.operations.slice(decisionIndex - 2, decisionIndex + 4), ["correction_cycle_drift_evaluate",
    "correction_cycle_drift_select", "correction_cycle_drift_decide", "correction_cycle_drift_finalize",
    "correction_cycle_drift_checkpoint_review", "correction_cycle_checkpoint"]);
  for (const stage of ["cycle", "closure", "promotion", "session_closure"]) {
    const site = `correction_${stage}_drift_finalize`, evaluationNode = site.replace(/_finalize$/, "_evaluate");
    const call = model.nodes.find(row => row.id === site), input = model.data_bindings.inputs.find(row => row.node_id === site);
    assert.equal(call.kind, "call"); assert.equal(call.target.model_id, "aidn-standard-corrective-drift");
    assert.deepEqual(input.fields, { evaluation_operation_id: { source: "operation_id", node_id: evaluationNode } });
    const [enter, returned] = result.call_transitions.filter(row => row.node_id === site);
    assert.equal(enter.kind, "call_enter"); assert.equal(returned.kind, "call_return");
    assert.equal(returned.witnesses.length, 1);
    assert.equal(returned.resolution.input.finalization_operation_id, returned.witnesses[0].operation_id);
    assert.equal(returned.witnesses[0].preview.input.evaluation_operation_id, enter.resolution.input.evaluation_operation_id);
  }
  assert.deepEqual(model.data_bindings.inputs.find(row => row.node_id === "correction_session_closure_decide").fields.drift_finalization_operation_id,
    { source: "call_output", node_id: "correction_session_closure_drift_finalize", path: ["finalization_operation_id"] });
  verifyFinalVerificationCalls(result, ["final_verification", "correction_final_verification"]);
  verifyReviewCall(result, "correction");
  assert.ok(result.operations.includes('correction_initialize'));
  assert.ok(result.operations.includes('correction_session_branch_integrate'));
  assert.ok(result.operations.includes('correction_pr_redelivery_push'));
  assert.ok(result.operations.includes('correction_pr_triage_evaluate'));
  assert.equal(result.native_occurrences.filter(row => row.node_id === 'correction_implement').length, 1);
  assert.equal(result.replay_exact, true); assert.equal(result.write_authorization, false);
}, true);
test("correction retains its original budget refusal and interruption choices", () => {
  const correction = JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/standard-workflow/composed-correction.v3.json', import.meta.url)));
  assert.throws(() => preflightStandardComposedFixture({ model, scenario: { ...correction, max_responses: 16 }, stop: "pr_effects_pending" }), { code: 'STANDARD_FIXTURE_RESPONSE_BUDGET_INSUFFICIENT' });
  for (const outcome of ['blocked', 'deferred', 'rejected', 'failed', 'cancelled']) {
    const stopped = preflightStandardComposedFixture({ model, scenario: { ...correction, interruption: { node_id: 'session_pr_correction_decide', outcome } } });
    assert.equal(stopped.responses_required, 9); assert.equal(stopped.interrupted, true);
    assert.ok(!stopped.operations.includes('correction_initialize'));
    assert.notEqual(stopped.planned_status, 'COMPLETED');
  }
  for (const stage of ["cycle", "closure", "promotion", "session_closure"]) for (const suffix of ["decide", "checkpoint_review"]) {
    const node_id = `correction_${stage}_drift_${suffix}`;
    const deferred = preflightStandardComposedFixture({ model, scenario: { ...correction, interruption: { node_id, outcome: "deferred" } } });
    assert.equal(deferred.planned_status, "WAITING");
    assert.deepEqual(deferred.call_transitions.filter(row => row.node_id === `correction_${stage}_drift_finalize`).map(row => row.kind), ["call_enter"]);
    assert.ok(!deferred.operations.includes("correction_session_closure_decide"));
  }
});
test("an interrupted final evaluation retains its entry without returning or entering verification", () => {
  const result = plan({ interruption: { node_id: "final_validation", outcome: "blocked" } });
  assert.equal(result.interrupted, true);
  assert.deepEqual(result.call_transitions.map(row => [row.node_id, row.kind]),
    [["session_setup", "call_enter"], ["session_setup", "call_return"], ["work_prepare", "call_enter"],
      ["work_prepare", "call_return"], ["final_verification", "call_enter"]]);
  assert.deepEqual(result.verification_inputs.map(row => row.node_id), ["final_validation"]);
  assert.ok(!result.operations.includes("verification_enter"));
}, true);
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
    const result = plan({ mode, cold_resume: false, max_responses: 2 }, "component_complete");
    assert.equal(result.responses_required, 2);
    assert.deepEqual(result.native_occurrences.map(n => n.node_id), [prefix + "_analysis", prefix + "_session_closure_drift_report"]);
    assert.ok(result.operations.includes("mode_decision"));
    assert.ok(result.operations.includes(prefix + "_admit"));
    assert.ok(result.operations.includes(prefix + "_evaluate"));
    assert.ok(result.operations.includes(prefix + "_session_close_finalize"));
    assert.ok(!result.operations.includes("plan_select"));
    assert.throws(() => plan({ mode, max_responses: 1 }, "component_complete"), { code: "STANDARD_FIXTURE_RESPONSE_BUDGET_INSUFFICIENT" });
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
        "--standard-composed-mode=files", "--standard-composed-stop=pr_effects_pending", "--standard-composed-resume=" + file,
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
