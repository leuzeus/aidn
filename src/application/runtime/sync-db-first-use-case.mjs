import { resolveEffectiveRuntimeMode } from "./runtime-mode-service.mjs";
import { requiresStrictRuntime } from "../../core/state-mode/state-mode-policy.mjs";
import { writeRepairLayerTriageArtifacts } from "./repair-layer-artifact-service.mjs";

function resolveRepairLayerTarget(payload, args) {
  const outputs = Array.isArray(payload?.outputs) ? payload.outputs : [];
  const sqliteOutput = outputs.find((row) => String(row?.backend ?? "").toLowerCase() === "sqlite")
    ?? outputs.find((row) => String(row?.path ?? "").toLowerCase().endsWith(".sqlite"));
  const jsonOutput = outputs.find((row) => String(row?.backend ?? "").toLowerCase() === "json")
    ?? outputs.find((row) => String(row?.path ?? "").toLowerCase().endsWith(".json"));
  if (sqliteOutput?.path) {
    return {
      indexFile: sqliteOutput.path,
      indexBackend: "sqlite",
    };
  }
  if (jsonOutput?.path) {
    return {
      indexFile: jsonOutput.path,
      indexBackend: "json",
    };
  }
  return {
    indexFile: args.repairLayerIndexFile,
    indexBackend: "sqlite",
  };
}

export function runSyncDbFirstUseCase({
  args,
  targetRoot,
  processAdapter,
  perfIndexSyncScript,
  repairLayerScript,
  repairLayerTriageSummaryScript,
}) {
  const runtimeMode = resolveEffectiveRuntimeMode({
    targetRoot,
    stateMode: args.stateMode,
    indexStore: args.store || "file",
    indexStoreExplicit: Boolean(args.store),
  });
  const strictByState = requiresStrictRuntime(runtimeMode.stateMode);
  const strict = args.strict || strictByState;

  if (runtimeMode.stateMode === "files" && !args.forceInFiles) {
    return {
      ts: new Date().toISOString(),
      ok: true,
      skipped: true,
      reason: "state_mode_files",
      target_root: targetRoot,
      state_mode: runtimeMode.stateMode,
      strict,
    };
  }

  const payload = processAdapter.runJsonNodeScript(perfIndexSyncScript, [
    "--target",
    targetRoot,
    "--store",
    runtimeMode.indexStore,
    "--with-content",
    "--json",
  ]);

  let repairLayerResult = null;
  let repairLayerTriageResult = null;
  if (args.repairLayer !== false) {
    const repairTarget = resolveRepairLayerTarget(payload, args);
    repairLayerResult = processAdapter.runJsonNodeScript(repairLayerScript, [
      "--target",
      targetRoot,
      "--index-file",
      repairTarget.indexFile,
      "--index-backend",
      repairTarget.indexBackend,
      ...(args.repairLayerReportFile ? ["--report-file", args.repairLayerReportFile] : ["--no-report"]),
      "--apply",
      "--json",
    ]);
    if (args.repairLayerTriage !== false) {
      repairLayerTriageResult = writeRepairLayerTriageArtifacts({
        targetRoot,
        indexFile: repairTarget.indexFile,
        backend: repairTarget.indexBackend,
        triageFile: args.repairLayerTriageFile,
        summaryFile: args.repairLayerTriageSummaryFile,
        renderScript: repairLayerTriageSummaryScript,
        runNodeScript(scriptPath, scriptArgs) {
          return processAdapter.runNodeScript(scriptPath, scriptArgs);
        },
      });
    }
  }

  return {
    ts: new Date().toISOString(),
    ok: true,
    skipped: false,
    target_root: targetRoot,
    state_mode: runtimeMode.stateMode,
    strict,
    store: runtimeMode.indexStore,
    payload,
    repair_layer_result: repairLayerResult,
    repair_layer_triage_result: repairLayerTriageResult,
  };
}
