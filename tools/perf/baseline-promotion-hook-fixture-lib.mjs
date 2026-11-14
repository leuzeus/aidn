import { runGatingEvaluateUseCase } from "../../src/application/runtime/gating-evaluate-use-case.mjs";
import { createStandardBaselinePromotionCheckpoint } from "../../src/application/runtime/standard-baseline-promotion-checkpoint.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createStandardBaselinePromotionHook } from "../../src/application/runtime/standard-baseline-promotion-hook.mjs";
import { runReloadCheckUseCase } from "../../src/application/runtime/reload-check-use-case.mjs";
import { completeDriftCheckFixture } from "./test-activation-fixture-lib.mjs";
import { baselinePromotionPaths } from "../../src/core/workflow/standard-baseline-promotion.mjs";
import { runPromoteBaselineCheckpointUseCase } from "../../src/application/runtime/promote-baseline-checkpoint-use-case.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";
export async function verifyBaselinePromotionHook({ root, mode, artifacts, promotion, instance, preview, result, git, fault, promotionCheckpoint = false, checkpointFault, agedCheckpoint = false, agedHook = false, objectiveCompletion = false }) {
  const recordId = "op_" + "c".repeat(40), hookId = "op_" + "d".repeat(40), input = { record_operation_id: recordId };
  const eventFile = path.join(root, ".aidn/runtime/perf/workflow-events.ndjson"), events = () => fs.existsSync(eventFile) ? fs.readFileSync(eventFile) : Buffer.alloc(0);
  let checkpointCalls = 0; const write = fs.writeFileSync;
  let hookClock = agedHook ? Date.now() - 86400000 : null;
  let completionMode = "valid", sourceReads = 0, revokeAt = null, grantLive = true;
  const completionSubject = { session_objective: "Qualify canonical baseline promotion", cycle_objective: "Qualify a separately scoped canonical baseline promotion" };
  // Controlled capability fixture only. This does not authenticate an R05
  // journal or establish the still separate full common-host A5 path.
  const readCompletion = async () => {
    sourceReads++; if (sourceReads === revokeAt) grantLive = false;
    if (completionMode === "missing") return null;
    if (completionMode === "revoked") throw Object.assign(Error("FIXTURE_PROMOTION_COMPLETION_REVOKED"), { code: "FIXTURE_PROMOTION_COMPLETION_REVOKED" });
    return completionMode === "wrong" ? { ...completionSubject, cycle_objective: "Wrong unaccepted objective" } : { ...completionSubject };
  };
  const makeHook = reader => createStandardBaselinePromotionHook({ targetRoot: root, promotion, readCurrent: () => instance, now: () => hookClock ?? Date.now(),
    readObjectiveCompletion: reader,
    readRecorded: async () => ({ record_operation_id: recordId, plan: preview.plan, output: result }) }, { checkpoint: async args => {
      checkpointCalls++; const prefix = events(), observed = await runPromoteBaselineCheckpointUseCase(args);
      assert.equal(observed.checkpoint?.ok, true, JSON.stringify(observed));
      if (fault === "event") fs.writeFileSync(eventFile, prefix);
      if (fault === "suffix") {
        assert.notEqual(mode, "files"); const db = new (getDatabaseSync())(resolveRuntimeSqliteFile({ targetRoot: root }));
        try { db.exec("CREATE TRIGGER fixture_abort_promotion_completion BEFORE INSERT ON artifacts WHEN NEW.path='baseline/history.md' AND CAST(NEW.content AS TEXT) LIKE '%## Promotion checkpoint%' BEGIN SELECT RAISE(ABORT,'fixture promotion suffix'); END"); }
        finally { db.close(); }
      }
      if (fault === "projection") {
        assert.equal(mode, "dual"); fs.writeFileSync = (file, ...rest) => typeof file === "string" && path.resolve(file) === path.resolve(root, "docs/audit/baseline/history.md") ? undefined : write(file, ...rest);
      }
      return observed;
    } });
  const hook = makeHook(objectiveCompletion ? readCompletion : null);
  if (promotionCheckpoint) {
    const id = "op_" + "e".repeat(40), checkpointInput = { record_operation_id: recordId, closure_operation_id: preview.plan.request.closure_operation_id,
      terminal_checkpoint_operation_id: "op_" + "f".repeat(40) };
    // Fixture authority attests the prepared closure/parent. Actual full-host
    // provenance is a separate composed-model qualification.
    const approved = [...baselinePromotionPaths, preview.plan.request.cycle_path + "/status.md"].sort().map(path => ({ path, sha256: artifacts.read(path).sha256 }));
    const material = { request: preview.plan.request, session_id: "S001", source_material_sha256: shadowHash({ plan: preview.plan, output: result }),
      record_context_sha256: result.observations.causal_transition.after_context_sha256,
      completion_boundary_sha256: result.observations.causal_transition.completion_boundary_sha256, parent_head: git("rev-parse", "HEAD"), approved_postimages: approved };
    let checkpointClock = agedCheckpoint ? Date.now() - 86400000 : null;
    const checkpoint = createStandardBaselinePromotionCheckpoint({ targetRoot: root, promotion, readCurrent: () => instance, readSource: async () => structuredClone(material), now: () => checkpointClock ?? Date.now() });
    const cachePath = path.join(root, ".aidn/runtime/cache/reload-state.json"), cacheBytes = () => fs.existsSync(cachePath) ? fs.readFileSync(cachePath) : null;
    const beforeHead = git("rev-parse", "HEAD"), beforeCache = cacheBytes();
    if (checkpointFault === "foreign_parent" || checkpointFault === "foreign_path") {
      if (checkpointFault === "foreign_parent") git("commit", "--allow-empty", "-m", "fixture foreign checkpoint parent");
      else fs.writeFileSync(path.join(root, "foreign.txt"), "Unapproved fixture postimage\n");
      const foreignHead = git("rev-parse", "HEAD");
      if (checkpointFault === "foreign_parent") {
        const denied = await checkpoint.prepare(instance, checkpointInput, id);
        assert.equal(denied.can_apply, false); assert.equal(denied.reason_code, "STANDARD_PROMOTION_CHECKPOINT_GIT_REQUIRED");
      } else await assert.rejects(checkpoint.prepare(instance, checkpointInput, id), error => typeof error.code === "string" && /(?:SCOPE|PATH|FOREIGN|UNAPPROVED)/.test(error.code));
      assert.equal(git("rev-parse", "HEAD"), foreignHead); assert.equal(artifacts.ownerPending(), false); assert.equal(checkpointCalls, 0);
      assert.match(artifacts.read("CURRENT-STATE.md").content, /^baseline_promotion_status: checkpoint_pending$/m); return;
    }
    const preparedCheckpoint = await checkpoint.prepare(instance, checkpointInput, id);
    assert.equal(preparedCheckpoint.can_apply, true, JSON.stringify(preparedCheckpoint));
    if (agedCheckpoint) { checkpointClock = null; assert.ok(Date.now() - preparedCheckpoint.plan.prepared_at_ms >= 86400000); }
    assert.equal(git("rev-parse", "HEAD"), beforeHead); assert.deepEqual(cacheBytes(), beforeCache);
    await assert.rejects(checkpoint.apply(instance, preparedCheckpoint, { write: true, expectPlan: preparedCheckpoint.plan_sha256,
      assertAuthorized: () => { throw Object.assign(Error("fixture denied checkpoint"), { code: "FIXTURE_CHECKPOINT_DENIED" }); } }), { code: "FIXTURE_CHECKPOINT_DENIED" });
    assert.equal(artifacts.ownerPending(), false); assert.equal(git("rev-parse", "HEAD"), beforeHead);
    let checkpointGrants = 0;
    const checked = await checkpoint.apply(instance, preparedCheckpoint, { write: true, expectPlan: preparedCheckpoint.plan_sha256, assertAuthorized() {
      if (checkpointFault === "grant_after_git" && ++checkpointGrants === 5) throw Object.assign(Error("fixture denied after confirmed Git"), { code: "FIXTURE_CHECKPOINT_GRANT_AFTER_GIT", effect_status: "no_effect" });
    } });
    if (checkpointFault === "grant_after_git") {
      assert.equal(checked.outcome, "reconciliation_required", JSON.stringify(checked)); assert.equal(checked.effect_status, "unknown"); assert.deepEqual(checked.facts, {});
      assert.equal(artifacts.ownerPending(), true); assert.notEqual(git("rev-parse", "HEAD"), beforeHead); assert.equal(checkpointCalls, 0);
      assert.deepEqual(cacheBytes(), beforeCache); assert.match(artifacts.read("CURRENT-STATE.md").content, /^baseline_promotion_status: checkpoint_pending$/m);
      return;
    }
    assert.equal(checked.outcome, "completed", JSON.stringify(checked));
    assert.equal(checked.facts.baseline_checkpoint_completed, true); assert.equal(checked.facts.baseline_promotion_completed, false);
    if (agedCheckpoint) assert.ok(Date.now() - preparedCheckpoint.plan.prepared_at_ms >= 86400000);
    assert.equal(artifacts.ownerPending(), false); assert.equal(git("status", "--porcelain"), "");
    const confirmedHead = git("rev-parse", "HEAD");
    await assert.rejects(checkpoint.apply(instance, preparedCheckpoint, { write: true, expectPlan: preparedCheckpoint.plan_sha256, assertAuthorized() {} }));
    assert.equal(git("rev-parse", "HEAD"), confirmedHead);
    if (!objectiveCompletion) completeDriftCheckFixture(root); // Existing ordinary component preparation.
    else {
      // Use the real event writer with an explicitly controlled alignment port.
      // This is a physical fixture precondition, not a signed model/H receipt.
      const runId = "fixture_promotion_objective_alignment", completed = await runGatingEvaluateUseCase({ targetRoot: root,
        runtimeDir: import.meta.dirname, verifyObjectiveAlignment: async () => ({ ...completionSubject }), args: {
          cache: ".aidn/runtime/cache/reload-state.json", eventFile: ".aidn/runtime/perf/workflow-events.ndjson", indexSyncCheckFile: ".aidn/runtime/index/index-sync-check.json",
          stateMode: mode, stateModeExplicit: true, indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto",
          thresholdFiles: 3, thresholdMinutes: null, mode: "COMMITTING", runId, reloadDecision: "", reloadFallback: "", reloadReasonCodes: "", emitEvent: true, completeDriftCheck: true } });
      assert.equal(completed.ok, true, JSON.stringify(completed));
      const physical = events().toString("utf8").split(/\r?\n/).filter(Boolean).map(row => JSON.parse(row)).filter(row => row.run_id === runId);
      assert.equal(physical.length, 1); assert.equal(physical[0].event, "drift_check_completed");
      assert.equal(physical[0].objective_alignment_sha256, shadowHash(completionSubject));
      console.log(JSON.stringify({ controlled_physical_drift_precondition: true, mode, root, event_sha256: shadowHash(physical[0]),
        source_authority: "CONTROLLED_ALIGNMENT_PORT_NOT_SIGNED_R05_OR_HUMAN_HISTORY", native: "NOT_RUN" }));
    }
  }
  if (objectiveCompletion) {
    const before = baselinePromotionPaths.map(name => ({ path: name, sha256: artifacts.read(name).sha256, metadata_sha256: artifacts.metadataHash(name) })), prefix = events();
    const unchanged = () => { assert.deepEqual(events(), prefix); assert.equal(checkpointCalls, 0); assert.equal(artifacts.ownerPending(), false);
      for (const row of before) { assert.equal(artifacts.read(row.path).sha256, row.sha256); assert.equal(artifacts.metadataHash(row.path), row.metadata_sha256); } };
    const noReader = await makeHook(null).prepare(instance, input, hookId);
    assert.equal(noReader.can_apply, false); assert.equal(noReader.reason_code, "STANDARD_PROMOTION_HOOK_GATE_REQUIRED");
    assert.deepEqual(noReader.gate.levels.level2.active_signals, ["objective_delta"]); unchanged();
    completionMode = "missing"; assert.equal((await hook.prepare(instance, input, hookId)).can_apply, false); unchanged();
    completionMode = "wrong"; await assert.rejects(hook.prepare(instance, input, hookId), /STANDARD_OBJECTIVE_COMPLETION_GATE_CHANGED/); unchanged();
    completionMode = "revoked"; await assert.rejects(hook.prepare(instance, input, hookId), { code: "FIXTURE_PROMOTION_COMPLETION_REVOKED" }); unchanged();
    completionMode = "valid";
    const foreign = Array.from({ length: 4 }, (_, i) => path.join(root, "product", "fixture-mixed-signal-" + i + ".txt")), foreignBefore = foreign.map(file => fs.readFileSync(file));
    try { for (const file of foreign) fs.appendFileSync(file, "Tracked scope growth must remain active.\n");
      sourceReads = 0; const blocked = await hook.prepare(instance, input, hookId);
      assert.equal(blocked.can_apply, false); assert.equal(blocked.reason_code, "STANDARD_PROMOTION_HOOK_GATE_REQUIRED");
      assert.ok(blocked.gate.levels.level2.active_signals.includes("scope_growth")); assert.ok(blocked.gate.levels.level2.active_signals.includes("objective_delta"));
      assert.equal(sourceReads, 0); unchanged();
    } finally { for (const [index, file] of foreign.entries()) fs.writeFileSync(file, foreignBefore[index]); }
    const preparedBoundary = await hook.prepare(instance, input, hookId); assert.equal(preparedBoundary.can_apply, true, JSON.stringify(preparedBoundary));
    sourceReads = 0; revokeAt = 3; grantLive = true;
    await assert.rejects(hook.apply(instance, preparedBoundary, { write: true, expectPlan: preparedBoundary.plan_sha256,
      assertAuthorized: async () => { if (!grantLive) throw Object.assign(Error("FIXTURE_PROMOTION_GRANT_REVOKED_LAST_COMPLETION_AWAIT"), { code: "FIXTURE_PROMOTION_GRANT_REVOKED_LAST_COMPLETION_AWAIT" }); } }),
      { code: "FIXTURE_PROMOTION_GRANT_REVOKED_LAST_COMPLETION_AWAIT", effect_status: "no_effect" });
    assert.equal(sourceReads, 3); unchanged(); revokeAt = null; grantLive = true;
    console.log(JSON.stringify({ promotion_objective_refusals: true, mode, root, sole_signal: "objective_delta", missing_wrong_revoked_and_mixed_refused: true,
      last_completion_await_grant_revocation: "NO_EFFECT_ZERO_CHECKPOINT_CALLS_CANONICAL_METADATA_UNCHANGED_OWNER_RELEASED", source_authority: "CONTROLLED_READER_NOT_AUTHENTICATED_R05" }));
  }
  let prepared = await hook.prepare(instance, input, hookId);
  if (!prepared.can_apply) {
    assert.equal(promotionCheckpoint, false, "governed checkpoint must not fall back to manual fixture Git/reload");
    assert.equal(prepared.reason_code, "STANDARD_PROMOTION_HOOK_GATE_REQUIRED");
    // Explicit external fixture preconditions; the full standard IR must model
    // their wait/retry route instead of treating this helper as orchestration.
    git("add", "."); git("commit", "--allow-empty", "-m", "fixture approved baseline metadata checkpoint");
    const reload = await runReloadCheckUseCase({ targetRoot: root, args: { cache: ".aidn/runtime/cache/reload-state.json", stateMode: mode,
      stateModeExplicit: true, indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto", writeCache: true } });
    assert.notEqual(reload.decision, "stop"); completeDriftCheckFixture(root);
    prepared = await hook.prepare(instance, input, hookId);
  }
  assert.equal(prepared.can_apply, true, JSON.stringify(prepared));
  if (agedHook) { hookClock = null; assert.ok(Date.now() - prepared.plan.prepared_at_ms >= 86400000); }
  const beforeEvents = events(), beforeDocuments = baselinePromotionPaths.map(name => artifacts.read(name));
  await assert.rejects(hook.apply(instance, prepared, { write: true, expectPlan: prepared.plan_sha256,
    assertAuthorized: () => { throw Object.assign(Error("fixture denied"), { code: "FIXTURE_GRANT_DENIED" }); } }), { code: "FIXTURE_GRANT_DENIED" });
  assert.deepEqual(events(), beforeEvents); assert.equal(artifacts.ownerPending(), false);
  for (const before of beforeDocuments) assert.equal(artifacts.read(before.path).sha256, before.sha256);
  let output, grants = 0;
  try { output = await hook.apply(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: () => {
    if (fault === "grant_after" && ++grants === 3) throw Object.assign(Error("fixture post-effect grant revoked"), { code: "FIXTURE_GRANT_REVOKED" });
  } }); } finally { fs.writeFileSync = write; }
  assert.equal(checkpointCalls, 1);
  if (fault) {
    assert.equal(output.outcome, "reconciliation_required", JSON.stringify(output)); assert.equal(output.effect_status, "unknown"); assert.deepEqual(output.facts, {});
    assert.equal(artifacts.ownerPending(), true); assert.equal((await hook.prepare(instance, input, hookId)).reason_code, "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
    const afterEvents = events(); await assert.rejects(hook.apply(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: () => {} }));
    assert.equal(checkpointCalls, 1); assert.deepEqual(events(), afterEvents);
    assert.equal(output.observations.committed.length, fault === "event" ? 0 : fault === "suffix" ? 1 : 5); return;
  }
  if (objectiveCompletion) console.log(JSON.stringify({ promotion_objective_completion_component: true, mode, root, completion_source_reads: sourceReads,
    source_authority: "CONTROLLED_READER_NOT_AUTHENTICATED_R05", common_process_host: "NOT_RUN", native: "NOT_RUN", effect_status: output.effect_status, facts: output.facts }));
  assert.equal(output.outcome, "completed", JSON.stringify(output)); assert.equal(output.effect_status, "confirmed");
  assert.deepEqual(output.facts, { baseline_recorded: true, baseline_promotion_completed: true }); assert.equal(output.observations.committed.length, 5);
  assert.ok(artifacts.read("baseline/history.md").content.startsWith(beforeDocuments[1].content));
  assert.match(artifacts.read("CURRENT-STATE.md").content, /^baseline_promotion_status: completed$/m); assert.equal(artifacts.ownerPending(), false);
  const afterEvents = events(), afterDocuments = baselinePromotionPaths.map(name => artifacts.read(name).sha256);
  await assert.rejects(hook.apply(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: () => {} }));
  assert.equal(checkpointCalls, 1);
  assert.deepEqual(events(), afterEvents); assert.deepEqual(baselinePromotionPaths.map(name => artifacts.read(name).sha256), afterDocuments);
  assert.equal(artifacts.ownerPending(), false);
}
