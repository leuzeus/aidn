#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execSync, execFileSync } from "node:child_process";
import { resolveEffectiveRuntimeMode } from "../../src/application/runtime/runtime-mode-service.mjs";
import {
  normalizeIndexStoreMode,
} from "../aidn-config-lib.mjs";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const envStore = String(process.env.AIDN_INDEX_STORE_MODE ?? "").trim().toLowerCase();
  const envStateMode = String(process.env.AIDN_STATE_MODE ?? "").trim().toLowerCase();
  const args = {
    target: ".",
    cache: ".aidn/runtime/cache/reload-state.json",
    eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
    indexOutput: ".aidn/runtime/index/workflow-index.json",
    indexStore: envStore || "",
    indexStoreExplicit: false,
    stateMode: envStateMode || "files",
    indexSqlOutput: ".aidn/runtime/index/workflow-index.sql",
    indexSqliteOutput: ".aidn/runtime/index/workflow-index.sqlite",
    indexSchemaFile: path.join(PERF_DIR, "sql", "schema.sql"),
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

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--cache") {
      args.cache = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--event-file") {
      args.eventFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-output") {
      args.indexOutput = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-store") {
      args.indexStore = String(argv[i + 1] ?? "").toLowerCase();
      args.indexStoreExplicit = true;
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
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").toUpperCase();
      i += 1;
    } else if (token === "--run-id") {
      args.runId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--no-summary-event") {
      args.emitSummaryEvent = false;
    } else if (token === "--skip-index-on-incremental") {
      args.skipIndexOnIncremental = true;
    } else if (token === "--no-skip-index-on-incremental") {
      args.skipIndexOnIncremental = false;
    } else if (token === "--skip-gate-evaluate") {
      args.skipGateEvaluate = true;
    } else if (token === "--no-auto-skip-gate") {
      args.autoSkipGateOnNoSignal = false;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!args.eventFile) {
    throw new Error("Missing value for --event-file");
  }
  if (!args.indexOutput) {
    throw new Error("Missing value for --index-output");
  }
  args.stateMode = String(args.stateMode ?? "").trim().toLowerCase() || "files";
  if (!["files", "dual", "db-only"].includes(args.stateMode)) {
    throw new Error("Invalid AIDN_STATE_MODE. Expected files|dual|db-only");
  }
  if (!args.indexStore) {
    if (args.stateMode === "dual") {
      args.indexStore = "dual-sqlite";
    } else if (args.stateMode === "db-only") {
      args.indexStore = "sqlite";
    } else {
      args.indexStore = "file";
    }
  }
  if (!["file", "sql", "dual", "sqlite", "dual-sqlite", "all"].includes(args.indexStore)) {
    throw new Error("Invalid --index-store. Expected file|sql|dual|sqlite|dual-sqlite|all");
  }
  if ((args.indexStore === "sql" || args.indexStore === "dual" || args.indexStore === "all") && !args.indexSqlOutput) {
    throw new Error("Missing value for --index-sql-output");
  }
  if ((args.indexStore === "sqlite" || args.indexStore === "dual-sqlite" || args.indexStore === "all") && !args.indexSqliteOutput) {
    throw new Error("Missing value for --index-sqlite-output");
  }
  if (!["THINKING", "EXPLORING", "COMMITTING", "UNKNOWN"].includes(args.mode)) {
    throw new Error("Invalid --mode. Expected THINKING|EXPLORING|COMMITTING|UNKNOWN");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/checkpoint.mjs --target ../client");
  console.log("  AIDN_INDEX_STORE_MODE=sqlite node tools/perf/checkpoint.mjs --target ../client");
  console.log("  AIDN_STATE_MODE=dual node tools/perf/checkpoint.mjs --target ../client");
  console.log("  AIDN_STATE_MODE=db-only node tools/perf/checkpoint.mjs --target ../client");
  console.log("  node tools/perf/checkpoint.mjs --target ../client --mode COMMITTING");
  console.log("  node tools/perf/checkpoint.mjs --target ../client --run-id S072-20260301T1012Z");
  console.log("  node tools/perf/checkpoint.mjs --target ../client --index-store dual --index-sql-output .aidn/runtime/index/workflow-index.sql");
  console.log("  node tools/perf/checkpoint.mjs --target ../client --index-store sqlite --index-sqlite-output .aidn/runtime/index/workflow-index.sqlite");
  console.log("  node tools/perf/checkpoint.mjs --target ../client --index-kpi-file .aidn/runtime/perf/kpi-report.json");
  console.log("  node tools/perf/checkpoint.mjs --target ../client --index-sync-check");
  console.log("  node tools/perf/checkpoint.mjs --target ../client --index-sync-check-strict");
  console.log("  node tools/perf/checkpoint.mjs --target ../client --no-skip-index-on-incremental");
  console.log("  node tools/perf/checkpoint.mjs --target ../client --skip-gate-evaluate");
  console.log("  node tools/perf/checkpoint.mjs --target ../client --no-auto-skip-gate");
  console.log("  node tools/perf/checkpoint.mjs --json");
}

function runToolJson(scriptName, argv) {
  const out = execFileSync(process.execPath, [
    path.join(PERF_DIR, scriptName),
    ...argv,
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

function appendEvent(eventFile, event) {
  const absolute = path.resolve(process.cwd(), eventFile);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.appendFileSync(absolute, `${JSON.stringify(event)}\n`, "utf8");
  return absolute;
}

function toIsoNowCompact() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "");
}

function writeJsonFile(filePath, payload) {
  const absolute = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return absolute;
}

function indexOutputsExistForStore(args, indexOutputPath, indexSqlOutputPath, indexSqliteOutputPath) {
  if (args.indexStore === "file") {
    return fs.existsSync(indexOutputPath);
  }
  if (args.indexStore === "sql") {
    return fs.existsSync(indexSqlOutputPath);
  }
  if (args.indexStore === "dual") {
    return fs.existsSync(indexOutputPath) && fs.existsSync(indexSqlOutputPath);
  }
  if (args.indexStore === "sqlite") {
    return fs.existsSync(indexSqliteOutputPath);
  }
  if (args.indexStore === "dual-sqlite") {
    return fs.existsSync(indexOutputPath) && fs.existsSync(indexSqliteOutputPath);
  }
  if (args.indexStore === "all") {
    return fs.existsSync(indexOutputPath) && fs.existsSync(indexSqlOutputPath) && fs.existsSync(indexSqliteOutputPath);
  }
  return false;
}

function resolveTargetPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function resolveReloadIndexConfig(args, indexOutputPath, indexSqliteOutputPath) {
  if (args.indexStore === "sqlite" || args.indexStore === "dual-sqlite" || args.indexStore === "all") {
    return {
      indexFile: indexSqliteOutputPath,
      indexBackend: "sqlite",
    };
  }
  return {
    indexFile: indexOutputPath,
    indexBackend: "json",
  };
}

function resolveSyncCheckIndexConfig(args, indexOutputPath, indexSqliteOutputPath) {
  if (args.indexStore === "sqlite" || args.indexStore === "dual-sqlite") {
    return {
      indexFile: indexSqliteOutputPath,
      indexBackend: "sqlite",
    };
  }
  return {
    indexFile: indexOutputPath,
    indexBackend: "json",
  };
}

function getCurrentBranch(targetRoot) {
  try {
    return execSync(`git -C "${targetRoot}" branch --show-current`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function hasWorkingTreeChanges(targetRoot) {
  try {
    const out = execFileSync("git", ["-C", targetRoot, "status", "--porcelain", "--untracked-files=no"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

function main() {
  const started = Date.now();
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const runtimeMode = resolveEffectiveRuntimeMode({
      targetRoot,
      stateMode: args.stateMode,
      indexStore: args.indexStore,
      indexStoreExplicit: args.indexStoreExplicit,
    });
    args.stateMode = runtimeMode.stateMode;
    args.indexStore = runtimeMode.indexStore;
    const cachePath = resolveTargetPath(targetRoot, args.cache);
    const eventFilePath = resolveTargetPath(targetRoot, args.eventFile);
    const indexOutputPath = resolveTargetPath(targetRoot, args.indexOutput);
    const indexSqlOutputPath = resolveTargetPath(targetRoot, args.indexSqlOutput);
    const indexSqliteOutputPath = resolveTargetPath(targetRoot, args.indexSqliteOutput);
    const indexSyncCheckOutPath = resolveTargetPath(targetRoot, args.indexSyncCheckOut);
    const reloadIndex = resolveReloadIndexConfig(args, indexOutputPath, indexSqliteOutputPath);
    const syncCheckIndex = resolveSyncCheckIndexConfig(args, indexOutputPath, indexSqliteOutputPath);

    const reloadStarted = Date.now();
    const reloadArgs = [
      "--target",
      targetRoot,
      "--cache",
      cachePath,
      "--state-mode",
      args.stateMode,
      "--write-cache",
      "--json",
    ];
    if (args.stateMode !== "files") {
      reloadArgs.push("--index-file", reloadIndex.indexFile, "--index-backend", reloadIndex.indexBackend);
    }
    const reload = runToolJson("reload-check.mjs", reloadArgs);
    const reloadDurationMs = Date.now() - reloadStarted;

    let gate = {
      action: "proceed_l1_fast_checks_only",
      result: "ok",
      reason_code: null,
      gates_triggered: [],
      levels: {
        level1: {
          decision: reload.decision,
          fallback: reload.fallback,
          reason_codes: reload.reason_codes ?? [],
        },
        level2: {
          required: false,
          active_signals: [],
          critical_signals: [],
          changed_files_count: 0,
          changed_files_sample: [],
          index_sync_check_file: null,
          index_sync_check_exists: false,
          index_sync_target_match: false,
          index_sync_in_sync: null,
        },
        level3: {
          required: false,
          reason: null,
          fallback_recent_count: 0,
          index_sync_drift_level: null,
        },
      },
    };
    let gateDurationMs = 0;
    const noSignalGateSkip = args.autoSkipGateOnNoSignal
      && !args.skipGateEvaluate
      && reload.decision === "incremental"
      && reload.fallback !== true
      && Array.isArray(reload.reason_codes)
      && reload.reason_codes.length === 0
      && !hasWorkingTreeChanges(targetRoot);
    if (!args.skipGateEvaluate && !noSignalGateSkip) {
      const gateStarted = Date.now();
      const gateArgs = [
        "--target",
        targetRoot,
        "--cache",
        cachePath,
        "--event-file",
        eventFilePath,
        "--mode",
        args.mode,
        "--state-mode",
        args.stateMode,
        "--reload-decision",
        String(reload.decision ?? "incremental"),
        "--reload-fallback",
        reload.fallback ? "true" : "false",
        "--reload-reason-codes",
        JSON.stringify(Array.isArray(reload.reason_codes) ? reload.reason_codes : []),
        "--json",
      ];
      if (args.stateMode !== "files") {
        gateArgs.push("--index-file", reloadIndex.indexFile, "--index-backend", reloadIndex.indexBackend);
      }
      if (args.runId) {
        gateArgs.push("--run-id", args.runId);
      }
      gate = runToolJson("gating-evaluate.mjs", gateArgs);
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

    const hasIndexOutputs = indexOutputsExistForStore(args, indexOutputPath, indexSqlOutputPath, indexSqliteOutputPath);
    const hasIndexFileForSyncCheck = !args.indexSyncCheck || fs.existsSync(syncCheckIndex.indexFile);
    const shouldSkipIndex = args.skipIndexOnIncremental
      && reload.decision === "incremental"
      && reload.fallback !== true
      && !args.indexKpiFile
      && hasIndexOutputs
      && hasIndexFileForSyncCheck;
    let indexDurationMs = 0;
    let index = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      store: args.indexStore,
      state_mode: args.stateMode,
      skipped: true,
      skip_reason: "SKIPPED_NO_RELOAD_SIGNAL",
      outputs: [],
      writes: {
        files_written_count: 0,
        bytes_written: 0,
      },
    };
    if (!shouldSkipIndex) {
      const indexStarted = Date.now();
      const indexArgs = ["--target", targetRoot, "--store", args.indexStore, "--output", indexOutputPath];
      if (args.indexStore === "sql" || args.indexStore === "dual" || args.indexStore === "all") {
        indexArgs.push("--sql-output", indexSqlOutputPath);
      }
      if (args.indexStore === "sqlite" || args.indexStore === "dual-sqlite" || args.indexStore === "all") {
        indexArgs.push("--sqlite-output", indexSqliteOutputPath);
      }
      if (args.indexStore === "sql" || args.indexStore === "dual" || args.indexStore === "sqlite" || args.indexStore === "dual-sqlite" || args.indexStore === "all") {
        indexArgs.push("--schema-file", args.indexSchemaFile);
        if (!args.indexIncludeSchema) {
          indexArgs.push("--no-schema");
        }
      }
      if (args.indexKpiFile) {
        indexArgs.push("--kpi-file", args.indexKpiFile);
      }
      indexArgs.push("--json");
      index = runToolJson("index-sync.mjs", indexArgs);
      indexDurationMs = Date.now() - indexStarted;
      index.skipped = false;
      index.skip_reason = null;
    }

    let indexSyncCheck = {
      enabled: false,
      strict: args.indexSyncCheckStrict,
      in_sync: null,
      action: null,
      mismatch_count: 0,
      duration_ms: 0,
      output_file: null,
      index_file: null,
      index_backend: null,
      skipped: false,
      skip_reason: null,
    };
    if (args.indexSyncCheck) {
      if (shouldSkipIndex) {
        const syncCheckOut = {
          ts: new Date().toISOString(),
          target_root: targetRoot,
          in_sync: true,
          action: "skipped_no_signal",
          reason_codes: ["SKIPPED_NO_RELOAD_SIGNAL"],
          summary_mismatches: [],
          summary: {
            missing_in_index: 0,
            stale_in_index: 0,
            digest_mismatch: 0,
          },
          skipped: true,
        };
        indexSyncCheck = {
          enabled: true,
          strict: args.indexSyncCheckStrict,
          in_sync: true,
          action: "skipped_no_signal",
          mismatch_count: 0,
          duration_ms: 0,
          output_file: writeJsonFile(indexSyncCheckOutPath, syncCheckOut),
          index_file: syncCheckIndex.indexFile,
          index_backend: syncCheckIndex.indexBackend,
          skipped: true,
          skip_reason: "SKIPPED_NO_RELOAD_SIGNAL",
        };
      } else {
        const syncCheckStarted = Date.now();
        const syncCheckOut = runToolJson("index-sync-check.mjs", [
          "--target",
          targetRoot,
          "--index-file",
          syncCheckIndex.indexFile,
          "--index-backend",
          syncCheckIndex.indexBackend,
          "--json",
        ]);
        indexSyncCheck = {
          enabled: true,
          strict: args.indexSyncCheckStrict,
          in_sync: syncCheckOut.in_sync === true,
          action: syncCheckOut.action ?? null,
          mismatch_count: Array.isArray(syncCheckOut.summary_mismatches)
            ? syncCheckOut.summary_mismatches.length
            : 0,
          duration_ms: Date.now() - syncCheckStarted,
          output_file: writeJsonFile(indexSyncCheckOutPath, syncCheckOut),
          index_file: syncCheckIndex.indexFile,
          index_backend: syncCheckIndex.indexBackend,
          skipped: false,
          skip_reason: null,
        };
        if (args.indexSyncCheckStrict && syncCheckOut.in_sync !== true) {
          throw new Error("Index sync check drift detected in strict checkpoint mode");
        }
      }
    }

    const checkpointRunId = args.runId || `checkpoint-${toIsoNowCompact()}`;

    const result = {
      ts: new Date().toISOString(),
      run_id: checkpointRunId,
      target_root: targetRoot,
      mode: args.mode,
      state_mode: args.stateMode,
      branch: getCurrentBranch(targetRoot),
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
    };

    if (args.emitSummaryEvent) {
      const reloadEvent = {
        ts: result.ts,
        run_id: checkpointRunId,
        session_id: null,
        cycle_id: null,
        branch: result.branch,
        mode: result.mode,
        skill: "reload-check",
        phase: "check",
        event: "reload_decision",
        duration_ms: result.reload.duration_ms,
        files_read_count: 0,
        bytes_read: 0,
        files_written_count: 0,
        bytes_written: 0,
        gates_triggered: [],
        result: result.reload.decision === "stop"
          ? "stop"
          : (result.reload.fallback ? "fallback" : "ok"),
        reason_code: (result.reload.reason_codes ?? [])[0] ?? null,
        trace_id: `tr-${crypto.randomBytes(4).toString("hex")}`,
      };
      appendEvent(eventFilePath, reloadEvent);

      const event = {
        ts: result.ts,
        run_id: checkpointRunId,
        session_id: null,
        cycle_id: null,
        branch: result.branch,
        mode: result.mode,
        skill: "perf-checkpoint",
        phase: "end",
        event: "checkpoint_summary",
        duration_ms: result.total_duration_ms,
        files_read_count: 0,
        bytes_read: 0,
        files_written_count: Number(result.index?.writes?.files_written_count ?? 0),
        bytes_written: Number(result.index?.writes?.bytes_written ?? 0),
        gates_triggered: Array.from(new Set([
          ...(Array.isArray(result.gate?.gates_triggered) ? result.gate.gates_triggered : []),
          ...(result.index_sync_check?.enabled ? ["R11"] : []),
        ])),
        result: result.gate.result === "stop" ? "stop" : "ok",
        reason_code: result.index_sync_check?.enabled && result.index_sync_check.in_sync === false
          ? "INDEX_SYNC_DRIFT"
          : result.gate.reason_code,
        trace_id: `tr-${crypto.randomBytes(4).toString("hex")}`,
      };
      result.summary_event_file = appendEvent(eventFilePath, event);
      result.summary_run_id = checkpointRunId;
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Checkpoint completed in ${result.total_duration_ms}ms`);
    console.log(`Target: ${result.target_root}`);
    console.log(`State mode: ${result.state_mode}`);
    console.log(`Reload: ${result.reload.decision} (${result.reload.duration_ms}ms)`);
    console.log(`Gate: ${result.gate.action} (${result.gate.duration_ms}ms)`);
    console.log(`Index (${result.index.store}): ${result.index.output} (${result.index.duration_ms}ms)`);
    if (result.index.skipped) {
      console.log(`Index skipped: ${result.index.skip_reason}`);
    }
    console.log(
      `Index writes: files=${result.index.writes.files_written_count}, bytes=${result.index.writes.bytes_written}`,
    );
    if (result.index_sync_check?.enabled) {
      console.log(
        `Index sync check: in_sync=${result.index_sync_check.in_sync ? "yes" : "no"} (${result.index_sync_check.duration_ms}ms)`,
      );
      if (result.index_sync_check.output_file) {
        console.log(`Index sync check file: ${result.index_sync_check.output_file}`);
      }
    }
    if (result.summary_event_file) {
      console.log(`Summary event: ${result.summary_event_file}`);
      console.log(`Summary run_id: ${result.summary_run_id}`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
