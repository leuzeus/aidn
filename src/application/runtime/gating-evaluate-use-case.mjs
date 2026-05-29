import crypto from "node:crypto";
import { deriveGatingAction } from "../../core/gating/gating-policy.mjs";
import {
  deriveGatingLevels,
  detectGatingSignals,
} from "../../core/gating/gating-signal-policy.mjs";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { collectGatingObservations } from "./gating-observation-service.mjs";
import {
  buildGatingSummary,
  isWorkflowResultOk,
} from "../../core/workflow/workflow-output-factory.mjs";
import { readAidnProjectConfig, resolveConfigStateMode } from "../../lib/config/aidn-config-lib.mjs";
import {
  appendRuntimeNdjsonEvent,
  resolveRuntimeTargetPath,
} from "./runtime-path-service.mjs";
import { createLocalProcessAdapter } from "../../adapters/runtime/local-process-adapter.mjs";
import { runWorkflowRuntimeJsonScript } from "./workflow-runtime-service.mjs";

function parseReloadReasonCodes(value) {
  if (!value) {
    return [];
  }
  if (value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter((item) => item.length > 0);
      }
    } catch {
      // fall back to comma-separated parsing
    }
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function runReloadCheck(runtimeDir, targetRoot, cachePath, stateMode, indexFile, indexBackend) {
  const processAdapter = createLocalProcessAdapter();
  return runWorkflowRuntimeJsonScript({
    processAdapter,
    runtimeDir,
    scriptName: "reload-check.mjs",
    args: [
      "--target",
      targetRoot,
      "--cache",
      cachePath,
      "--state-mode",
      stateMode,
      "--index-file",
      indexFile,
      "--index-backend",
      indexBackend,
      "--json",
    ],
  });
}

async function detectSignals(targetRoot, args, reloadResult, gitAdapter) {
  const observations = await collectGatingObservations({
    targetRoot,
    eventFile: args.eventFile,
    indexSyncCheckFile: args.indexSyncCheckFile,
    indexFile: args.indexFile,
    indexBackend: args.indexBackend,
    stateMode: args.stateMode,
    mode: args.mode,
    reloadResult,
    gitAdapter,
  });
  const signal = detectGatingSignals({
    sessionObjective: observations.sessionObjective,
    cycleGoal: observations.cycleGoal,
    changedFiles: observations.changedFiles,
    mode: args.mode,
    thresholdFiles: args.thresholdFiles,
    thresholdMinutes: args.thresholdMinutes,
    latestDriftMs: observations.latestDriftMs,
    reloadReasonCodes: reloadResult.reason_codes ?? [],
    indexSyncCheckExists: observations.indexSyncCheckExists,
    indexSyncTargetMatch: observations.indexSyncTargetMatch,
    indexSyncInSync: observations.indexSyncInSync,
    noChangeFastPath: observations.noChangeFastPath,
    repairLayerOpenCount: observations.repairLayerOpenCount,
  });

  return deriveGatingLevels({
    reloadResult,
    signal,
    changedFiles: observations.changedFiles,
    indexSyncCheckAbsolute: observations.indexSyncCheckAbsolute,
    indexSyncCheckExists: observations.indexSyncCheckExists,
    indexSyncTargetMatch: observations.indexSyncTargetMatch,
    indexSyncInSync: observations.indexSyncInSync,
    fallbackRecentCount: observations.fallbackRecentCount,
    indexSyncDriftLevel: observations.indexSyncDriftLevel,
    repairLayerOpenCount: observations.repairLayerOpenCount,
    repairLayerBlocking: observations.repairLayerBlocking,
    repairLayerSeverityCounts: observations.repairLayerSeverityCounts,
    repairLayerTopFindings: observations.repairLayerTopFindings,
    mode: args.mode,
  });
}

function compactRunStamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "");
}

export function printHumanGatingResult(result) {
  console.log(`Action: ${result.action}`);
  console.log(`Result: ${result.result}`);
  console.log(`Mode: ${result.mode}`);
  console.log(`L1 decision: ${result.levels.level1.decision}`);
  console.log(`L1 reasons: ${result.levels.level1.reason_codes.length ? result.levels.level1.reason_codes.join(", ") : "none"}`);
  console.log(`L2 required: ${result.levels.level2.required ? "yes" : "no"}`);
  if (result.levels.level2.active_signals.length) {
    console.log(`L2 signals: ${result.levels.level2.active_signals.join(", ")}`);
  }
  console.log(`L3 required: ${result.levels.level3.required ? "yes" : "no"}`);
  if (result.levels.level3.reason) {
    console.log(`L3 reason: ${result.levels.level3.reason}`);
  }
}

export async function runGatingEvaluateUseCase({ args, targetRoot, runtimeDir }) {
  const started = Date.now();
  const gitAdapter = createLocalGitAdapter();
  args.cache = resolveRuntimeTargetPath(targetRoot, args.cache);
  args.eventFile = resolveRuntimeTargetPath(targetRoot, args.eventFile);
  args.indexSyncCheckFile = resolveRuntimeTargetPath(targetRoot, args.indexSyncCheckFile);
  if (!args.stateModeExplicit && !String(process.env.AIDN_STATE_MODE ?? "").trim()) {
    const config = readAidnProjectConfig(targetRoot);
    const configStateMode = resolveConfigStateMode(config.data);
    if (configStateMode) {
      args.stateMode = configStateMode;
    }
  }
  if (!["files", "dual", "db-only"].includes(args.stateMode)) {
    throw new Error("Invalid effective state mode. Expected files|dual|db-only");
  }
  if (args.stateMode !== "files") {
    args.indexFile = resolveRuntimeTargetPath(targetRoot, args.indexFile);
  }
  let reload = null;
  if (args.reloadDecision) {
    reload = {
      decision: args.reloadDecision,
      fallback: args.reloadFallback === "true",
      reason_codes: parseReloadReasonCodes(args.reloadReasonCodes),
    };
  } else {
    reload = runReloadCheck(
      runtimeDir,
      targetRoot,
      args.cache,
      args.stateMode,
      args.indexFile,
      args.indexBackend,
    );
  }
  const levels = await detectSignals(targetRoot, args, reload, gitAdapter);
  const decision = deriveGatingAction(levels);

  const result = {
    ts: new Date().toISOString(),
    ok: isWorkflowResultOk(decision.result),
    mode: args.mode,
    state_mode: args.stateMode,
    target_root: targetRoot,
    branch: gitAdapter.getCurrentBranch(targetRoot),
    action: decision.action,
    result: decision.result,
    reason_code: decision.reason_code,
    gates_triggered: decision.gates_triggered,
    levels,
    duration_ms: Date.now() - started,
    summary: null,
  };
  result.summary = buildGatingSummary(result);

  if (args.emitEvent) {
    const eventPayload = {
      ts: result.ts,
      run_id: args.runId || `gate-${compactRunStamp()}`,
      session_id: null,
      cycle_id: null,
      branch: result.branch,
      mode: result.mode,
      skill: "gating-evaluate",
      phase: "end",
      event: "gating_summary",
      duration_ms: result.duration_ms,
      files_read_count: 0,
      bytes_read: 0,
      files_written_count: 0,
      bytes_written: 0,
      gates_triggered: decision.gates_triggered,
      result: decision.result === "warn" ? "warn" : decision.result,
      reason_code: decision.reason_code,
      trace_id: `tr-${crypto.randomBytes(4).toString("hex")}`,
    };
    result.event_file = appendRuntimeNdjsonEvent(args.eventFile, eventPayload);
  }

  return result;
}
