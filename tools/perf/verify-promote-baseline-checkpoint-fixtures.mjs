import assert from "node:assert/strict";
import { runPromoteBaselineCheckpointUseCase, createPromoteBaselineCheckpointDefaults } from "../../src/application/runtime/promote-baseline-checkpoint-use-case.mjs";
let checks = 0;
async function test(name, run) { await run(); checks++; console.log("PASS " + name); }
const input = { targetRoot: "fixture-root", runtimeDir: "fixture-runtime", args: { mode: "COMMITTING", runId: "fixture_run" } };
await test("refusal and ambiguous selection never invoke checkpoint effects", async () => {
  for (const admission of [{ ok: false, action: "blocked_validation_incomplete" }, { ok: false, action: "promote_baseline_allowed" }, { ok: true, action: "choose_cycle" }]) {
    let effects = 0; const result = await runPromoteBaselineCheckpointUseCase(input, { admit: async () => admission, checkpoint: async () => { effects++; } });
    assert.deepEqual(result, { admission, checkpoint: null }); assert.equal(effects, 0);
  }
});
await test("ordinary inference preserves the real port argument shape and nested checkpoint result", async () => {
  const calls = [], admission = { ok: true, action: "promote_baseline_allowed", target_cycle: { cycle_id: "C001" } }, observed = { ok: false, summary: { result: "warn" } };
  const result = await runPromoteBaselineCheckpointUseCase(input, { admit: async args => { calls.push(args); return admission; }, checkpoint: async args => { calls.push(args); return observed; } });
  assert.deepEqual(calls[0], { targetRoot: input.targetRoot, mode: "COMMITTING", cycleId: null });
  assert.deepEqual(calls[1], { args: input.args, runtimeDir: input.runtimeDir, targetRoot: input.targetRoot }); assert.equal(result.checkpoint, observed);
});
await test("host-selected completed target is retained and mismatched admission refuses before effects", async () => {
  let effects = 0;
  const dependencies = { admit: async () => ({ ok: true, action: "promote_baseline_allowed", target_cycle: { cycle_id: "C002" } }), checkpoint: async () => { effects++; } };
  await assert.rejects(runPromoteBaselineCheckpointUseCase({ ...input, cycleId: "C001" }, dependencies), { code: "PROMOTE_BASELINE_HOOK_TARGET_CHANGED" }); assert.equal(effects, 0);
  let received; await runPromoteBaselineCheckpointUseCase({ ...input, cycleId: "C002", completionCycleId: "C002" }, { ...dependencies, checkpoint: async args => { received = args; return { ok: true }; } });
  assert.equal(received.completionCycleId, "C002"); assert.equal(received.args.runId, input.args.runId);
});
await test("completion context cannot belong to an unselected or different cycle", async () => {
  let calls = 0; const ports = { admit: async () => { calls++; }, checkpoint: async () => { calls++; } };
  for (const fields of [{ completionCycleId: "C001" }, { cycleId: "C001", completionCycleId: "C002" }])
    await assert.rejects(runPromoteBaselineCheckpointUseCase({ ...input, ...fields }, ports), { code: "PROMOTE_BASELINE_HOOK_TARGET_CHANGED" });
  assert.equal(calls, 0);
});
await test("shared defaults retain ordinary inference and fixed runtime artifact locations", () => {
  const defaults = createPromoteBaselineCheckpointDefaults({ runtimeDir: "fixture-runtime", env: {} });
  assert.equal(defaults.stateMode, "files"); assert.equal(defaults.indexStore, ""); assert.equal(defaults.indexStoreExplicit, false);
  assert.equal(defaults.cache, ".aidn/runtime/cache/reload-state.json"); assert.equal(defaults.eventFile, ".aidn/runtime/perf/workflow-events.ndjson");
  assert.equal(defaults.mode, "COMMITTING"); assert.equal(defaults.skipGateEvaluate, false); assert.equal(defaults.autoSkipGateOnNoSignal, true);
  const configured = createPromoteBaselineCheckpointDefaults({ runtimeDir: "fixture-runtime", env: { AIDN_STATE_MODE: " DUAL ", AIDN_INDEX_STORE_MODE: " SQLITE " } });
  assert.equal(configured.stateMode, "dual"); assert.equal(configured.indexStore, "sqlite"); assert.equal(configured.indexStoreExplicit, false);
});
console.log(JSON.stringify({ status: "PASS", checks, proof: "promotion-checkpoint-application-dispatch", ports: "fixture",
  actual_checkpoint: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
