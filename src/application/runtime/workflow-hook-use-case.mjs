import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { createLocalProcessAdapter } from "../../adapters/runtime/local-process-adapter.mjs";
import { resolveEffectiveRuntimeMode } from "./runtime-mode-service.mjs";
import { buildWorkflowHookEvent } from "../../core/workflow/workflow-event-factory.mjs";
import {
  buildWorkflowHookSummary,
  isWorkflowResultOk,
} from "../../core/workflow/workflow-output-factory.mjs";
import {
  resolveHookReasonCode,
  resolveHookResult,
} from "../../core/workflow/workflow-result-policy.mjs";
import {
  requiresStrictRuntime,
  shouldRunConstraintLoopForState,
} from "../../core/state-mode/state-mode-policy.mjs";
import {
  computeWorkflowHookDurationMs,
  persistWorkflowRunId,
  resolveWorkflowRunId,
} from "./workflow-session-service.mjs";

function appendEvent(eventFile, payload) {
  const absolute = path.resolve(process.cwd(), eventFile);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.appendFileSync(absolute, `${JSON.stringify(payload)}\n`, "utf8");
  return absolute;
}

function runCheckpoint(runtimeDir, targetRoot, mode, runId, indexOptions = {}) {
  const checkpointScript = path.join(runtimeDir, "checkpoint.mjs");
  const cmd = [
    checkpointScript,
    "--target",
    targetRoot,
    "--mode",
    mode,
  ];
  if (runId) {
    cmd.push("--run-id", runId);
  }
  if (indexOptions.store) {
    cmd.push("--index-store", indexOptions.store);
  }
  if (indexOptions.output) {
    cmd.push("--index-output", indexOptions.output);
  }
  if (indexOptions.sqlOutput) {
    cmd.push("--index-sql-output", indexOptions.sqlOutput);
  }
  if (indexOptions.sqliteOutput) {
    cmd.push("--index-sqlite-output", indexOptions.sqliteOutput);
  }
  if (indexOptions.schemaFile) {
    cmd.push("--index-schema-file", indexOptions.schemaFile);
  }
  if (indexOptions.includeSchema === false) {
    cmd.push("--index-no-schema");
  }
  if (indexOptions.kpiFile) {
    cmd.push("--index-kpi-file", indexOptions.kpiFile);
  }
  if (indexOptions.syncCheck === true) {
    cmd.push("--index-sync-check");
  }
  if (indexOptions.syncCheckStrict === true) {
    cmd.push("--index-sync-check-strict");
  }
  if (indexOptions.syncCheckOut) {
    cmd.push("--index-sync-check-out", indexOptions.syncCheckOut);
  }
  if (indexOptions.skipGateEvaluate === true) {
    cmd.push("--skip-gate-evaluate");
  }
  cmd.push("--json");

  const processAdapter = createLocalProcessAdapter();
  return processAdapter.runJsonNodeScript(checkpointScript, cmd.slice(1));
}

function runConstraintLoop(runtimeDir, targetRoot, options = {}) {
  const loopScript = path.join(runtimeDir, "constraint-loop.mjs");
  const cmd = [
    loopScript,
    "--target",
    targetRoot,
  ];
  if (options.eventFile) {
    cmd.push("--event-file", options.eventFile);
  }
  if (options.strict === true) {
    cmd.push("--strict");
  }
  cmd.push("--json");

  const processAdapter = createLocalProcessAdapter();
  return processAdapter.runJsonNodeScript(loopScript, cmd.slice(1));
}

function resolveTargetPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

export function runWorkflowHookUseCase({ args, runtimeDir, targetRoot }) {
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
  const strictRequiredByState = requiresStrictRuntime(args.stateMode);
  if (strictRequiredByState) {
    args.strict = true;
  }
  const eventFilePath = resolveTargetPath(targetRoot, args.eventFile);
  const runIdFilePathArg = resolveTargetPath(targetRoot, args.runIdFile);
  const indexOutputPath = resolveTargetPath(targetRoot, args.indexOutput);
  const indexSqlOutputPath = resolveTargetPath(targetRoot, args.indexSqlOutput);
  const indexSqliteOutputPath = resolveTargetPath(targetRoot, args.indexSqliteOutput);
  const indexSyncCheckOutPath = resolveTargetPath(targetRoot, args.indexSyncCheckOut);
  const branch = gitAdapter.getCurrentBranch(targetRoot);
  const runId = resolveWorkflowRunId({
    phase: args.phase,
    runIdFilePath: runIdFilePathArg,
  });
  const constraintLoopRequired = shouldRunConstraintLoopForState({
    phase: args.phase,
    constraintLoopMode: args.constraintLoopMode,
    stateMode: args.stateMode,
  });

  let checkpointResult = null;
  let checkpointError = null;
  let constraintLoopResult = null;
  let constraintLoopError = null;

  try {
    checkpointResult = runCheckpoint(runtimeDir, targetRoot, args.mode, runId, {
      store: args.indexStore,
      output: indexOutputPath,
      sqlOutput: indexSqlOutputPath,
      sqliteOutput: indexSqliteOutputPath,
      schemaFile: args.indexSchemaFile,
      includeSchema: args.indexIncludeSchema,
      kpiFile: args.indexKpiFile,
      syncCheck: args.indexSyncCheck,
      syncCheckStrict: args.indexSyncCheckStrict,
      syncCheckOut: indexSyncCheckOutPath,
      skipGateEvaluate: args.phase === "session-start" && args.startLightGate,
    });
  } catch (error) {
    checkpointError = error;
    if (args.strict) {
      throw error;
    }
  }

  const hookResult = resolveHookResult({
    strict: args.strict,
    checkpointError,
  });
  const reasonCode = resolveHookReasonCode({ checkpointError });

  const eventPayload = buildWorkflowHookEvent({
    ts: new Date().toISOString(),
    runId,
    branch,
    mode: args.mode,
    phase: args.phase,
    durationMs: computeWorkflowHookDurationMs({
      startedAtMs: started,
      checkpointTotalDurationMs: checkpointResult?.total_duration_ms,
    }),
    result: hookResult,
    reasonCode,
    traceId: `tr-${crypto.randomBytes(4).toString("hex")}`,
  });
  const appendedEventFile = appendEvent(eventFilePath, eventPayload);

  const runIdFilePath = persistWorkflowRunId({
    phase: args.phase,
    runIdFilePath: runIdFilePathArg,
    runId,
  });

  if (constraintLoopRequired) {
    try {
      constraintLoopResult = runConstraintLoop(runtimeDir, targetRoot, {
        eventFile: eventFilePath,
        strict: args.constraintLoopStrict,
      });
    } catch (error) {
      constraintLoopError = error;
      throw error;
    }
  }

  const result = {
    ts: eventPayload.ts,
    ok: isWorkflowResultOk(hookResult),
    phase: args.phase,
    target_root: targetRoot,
    mode: args.mode,
    state_mode: args.stateMode,
    strict: args.strict,
    strict_required_by_state: strictRequiredByState,
    run_id: runId,
    result: hookResult,
    reason_code: reasonCode,
    branch,
    event_file: appendedEventFile,
    run_id_file: runIdFilePath,
    checkpoint: checkpointResult,
    checkpoint_error: checkpointError ? String(checkpointError.message ?? checkpointError) : null,
    constraint_loop_required: constraintLoopRequired,
    constraint_loop_strict: args.constraintLoopStrict,
    constraint_loop: constraintLoopResult,
    constraint_loop_error: constraintLoopError ? String(constraintLoopError.message ?? constraintLoopError) : null,
    duration_ms: eventPayload.duration_ms,
  };
  result.summary = buildWorkflowHookSummary(result);
  return result;
}
