import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProcessDecisionInboxStore } from "../../src/adapters/runtime/process-decision-inbox-store.mjs";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { decisionInboxPath } from "../../src/core/workflow/process-decision-inbox.mjs";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createStandardHumanDecisions } from "../../src/application/runtime/standard-workflow-human-decisions.mjs";
import { createStandardBaselinePromotionReview } from "../../src/application/runtime/standard-baseline-promotion-review.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { assertDecisionInbox } from "../../src/core/workflow/process-decision-inbox.mjs";
import { baselinePromotionChoices } from "../../src/core/workflow/standard-baseline-promotion-decision.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import outputSchema from "../../src/core/contracts/workflow-definition/standard-baseline-promotion-decision-output.v1.schema.json" with { type: "json" };
import reviewSchema from "../../src/core/contracts/workflow-definition/standard-baseline-promotion-review-plan.v1.schema.json" with { type: "json" };
import inputSchema from "../../src/core/contracts/workflow-definition/standard-baseline-promotion-review-input.v1.schema.json" with { type: "json" };
const sha = "a".repeat(64), key = randomBytes(32), signer = createOperationJournalSigner(() => key);
let checks = 0;
async function test(name, run) { await run(); checks++; console.log("PASS " + name); }
function fixture(makeInbox) {
  const rows = new Map(), sources = new Map(); let verified = true, providerCalls = 0;
  const inbox = makeInbox ? makeInbox() : { read(id) { const record = structuredClone(rows.get(id) ?? null); return { record, content_sha256: record ? shadowHash(record) : null }; },
    compareAndSwap(row, expected) { assertDecisionInbox(row); const before = this.read(row.inbox_id); assert.equal(before.content_sha256, expected); rows.set(row.inbox_id, structuredClone(row)); return { projection: "canonical" }; } };
  const source = { read({ sourceRef }) { providerCalls++; return structuredClone(sources.get(sourceRef) ?? null); }, verify({ source: claim, sourceRef }) {
    providerCalls++; return { outcome: verified && shadowHash(claim) === shadowHash(sources.get(sourceRef)) ? "verified" : "rejected", authority_id: claim.authority_id, source_sha256: shadowHash(claim) }; } };
  const human = () => createStandardHumanDecisions({ inbox, signer, source, projectionRequired: false });
  const record = { operation_id: "op_" + "b".repeat(40), intent: { binding_ref: "baseline_promotion_decision", instance_id: "fixture", scope_id: "scope", occurrence_id: "promotion:0" },
    preview: { prepared: { plan: { review: { session_id: "S001", cycle_id: "C001", cycle_path: "cycles/C001-build-example", closure_operation_id: "op_" + "c".repeat(40),
      closure_output_sha256: sha, context_sha256: sha, product_sha256: sha, baseline_sha256: sha, history_sha256: sha, current_version: "v0.1",
      evidence_refs: [{ ref: "closure/result", sha256: sha }] }, choices: [...baselinePromotionChoices] } } }, results: [] };
  const claim = (choice = "promote") => { const q = human().question(record); return { contract_version: "human-baseline-promotion-decision.v1", source_kind: "human", authority_id: "fixture_operator",
    source_event_id: "promotion:1", question_sha256: shadowHash(q), subject_sha256: shadowHash(q.review), choice, rationale: "Explicit fixture decision",
    promotion: choice === "promote" ? { version: "v0.2", summary: "Retained work" } : null, evidence_refs: [{ ref: "human/selection", sha256: sha }] }; };
  return { rows, sources, human, record, claim, deny: () => { verified = false; }, calls: () => providerCalls };
}
await test("private review and decision-output schemas use supported vocabulary", () => {
  for (const schema of [outputSchema, reviewSchema, inputSchema]) assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
});
await test("missing human response leaves the inbox empty without a fabricated success", async () => {
  const f = fixture(); assert.equal(await f.human().reserve(f.record, "fixture:answer"), null); assert.equal(f.rows.size, 0);
});
await test("rejected provider proof refuses even a schema-valid human response", async () => {
  const f = fixture(); f.sources.set("fixture:answer", f.claim()); f.deny(); await assert.rejects(f.human().reserve(f.record, "fixture:answer"), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" }); assert.equal(f.rows.size, 0);
});
await test("v4 reservation and acknowledgement have real HMAC authentication and survive host recreation", async () => {
  const f = fixture(); f.sources.set("fixture:answer", f.claim()); const capture = await f.human().reserve(f.record, "fixture:answer");
  assert.equal(capture.contract_version, "process-decision-inbox.v4"); signer.verify(capture);
  const output = f.human().output(f.record, capture), receipt = { receipt_id: "fixture_receipt" }; assert.deepEqual(validateJsonSchema(output, outputSchema, "$", { contractKind: "workflow-definition" }), []);
  f.record.results.push({ output, receipt }); f.human().acknowledge(capture.inbox_id, receipt); const before = shadowHash(f.rows.get(capture.inbox_id));
  const calls = f.calls(); f.sources.clear(); assert.equal(f.human().captured(f.record).phase, "receipted"); assert.equal(f.calls(), calls);
  f.human().acknowledge(capture.inbox_id, receipt); assert.equal(shadowHash(f.rows.get(capture.inbox_id)), before);
});
await test("modified retained human selection is rejected by the actual signer", async () => {
  const f = fixture(); f.sources.set("fixture:answer", f.claim()); const capture = await f.human().reserve(f.record, "fixture:answer");
  f.record.results.push({ output: f.human().output(f.record, capture), receipt: { receipt_id: "fixture_receipt" } });
  f.rows.get(capture.inbox_id).source.promotion.version = "v9.9"; assert.throws(() => f.human().captured(f.record), { code: "PROCESS_JOURNAL_NOT_AUTHENTICATED" });
});
await test("one source event cannot authorize a second waiting operation", async () => {
  const f = fixture(); f.sources.set("fixture:answer", f.claim()); await f.human().reserve(f.record, "fixture:answer"); const before = shadowHash([...f.rows]);
  f.record.operation_id = "op_" + "d".repeat(40); f.record.intent.occurrence_id = "promotion:1"; f.sources.set("fixture:answer", f.claim());
  await assert.rejects(f.human().reserve(f.record, "fixture:answer"), { code: "PROCESS_HUMAN_SOURCE_ALREADY_USED" }); assert.equal(shadowHash([...f.rows]), before);
});
await test("every human outcome conforms and non-successes never inherit promotion facts", async () => {
  for (const choice of baselinePromotionChoices) { const f = fixture(); f.sources.set("fixture:answer", f.claim(choice)); const capture = await f.human().reserve(f.record, "fixture:answer"), output = f.human().output(f.record, capture);
    assert.deepEqual(validateJsonSchema(output, outputSchema, "$", { contractKind: "workflow-definition" }), []); assert.equal(output.effect_status, "no_effect");
    if (["refused", "deferred", "cancelled"].includes(choice)) assert.deepEqual(output.facts, {});
    const forged = structuredClone(output); forged.facts.baseline_promotion_completed = true; assert.ok(validateJsonSchema(forged, outputSchema, "$", { contractKind: "workflow-definition" }).length);
  }
});
await test("review preparation authenticates scope through its capability, remains read-only and supports a long durable wait", async () => {
  const f = fixture(), instance = { instance_id: "fixture", scope_id: "scope" }, input = { contract_version: "standard-baseline-promotion-review-input.v1", closure_operation_id: f.record.preview.prepared.plan.review.closure_operation_id };
  const closure = { operation_id: input.closure_operation_id, instance_id: instance.instance_id, scope_id: instance.scope_id, session_id: "S001", cycle_id: "C001", cycle_path: "cycles/C001-build-example", product_sha256: sha,
    output: { operation_ref: "cycle_close_finalize", outcome: "completed", effect_status: "confirmed", facts: { cycle_close_completed: true, cycle_retained: true }, observations: { target_state: "DONE" } } };
  let contextSha = sha, blocked = false, clock = 1000;
  const promotion = { async observeContext() { return blocked ? { blocked: "FIXTURE_ADMISSION_BLOCKED" } : { context_sha256: contextSha,
    context: { mode: "COMMITTING", cycle_state: "DONE", active_session: "S001" }, documents: [{ path: "baseline/current.md", sha256: sha, content: "baseline: v0.1\n" }, { path: "baseline/history.md", sha256: sha }] }; } };
  const review = createStandardBaselinePromotionReview({ readClosure: async () => structuredClone(closure), promotion, now: () => clock });
  const prepared = await review.prepare(instance, input); assert.equal(prepared.can_apply, true); clock += 86400000; await review.assertFresh(instance, prepared.plan);
  contextSha = "f".repeat(64); await assert.rejects(review.assertFresh(instance, prepared.plan), { code: "STANDARD_PROMOTION_REVIEW_CHANGED" });
  blocked = true; assert.equal((await review.prepare(instance, input)).reason_code, "FIXTURE_ADMISSION_BLOCKED"); blocked = false;
  closure.output.facts.cycle_retained = false; await assert.rejects(review.prepare(instance, input), { code: "STANDARD_PROMOTION_COMPLETED_CLOSURE_REQUIRED" }); assert.equal(f.rows.size, 0);
});
const owned = [], temporary = fs.realpathSync(os.tmpdir());
try {
  for (const mode of ["files", "dual", "db-only"]) await test("signed v4 capture survives reopening the actual canonical inbox: " + mode, async () => {
    const root = createStandardWorkflowFixture(mode, owned), makeInbox = () => createProcessDecisionInboxStore({ targetRoot: root, stateMode: mode });
    const f = fixture(makeInbox); f.sources.set("fixture:answer", f.claim()); const capture = await f.human().reserve(f.record, "fixture:answer");
    const output = f.human().output(f.record, capture), receipt = { receipt_id: "fixture_receipt" }; f.record.results.push({ output, receipt });
    const cold = fixture(makeInbox); cold.human().acknowledge(capture.inbox_id, receipt);
    assert.equal(cold.human().captured(f.record).phase, "receipted"); assert.equal(cold.calls(), 0);
    const visible = path.join(root, "docs/audit", decisionInboxPath(capture.inbox_id)); assert.equal(fs.existsSync(visible), mode !== "db-only");
    const store = makeInbox(), before = store.read(capture.inbox_id), tampered = structuredClone(before.record); tampered.source.promotion.version = "v9.9";
    store.compareAndSwap(tampered, before.content_sha256); assert.throws(() => fixture(makeInbox).human().captured(f.record), { code: "PROCESS_JOURNAL_NOT_AUTHENTICATED" });
  });
} finally {
  for (const folder of owned) { const real = fs.realpathSync(folder); assert.equal(path.dirname(real), temporary); assert.ok(path.basename(real).startsWith("aidn-standard-ports-")); fs.rmSync(real, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ status: "PASS", checks, proof: "promotion-review-and-signed-human-component", real_hmac: true,
  inbox_backend: "fixture-memory-and-real-files-dual-db-only", human_provider: "fixture", actual_closure: "NOT_RUN", application_effects: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
