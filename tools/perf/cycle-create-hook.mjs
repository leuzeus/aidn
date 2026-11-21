#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCycleCreateHookUseCase } from "../../src/application/runtime/cycle-create-hook-use-case.mjs";
import { resolveDefaultIndexStore } from "../../src/core/state-mode/runtime-index-policy.mjs";

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
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").trim().toUpperCase();
      i += 1;
    } else if (token === "--cache") {
      args.cache = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--event-file") {
      args.eventFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--index-output") {
      args.indexOutput = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--index-store") {
      args.indexStore = String(argv[i + 1] ?? "").trim().toLowerCase();
      args.indexStoreExplicit = true;
      i += 1;
    } else if (token === "--index-sql-output") {
      args.indexSqlOutput = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--index-sqlite-output") {
      args.indexSqliteOutput = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--index-schema-file") {
      args.indexSchemaFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--index-no-schema") {
      args.indexIncludeSchema = false;
    } else if (token === "--index-kpi-file") {
      args.indexKpiFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--index-sync-check") {
      args.indexSyncCheck = true;
    } else if (token === "--index-sync-check-strict") {
      args.indexSyncCheck = true;
      args.indexSyncCheckStrict = true;
    } else if (token === "--index-sync-check-out") {
      args.indexSyncCheckOut = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--run-id") {
      args.runId = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--no-auto-skip-gate") {
      args.autoSkipGateOnNoSignal = false;
    } else if (token === "--no-summary-event") {
      args.emitSummaryEvent = false;
    } else if (token === "--skip-index-on-incremental") {
      args.skipIndexOnIncremental = true;
    } else if (token === "--no-skip-index-on-incremental") {
      args.skipIndexOnIncremental = false;
    } else if (token === "--skip-gate-evaluate") {
      args.skipGateEvaluate = true;
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
  if (!["THINKING", "EXPLORING", "COMMITTING", "UNKNOWN"].includes(args.mode)) {
    throw new Error("Invalid --mode. Expected THINKING|EXPLORING|COMMITTING|UNKNOWN");
  }
  args.stateMode = String(args.stateMode ?? "").trim().toLowerCase() || "files";
  if (!["files", "dual", "db-only"].includes(args.stateMode)) {
    throw new Error("Invalid AIDN_STATE_MODE. Expected files|dual|db-only");
  }
  if (!args.indexStore) {
    args.indexStore = resolveDefaultIndexStore(args.stateMode);
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
  console.log("  node tools/perf/cycle-create-hook.mjs --target . --mode COMMITTING --json");
  console.log("  node tools/perf/cycle-create-hook.mjs --target . --mode COMMITTING --index-store dual --json");
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const result = await runCycleCreateHookUseCase({ args, runtimeDir: PERF_DIR, targetRoot });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    console.log(`Result: ${result.result}`);
    console.log(`Action: ${result.action}`);
    console.log(`Branch: ${result.branch}`);
    if (result.admission.recommended_next_action) {
      console.log(`Next action: ${result.admission.recommended_next_action}`);
    }
    process.exit(0);
  }).catch((error) => {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  });
}

main();
