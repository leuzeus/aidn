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
import { resolveWorkflowSnapshotBackend } from "./runtime-snapshot-service.mjs";
import { runCycleCloseAdmitUseCase } from "./cycle-close-admit-use-case.mjs";
import { runReloadCheckUseCase } from "./reload-check-use-case.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

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

async function detectSignals(targetRoot, args, reloadResult, gitAdapter, completionContext = null, verifyObjectiveAlignment = null, readObjectiveCompletion = null, requireIntentSignals = false) {
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
    completionContext,
    requireIntentSignals,
  });
  const observedReload = observations.canonicalIntentFailureReason ? {
    ...reloadResult,
    decision: "stop",
    fallback: false,
    reason_codes: [...new Set([...(reloadResult.reason_codes ?? []), observations.canonicalIntentFailureReason])],
  } : reloadResult;
  const signal = detectGatingSignals({
    sessionObjective: observations.sessionObjective,
    cycleGoal: observations.cycleGoal,
    changedFiles: observations.changedFiles,
    mode: args.mode,
    thresholdFiles: args.thresholdFiles,
    thresholdMinutes: args.thresholdMinutes,
    latestDriftMs: observations.latestDriftMs,
    reloadReasonCodes: observedReload.reason_codes ?? [],
    indexSyncCheckExists: observations.indexSyncCheckExists,
    indexSyncTargetMatch: observations.indexSyncTargetMatch,
    indexSyncInSync: observations.indexSyncInSync,
    // Closure intent must be checked even if a preceding checkpoint refreshed
    // the cache and the working tree is clean.
    noChangeFastPath: completionContext ? false : observations.noChangeFastPath,
    repairLayerOpenCount: observations.repairLayerOpenCount,
  });
  if (completionContext && !observations.cycleGoal) signal.uncertain_intent = true;
  if (observations.canonicalIntentUncertain && !observations.noChangeFastPath) signal.uncertain_intent = true;
  // The explicit drift skill is performing this check now. Only its own age
  // prerequisite is discharged; objective, scope, integrity and repair remain.
  // A no-event preview cannot complete or refresh the check.
  if (args.completeDriftCheck === true && args.emitEvent === true) {
    signal.time_since_last_drift_check = false;
  }

  const derive = (observations, signal) => deriveGatingLevels({
    reloadResult: observedReload,
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
  let levels = derive(observations, signal), objectiveAlignment = null;
  if (verifyObjectiveAlignment !== null) {
    const eligible = value => value.levels.level1.decision !== "stop" && !value.levels.level3.required
      && shadowHash(value.levels.level2.active_signals) === shadowHash(["objective_delta"]);
    if (typeof verifyObjectiveAlignment !== "function" || args.completeDriftCheck !== true || args.emitEvent !== true
      || !eligible({ levels })) throw Error("STANDARD_OBJECTIVE_ALIGNMENT_GATE_CHANGED");
    // This capability is injected by the authenticated operation host. It is
    // deliberately outside CLI args; authored JSON has no such capability.
    objectiveAlignment = await verifyObjectiveAlignment();
    const fresh = await detectSignals(targetRoot, args, reloadResult, gitAdapter, completionContext);
    if (!eligible(fresh) || shadowHash(fresh.levels) !== shadowHash(levels)
      || objectiveAlignment?.session_objective !== fresh.observations.sessionObjective
      || objectiveAlignment?.cycle_objective !== fresh.observations.cycleGoal
      || observations.sessionObjective !== fresh.observations.sessionObjective || observations.cycleGoal !== fresh.observations.cycleGoal)
      throw Error("STANDARD_OBJECTIVE_ALIGNMENT_GATE_CHANGED");
    levels = derive(fresh.observations, { ...signal, objective_delta: false });
  }
  // Admission consumes an already accepted physical completion. It cannot use
  // the finalizer's effect capability or manufacture a drift completion event.
  if (readObjectiveCompletion !== null) {
    if (typeof readObjectiveCompletion !== "function" || verifyObjectiveAlignment !== null || args.completeDriftCheck === true)
      throw Error("STANDARD_OBJECTIVE_COMPLETION_GATE_INVALID");
    const eligible = value => value.levels.level1.decision !== "stop" && !value.levels.level3.required
      && shadowHash(value.levels.level2.active_signals) === shadowHash(["objective_delta"]);
    if (eligible({ levels })) {
      const completed = await readObjectiveCompletion();
      if (completed !== null) {
        const fresh = await detectSignals(targetRoot, args, reloadResult, gitAdapter, completionContext);
        if (!eligible(fresh) || shadowHash(fresh.levels) !== shadowHash(levels)
          || completed.session_objective !== fresh.observations.sessionObjective || completed.cycle_objective !== fresh.observations.cycleGoal
          || observations.sessionObjective !== fresh.observations.sessionObjective || observations.cycleGoal !== fresh.observations.cycleGoal)
          throw Error("STANDARD_OBJECTIVE_COMPLETION_GATE_CHANGED");
        // Reauthenticate after observation even for a no-event preview. Reads
        // do not renew the retained review's TTL or bypass process/context CAS.
        if (shadowHash(await readObjectiveCompletion()) !== shadowHash(completed)) throw Error("STANDARD_OBJECTIVE_COMPLETION_GATE_CHANGED");
        objectiveAlignment = completed;
        levels = derive(fresh.observations, { ...signal, objective_delta: false });
      }
    }
  }
  return { levels, repairLayerObserved: observations.repairLayerObserved, observations, objectiveAlignment };
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

export async function runGatingEvaluateUseCase({ args, targetRoot, runtimeDir, completionCycleId = null, verifyObjectiveAlignment = null, readObjectiveCompletion = null, assertEventAuthorized = null, requireIntentSignals = false }) {
  const started = Date.now();
  const gitAdapter = createLocalGitAdapter();
  args.cache = resolveRuntimeTargetPath(targetRoot, args.cache);
  args.eventFile = resolveRuntimeTargetPath(targetRoot, args.eventFile);
  args.indexSyncCheckFile = resolveRuntimeTargetPath(targetRoot, args.indexSyncCheckFile);
  args.indexBackend = resolveWorkflowSnapshotBackend(targetRoot, args.indexFile, args.indexBackend);
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
  let completionContext = null;
  let completionRefusal = null;
  // Explicit drift completion can finish the closure checks of a terminal
  // cycle. Ordinary gating and non-COMMITTING calls retain active-only mapping.
  // Admission verifies ownership, canonical status and the usage matrix first.
  if ((args.completeDriftCheck === true && args.mode === "COMMITTING" && !args.reloadDecision) || completionCycleId) {
    const admission = await runCycleCloseAdmitUseCase({ targetRoot, mode: args.mode });
    if (!admission.ok) completionRefusal = admission.reason_code;
    if (admission.ok && ["DONE", "NO_GO", "DROPPED"].includes(admission.target_cycle?.state)
        && (!completionCycleId || admission.target_cycle.cycle_id === completionCycleId)) {
      completionContext = { ...admission.target_cycle, session_id: admission.active_session };
    }
  }
  if (args.reloadDecision) {
    reload = {
      decision: args.reloadDecision,
      fallback: args.reloadFallback === "true",
      reason_codes: parseReloadReasonCodes(args.reloadReasonCodes),
    };
  } else if (completionContext) {
    reload = await runReloadCheckUseCase({ targetRoot, completionCycleId: completionContext.cycle_id,
      args: { cache: args.cache, stateMode: args.stateMode, stateModeExplicit: true,
        indexFile: args.indexFile, indexBackend: args.indexBackend, writeCache: false } });
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
  const { levels, repairLayerObserved, objectiveAlignment } = await detectSignals(targetRoot, args, reload, gitAdapter, completionContext, verifyObjectiveAlignment, readObjectiveCompletion, requireIntentSignals);
  if (completionRefusal) {
    levels.level1.decision = "stop";
    levels.level1.reason_codes = [...new Set([...levels.level1.reason_codes, completionRefusal])];
    levels.level3.required = true;
    levels.level3.reason = "blocking_l1_reason";
  }
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
  result.summary = buildGatingSummary(result, { repairLayerObserved });
  if (objectiveAlignment !== null) result.objective_alignment = objectiveAlignment;

  if (args.emitEvent) {
    const eventPayload = {
      ts: result.ts,
      run_id: args.runId || `gate-${compactRunStamp()}`,
      session_id: null,
      cycle_id: null,
      branch: result.branch,
      mode: result.mode,
      skill: args.completeDriftCheck === true ? "drift-check" : "gating-evaluate",
      phase: "end",
      event: args.completeDriftCheck === true
        ? (decision.result === "ok" ? "drift_check_completed" : "drift_check_evaluated")
        : "gating_summary",
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
    // The capability checked during signal derivation predates the final
    // asynchronous collection. Reauthenticate its exact subject after that
    // wait, immediately before the synchronous append. A revoked, expired or
    // replaced disposition must leave even the existing log prefix unchanged.
    if (objectiveAlignment !== null) {
      const currentAlignment = await (verifyObjectiveAlignment ?? readObjectiveCompletion)();
      if (shadowHash(currentAlignment) !== shadowHash(objectiveAlignment))
        throw Error("STANDARD_OBJECTIVE_ALIGNMENT_GATE_CHANGED");
    }
    if (assertEventAuthorized !== null) {
      if (typeof assertEventAuthorized !== "function") throw Error("STANDARD_GATE_EVENT_AUTHORITY_INVALID");
      await assertEventAuthorized();
    }
    if (objectiveAlignment !== null) eventPayload.objective_alignment_sha256 = shadowHash(objectiveAlignment);
    result.event_file = appendRuntimeNdjsonEvent(args.eventFile, eventPayload);
  }

  return result;
}
