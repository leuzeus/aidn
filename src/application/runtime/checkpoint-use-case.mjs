import fs from "node:fs";
import crypto from "node:crypto";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { createLocalProcessAdapter } from "../../adapters/runtime/local-process-adapter.mjs";
import { shouldSkipGateOnNoSignal } from "../../core/gating/gating-policy.mjs";
import {
  buildDefaultCheckpointGate,
  buildDefaultCheckpointIndex,
  buildDefaultCheckpointIndexSyncCheck,
  buildCheckpointIndexSyncCheckResult,
} from "../../core/workflow/checkpoint-output-policy.mjs";
import {
  buildSkippedIndexSyncCheckPayload,
  shouldSkipCheckpointIndex,
} from "../../core/workflow/checkpoint-skip-policy.mjs";
import {
  buildCheckpointSummaryEvent,
  buildReloadSummaryEvent,
} from "../../core/workflow/workflow-event-factory.mjs";
import {
  buildCheckpointSummary,
  isWorkflowResultOk,
} from "../../core/workflow/workflow-output-factory.mjs";
import {
  resolveCheckpointReasonCode,
  resolveCheckpointResult,
  resolveReloadEventResult,
} from "../../core/workflow/workflow-result-policy.mjs";
import { resolveEffectiveRuntimeMode } from "./runtime-mode-service.mjs";
import { runGatingEvaluateUseCase } from "./gating-evaluate-use-case.mjs";
import {
  appendRuntimeNdjsonEvent,
  resolveRuntimeTargetPath,
  writeRuntimeJsonFile,
} from "./runtime-path-service.mjs";
import {
  indexOutputsExistForStore,
  resolveReloadIndexBackend,
  resolveSyncCheckIndexBackend,
} from "../../core/state-mode/runtime-index-policy.mjs";
import {
  runWorkflowIndexSync,
  runWorkflowIndexSyncCheck,
  runWorkflowReloadCheck,
} from "./workflow-runtime-service.mjs";

function toIsoNowCompact() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "");
}

export async function runCheckpointUseCase({ args, runtimeDir, targetRoot }) {
  const processAdapter = createLocalProcessAdapter();
  const gitAdapter = createLocalGitAdapter();
  const started = Date.now();
  const runtimeMode = resolveEffectiveRuntimeMode({
    targetRoot,
    stateMode: args.stateMode,
    indexStore: args.indexStore,
    indexStoreExplicit: args.indexStoreExplicit,
  });
  args.stateMode = runtimeMode.stateMode;
  args.indexStore = runtimeMode.indexStore;
  const cachePath = resolveRuntimeTargetPath(targetRoot, args.cache);
  const eventFilePath = resolveRuntimeTargetPath(targetRoot, args.eventFile);
  const indexOutputPath = resolveRuntimeTargetPath(targetRoot, args.indexOutput);
  const indexSqlOutputPath = resolveRuntimeTargetPath(targetRoot, args.indexSqlOutput);
  const indexSqliteOutputPath = resolveRuntimeTargetPath(targetRoot, args.indexSqliteOutput);
  const indexSyncCheckOutPath = resolveRuntimeTargetPath(targetRoot, args.indexSyncCheckOut);
  const reloadIndex = resolveReloadIndexBackend({
    storeMode: args.indexStore,
    indexOutputPath,
    indexSqliteOutputPath,
  });
  const syncCheckIndex = resolveSyncCheckIndexBackend({
    storeMode: args.indexStore,
    indexOutputPath,
    indexSqliteOutputPath,
  });

  const reloadStarted = Date.now();
  const reload = runWorkflowReloadCheck({
    processAdapter,
    runtimeDir,
    targetRoot,
    cachePath,
    stateMode: args.stateMode,
    indexFile: args.stateMode !== "files" ? reloadIndex.indexFile : "",
    indexBackend: args.stateMode !== "files" ? reloadIndex.indexBackend : "",
    writeCache: true,
  });
  const reloadDurationMs = Date.now() - reloadStarted;

  let gate = buildDefaultCheckpointGate(reload);
  let gateDurationMs = 0;
  const noSignalGateSkip = shouldSkipGateOnNoSignal({
    autoSkipGateOnNoSignal: args.autoSkipGateOnNoSignal,
    skipGateEvaluate: args.skipGateEvaluate,
    reload,
    hasWorkingTreeChanges: gitAdapter.hasWorkingTreeChanges(targetRoot),
  });
  if (!args.skipGateEvaluate && !noSignalGateSkip) {
    const gateStarted = Date.now();
    gate = await runGatingEvaluateUseCase({
      args: {
        target: targetRoot,
        cache: cachePath,
        eventFile: eventFilePath,
        indexSyncCheckFile: indexSyncCheckOutPath,
        stateMode: args.stateMode,
        stateModeExplicit: true,
        indexFile: reloadIndex.indexFile,
        indexBackend: reloadIndex.indexBackend,
        thresholdFiles: 3,
        thresholdMinutes: 45,
        mode: args.mode,
        runId: args.runId,
        reloadDecision: String(reload.decision ?? "incremental"),
        reloadFallback: reload.fallback ? "true" : "false",
        reloadReasonCodes: JSON.stringify(Array.isArray(reload.reason_codes) ? reload.reason_codes : []),
        emitEvent: true,
      },
      targetRoot,
      runtimeDir,
    });
    gateDurationMs = Date.now() - gateStarted;
  } else if (noSignalGateSkip) {
    gate = {
      ...gate,
      action: "proceed_l1_fast_checks_only",
      result: "ok",
      reason_code: null,
      gates_triggered: ["R03", "R04"],
    };
  }

  const hasIndexOutputs = indexOutputsExistForStore({
    storeMode: args.indexStore,
    indexOutputPath,
    indexSqlOutputPath,
    indexSqliteOutputPath,
  });
  const hasIndexFileForSyncCheck = !args.indexSyncCheck || fs.existsSync(syncCheckIndex.indexFile);
  const shouldSkipIndex = shouldSkipCheckpointIndex({
    skipIndexOnIncremental: args.skipIndexOnIncremental,
    reload,
    indexKpiFile: args.indexKpiFile,
    hasIndexOutputs,
    hasIndexFileForSyncCheck,
  });
  let indexDurationMs = 0;
  let index = buildDefaultCheckpointIndex({
    targetRoot,
    stateMode: args.stateMode,
    store: args.indexStore,
  });
  if (!shouldSkipIndex) {
    const indexStarted = Date.now();
    index = runWorkflowIndexSync({
      processAdapter,
      runtimeDir,
      targetRoot,
      store: args.indexStore,
      output: indexOutputPath,
      sqlOutput: args.indexStore === "sql" || args.indexStore === "dual" || args.indexStore === "all"
        ? indexSqlOutputPath
        : "",
      sqliteOutput: args.indexStore === "sqlite" || args.indexStore === "dual-sqlite" || args.indexStore === "all"
        ? indexSqliteOutputPath
        : "",
      schemaFile: args.indexStore === "sql" || args.indexStore === "dual" || args.indexStore === "sqlite" || args.indexStore === "dual-sqlite" || args.indexStore === "all"
        ? args.indexSchemaFile
        : "",
      includeSchema: args.indexIncludeSchema,
      kpiFile: args.indexKpiFile,
    });
    indexDurationMs = Date.now() - indexStarted;
    index.skipped = false;
    index.skip_reason = null;
  }

  let indexSyncCheck = buildDefaultCheckpointIndexSyncCheck({
    strict: args.indexSyncCheckStrict,
  });
  if (args.indexSyncCheck) {
    if (shouldSkipIndex) {
      const syncCheckOut = buildSkippedIndexSyncCheckPayload({ targetRoot });
      indexSyncCheck = buildCheckpointIndexSyncCheckResult({
        strict: args.indexSyncCheckStrict,
        syncCheckOut,
        durationMs: 0,
        outputFile: writeRuntimeJsonFile(indexSyncCheckOutPath, syncCheckOut),
        indexFile: syncCheckIndex.indexFile,
        indexBackend: syncCheckIndex.indexBackend,
        skipped: true,
        skipReason: "SKIPPED_NO_RELOAD_SIGNAL",
      });
    } else {
      const syncCheckStarted = Date.now();
      const syncCheckOut = runWorkflowIndexSyncCheck({
        processAdapter,
        runtimeDir,
        targetRoot,
        indexFile: syncCheckIndex.indexFile,
        indexBackend: syncCheckIndex.indexBackend,
      });
      indexSyncCheck = buildCheckpointIndexSyncCheckResult({
        strict: args.indexSyncCheckStrict,
        syncCheckOut,
        durationMs: Date.now() - syncCheckStarted,
        outputFile: writeRuntimeJsonFile(indexSyncCheckOutPath, syncCheckOut),
        indexFile: syncCheckIndex.indexFile,
        indexBackend: syncCheckIndex.indexBackend,
      });
      if (args.indexSyncCheckStrict && syncCheckOut.in_sync !== true) {
        throw new Error("Index sync check drift detected in strict checkpoint mode");
      }
    }
  }

  const checkpointRunId = args.runId || `checkpoint-${toIsoNowCompact()}`;
  const gateLevels = gate?.levels ?? buildDefaultCheckpointGate(reload).levels;

  const result = {
    ts: new Date().toISOString(),
    ok: false,
    run_id: checkpointRunId,
    target_root: targetRoot,
    mode: args.mode,
    state_mode: args.stateMode,
    branch: gitAdapter.getCurrentBranch(targetRoot),
    reload: {
      decision: reload.decision,
      fallback: reload.fallback,
      reason_codes: reload.reason_codes ?? [],
      duration_ms: reloadDurationMs,
    },
    gate: {
      action: gate.action,
      result: gate.result,
      reason_code: gate.reason_code,
      gates_triggered: Array.isArray(gate.gates_triggered) ? gate.gates_triggered : [],
      levels: gateLevels,
      skipped: args.skipGateEvaluate === true || noSignalGateSkip,
      skip_reason: args.skipGateEvaluate === true
        ? "SKIPPED_BY_CHECKPOINT_OPTION"
        : (noSignalGateSkip ? "SKIPPED_NO_SIGNAL_GATE" : null),
      duration_ms: gateDurationMs,
    },
    index: {
      state_mode: args.stateMode,
      store: args.indexStore,
      skipped: shouldSkipIndex,
      skip_reason: shouldSkipIndex ? "SKIPPED_NO_RELOAD_SIGNAL" : null,
      output: indexOutputPath,
      sql_output: args.indexStore === "sql" || args.indexStore === "dual" || args.indexStore === "all"
        ? indexSqlOutputPath
        : null,
      sqlite_output: args.indexStore === "sqlite" || args.indexStore === "dual-sqlite" || args.indexStore === "all"
        ? indexSqliteOutputPath
        : null,
      outputs: Array.isArray(index.outputs) ? index.outputs : [],
      writes: index.writes ?? {
        files_written_count: 0,
        bytes_written: 0,
      },
      duration_ms: indexDurationMs,
    },
    index_sync_check: indexSyncCheck,
    total_duration_ms: Date.now() - started,
    summary: null,
  };
  result.summary = buildCheckpointSummary(result);
  result.ok = isWorkflowResultOk(result.summary.result);

  if (args.emitSummaryEvent) {
    const reloadEvent = buildReloadSummaryEvent({
      ts: result.ts,
      runId: checkpointRunId,
      branch: result.branch,
      mode: result.mode,
      durationMs: result.reload.duration_ms,
      reload: {
        ...result.reload,
        result: resolveReloadEventResult(result.reload),
      },
      traceId: `tr-${crypto.randomBytes(4).toString("hex")}`,
    });
    appendRuntimeNdjsonEvent(eventFilePath, reloadEvent);

    const event = buildCheckpointSummaryEvent({
      ts: result.ts,
      runId: checkpointRunId,
      branch: result.branch,
      mode: result.mode,
      durationMs: result.total_duration_ms,
      filesWrittenCount: Number(result.index?.writes?.files_written_count ?? 0),
      bytesWritten: Number(result.index?.writes?.bytes_written ?? 0),
      gatesTriggered: Array.from(new Set([
        ...(Array.isArray(result.gate?.gates_triggered) ? result.gate.gates_triggered : []),
        ...(result.index_sync_check?.enabled ? ["R11"] : []),
      ])),
      result: result.summary.result,
      reasonCode: result.summary.reason_code,
      repairLayerOpenCount: result.summary.repair_layer_open_count,
      repairLayerBlocking: result.summary.repair_layer_blocking,
      traceId: `tr-${crypto.randomBytes(4).toString("hex")}`,
    });
    result.summary_event_file = appendRuntimeNdjsonEvent(eventFilePath, event);
    result.summary_run_id = checkpointRunId;
  }

  return result;
}
