import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardDriftRecovery } from "../../src/application/runtime/standard-drift-recovery.mjs";
import { runReloadCheckUseCase } from "../../src/application/runtime/reload-check-use-case.mjs";
import { observeStandardDriftGate } from "../../src/application/runtime/standard-drift-finalization.mjs";
import { createAgenticProcessStore } from "../../src/adapters/runtime/agentic-process-store.mjs";
import { createAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

// Actual SQLite/DUAL source ports, runtime record and R03 cache. Evaluation
// and context capabilities are fixtures; this allocates no Native resource.
export async function verifyRecoveryReviewCache(pass, { combinedCache = false } = {}) {
  const owned = [], H = "a".repeat(64), operationId = "op_" + "b".repeat(40);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:AIDN_|NODE_OPTIONS$|NODE_PATH$|GIT_)/i.test(key)));
  let completed = false;
  try {
    const targetRoot = createFreshStandardWorkflowFixture("dual", owned);
    const reload = () => runReloadCheckUseCase({ targetRoot, args: { cache: ".aidn/runtime/cache/reload-state.json", stateMode: "dual",
      stateModeExplicit: true, indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto", writeCache: true } });
    // A real cache from before the new branch/cycle reproduces the corrective
    // journey's combined invalidations, without replaying its failed effect.
    if (combinedCache) assert.notEqual((await reload()).decision, "stop");
    const operations = createStandardWorkflowOperations({ targetRoot, environment: env });
    const git = (...args) => execFileSync("git", ["-C", targetRoot, "-c", "core.hooksPath=NUL", ...args], { windowsHide: true, env, maxBuffer: 8388608 });
    const checkpoint = message => { git("add", "."); git("commit", "--allow-empty", "-m", message); };
    let prepared = await operations.prepareSession({ session_id: "S001", session_branch: "S001-cache-review", objective: "Learn through an explicitly admitted bounded SPIKE" });
    assert.equal(prepared.can_apply, true, prepared.reason_code);
    assert.equal((await operations.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    prepared = await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" });
    assert.equal(prepared.can_apply, true, prepared.reason_code);
    assert.equal((await operations.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    checkpoint("fixture current session and selected mode");
    prepared = await operations.prepareCycleContext({ session_id: "S001" });
    assert.equal((await operations.refreshCycleContext(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    checkpoint("fixture admitted cycle context");
    prepared = await operations.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "cache-review",
      objective: "Determine whether a bounded prototype is useful", continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-cache-review" });
    assert.equal(prepared.can_apply, true, prepared.reason_code);
    assert.equal((await operations.initializeCycle(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    checkpoint("fixture cycle before cache-only experiment");
    const artifacts = createStandardWorkflowArtifacts({ targetRoot, env });
    const names = ["CURRENT-STATE.md", "SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md", "baseline/current.md", "snapshots/context-snapshot.md",
      "sessions/S001.md", "cycles/C001-feature-cache-review/status.md", "cycles/C001-feature-cache-review/brief.md"];
    const business = () => Object.fromEntries(names.map(name => [name, { sha256: artifacts.read(name).sha256, metadata_sha256: artifacts.metadataHash(name) }]));
    const beforeBusiness = business();
    if (!combinedCache) assert.notEqual((await reload()).decision, "stop");
    const model = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url)));
    const instance = createAgenticProcess({ instanceId: "cache-transition-component", model, policyPins: agenticPolicyPins(model), scopeId: "fixture:cache-transition" });
    const instances = createAgenticProcessStore({ targetRoot, stateMode: "dual", env });
    const stored = instances.compareAndSwap(instance, null);
    if (stored.projection === "pending") instances.materialize(instance.instance_id, { write: true });
    const context = { mode: "COMMITTING", session_id: "S001", cycle_id: "C001", original_objective: "Determine whether a bounded prototype is useful",
      documents: [{ ref: "audit:sessions/S001.md", content: "session_objective: Learn through an explicitly admitted bounded SPIKE\n" }] };
    const contextSha = shadowHash(context), report = { contract_version: "standard-drift-report.v1", context_sha256: contextSha, original_objective: context.original_objective,
      current_objective: context.original_objective, drift_level: "none", objective_changed: false, changes: [], keep: ["Exact fixture scope"], discard: [],
      split_recommendation: { new_cycle: false, new_branch: false, change_request_required: false, impact: "none" }, recommendation: "continue",
      rationale: "Component fixture only", evidence_refs: [{ ref: "fixture:component", sha256: H }] };
    const verified = { context, context_sha256: contextSha, evaluation_sha256: H,
      output: { facts: { drift_present: false, drift_context_complete: true, drift_recovery_required: false }, observations: { report } } };
    let changedContext = false;
    const recovery = createStandardDriftRecovery({ targetRoot, environment: env, now: () => 1000,
      readEvaluation: async () => verified, observeContext: async () => ({ context_sha256: changedContext ? "f".repeat(64) : contextSha }),
      readCurrent: () => ({ instance_sha256: H }) });
    const subject = { instance_id: "component-subject", instance_sha256: H }, input = { evaluation_operation_id: operationId };
    const original = await recovery.prepare(subject, input, operationId), originalBytes = JSON.stringify(original);
    if (combinedCache) {
      const level = original.plan.gate_constraints.level1;
      assert.equal(level.decision, "full"); assert.equal(level.fallback, true);
      for (const reason of ["BRANCH_CHANGED", "HEAD_CHANGED", "ARTIFACTS_CHANGED", "ACTIVE_CYCLES_CHANGED", "DIGEST_MISS"])
        assert.ok(level.reason_codes.includes(reason), JSON.stringify(level));
    } else assert.deepEqual(original.plan.gate_constraints.level1, { decision: "full", fallback: true, reason_codes: ["ARTIFACTS_CHANGED"] });
    assert.notEqual((await reload()).decision, "stop");
    const fast = await observeStandardDriftGate(artifacts, "COMMITTING");
    assert.deepEqual(fast.levels.level1, { decision: "incremental", fallback: false, reason_codes: [] });
    assert.deepEqual(fast.levels.level2.active_signals, []);
    await recovery.assertFresh(subject, original.plan);
    assert.equal(JSON.stringify(original), originalBytes); assert.deepEqual(business(), beforeBusiness);
    pass(`${combinedCache ? "combined" : "single"} invalidation: original review survives actual DUAL cache refresh with intent and business witnesses fixed`);
    for (const reasons of [["OTHER_RELOAD_REASON"], ["DIGEST_MISS"], ["ARTIFACTS_CHANGED", "STATE_MODE_FALLBACK"]]) {
      const other = structuredClone(original.plan); other.gate_constraints.level1.reason_codes = reasons;
      await assert.rejects(recovery.assertFresh(subject, other), { code: "STANDARD_RECOVERY_REVIEW_STALE" });
    }
    const stop = structuredClone(original.plan); stop.gate_constraints.level1.decision = "stop";
    await assert.rejects(recovery.assertFresh(subject, stop), { code: "STANDARD_OBJECTIVE_REVIEW_INVALID" });
    changedContext = true;
    await assert.rejects(recovery.assertFresh(subject, original.plan), { code: "STANDARD_RECOVERY_REVIEW_STALE" });
    changedContext = false; assert.deepEqual(business(), beforeBusiness);
    pass(`${combinedCache ? "combined" : "single"} invalidation: unexplained digest, unknown/fallback reasons, stop and changed context still refuse`);
    const session = artifacts.read("sessions/S001.md"); assert.equal((session.content.match(/^session_objective:.*$/gm) ?? []).length, 1);
    await artifacts.withLocalEffectOwner(shadowHash({ fixture: "cache-review-changed-intent", path: session.path, before_sha256: session.sha256 }), async () => {
      artifacts.compareAndSwapPreservingMetadata({ path: session.path, before_sha256: session.sha256,
        before_metadata_sha256: artifacts.metadataHash(session.path), after: session.content.replace(/^session_objective:.*$/m, "session_objective: ambiguous") });
      artifacts.project([session.path]);
    });
    await assert.rejects(recovery.assertFresh(subject, original.plan), { code: "STANDARD_OBJECTIVE_REVIEW_INVALID" });
    assert.equal(JSON.stringify(original), originalBytes);
    pass(`${combinedCache ? "combined" : "single"} invalidation: changed live intent cannot reuse the retained review`);
    completed = true;
  } finally {
    if (!completed) console.error("Cache-review component fixtures retained for diagnosis: " + JSON.stringify(owned));
    else {
      const temporary = fs.realpathSync(os.tmpdir()), paths = owned.map(root => fs.realpathSync(root));
      for (const root of paths) if (path.dirname(root) !== temporary || !path.basename(root).startsWith("aidn-standard-fresh-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
      for (const root of paths) fs.rmSync(root, { recursive: true, force: true });
    }
  }
}
