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
import {
  runWorkflowCheckpoint,
  runWorkflowConstraintLoop,
} from "./workflow-runtime-service.mjs";
import {
  appendRuntimeNdjsonEvent,
  resolveRuntimeTargetPath,
} from "./runtime-path-service.mjs";

export function runWorkflowHookUseCase({ args, runtimeDir, targetRoot }) {
  const gitAdapter = createLocalGitAdapter();
  const processAdapter = createLocalProcessAdapter();
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
  const eventFilePath = resolveRuntimeTargetPath(targetRoot, args.eventFile);
  const runIdFilePathArg = resolveRuntimeTargetPath(targetRoot, args.runIdFile);
  const indexOutputPath = resolveRuntimeTargetPath(targetRoot, args.indexOutput);
  const indexSqlOutputPath = resolveRuntimeTargetPath(targetRoot, args.indexSqlOutput);
  const indexSqliteOutputPath = resolveRuntimeTargetPath(targetRoot, args.indexSqliteOutput);
  const indexSyncCheckOutPath = resolveRuntimeTargetPath(targetRoot, args.indexSyncCheckOut);
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
    checkpointResult = runWorkflowCheckpoint({
      processAdapter,
      runtimeDir,
      targetRoot,
      mode: args.mode,
      runId,
      indexOptions: {
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
      },
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
  const appendedEventFile = appendRuntimeNdjsonEvent(eventFilePath, eventPayload);

  const runIdFilePath = persistWorkflowRunId({
    phase: args.phase,
    runIdFilePath: runIdFilePathArg,
    runId,
  });

  if (constraintLoopRequired) {
    try {
      constraintLoopResult = runWorkflowConstraintLoop({
        processAdapter,
        runtimeDir,
        targetRoot,
        options: {
          eventFile: eventFilePath,
          strict: args.constraintLoopStrict,
        },
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
