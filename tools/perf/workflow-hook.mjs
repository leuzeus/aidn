#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const envStore = String(process.env.AIDN_INDEX_STORE_MODE ?? "").trim().toLowerCase();
  const args = {
    phase: "",
    target: ".",
    mode: "COMMITTING",
    eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
    runIdFile: ".aidn/runtime/perf/current-run-id.txt",
    indexStore: envStore || "file",
    indexOutput: ".aidn/runtime/index/workflow-index.json",
    indexSqlOutput: ".aidn/runtime/index/workflow-index.sql",
    indexSqliteOutput: ".aidn/runtime/index/workflow-index.sqlite",
    indexSchemaFile: path.join(path.dirname(fileURLToPath(import.meta.url)), "sql", "schema.sql"),
    indexIncludeSchema: true,
    indexKpiFile: "",
    indexSyncCheck: false,
    indexSyncCheckStrict: false,
    indexSyncCheckOut: ".aidn/runtime/index/index-sync-check.json",
    strict: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--phase") {
      args.phase = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").toUpperCase();
      i += 1;
    } else if (token === "--event-file") {
      args.eventFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--run-id-file") {
      args.runIdFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-store") {
      args.indexStore = String(argv[i + 1] ?? "").toLowerCase();
      i += 1;
    } else if (token === "--index-output") {
      args.indexOutput = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-sql-output") {
      args.indexSqlOutput = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-sqlite-output") {
      args.indexSqliteOutput = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-schema-file") {
      args.indexSchemaFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-no-schema") {
      args.indexIncludeSchema = false;
    } else if (token === "--index-kpi-file") {
      args.indexKpiFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-sync-check") {
      args.indexSyncCheck = true;
    } else if (token === "--index-sync-check-strict") {
      args.indexSyncCheck = true;
      args.indexSyncCheckStrict = true;
    } else if (token === "--index-sync-check-out") {
      args.indexSyncCheckOut = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.phase) {
    throw new Error("Missing required --phase");
  }
  if (!["session-start", "session-close", "manual"].includes(args.phase)) {
    throw new Error("Invalid --phase. Expected session-start|session-close|manual");
  }
  if (!["THINKING", "EXPLORING", "COMMITTING", "UNKNOWN"].includes(args.mode)) {
    throw new Error("Invalid --mode. Expected THINKING|EXPLORING|COMMITTING|UNKNOWN");
  }
  if (!["file", "sql", "dual", "sqlite", "dual-sqlite", "all"].includes(args.indexStore)) {
    throw new Error("Invalid --index-store. Expected file|sql|dual|sqlite|dual-sqlite|all");
  }
  if (!args.indexOutput) {
    throw new Error("Missing value for --index-output");
  }
  if ((args.indexStore === "sql" || args.indexStore === "dual" || args.indexStore === "all") && !args.indexSqlOutput) {
    throw new Error("Missing value for --index-sql-output");
  }
  if ((args.indexStore === "sqlite" || args.indexStore === "dual-sqlite" || args.indexStore === "all") && !args.indexSqliteOutput) {
    throw new Error("Missing value for --index-sqlite-output");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-start");
  console.log("  AIDN_INDEX_STORE_MODE=sqlite node tools/perf/workflow-hook.mjs --phase session-start");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-close --mode COMMITTING");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-start --index-store dual");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-start --index-store sqlite --index-sqlite-output .aidn/runtime/index/workflow-index.sqlite");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-close --index-kpi-file .aidn/runtime/perf/kpi-report.json");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-close --index-sync-check");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-start --run-id-file .aidn/runtime/perf/current-run-id.txt");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-start --strict");
}

function appendEvent(eventFile, payload) {
  const absolute = path.resolve(process.cwd(), eventFile);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.appendFileSync(absolute, `${JSON.stringify(payload)}\n`, "utf8");
  return absolute;
}

function toRunId(prefix) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${prefix}-${stamp}`;
}

function getCurrentBranch(targetRoot) {
  try {
    return execFileSync("git", ["-C", targetRoot, "branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function runCheckpoint(targetRoot, mode, runId, indexOptions = {}) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const checkpointScript = path.join(scriptDir, "checkpoint.mjs");
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
  cmd.push("--json");

  const stdout = execFileSync(process.execPath, cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
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

function main() {
  const started = Date.now();
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const eventFilePath = resolveTargetPath(targetRoot, args.eventFile);
    const runIdFilePathArg = resolveTargetPath(targetRoot, args.runIdFile);
    const indexOutputPath = resolveTargetPath(targetRoot, args.indexOutput);
    const indexSqlOutputPath = resolveTargetPath(targetRoot, args.indexSqlOutput);
    const indexSqliteOutputPath = resolveTargetPath(targetRoot, args.indexSqliteOutput);
    const indexSyncCheckOutPath = resolveTargetPath(targetRoot, args.indexSyncCheckOut);
    const branch = getCurrentBranch(targetRoot);
    const phaseEvent = args.phase.replace("-", "_");
    const existingRunId = readRunIdFile(runIdFilePathArg);
    const runId = args.phase === "session-close"
      ? (existingRunId || toRunId("session"))
      : toRunId(`session-${phaseEvent}`);

    let checkpointResult = null;
    let hookResult = "ok";
    let reasonCode = null;
    let checkpointError = null;

    try {
      checkpointResult = runCheckpoint(targetRoot, args.mode, runId, {
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
      ts: new Date().toISOString(),
      run_id: runId,
      session_id: null,
      cycle_id: null,
      branch,
      mode: args.mode,
      skill: "workflow-hook",
      phase: args.phase,
      event: `hook_${phaseEvent}`,
      duration_ms: Date.now() - started,
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

    const output = {
      ts: eventPayload.ts,
      phase: args.phase,
      target_root: targetRoot,
      mode: args.mode,
      strict: args.strict,
      run_id: runId,
      result: hookResult,
      reason_code: reasonCode,
      branch,
      event_file: appendedEventFile,
      run_id_file: runIdFilePath,
      checkpoint: checkpointResult,
      checkpoint_error: checkpointError ? String(checkpointError.message ?? checkpointError) : null,
      duration_ms: eventPayload.duration_ms,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log(`Hook phase: ${args.phase}`);
    console.log(`Result: ${output.result}`);
    if (output.reason_code) {
      console.log(`Reason: ${output.reason_code}`);
    }
    console.log(`Target: ${targetRoot}`);
    console.log(`Mode: ${args.mode}`);
    console.log(`run_id: ${runId}`);
    console.log(`Event file: ${appendedEventFile}`);
    if (runIdFilePath) {
      console.log(`Run id file: ${runIdFilePath}`);
    }
    if (checkpointResult) {
      console.log(`Checkpoint action: ${checkpointResult.gate?.action ?? "n/a"}`);
      console.log(`Checkpoint total: ${checkpointResult.total_duration_ms ?? "n/a"}ms`);
    }
    if (checkpointError && !args.strict) {
      console.log(`Checkpoint error (ignored): ${output.checkpoint_error}`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
