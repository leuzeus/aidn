#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createStandardHumanDecisions } from "../../src/application/runtime/standard-workflow-human-decisions.mjs";
import { createStandardSessionClosureReview } from "../../src/application/runtime/standard-session-closure-review.mjs";
import { createProcessDecisionInboxStore } from "../../src/adapters/runtime/process-decision-inbox-store.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { assertDecisionInbox, decisionInboxPath } from "../../src/core/workflow/process-decision-inbox.mjs";
import { assertSessionClosureDecisionOutput, assertSessionClosureQuestion, sessionClosureChoices } from "../../src/core/workflow/standard-session-closure-decision.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
const H = "a".repeat(64), op = x => "op_" + x.repeat(40), key = randomBytes(32), signer = createOperationJournalSigner(() => key);
const selectedMode = process.argv.find(value => value.startsWith("--mode="))?.slice(7);
if (selectedMode && !["files", "dual", "db-only"].includes(selectedMode)) throw Error("FIXTURE_MODE_INVALID");
const baseReview = () => ({ session_id: "S001", session_path: "sessions/S001.md", mode: "COMMITTING", branch: "C001-feature-example", session_branch: "S001-example", head: "a".repeat(40),
  admission_operation_id: op("a"), admission_output_sha256: H, drift_evaluation_operation_id: op("b"), drift_evaluation_output_sha256: H,
  drift_finalization_operation_id: op("c"), drift_finalization_output_sha256: H, context_sha256: H, scope_sha256: H,
  documents: ["sessions/S001.md", "CURRENT-STATE.md", "snapshots/context-snapshot.md"].map(ref => ({ ref: "audit:" + ref, sha256: H, metadata_sha256: H })), open_cycles: [], session_close_gate_satisfied: false });
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log("PASS " + name); };
function fixture(makeInbox) {
  const rows = new Map(), sources = new Map(); let verified = true, calls = 0;
  const inbox = makeInbox ? makeInbox() : { read(id) { const record = structuredClone(rows.get(id) ?? null); return { record, content_sha256: record ? shadowHash(record) : null }; },
    compareAndSwap(row, before) { assertDecisionInbox(row); assert.equal(this.read(row.inbox_id).content_sha256, before); rows.set(row.inbox_id, structuredClone(row)); return { projection: "canonical" }; } };
  const source = { read({ sourceRef }) { calls++; return structuredClone(sources.get(sourceRef) ?? null); },
    verify({ source: claim, sourceRef }) { calls++; return { outcome: verified && shadowHash(claim) === shadowHash(sources.get(sourceRef)) ? "verified" : "rejected", authority_id: claim.authority_id, source_sha256: shadowHash(claim) }; } };
  const human = () => createStandardHumanDecisions({ inbox, signer, source, projectionRequired: false });
  const record = { operation_id: op("d"), intent: { binding_ref: "session_closure_decision", instance_id: "fixture", scope_id: "scope", occurrence_id: "close:0" },
    preview: { prepared: { plan: { review: baseReview(), choices: sessionClosureChoices(baseReview()) } } }, results: [] };
  const claim = (choice = "close") => { const q = human().question(record); return { contract_version: "human-session-closure-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "session-close:1",
    question_sha256: shadowHash(q), subject_sha256: shadowHash(q.review), choice, rationale: "Explicit session close decision",
    session_report: choice === "close" ? { summary: "Retain verified outputs", open_loops: [], blockers: [], next_entry_point: "Review the session branch" } : null,
    evidence_refs: [{ ref: "human/selection", sha256: H }] }; };
  return { rows, sources, human, record, claim, deny: () => { verified = false; }, calls: () => calls };
}
await test("seven private closed schemas use supported vocabulary and matching identifiers", () => {
  for (const name of ["standard-session-closure-review.v1", "standard-session-closure-review-input.v1", "standard-session-closure-review-plan.v1", "standard-session-closure-question.v1", "human-session-closure-decision.v1", "standard-session-closure-decision-output.v1", "process-decision-inbox.v5"]) {
    const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/" + name + ".schema.json", import.meta.url), "utf8"));
    assert.equal(schema["x-aidn-contract-version"], name); assert.equal(schema.$id, "aidn://contracts/workflow-definition/" + name);
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
});
await test("no source leaves a durable human wait without fabricated success or reservation", async () => {
  const f = fixture(); assert.equal(await f.human().reserve(f.record, "fixture:answer"), null); assert.equal(f.rows.size, 0);
});
await test("provider authentication is mandatory for schema-valid close decision", async () => {
  const f = fixture(); f.sources.set("fixture:answer", f.claim()); f.deny(); await assert.rejects(f.human().reserve(f.record, "fixture:answer"), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" }); assert.equal(f.rows.size, 0);
});
await test("all decisions preserve no-effect semantics and never claim session completion", async () => {
  for (const choice of ["close", "refused", "deferred", "cancelled"]) {
    const f = fixture(); f.sources.set("fixture:answer", f.claim(choice)); const capture = await f.human().reserve(f.record, "fixture:answer"), output = f.human().output(f.record, capture);
    assertSessionClosureDecisionOutput(output); assert.equal(output.effect_status, "no_effect");
    assert.deepEqual(output.facts, choice === "close" ? { session_closure_requested: true, session_close_completed: false } : {});
    const forged = structuredClone(output); forged.facts.session_close_completed = true;
    assert.throws(() => assertSessionClosureDecisionOutput(forged), { code: "STANDARD_SESSION_CLOSURE_OUTPUT_INVALID" });
  }
});
await test("changed question subject, unoffered close and multiline metadata injection are rejected", async () => {
  const f = fixture(), stale = f.claim(); f.record.preview.prepared.plan.review.context_sha256 = "f".repeat(64); f.sources.set("fixture:answer", stale);
  await assert.rejects(f.human().reserve(f.record, "fixture:answer"), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
  const g = fixture(); g.record.preview.prepared.plan.review.open_cycles = ["C001"]; g.record.preview.prepared.plan.choices = sessionClosureChoices(g.record.preview.prepared.plan.review);
  g.sources.set("fixture:answer", g.claim()); await assert.rejects(g.human().reserve(g.record, "fixture:answer"), { code: "PROCESS_HUMAN_CHOICE_NOT_OFFERED" });
  const h = fixture(), bad = h.claim(); bad.session_report.summary = "done\nmode: THINKING"; h.sources.set("fixture:answer", bad);
  await assert.rejects(h.human().reserve(h.record, "fixture:answer"), { code: "PROCESS_SESSION_CLOSURE_SOURCE_INVALID" });
});
await test("review cannot authorize already closed or unresolved sessions", () => {
  const r = baseReview(); r.session_close_gate_satisfied = true; assert.ok(!sessionClosureChoices(r).includes("close"));
  const f = fixture(), q = f.human().question(f.record); q.review.session_path = "sessions/S999.md";
  assert.throws(() => assertSessionClosureQuestion(q), { code: "PROCESS_SESSION_CLOSURE_REVIEW_INVALID" });
});
await test("v5 HMAC capture survives recreation and provider loss without replaying the decision", async () => {
  const f = fixture(); f.sources.set("fixture:answer", f.claim()); const capture = await f.human().reserve(f.record, "fixture:answer"); assert.equal(capture.contract_version, "process-decision-inbox.v5"); signer.verify(capture);
  const receipt = { receipt_id: "fixture_receipt" }; f.record.results.push({ output: f.human().output(f.record, capture), receipt }); f.human().acknowledge(capture.inbox_id, receipt);
  const before = shadowHash([...f.rows]), calls = f.calls(); f.sources.clear(); assert.equal(f.human().captured(f.record).phase, "receipted"); f.human().acknowledge(capture.inbox_id, receipt);
  assert.equal(shadowHash([...f.rows]), before); assert.equal(f.calls(), calls);
});
await test("a captured source cannot be reused for another waiting occurrence", async () => {
  const f = fixture(); f.sources.set("fixture:answer", f.claim()); await f.human().reserve(f.record, "fixture:answer"); f.record.operation_id = op("e"); f.sources.set("fixture:answer", f.claim());
  await assert.rejects(f.human().reserve(f.record, "fixture:answer"), { code: "PROCESS_HUMAN_SOURCE_ALREADY_USED" });
});
await test("review checks correlated admission/R05 capability results and detects stale context", async () => {
  const input = { contract_version: "standard-session-closure-review-input.v1", admission_operation_id: op("a"), drift_evaluation_operation_id: op("b"), drift_finalization_operation_id: op("c") };
  const r = baseReview(), source = { admission: { operation_id: op("a"), session_id: "S001", output: { facts: { session_close_admission_satisfied: true } } },
    evaluation: { operation_id: op("b"), output: { facts: { drift_present: false, drift_context_complete: true, drift_recovery_required: false } } },
    finalization: { operation_id: op("c"), output: { facts: { drift_check_completed: true }, observations: { evaluation_operation_id: op("b") } } }, current: { ...r, admission_allowed: true } };
  const review = createStandardSessionClosureReview({ readSource: async () => structuredClone(source) }), instance = { instance_id: "fixture" };
  const prepared = await review.prepare(instance, input); await review.assertFresh(instance, prepared.plan);
  source.current.context_sha256 = "b".repeat(64); await assert.rejects(review.assertFresh(instance, prepared.plan), { code: "STANDARD_SESSION_CLOSURE_REVIEW_CHANGED" });
  source.evaluation.output.facts.drift_recovery_required = true; await assert.rejects(review.prepare(instance, input), { code: "STANDARD_SESSION_CLOSURE_ACCEPTED_SOURCE_REQUIRED" });
});
if (!process.argv.includes("--contract-only")) {
  const owned = [], temporary = fs.realpathSync(os.tmpdir());
  try {
    for (const mode of selectedMode ? [selectedMode] : ["files", "dual", "db-only"]) await test("real canonical v5 inbox, cold capture, no implicit DB export and tamper refusal: " + mode, async () => {
      const root = createStandardWorkflowFixture(mode, owned), makeInbox = () => createProcessDecisionInboxStore({ targetRoot: root, stateMode: mode }), f = fixture(makeInbox);
      f.sources.set("fixture:answer", f.claim()); const capture = await f.human().reserve(f.record, "fixture:answer"), receipt = { receipt_id: "fixture_receipt" };
      f.record.results.push({ output: f.human().output(f.record, capture), receipt }); const cold = fixture(makeInbox); cold.human().acknowledge(capture.inbox_id, receipt);
      assert.equal(cold.human().captured(f.record).phase, "receipted"); assert.equal(cold.calls(), 0);
      assert.equal(fs.existsSync(path.join(root, "docs/audit", decisionInboxPath(capture.inbox_id))), mode !== "db-only");
      const store = makeInbox(), before = store.read(capture.inbox_id), forged = structuredClone(before.record); forged.source.session_report.summary = "Forged retained decision";
      store.compareAndSwap(forged, before.content_sha256); assert.throws(() => fixture(makeInbox).human().captured(f.record), { code: "PROCESS_JOURNAL_NOT_AUTHENTICATED" });
    });
  } finally {
    for (const root of owned.reverse()) { const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), temporary); assert.ok(path.basename(resolved).startsWith("aidn-standard-ports-")); fs.rmSync(resolved, { recursive: true, force: true }); }
  }
}
console.log(JSON.stringify({ status: "PASS", checks, provider: "FIXTURE", actual_hmac: true, canonical_store: process.argv.includes("--contract-only") ? "NOT_RUN" : "ACTUAL", model_calls: 0,
  actual_admission_and_R05_source_chain: "NOT_RUN", published_model_wiring: "NOT_EXECUTED_HERE", session_closed: false, native: "NOT_RUN", installed_archive: "NOT_RUN" }));
