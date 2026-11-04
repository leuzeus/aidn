import assert from "node:assert/strict";
import fs from "node:fs";
import { renderStandardSessionClose, renderStandardSessionCloseCompletion } from "../../src/core/workflow/standard-session-close-render.mjs";
import { readSessionClosureHistory, assertSessionClosureRecord } from "../../src/core/workflow/standard-session-closure-history.mjs";
import { renderPrCorrectionReopen } from "../../src/core/workflow/standard-pr-correction-reopen.mjs";
import { sessionClosureChoices } from "../../src/core/workflow/standard-session-closure-decision.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
const H = "a".repeat(64), op = n => "op_" + n.repeat(40), at = Date.parse("2026-11-04T18:00:00.000Z");
const row = (path, content) => ({ path, content, sha256: artifactContentHash(content) });
const docs = () => [row("sessions/S001.md", "# Session S001\n\nstate: OPEN\nlifecycle_status: active\nupdated_at: before\npr_status: open\npr_review_status: pending\n\n"
  + ["Outputs", "Open loops", "Blockers", "Cycle Resolution At Session Close", "Next Entry Point", "Session close gate satisfied", "Snapshot updated"].map(title => "### " + title + "\n\n- pending\n\n").join("")),
  row("snapshots/context-snapshot.md", "# Snapshot\nupdated_at: before\n\n## Next entry point\n\n- pending\n"),
  row("CURRENT-STATE.md", "# Current\nactive_session: S001\nactive_cycle: none\nmode: COMMITTING\nsession_pr_status: open\nsession_pr_review_status: pending\nupdated_at: before\nfirst_plan_step: pending\n")];
const apply = changes => changes.map(change => row(change.path, change.text_chunks.join("")));
function question(documents, n = "d") {
  const review = { session_id: "S001", session_path: "sessions/S001.md", mode: "COMMITTING", branch: "C002-feature-correction", session_branch: "S001-example", head: n.repeat(40),
    admission_operation_id: op("a"), admission_output_sha256: H, drift_evaluation_operation_id: op("b"), drift_evaluation_output_sha256: H,
    drift_finalization_operation_id: op("c"), drift_finalization_output_sha256: H, context_sha256: shadowHash(documents), scope_sha256: H,
    documents: documents.map(value => ({ ref: "audit:" + value.path, sha256: value.sha256, metadata_sha256: null })), open_cycles: [], session_close_gate_satisfied: false };
  return { contract_version: "standard-session-closure-question.v1", operation_id: op(n), instance_id: "fixture", scope_id: "scope", occurrence_id: "close:" + n,
    intent_sha256: H, session_id: "S001", review, choices: sessionClosureChoices(review) };
}
const decision = q => ({ contract_version: "human-session-closure-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: q.occurrence_id,
  question_sha256: shadowHash(q), subject_sha256: shadowHash(q.review), choice: "close", rationale: "Fresh closure of this exact subject", evidence_refs: [{ ref: "fixture:human", sha256: H }],
  session_report: { summary: "Verified current correction", open_loops: [], blockers: [], next_entry_point: "Review current delivery" } });
const record = (documents, n = "d", source) => { const q = question(documents, n); return apply(renderStandardSessionClose({ question: q, decision: source ?? decision(q), documents, preparedAt: at })); };
const complete = documents => apply(renderStandardSessionCloseCompletion({ sessionPath: "sessions/S001.md", documents, runId: "fresh_run", eventSha256: H, completedAt: at + 1 }));
function reopen(documents, n = "e") {
  const input = [documents[0], documents[2], documents[1]];
  const after = apply(renderPrCorrectionReopen({ source: { session_id: "S001", triage_operation_id: op(n), pull_request: { head_oid: "b".repeat(40), base_oid: "c".repeat(40) }, corrections: [{ subject: "current" }] }, documents: input, preparedAt: at + 2 }));
  return [after[0], after[2], after[1]];
}
let checks = 0;
const test = (name, run) => { run(); checks++; console.log("PASS " + name); };
test("new record and completion schemas use the closed supported vocabulary", () => {
  for (const name of ["standard-session-closure-record.v2", "standard-session-closure-completion.v2"]) {
    const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/" + name + ".schema.json", import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
});
test("fresh v2 closure binds the exact human subject and current head and only its final completion", () => {
  const pending = record(docs()), before = readSessionClosureHistory(pending[0].content);
  assert.equal(before.pending.value.contract_version, "standard-session-closure-record.v2"); assert.deepEqual(before.history, []);
  assert.equal(before.pending.value.subject_sha256, shadowHash(question(docs()).review));
  const done = readSessionClosureHistory(complete(pending)[0].content);
  assert.equal(done.completion.value.record_sha256, shadowHash(before.pending.value)); assert.equal(done.completion.value.decision_operation_id, op("d"));
});
test("reopen and fresh reclosure retain every historical block verbatim and bind a new decision", () => {
  const opened = reopen(complete(record(docs()))), old = readSessionClosureHistory(opened[0].content);
  const next = record(opened, "f"), now = readSessionClosureHistory(next[0].content);
  assert.deepEqual(now.history, old.history); assert.deepEqual(now.pending.value.history, old.history);
  const prefix = opened[0].content.slice(opened[0].content.indexOf("## Historical"), opened[0].content.indexOf("## Process PR correction continuation"));
  assert.ok(next[0].content.includes(prefix)); assert.equal(now.pending.value.decision_operation_id, op("f"));
  const finished = complete(next), twice = reopen(finished, "a"), third = record(twice, "b");
  assert.equal(readSessionClosureHistory(third[0].content).history.length, 2);
});
test("prior human consent and unresolved current records cannot authorize a new closure", () => {
  const original = docs(), source = decision(question(original)), opened = reopen(complete(record(original)));
  assert.throws(() => record(opened, "f", source), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
  assert.throws(() => record(record(original)), { code: "STANDARD_SESSION_CLOSE_SOURCE_INVALID" });
});
test("current and archived v2 completions require the exact record, decision and same version", () => {
  const done = complete(record(docs())), completion = readSessionClosureHistory(done[0].content).completion.value;
  const wrong = [{ ...completion, decision_operation_id: op("f") }, { ...completion, record_sha256: "f".repeat(64) },
    { run_id: completion.run_id, event_sha256: completion.event_sha256, session_close_completed: true, completed_at: completion.completed_at }];
  for (const value of wrong) {
    const text = done[0].content.replace(JSON.stringify(completion, null, 2), JSON.stringify(value, null, 2));
    assert.throws(() => readSessionClosureHistory(text), { code: "STANDARD_SESSION_CLOSURE_HISTORY_INVALID" });
    const archived = text.replace(/^## Process session closure( completion)?$/gm, (_all, suffix) => "## Historical Process session closure" + (suffix ?? "") + " before " + op("e"));
    assert.throws(() => readSessionClosureHistory(archived), { code: "STANDARD_SESSION_CLOSURE_HISTORY_INVALID" });
  }
});
test("missing, reordered, duplicated or changed historical completion cannot be silently repaired", () => {
  const opened = reopen(complete(record(docs()))), pending = record(opened, "f");
  for (const [label, content] of [["changed ancestor", pending[0].content.replace('"Verified current correction"', '"tampered"')],
    ["invalid completion", pending[0].content.replace('"record_sha256":', '"foreign":')],
    ["missing completion", opened[0].content.replace(/^## Historical Process session closure completion[^\n]*\n[\s\S]*?(?=^## )/m, "")]]) {
    assert.throws(() => readSessionClosureHistory(content), { code: "STANDARD_SESSION_CLOSURE_HISTORY_INVALID" }, label);
  }
});
test("legacy pending and completed records stay readable without a silent v2 conversion", () => {
  const pending = record(docs()), parsed = readSessionClosureHistory(pending[0].content).pending.value;
  const legacy = { ...parsed }; for (const key of ["contract_version", "subject_sha256", "head", "history"]) delete legacy[key];
  pending[0] = row(pending[0].path, pending[0].content.replace(JSON.stringify(parsed, null, 2), JSON.stringify(legacy, null, 2)));
  const done = complete(pending), read = readSessionClosureHistory(done[0].content);
  assert.equal(read.pending.value.contract_version, undefined); assert.equal(read.completion.value.contract_version, undefined);
  const next = record(reopen(done), "f"); assert.equal(readSessionClosureHistory(next[0].content).history.length, 1);
  assert.ok(next[0].content.includes(JSON.stringify(legacy, null, 2)));
});
test("unknown versions and excessive or duplicate history refuse", () => {
  const value = readSessionClosureHistory(record(docs())[0].content).pending.value;
  assert.throws(() => assertSessionClosureRecord({ ...value, contract_version: "standard-session-closure-record.v3" }));
  const h = { before_triage_operation_id: op("e"), record_sha256: H, completion_sha256: H };
  assert.throws(() => assertSessionClosureRecord({ ...value, history: [h, h] }));
  assert.throws(() => assertSessionClosureRecord({ ...value, history: Array(33).fill(h) }));
});
test("each archived v2 report authenticates its own historical prefix even without a current pending record", () => {
  const once = reopen(complete(record(docs()))), twice = reopen(complete(record(once, "f")), "a");
  const old = readSessionClosureHistory(twice[0].content); assert.equal(old.history.length, 2); assert.equal(old.pending, null);
  const changedAncestor = twice[0].content.replace('"Verified current correction"', '"changed ancestor"');
  assert.throws(() => readSessionClosureHistory(changedAncestor), { code: "STANDARD_SESSION_CLOSURE_HISTORY_INVALID" });
});
console.log(JSON.stringify({ status: "PASS", checks, evidence: "pure-versioned-closure-history", human: "fixture", canonical_writes: "NOT_RUN", actual_hook: "NOT_RUN", native: "NOT_RUN", installed: "NOT_RUN" }));
