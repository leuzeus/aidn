#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    target: ".",
    cache: ".aidn/runtime/cache/reload-state.json",
    eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
    indexOutput: ".aidn/runtime/index/workflow-index.json",
    indexStore: "file",
    indexSqlOutput: ".aidn/runtime/index/workflow-index.sql",
    indexSchemaFile: "tools/perf/sql/schema.sql",
    indexIncludeSchema: true,
    indexKpiFile: "",
    mode: "COMMITTING",
    runId: "",
    json: false,
    emitSummaryEvent: true,
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
      i += 1;
    } else if (token === "--index-sql-output") {
      args.indexSqlOutput = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-schema-file") {
      args.indexSchemaFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-no-schema") {
      args.indexIncludeSchema = false;
    } else if (token === "--index-kpi-file") {
      args.indexKpiFile = argv[i + 1] ?? "";
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
  if (!["file", "sql", "dual"].includes(args.indexStore)) {
    throw new Error("Invalid --index-store. Expected file|sql|dual");
  }
  if ((args.indexStore === "sql" || args.indexStore === "dual") && !args.indexSqlOutput) {
    throw new Error("Missing value for --index-sql-output");
  }
  if (!["THINKING", "EXPLORING", "COMMITTING", "UNKNOWN"].includes(args.mode)) {
    throw new Error("Invalid --mode. Expected THINKING|EXPLORING|COMMITTING|UNKNOWN");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/checkpoint.mjs --target ../client");
  console.log("  node tools/perf/checkpoint.mjs --target ../client --mode COMMITTING");
  console.log("  node tools/perf/checkpoint.mjs --target ../client --run-id S072-20260301T1012Z");
  console.log("  node tools/perf/checkpoint.mjs --target ../client --index-store dual --index-sql-output .aidn/runtime/index/workflow-index.sql");
  console.log("  node tools/perf/checkpoint.mjs --target ../client --index-kpi-file .aidn/runtime/perf/kpi-report.json");
  console.log("  node tools/perf/checkpoint.mjs --json");
}

function execJson(command) {
  const out = execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

function execText(command) {
  return execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function appendEvent(eventFile, event) {
  const absolute = path.resolve(process.cwd(), eventFile);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.appendFileSync(absolute, `${JSON.stringify(event)}\n`, "utf8");
  return absolute;
}

function toIsoNowCompact() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
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

function main() {
  const started = Date.now();
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);

    const reloadStarted = Date.now();
    const reload = execJson(
      `node tools/perf/reload-check.mjs --target "${targetRoot}" --cache "${args.cache}" --write-cache --json`,
    );
    const reloadDurationMs = Date.now() - reloadStarted;

    const gateStarted = Date.now();
    const gate = execJson(
      `node tools/perf/gating-evaluate.mjs --target "${targetRoot}" --cache "${args.cache}" --event-file "${args.eventFile}" --mode ${args.mode}${args.runId ? ` --run-id ${args.runId}` : ""} --json`,
    );
    const gateDurationMs = Date.now() - gateStarted;

    const indexStarted = Date.now();
    const indexArgs = [
      `--target "${targetRoot}"`,
      `--store ${args.indexStore}`,
      `--output "${args.indexOutput}"`,
    ];
    if (args.indexStore === "sql" || args.indexStore === "dual") {
      indexArgs.push(`--sql-output "${args.indexSqlOutput}"`);
      indexArgs.push(`--schema-file "${args.indexSchemaFile}"`);
      if (!args.indexIncludeSchema) {
        indexArgs.push("--no-schema");
      }
    }
    if (args.indexKpiFile) {
      indexArgs.push(`--kpi-file "${args.indexKpiFile}"`);
    }
    const indexOut = execText(
      `node tools/perf/index-sync.mjs ${indexArgs.join(" ")}`,
    );
    const indexDurationMs = Date.now() - indexStarted;

    const checkpointRunId = args.runId || `checkpoint-${toIsoNowCompact()}`;

    const result = {
      ts: new Date().toISOString(),
      run_id: checkpointRunId,
      target_root: targetRoot,
      mode: args.mode,
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
        duration_ms: gateDurationMs,
      },
      index: {
        store: args.indexStore,
        output: path.resolve(process.cwd(), args.indexOutput),
        sql_output: args.indexStore === "sql" || args.indexStore === "dual"
          ? path.resolve(process.cwd(), args.indexSqlOutput)
          : null,
        duration_ms: indexDurationMs,
      },
      total_duration_ms: Date.now() - started,
      index_sync_stdout: indexOut.trim(),
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
      appendEvent(args.eventFile, reloadEvent);

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
        files_written_count: 1,
        bytes_written: 0,
        gates_triggered: ["R03", "R04", "R05", "R10"],
        result: result.gate.result === "stop" ? "stop" : "ok",
        reason_code: result.gate.reason_code,
        trace_id: `tr-${crypto.randomBytes(4).toString("hex")}`,
      };
      result.summary_event_file = appendEvent(args.eventFile, event);
      result.summary_run_id = checkpointRunId;
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Checkpoint completed in ${result.total_duration_ms}ms`);
    console.log(`Target: ${result.target_root}`);
    console.log(`Reload: ${result.reload.decision} (${result.reload.duration_ms}ms)`);
    console.log(`Gate: ${result.gate.action} (${result.gate.duration_ms}ms)`);
    console.log(`Index: ${result.index.output} (${result.index.duration_ms}ms)`);
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
