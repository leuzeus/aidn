import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardSpikeConversion } from "../../src/application/runtime/standard-spike-conversion.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { observeModeWorkReport } from "../../src/core/workflow/standard-mode-work-continuation.mjs";
import { observeHumanSpikeDecision } from "../../src/core/workflow/standard-spike-decision.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { decisionInboxId } from "../../src/core/workflow/process-decision-inbox.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

// This short precondition suite calls the actual wrapper with signed synthetic
// accepted sources. It is separate from the published-model mixed qualification.
const mode = process.argv.includes("--metadata-tamper") ? "dual" : "files", roots = [];
const root = createFreshStandardWorkflowFixture(mode, roots), operations = createStandardWorkflowOperations({ targetRoot: root });
console.log(JSON.stringify({ root, mode, proof_class: "wrapper-precondition-synthetic-accepted-sources", native_calls: 0 }));
const artifacts = createStandardWorkflowArtifacts({ targetRoot: root }), H = "a".repeat(64), evidence = [{ ref: "fixture:analysis", sha256: H }];
let prepared = await operations.prepareSession({ session_id: "S001", session_branch: "S001-spike", objective: "Verify real conversion wrapper fences" });
assert.equal((await operations.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
prepared = await operations.prepareMode({ session_id: "S001", mode: "EXPLORING" });
assert.equal((await operations.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim();
git("add", "."); git("-c", "core.hooksPath=NUL", "commit", "-m", "fixture admitted exploration");
const context = { session_id: "S001", mode: "EXPLORING", objective: "Verify real conversion wrapper fences", product_sha256: H,
  git: { head: git("rev-parse", "HEAD"), branch: git("branch", "--show-current") }, preflight_operation_id: "op_" + "b".repeat(40) };
const observed = observeModeWorkReport({ report: { contract_version: "standard-mode-work-report.v1", context_sha256: shadowHash(context), mode: "EXPLORING",
  objective: context.objective, disposition: "retain_requested", findings: ["Conversion requested"], rationale: "Fixture information only", evidence_refs: evidence },
  reference: evidence[0], producer: { instance_id: "fixture", model_sha256: H, occurrence_id: "analysis", result_id: "analysis" } },
{ context, context_sha256: shadowHash(context), evidence_refs: evidence });
const instance = { instance_id: "fixture", instance_sha256: H }, analysisId = "op_" + "c".repeat(40), decisionId = "op_" + "d".repeat(40), initializeId = "op_" + "e".repeat(40);
const signer = createOperationJournalSigner(() => Buffer.alloc(32, 7)), sources = new Map([[analysisId, { output: observed, record: { preview: { input: {} } } }]]);
let verifications = 0;
const wrapper = createStandardSpikeConversion({ targetRoot: root, operations, readAcceptedOperation: (_instance, id) => { assert.ok(sources.has(id)); return sources.get(id); },
  observeModeWork: () => observed, verifyDecision: record => { signer.verify(record); verifications++; }, readCurrent: () => instance, observeProduct: () => H });
const input = { contract_version: "standard-spike-review-input.v1", review_operation_id: analysisId };
const admitted = await wrapper.admit(instance, input);
assert.equal(admitted.outcome, "completed", JSON.stringify(admitted));
const review = await wrapper.prepareDecision(instance, input);
const question = { contract_version: "standard-spike-question.v1", operation_id: decisionId, instance_id: "fixture", scope_id: "scope", occurrence_id: "decision",
  intent_sha256: H, session_id: "S001", review_operation_id: analysisId, ...review };
const selection = { cycle_id: "C007", title: "bounded-learning", learning_goal: context.objective, timebox: "30 minutes", decision_target: "Retain or discard after validation", chosen_mode: "EXPLORING", branch_action: "create" };
const decision = { contract_version: "human-spike-decision.v1", source_kind: "human", authority_id: "fixture_user", source_event_id: "wrapper-decision",
  question_sha256: shadowHash(question), subject_sha256: shadowHash(review.review), choice: "convert-to-spike", selection, rationale: "Synthetic exact-subject choice", evidence_refs: evidence };
sources.set(decisionId, { output: { ...observeHumanSpikeDecision({ question, decision }), observations: { ...observeHumanSpikeDecision({ question, decision }).observations,
  inbox_id: decisionInboxId(decision), source_ref: "fixture:decision" }, evidence_refs: evidence, contract_version: "standard-spike-decision-output.v1", operation_ref: "spike_conversion_decision" },
record: signer.seal({ preview: { input, prepared: review } }) });
prepared = await wrapper.prepareInitialize(instance, { contract_version: "standard-spike-initialize-input.v1", decision_operation_id: decisionId });
assert.equal(prepared.can_apply, true);
const original = structuredClone(prepared); await new Promise(resolve => setTimeout(resolve, 1100));
await assert.rejects(wrapper.initialize(instance, prepared, { expectPlan: prepared.plan_sha256, assertAuthorized: async () => {} }), { code: "STANDARD_EXPLICIT_EFFECT_REQUIRED" });
const initialized = await wrapper.initialize(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: async () => {} });
assert.equal(initialized.effect_status, "confirmed", JSON.stringify(initialized)); assert.deepEqual(prepared, original);
for (const row of original.plan.inner.plan.changes) assert.equal(artifacts.read(row.path).sha256, row.after_sha256);
sources.set(initializeId, { record: { preview: { prepared: original } }, output: initialized });
prepared = await wrapper.prepareFinalize(instance, { contract_version: "standard-spike-finalize-input.v1", initialize_operation_id: initializeId });
let final;
if (mode === "dual") {
  const name = original.plan.inner.plan.changes[0].path, before = artifacts.read(name), metadata = artifacts.metadataHash(name), store = createProjectArtifactStore({ targetRoot: root, existingOnly: true });
  try { const row = store.getArtifact(name); store.upsertArtifact({ ...row, gate_relevance: row.gate_relevance === 1 ? 0 : 1 }); } finally { store.close(); }
  assert.equal(artifacts.read(name).sha256, before.sha256); assert.notEqual(artifacts.metadataHash(name), metadata);
  await assert.rejects(wrapper.finalize(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: async () => {} }), { code: "STANDARD_SPIKE_PREVIEW_CHANGED" });
  final = { metadata_only_tamper: "REJECTED_BEFORE_HOOK", canonical_content_unchanged: true };
} else {
  final = await wrapper.finalize(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: async () => {} });
  assert.equal(final.effect_status, "confirmed", JSON.stringify(final)); assert.equal(final.facts.spike_conversion_completed, true);
}
assert.ok(verifications > 0);
console.log(JSON.stringify({ ok: true, root, mode, final, prepared_at_ms: original.plan.prepared_at_ms,
  delay_ms: Date.now() - original.plan.prepared_at_ms, same_dated_postimages: true, native_calls: 0, mixed_model: "NOT_RUN", genuine_human: "NOT_RUN" }));
