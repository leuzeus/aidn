import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStandardBaselinePromotionAuthority } from "../../src/application/runtime/standard-baseline-promotion-authority.mjs";
import { baselinePromotionChoices } from "../../src/core/workflow/standard-baseline-promotion-decision.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
const temporary = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(temporary, "aidn-promotion-authority-"));
let checks = 0;
async function test(name, run) { await run(); checks++; console.log("PASS " + name); }
const sha = "a".repeat(64), closureId = "op_" + "c".repeat(40), recordId = "op_" + "d".repeat(40), selectionId = "op_" + "e".repeat(40), decisionId = "op_" + "f".repeat(40);
const instance = { instance_id: "fixture", scope_id: "scope" }, input = { closure_operation_id: closureId };
const eventFile = path.join(root, ".aidn/runtime/perf/workflow-events.ndjson"); fs.mkdirSync(path.dirname(eventFile), { recursive: true });
function fixture() {
  const prefix = JSON.stringify({ event: "fixture", text: "préfixe 🧪" }) + "\n", event = { event: "checkpoint_summary", run_id: "process_close_" + closureId.slice(3), result: "ok" };
  fs.writeFileSync(eventFile, prefix + JSON.stringify(event) + "\n");
  const closed = { record: { operation_id: closureId, preview: { prepared: { plan: { operation_id: closureId, input: { closure_operation_id: recordId }, scope: { cycle_id: "C001", target_state: "DONE" } } } } },
    output: { operation_ref: "cycle_close_finalize", outcome: "completed", effect_status: "confirmed", facts: { cycle_close_completed: true, cycle_retained: true },
      observations: { target_state: "DONE", event, event_file: ".aidn/runtime/perf/workflow-events.ndjson", event_offset: Buffer.byteLength(prefix) } } };
  const recorded = { record_operation_id: recordId, plan: { input: { decision_operation_id: selectionId }, cycle_path: "cycles/C001-build-example" } };
  const question = { contract_version: "standard-baseline-promotion-question.v1", operation_id: decisionId, ...instance, occurrence_id: "promotion:0", intent_sha256: sha, session_id: "S001",
    choices: [...baselinePromotionChoices], review: { session_id: "S001", cycle_id: "C001", cycle_path: recorded.plan.cycle_path, closure_operation_id: closureId,
      closure_output_sha256: shadowHash(closed.output), context_sha256: sha, product_sha256: sha, baseline_sha256: sha, history_sha256: sha, current_version: "v0.1", evidence_refs: [{ ref: "closure/result", sha256: sha }] } };
  const decision = { contract_version: "human-baseline-promotion-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "promotion:1",
    question_sha256: shadowHash(question), subject_sha256: shadowHash(question.review), choice: "promote", rationale: "Explicit fixture decision",
    promotion: { version: "v0.2", summary: "Retained work" }, evidence_refs: [{ ref: "human/selection", sha256: sha }] };
  let allowed = true; const calls = [];
  const authority = createStandardBaselinePromotionAuthority({ targetRoot: root,
    readAcceptedOperation(actual, id, binding) { assert.deepEqual(actual, instance); calls.push([id, binding]); if (!allowed) throw Object.assign(Error("fixture rejected source"), { code: "FIXTURE_ACCEPTED_SOURCE_REQUIRED" });
      if (id === closureId && binding === "cycle_close_finalize") return structuredClone(closed);
      if (id === selectionId && binding === "cycle_closure_decision") return { record: { kind: "selection" } };
      if (id === decisionId && binding === "baseline_promotion_decision") return { record: { kind: "promotion" } }; throw Error("FIXTURE_SOURCE_ID_INVALID"); },
    readTerminalRecord(actual, selected) { assert.deepEqual(actual, instance); assert.equal(selected.closure_operation_id, recordId); return structuredClone(recorded); },
    human: { question(record) { return record.kind === "promotion" ? structuredClone(question) : { session_id: "S001", review: { cycle_id: "C001", product_sha256: sha } }; },
      captured() { return { source: structuredClone(decision) }; } } });
  return { authority, closed, recorded, question, decision, calls, deny() { allowed = false; } };
}
try {
  await test("fixed reader observes a physically correlated checkpoint at a Unicode byte offset", async () => {
    const f = fixture(), before = fs.readFileSync(eventFile), result = await f.authority.readClosure(instance, input);
    assert.equal(result.operation_id, closureId); assert.equal(result.cycle_id, "C001"); assert.equal(result.product_sha256, sha); assert.deepEqual(fs.readFileSync(eventFile), before);
    assert.deepEqual(f.calls, [[closureId, "cycle_close_finalize"], [selectionId, "cycle_closure_decision"]]);
  });
  await test("later unrelated events preserve the same confirmed checkpoint identity", async () => {
    const f = fixture(); fs.appendFileSync(eventFile, JSON.stringify({ event: "later_fixture" }) + "\n"); await f.authority.readClosure(instance, input);
  });
  await test("unaccepted journal capability refuses before physical evidence can grant anything", async () => {
    const f = fixture(); f.deny(); await assert.rejects(f.authority.readClosure(instance, input), { code: "FIXTURE_ACCEPTED_SOURCE_REQUIRED" });
  });
  await test("non-retained incomplete foreign and mis-correlated closures refuse", async () => {
    for (const mutate of [f => f.closed.output.facts.cycle_retained = false, f => f.closed.output.outcome = "rejected", f => f.closed.output.operation_ref = "foreign",
      f => f.recorded.record_operation_id = decisionId, f => f.closed.record.preview.prepared.plan.scope.cycle_id = "C002"]) {
      const f = fixture(); mutate(f); await assert.rejects(f.authority.readClosure(instance, input), { code: "STANDARD_PROMOTION_COMPLETED_CLOSURE_REQUIRED" }); }
  });
  await test("changed event bytes offset identity or an alternate event path cannot substitute proof", async () => {
    for (const mutate of [f => fs.writeFileSync(eventFile, "{}\n"), f => f.closed.output.observations.event_offset++, f => f.closed.output.observations.event.run_id = "foreign",
      f => f.closed.output.observations.event_file = "elsewhere"]) {
      const f = fixture(); mutate(f); await assert.rejects(f.authority.readClosure(instance, input)); }
  });
  await test("request construction consumes the exact accepted human choice and closure output", async () => {
    const f = fixture(), result = await f.authority.readRequest(instance, { decision_operation_id: decisionId });
    assert.equal(result.request.version, "v0.2"); assert.equal(result.request.decision_operation_id, decisionId); assert.equal(result.closure.operation_id, closureId);
    f.question.review.closure_output_sha256 = "f".repeat(64); f.decision.question_sha256 = shadowHash(f.question); f.decision.subject_sha256 = shadowHash(f.question.review);
    await assert.rejects(f.authority.readRequest(instance, { decision_operation_id: decisionId }), { code: "STANDARD_PROMOTION_COMPLETED_CLOSURE_REQUIRED" });
  });
  await test("a valid not-requested decision cannot produce a baseline write request", async () => {
    const f = fixture(); f.decision.choice = "not_requested"; f.decision.promotion = null;
    await assert.rejects(f.authority.readRequest(instance, { decision_operation_id: decisionId }), { code: "PROCESS_PROMOTION_NOT_REQUESTED" });
  });
  console.log(JSON.stringify({ status: "PASS", checks, proof: "promotion-source-reader-with-real-event-file", accepted_journal_capability: "fixture",
    human_authentication: "NOT_RUN", actual_closure: "NOT_RUN", application_writes: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
} finally {
  const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary); assert.ok(path.basename(real).startsWith("aidn-promotion-authority-")); fs.rmSync(real, { recursive: true, force: true });
}
