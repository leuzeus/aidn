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
export async function verifyBaselinePromotionHook({ root, mode, artifacts, promotion, instance, preview, result, git, fault }) {
  const recordId = "op_" + "c".repeat(40), hookId = "op_" + "d".repeat(40), input = { record_operation_id: recordId };
  const eventFile = path.join(root, ".aidn/runtime/perf/workflow-events.ndjson"), events = () => fs.existsSync(eventFile) ? fs.readFileSync(eventFile) : Buffer.alloc(0);
  let checkpointCalls = 0; const write = fs.writeFileSync;
  const hook = createStandardBaselinePromotionHook({ targetRoot: root, promotion, readCurrent: () => instance,
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
  let prepared = await hook.prepare(instance, input, hookId);
  if (!prepared.can_apply) {
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
