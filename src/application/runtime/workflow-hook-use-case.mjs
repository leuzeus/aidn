import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { createLocalProcessAdapter } from "../../adapters/runtime/local-process-adapter.mjs";
import { resolveEffectiveRuntimeMode } from "./runtime-mode-service.mjs";

function shouldRunConstraintLoop(args, effectiveStateMode) {
  if (args.phase !== "session-close") {
    return false;
  }
  if (args.constraintLoopMode === "on") {
    return true;
  }
  if (args.constraintLoopMode === "off") {
    if (effectiveStateMode === "dual" || effectiveStateMode === "db-only") {
      throw new Error("--no-constraint-loop is not allowed in dual/db-only mode");
    }
    return false;
  }
  return effectiveStateMode === "dual" || effectiveStateMode === "db-only";
}

function appendEvent(eventFile, payload) {
  const absolute = path.resolve(process.cwd(), eventFile);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.appendFileSync(absolute, `${JSON.stringify(payload)}\n`, "utf8");
  return absolute;
}

function toRunId(prefix) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `${prefix}-${stamp}`;
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

function writeRunIdFile(filePath, runId) {
  const absolute = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${runId}\n`, "utf8");
  return absolute;
}

function readRunIdFile(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return null;
  }
  const text = fs.readFileSync(absolute, "utf8").trim();
  return text || null;
}

function removeRunIdFile(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  fs.rmSync(absolute, { force: true });
  return absolute;
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
  const strictRequiredByState = args.stateMode === "dual" || args.stateMode === "db-only";
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
  const phaseEvent = args.phase.replace("-", "_");
  const existingRunId = readRunIdFile(runIdFilePathArg);
  const runId = args.phase === "session-close"
    ? (existingRunId || toRunId("session"))
    : toRunId(`session-${phaseEvent}`);
  const constraintLoopRequired = shouldRunConstraintLoop(args, args.stateMode);

  let checkpointResult = null;
  let hookResult = "ok";
  let reasonCode = null;
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
    hookResult = args.strict ? "stop" : "warn";
    reasonCode = "HOOK_CHECKPOINT_FAILED";
    if (args.strict) {
      throw error;
    }
  }

  const eventPayload = {
    duration_ms: (() => {
      const elapsed = Date.now() - started;
      const nested = Number(checkpointResult?.total_duration_ms ?? 0);
      if (Number.isFinite(nested) && nested > 0) {
        return Math.max(1, elapsed - nested);
      }
      return Math.max(1, elapsed);
    })(),
    ts: new Date().toISOString(),
    run_id: runId,
    session_id: null,
    cycle_id: null,
    branch,
    mode: args.mode,
    skill: "workflow-hook",
    phase: args.phase,
    event: `hook_${phaseEvent}`,
    files_read_count: 0,
    bytes_read: 0,
    files_written_count: 0,
    bytes_written: 0,
    gates_triggered: ["R01", "R07", "R05", "R10"],
    result: hookResult,
    reason_code: reasonCode,
    trace_id: `tr-${crypto.randomBytes(4).toString("hex")}`,
  };
  const appendedEventFile = appendEvent(eventFilePath, eventPayload);

  let runIdFilePath = null;
  if (args.phase === "session-start") {
    runIdFilePath = writeRunIdFile(runIdFilePathArg, runId);
  } else if (args.phase === "session-close") {
    runIdFilePath = removeRunIdFile(runIdFilePathArg);
  }

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

  return {
    ts: eventPayload.ts,
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
}
