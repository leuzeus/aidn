import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardSpikeConversion } from "../../src/application/runtime/standard-spike-conversion.mjs";
import { collectStandardSessionCheckpointPostimages } from "../../src/application/runtime/standard-session-preclose-checkpoint.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { observeModeWorkReport } from "../../src/core/workflow/standard-mode-work-continuation.mjs";
import { observeHumanSpikeDecision } from "../../src/core/workflow/standard-spike-decision.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { decisionInboxId } from "../../src/core/workflow/process-decision-inbox.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { runSkillHookUseCase } from "../../src/application/runtime/skill-hook-use-case.mjs";
import { createLocalProcessAdapter } from "../../src/adapters/runtime/local-process-adapter.mjs";

// This short precondition suite calls the actual wrapper with signed synthetic
// accepted sources. It is separate from the published-model mixed qualification.
const metadataStage = process.argv.find(arg => arg.startsWith("--metadata-stage="))?.split("=")[1] ?? null;
if (metadataStage && !["before-authorization", "after-hook"].includes(metadataStage)) throw Error("SPIKE_METADATA_STAGE_INVALID");
const portDiagnostic = process.argv.includes("--dual-port-diagnostic");
const mode = process.argv.includes("--db-only-nominal") ? "db-only" : process.argv.includes("--metadata-tamper") || metadataStage || process.argv.includes("--dual-nominal") || portDiagnostic ? "dual" : "files", roots = [];
const root = createFreshStandardWorkflowFixture(mode, roots), operations = createStandardWorkflowOperations({ targetRoot: root });
console.log(JSON.stringify({ root, mode, proof_class: "wrapper-precondition-synthetic-accepted-sources", native_calls: 0 }));
const artifacts = createStandardWorkflowArtifacts({ targetRoot: root }), H = "a".repeat(64), evidence = [{ ref: "fixture:analysis", sha256: H }];
let prepared = await operations.prepareSession({ session_id: "S001", session_branch: "S001-spike", objective: "Verify real conversion wrapper fences" });
assert.equal((await operations.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
prepared = await operations.prepareMode({ session_id: "S001", mode: "EXPLORING" });
assert.equal((await operations.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim();
git("add", "."); git("-c", "core.hooksPath=NUL", "commit", ...(mode === "db-only" ? ["--allow-empty"] : []), "-m", "fixture admitted exploration");
prepared = await operations.prepareStart({ session_id: "S001" });
assert.equal(prepared.can_apply, true);
const started = await operations.finalizeStart(prepared, { write: true, expectPlan: prepared.plan_sha256 });
assert.equal(started.outcome, "completed", JSON.stringify(started));
// Establish real canonical repair observations; no freshness verdict is authored.
prepared = await operations.prepareCycleContext({ session_id: "S001" });
assert.equal(prepared.can_apply, true, JSON.stringify(prepared));
const refreshed = await operations.refreshCycleContext(prepared, { write: true, expectPlan: prepared.plan_sha256 });
assert.equal(refreshed.effect_status, "confirmed", JSON.stringify(refreshed));
git("add", "."); git("-c", "core.hooksPath=NUL", "commit", "--allow-empty", "-m", "fixture reconciled canonical digest");
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
// Exercise the shared inventory with real initializer postimages and an
// explicitly synthetic signed journal. Full mixed-host closure is separate.
const receipt = { operation_id: initializeId, outcome: "completed", output_sha256: shadowHash(initialized) };
const writerInstance = { instance_id: "fixture", scope_id: "scope", events: [{ kind: "operation_result", receipt }] };
const writer = { operation_id: initializeId, phase: "receipted", intent: { binding_ref: "spike_cycle_initialize", instance_id: "fixture", scope_id: "scope" },
  preview: { binding: { executor_kind: "deterministic" } }, results: [{ receipt, output: initialized }] };
const writerOptions = { instance: writerInstance, fixed: ["sessions/S001.md", "snapshots/context-snapshot.md", "CURRENT-STATE.md"],
  ownedPaths: [original.plan.inner.plan.cycle_path] };
let signedWriter = signer.seal(writer), writerChecks = 0;
const readWriter = id => { assert.equal(id, initializeId); signer.verify(signedWriter); return { record: signedWriter }; };
for (const closing of [false, true]) {
  const collect = () => collectStandardSessionCheckpointPostimages({ ...writerOptions, readRetained: readWriter, closing });
  const rows = collect();
  assert.deepEqual([...rows.approved], original.plan.inner.plan.changes.map(row => [row.path, row.after_sha256]));
  assert.deepEqual(rows.journals, [{ operation_id: initializeId, output_sha256: shadowHash(initialized) }]); writerChecks++;
  signedWriter.results[0].output.evidence_refs[0].sha256 = "f".repeat(64);
  assert.throws(collect, { code: "PROCESS_JOURNAL_NOT_AUTHENTICATED" }); writerChecks++;
  const prefix = closing ? "STANDARD_SESSION_CHECKPOINT" : "STANDARD_SESSION_PRECLOSE";
  for (const change of [value => { value.intent.scope_id = "other"; }, value => { value.intent.instance_id = "other"; },
    value => { value.phase = "dispatching"; }, value => { value.preview.binding.executor_kind = "human"; },
    value => { value.results[0].receipt = { ...receipt, output_sha256: "f".repeat(64) }; },
    value => { value.results[0].output.effect_status = "unknown"; }]) {
    const invalid = structuredClone(writer); change(invalid); signedWriter = signer.seal(invalid);
    assert.throws(collect, { code: prefix + "_WRITER_REQUIRED" }); writerChecks++;
  }
  const invalid = structuredClone(writer); invalid.results[0].output.evidence_refs.push({ ref: "docs/audit/foreign.md", sha256: H });
  signedWriter = signer.seal(invalid); assert.throws(collect, { code: prefix + "_WRITER_SCOPE_INVALID" }); writerChecks++;
  const unapproved = structuredClone(writer); unapproved.intent.binding_ref = "spike_conversion_finalize";
  signedWriter = signer.seal(unapproved); assert.equal(collect().approved.size, 0); writerChecks++;
  signedWriter = signer.seal(writer);
}
console.log(JSON.stringify({ checkpoint_writer_inventory: "PASS", checks: writerChecks, postimages: initialized.evidence_refs.length,
  journal_authority: "signed-synthetic-component-only", canonical_initializer: "real-port", mixed_session_close: "NOT_RUN" }));
sources.set(initializeId, { record: { preview: { prepared: original } }, output: initialized });
prepared = await wrapper.prepareFinalize(instance, { contract_version: "standard-spike-finalize-input.v1", initialize_operation_id: initializeId });
let final;
if (portDiagnostic) {
  // A new disposable diagnostic runs each real port exactly once. It does not
  // call finalize afterwards or claim wrapper completion. Retain full canonical
  // rows and projection bytes so content and metadata changes stay distinguishable.
  const folder = path.join(root, ".aidn/runtime/spike-port-diagnostic");
  fs.mkdirSync(folder, { recursive: true });
  const capture = stage => {
    const store = createProjectArtifactStore({ targetRoot: root, existingOnly: true, readOnly: true });
    let rows;
    try { rows = original.plan.inner.plan.changes.map(change => {
      const row = store.getArtifact(change.path), file = path.join(root, "docs/audit", change.path);
      const projection = fs.existsSync(file) ? fs.readFileSync(file) : null;
      return { path: change.path, canonical: row, content_sha256: artifacts.read(change.path).sha256,
        metadata_sha256: artifacts.metadataHash(change.path), projection_base64: projection?.toString("base64") ?? null,
        projection_sha256: projection && createHash("sha256").update(projection).digest("hex") };
    }); } finally { store.close(); }
    const snapshot = { stage, observed_utc: new Date().toISOString(), rows };
    fs.writeFileSync(path.join(folder, `${stage}.json`), JSON.stringify(snapshot, null, 2), { flag: "wx" });
    return snapshot;
  };
  const before = capture("before-hook");
  const hook = runSkillHookUseCase({ args: { skill: "convert-to-spike", mode: "EXPLORING", completionCycleId: selection.cycle_id, strict: true, noAutoSkipGate: true },
    perfDir: fileURLToPath(new URL("./", import.meta.url)), targetRoot: root, processAdapter: createLocalProcessAdapter() });
  fs.writeFileSync(path.join(folder, "hook-result.json"), JSON.stringify(hook), { flag: "wx" });
  const afterHook = capture("after-hook");
  const rawSync = execFileSync(process.execPath, [fileURLToPath(new URL("../runtime/sync-db-first-selective.mjs", import.meta.url)),
    "--target", root, "--strict", "--json"], { cwd: root, encoding: "utf8", shell: false, windowsHide: true, timeout: 300000, maxBuffer: 4194304 });
  fs.writeFileSync(path.join(folder, "sync-stdout.json"), rawSync, { flag: "wx" });
  const afterSync = capture("after-sync");
  const differences = (a, b) => a.rows.map((old, i) => ({ path: old.path,
    changed: Object.keys({ ...old.canonical, ...b.rows[i].canonical }).filter(key => JSON.stringify(old.canonical?.[key]) !== JSON.stringify(b.rows[i].canonical?.[key])),
    content_changed: old.content_sha256 !== b.rows[i].content_sha256, metadata_changed: old.metadata_sha256 !== b.rows[i].metadata_sha256,
    projection_changed: old.projection_sha256 !== b.rows[i].projection_sha256 }));
  const report = { proof_class: "real-port-sequence-diagnostic-only", root, folder, hook_ok: hook.ok, sync_ok: JSON.parse(rawSync).ok,
    hook_differences: differences(before, afterHook), sync_differences: differences(afterHook, afterSync), wrapper_completion: "NOT_RUN" };
  fs.writeFileSync(path.join(folder, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report));
  assert.equal(hook.ok, true); assert.equal(JSON.parse(rawSync).ok, true);
  final = { diagnostic_completed: true, wrapper_completion: "NOT_RUN" };
} else if (mode === "dual" && !process.argv.includes("--dual-nominal")) {
  const name = original.plan.inner.plan.changes[0].path, before = artifacts.read(name), metadata = artifacts.metadataHash(name);
  let injections = 0, authorizations = 0;
  const mutate = () => {
    const store = createProjectArtifactStore({ targetRoot: root, existingOnly: true });
    try { const row = store.getArtifact(name); store.upsertArtifact({ ...row, gate_relevance: row.gate_relevance === 1 ? 0 : 1 }); } finally { store.close(); }
    injections++;
    assert.equal(artifacts.read(name).sha256, before.sha256); assert.notEqual(artifacts.metadataHash(name), metadata);
  };
  if (metadataStage) {
    const assertAuthorized = async () => { authorizations++; if (authorizations === (metadataStage === "before-authorization" ? 1 : 2)) mutate(); };
    if (metadataStage === "before-authorization") {
      await assert.rejects(wrapper.finalize(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized }),
        { code: "STANDARD_SPIKE_METADATA_CHANGED", effect_status: "no_effect" });
      final = { metadata_only_tamper: "REJECTED_BEFORE_HOOK_AFTER_AUTHORIZATION_AWAIT", canonical_content_unchanged: true };
    } else {
      final = await wrapper.finalize(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized });
      assert.equal(final.outcome, "reconciliation_required"); assert.equal(final.effect_status, "unknown"); assert.deepEqual(final.facts, {});
      assert.equal(final.observations.hook.ok, true); assert.equal(final.observations.sync.ok, true);
      assert.equal(final.observations.reason_code, "STANDARD_SPIKE_POSTIMAGE_CHANGED");
      for (const kind of ["hook", "sync"]) {
        const retained = final.observations[kind].evidence;
        const bytes = (await import("node:fs")).readFileSync((await import("node:path")).join(root, retained.ref));
        assert.equal(bytes.length, retained.bytes);
        assert.equal((await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"), retained.sha256);
        assert.equal(JSON.parse(bytes).ok, true);
      }
    }
    assert.equal(injections, 1); assert.equal(authorizations, metadataStage === "before-authorization" ? 1 : 2);
  } else {
  mutate();
  await assert.rejects(wrapper.finalize(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: async () => {} }), { code: "STANDARD_SPIKE_PREVIEW_CHANGED" });
  final = { metadata_only_tamper: "REJECTED_BEFORE_HOOK", canonical_content_unchanged: true };
  }
} else {
  const canonicalRows = () => {
    const store = createProjectArtifactStore({ targetRoot: root, existingOnly: true, readOnly: true });
    try { return original.plan.inner.plan.changes.map(row => store.getArtifact(row.path)); } finally { store.close(); }
  };
  const before = mode !== "files" ? canonicalRows() : null;
  final = await wrapper.finalize(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: async () => {} });
  assert.equal(final.effect_status, "confirmed", JSON.stringify(final)); assert.equal(final.facts.spike_conversion_completed, true);
  if (before) {
    assert.deepEqual(canonicalRows(), before, "projection sync must preserve complete canonical rows, including metadata");
    assert.equal(final.observations.sync.source, "canonical_projection");
    assert.equal(final.observations.sync.state_mode, mode);
    if (mode === "db-only") assert.equal(JSON.parse(fs.readFileSync(path.join(root, final.observations.sync.evidence.ref))).projection.requested, false);
    for (const kind of ["hook", "sync"]) {
      const retained = final.observations[kind].evidence, bytes = fs.readFileSync(path.join(root, retained.ref));
      assert.equal(bytes.length, retained.bytes); assert.equal(createHash("sha256").update(bytes).digest("hex"), retained.sha256);
      assert.equal(JSON.parse(bytes).ok, true);
    }
  }
}
assert.ok(verifications > 0);
console.log(JSON.stringify({ ok: true, root, mode, final, prepared_at_ms: original.plan.prepared_at_ms,
  metadata_stage: metadataStage, delay_ms: Date.now() - original.plan.prepared_at_ms, same_dated_postimages: true, native_calls: 0, mixed_model: "NOT_RUN", genuine_human: "NOT_RUN" }));
