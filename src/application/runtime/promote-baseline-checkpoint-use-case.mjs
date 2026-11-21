import path from "node:path";
import { runPromoteBaselineAdmitUseCase } from "./promote-baseline-admit-use-case.mjs";
import { runCheckpointUseCase } from "./checkpoint-use-case.mjs";

// cycleId and completionCycleId are trusted application selections, not grants.
// The ordinary wrapper keeps its existing inferred target by omitting them.
export async function runPromoteBaselineCheckpointUseCase({ targetRoot, args, runtimeDir, cycleId = null, completionCycleId = null, readObjectiveCompletion = null, assertEffectAuthorized = null },
  { admit = runPromoteBaselineAdmitUseCase, checkpoint = runCheckpointUseCase } = {}) {
  if (completionCycleId !== null && (cycleId === null || completionCycleId !== cycleId)) throw Object.assign(Error("PROMOTE_BASELINE_HOOK_TARGET_CHANGED"), { code: "PROMOTE_BASELINE_HOOK_TARGET_CHANGED" });
  const admission = await admit({ targetRoot, mode: args.mode, cycleId });
  if (admission.ok !== true || admission.action !== "promote_baseline_allowed") return { admission, checkpoint: null };
  if (cycleId !== null && admission.target_cycle?.cycle_id !== cycleId) throw Object.assign(Error("PROMOTE_BASELINE_HOOK_TARGET_CHANGED"), { code: "PROMOTE_BASELINE_HOOK_TARGET_CHANGED" });
  return { admission, checkpoint: await checkpoint({ args, runtimeDir, targetRoot, ...(completionCycleId === null ? {} : { completionCycleId }),
    ...(readObjectiveCompletion === null ? {} : { readObjectiveCompletion }),
    ...(assertEffectAuthorized === null ? {} : { assertEffectAuthorized }) }) };
}

export function createPromoteBaselineCheckpointDefaults({ runtimeDir, env = process.env }) {
  const envStore = String(env.AIDN_INDEX_STORE_MODE ?? "").trim().toLowerCase();
  const envStateMode = String(env.AIDN_STATE_MODE ?? "").trim().toLowerCase();
  return {
    target: ".",
    cache: ".aidn/runtime/cache/reload-state.json",
    eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
    indexOutput: ".aidn/runtime/index/workflow-index.json",
    indexStore: envStore || "",
    indexStoreExplicit: false,
    stateMode: envStateMode || "files",
    indexSqlOutput: ".aidn/runtime/index/workflow-index.sql",
    indexSqliteOutput: ".aidn/runtime/index/workflow-index.sqlite",
    indexSchemaFile: path.join(runtimeDir, "sql", "schema.sql"),
    indexIncludeSchema: true,
    indexKpiFile: "",
    indexSyncCheck: false,
    indexSyncCheckStrict: false,
    indexSyncCheckOut: ".aidn/runtime/index/index-sync-check.json",
    mode: "COMMITTING",
    runId: "",
    json: false,
    emitSummaryEvent: true,
    skipIndexOnIncremental: true,
    skipGateEvaluate: false,
    autoSkipGateOnNoSignal: true,
  };
}
