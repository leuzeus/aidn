#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { runGatingEvaluateUseCase } from "../../src/application/runtime/gating-evaluate-use-case.mjs";
import { runWorkflowHookUseCase } from "../../src/application/runtime/workflow-hook-use-case.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

export async function verifyStandardStartCompletion({ selectedMode } = {}) {
  const owned = [], temporary = fs.realpathSync(os.tmpdir()), runtimeDir = fileURLToPath(new URL("./", import.meta.url)); let checks = 0, success = false;
  const pass = text => { checks++; console.log("PASS " + text); };
  if (selectedMode && !["files", "dual", "db-only"].includes(selectedMode)) throw Error("FIXTURE_MODE_INVALID");
  try {
    for (const mode of selectedMode ? [selectedMode] : ["files", "dual", "db-only"]) {
      const targetRoot = createFreshStandardWorkflowFixture(mode, owned), ops = createStandardWorkflowOperations({ targetRoot }), artifacts = createStandardWorkflowArtifacts({ targetRoot });
      const git = (...args) => execFileSync("git", ["-C", targetRoot, "-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`, ...args], { encoding: "utf8", windowsHide: true }).trim();
      const checkpoint = message => { git("add", "."); git("commit", "--allow-empty", "-m", message); };
      const apply = async (prepared, method) => { assert.equal(prepared.can_apply, true); assert.equal((await ops[method](prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed"); };
      const sessionObjective = "Maintain the existing feature", cycleObjective = "Correct the reviewed feature after delivery";
      await apply(await ops.prepareSession({ session_id: "S001", session_branch: "S001-start-completion", objective: sessionObjective }), "initializeSession");
      await apply(await ops.prepareMode({ session_id: "S001", mode: "COMMITTING" }), "applyMode"); checkpoint("fixture selected mode");
      await apply(await ops.prepareCycleContext({ session_id: "S001" }), "refreshCycleContext"); checkpoint("fixture current cycle context");
      await apply(await ops.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "start-completion", objective: cycleObjective,
        continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-start-completion" }), "initializeCycle"); checkpoint("fixture current corrective intent");
      fs.writeFileSync(path.join(targetRoot, "fixture-entry-signal.txt"), "One fixture change keeps the ordinary intent gate observable.\n");
      const eventFile = path.join(targetRoot, ".aidn/runtime/perf/workflow-events.ndjson"), cacheFile = path.join(targetRoot, ".aidn/runtime/cache/reload-state.json");
      const bytes = file => fs.existsSync(file) ? fs.readFileSync(file).toString("base64") : null;
      const input = { session_id: "S001" }, H = "a".repeat(64);
      // This source capability is synthetic; this fixture qualifies the actual
      // startup/checkpoint/effect bridge, not authentication of a human source.
      const completion = { contract_version: "standard-drift-objective-disposition.v1", decision_operation_id: "op_" + "a".repeat(40),
        evaluation_operation_id: "op_" + "b".repeat(40), evaluation_sha256: H, context_sha256: H, review_sha256: H, question_sha256: H,
        source_sha256: H, receipt_sha256: H, inbox_id: "decision_" + "c".repeat(40), authority_id: "fixture_operator", source_event_id: "fixture-completion",
        session_objective: sessionObjective, cycle_objective: cycleObjective, rationale: "Synthetic already accepted exact current completion", prepared_at_ms: 0 };
      let reads = 0; const reader = async () => { reads++; await new Promise(resolve => setImmediate(resolve)); return structuredClone(completion); };
      const gateArgs = { cache: ".aidn/runtime/cache/reload-state.json", eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
        indexSyncCheckFile: ".aidn/runtime/index/index-sync-check.json", stateMode: mode, stateModeExplicit: true, indexFile: ".aidn/runtime/index/workflow-index.sqlite",
        indexBackend: "auto", thresholdFiles: 3, thresholdMinutes: null, mode: "COMMITTING", emitEvent: false, completeDriftCheck: false };
      // Establish a physical completion with the actual evaluator and a
      // synthetic alignment verifier. This is not a signed R05 operation chain.
      const seeded = await runGatingEvaluateUseCase({ targetRoot, runtimeDir,
        args: { ...gateArgs, emitEvent: true, completeDriftCheck: true, runId: "fixture_start_r05" }, verifyObjectiveAlignment: reader });
      assert.equal(seeded.result, "ok");
      const beforePreview = [bytes(eventFile), bytes(cacheFile)], legacy = await ops.prepareStart(input);
      assert.equal(legacy.can_apply, true); assert.equal(legacy.plan.contract_version, "standard-session-start-plan.v1");
      const gate = await runGatingEvaluateUseCase({ targetRoot, runtimeDir, args: { ...gateArgs } });
      assert.equal(gate.result, "warn"); assert.deepEqual(gate.levels.level2.active_signals, ["objective_delta"]); assert.deepEqual([bytes(eventFile), bytes(cacheFile)], beforePreview);
      const prepared = await ops.prepareStart(input, { readObjectiveCompletion: reader });
      assert.equal(prepared.plan.contract_version, "standard-session-start-plan.v2"); assert.equal(prepared.plan.objective_completion_sha256, shadowHash(completion));
      assert.deepEqual([bytes(eventFile), bytes(cacheFile)], beforePreview);
      await assert.rejects(ops.finalizeStart(prepared, { write: true, expectPlan: prepared.plan_sha256 }), { code: "STANDARD_START_COMPLETION_CAPABILITY_REQUIRED" });
      for (const fault of ["changed-proof", "revoked-grant", "changed-process"]) {
        const before = [bytes(eventFile), bytes(cacheFile)], original = shadowHash(prepared);
        let authorized = true, current = true;
        const read = async () => {
          const value = await reader();
          if (fault === "revoked-grant") authorized = false;
          if (fault === "changed-process") current = false;
          return fault === "changed-proof" ? { ...value, source_sha256: "b".repeat(64) } : value;
        };
        await assert.rejects(ops.finalizeStart(prepared, { write: true, expectPlan: prepared.plan_sha256, readObjectiveCompletion: read,
          assertAuthorized: async () => { if (!authorized) throw Error("FIXTURE_START_GRANT_REVOKED"); },
          assertCurrent: async () => { if (!current) throw Error("FIXTURE_START_PROCESS_CHANGED"); } }),
        fault === "changed-proof" ? { code: "STANDARD_START_COMPLETION_CHANGED", effect_status: "no_effect" } : { message: fault === "revoked-grant" ? "FIXTURE_START_GRANT_REVOKED" : "FIXTURE_START_PROCESS_CHANGED", effect_status: "no_effect" });
        assert.equal(artifacts.ownerPending(), false); assert.deepEqual([bytes(eventFile), bytes(cacheFile)], before); assert.equal(shadowHash(prepared), original);
      }
      pass(`${mode}: legacy warning and read-only previews retained; missing/substituted proof, revoked grant and changed process refuse before checkpoint effects`);
      const businessBefore = artifacts.observeInventory().rows.filter(row => !row.path.startsWith("workflows/") && row.path !== "RUNTIME-STATE.md").map(row => ({ path: row.path, sha256: row.sha256, metadata_sha256: row.metadata_sha256 }));
      const prefix = fs.existsSync(eventFile) ? fs.readFileSync(eventFile) : Buffer.alloc(0);
      const result = await ops.finalizeStart(prepared, { write: true, expectPlan: prepared.plan_sha256, readObjectiveCompletion: reader, assertAuthorized: async () => {}, assertCurrent: async () => {} });
      assert.equal(result.outcome, "completed", result.observations.reason_code); assert.equal(result.effect_status, "confirmed"); assert.equal(artifacts.ownerPending(), false);
      const payload = result.observations.hook.payload, hook = payload.workflow_hook, cp = hook.checkpoint;
      assert.equal(cp.gate.result, "ok"); assert.equal(cp.gate.skipped, false); assert.equal(cp.summary.result, "ok"); assert.equal(cp.gate.levels.level2.required, false);
      assert.equal(hook.run_id, cp.run_id); assert.equal(cp.run_id, cp.summary_run_id); assert.equal(hook.run_id, "process_start_" + prepared.plan_sha256.slice(0, 40));
      assert.equal(fs.readFileSync(hook.run_id_file, "utf8").trim(), hook.run_id); assert.ok(reads >= 6);
      const after = fs.readFileSync(eventFile); assert.deepEqual(after.subarray(0, prefix.length), prefix);
      const events = after.subarray(prefix.length).toString("utf8").trim().split("\n").map(line => JSON.parse(line));
      assert.ok(events.some(row => row.event === "hook_session_start" && row.run_id === hook.run_id));
      assert.ok(events.some(row => row.event === "checkpoint_summary")); assert.ok(!events.some(row => row.event === "drift_check_completed"));
      assert.deepEqual(artifacts.observeInventory().rows.filter(row => !row.path.startsWith("workflows/") && row.path !== "RUNTIME-STATE.md").map(row => ({ path: row.path, sha256: row.sha256, metadata_sha256: row.metadata_sha256 })), businessBefore);
      const beforeBadRun = [bytes(eventFile), fs.readFileSync(hook.run_id_file, "utf8")];
      assert.throws(() => runWorkflowHookUseCase({ targetRoot, runtimeDir, args: { phase: "session-start", mode: "COMMITTING", strict: true },
        completedCheckpoint: cp, completedStartRunId: "process_start_" + "f".repeat(40) }), /START_CHECKPOINT_CORRELATION_CHANGED/);
      assert.throws(() => runWorkflowHookUseCase({ targetRoot, runtimeDir, args: { phase: "session-start", mode: "COMMITTING", strict: true },
        completedCheckpoint: { ...cp, gate: { ...cp.gate, result: "warn" } }, completedStartRunId: hook.run_id }), /START_CHECKPOINT_CORRELATION_CHANGED/);
      assert.deepEqual([bytes(eventFile), fs.readFileSync(hook.run_id_file, "utf8")], beforeBadRun);
      pass(`${mode}: actual checkpoint and start event share one run; canonical business preserved, no fabricated drift completion, substituted run refused`);
    }
    success = true; console.log(JSON.stringify({ status: "PASS", checks, checkpoint_and_start_hook: "ACTUAL", completion_source: "SYNTHETIC_CAPABILITY", signed_R05_chain: "NOT_RUN", published_model: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" })); return checks;
  } finally {
    if (success) for (const root of owned) { const real = fs.realpathSync(root); if (path.dirname(real) !== temporary || !path.basename(real).startsWith("aidn-standard-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID"); fs.rmSync(real, { recursive: true, force: true }); }
    else console.error(JSON.stringify({ retained_failed_fixture_roots: owned }));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyStandardStartCompletion({ selectedMode: process.argv.find(arg => arg.startsWith("--mode="))?.slice(7) });
