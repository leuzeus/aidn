#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWorkflowHookUseCase } from "../../src/application/runtime/workflow-hook-use-case.mjs";
import { normalizeIndexStoreMode } from "../../src/lib/config/aidn-config-lib.mjs";
import { resolveDefaultIndexStore } from "../../src/core/state-mode/runtime-index-policy.mjs";

function parseArgs(argv) {
  const envStore = String(process.env.AIDN_INDEX_STORE_MODE ?? "").trim().toLowerCase();
  const envStateMode = String(process.env.AIDN_STATE_MODE ?? "").trim().toLowerCase();
  const args = {
    phase: "",
    target: ".",
    mode: "COMMITTING",
    eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
    runIdFile: ".aidn/runtime/perf/current-run-id.txt",
    indexStore: envStore || "",
    indexStoreExplicit: false,
    stateMode: envStateMode || "files",
    indexOutput: ".aidn/runtime/index/workflow-index.json",
    indexSqlOutput: ".aidn/runtime/index/workflow-index.sql",
    indexSqliteOutput: ".aidn/runtime/index/workflow-index.sqlite",
    indexSchemaFile: path.join(path.dirname(fileURLToPath(import.meta.url)), "sql", "schema.sql"),
    indexIncludeSchema: true,
    indexKpiFile: "",
    indexSyncCheck: false,
    indexSyncCheckStrict: false,
    indexSyncCheckOut: ".aidn/runtime/index/index-sync-check.json",
    constraintLoopMode: "auto",
    constraintLoopStrict: false,
    startLightGate: true,
    autoSkipGateOnNoSignal: true,
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
      args.indexStoreExplicit = true;
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
    } else if (token === "--constraint-loop") {
      args.constraintLoopMode = "on";
    } else if (token === "--no-constraint-loop") {
      args.constraintLoopMode = "off";
    } else if (token === "--constraint-loop-strict") {
      args.constraintLoopStrict = true;
    } else if (token === "--start-light-gate") {
      args.startLightGate = true;
    } else if (token === "--full-start-gate") {
      args.startLightGate = false;
    } else if (token === "--no-auto-skip-gate") {
      args.autoSkipGateOnNoSignal = false;
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
  console.log("  node tools/perf/workflow-hook.mjs --phase session-start");
  console.log("  AIDN_INDEX_STORE_MODE=sqlite node tools/perf/workflow-hook.mjs --phase session-start");
  console.log("  AIDN_STATE_MODE=dual node tools/perf/workflow-hook.mjs --phase session-start");
  console.log("  AIDN_STATE_MODE=db-only node tools/perf/workflow-hook.mjs --phase session-start");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-close --mode COMMITTING");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-start --index-store dual");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-start --index-store sqlite --index-sqlite-output .aidn/runtime/index/workflow-index.sqlite");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-close --index-kpi-file .aidn/runtime/perf/kpi-report.json");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-close --index-sync-check");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-start --run-id-file .aidn/runtime/perf/current-run-id.txt");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-start --full-start-gate");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-close --no-auto-skip-gate");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-start --strict");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-close --constraint-loop");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-close --no-constraint-loop");
  console.log("  node tools/perf/workflow-hook.mjs --phase session-close --constraint-loop-strict");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const output = runWorkflowHookUseCase({ args, runtimeDir, targetRoot });

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
    console.log(`State mode: ${args.stateMode}`);
    console.log(`run_id: ${output.run_id}`);
    console.log(`Event file: ${output.event_file}`);
    if (output.run_id_file) {
      console.log(`Run id file: ${output.run_id_file}`);
    }
    if (output.checkpoint) {
      console.log(`Checkpoint action: ${output.checkpoint.gate?.action ?? "n/a"}`);
      console.log(`Checkpoint index store: ${output.checkpoint.index?.store ?? "n/a"}`);
      console.log(`Checkpoint total: ${output.checkpoint.total_duration_ms ?? "n/a"}ms`);
      const repairLayerOpenCount = Number(output.summary?.repair_layer_open_count ?? 0);
      if (repairLayerOpenCount > 0) {
        console.log(`Repair findings: ${repairLayerOpenCount} open${output.summary?.repair_layer_blocking ? " (blocking)" : ""}`);
      }
    }
    if (output.checkpoint_error && !args.strict) {
      console.log(`Checkpoint error (ignored): ${output.checkpoint_error}`);
    }
    if (output.constraint_loop_required) {
      console.log("Constraint loop: OK");
      console.log(`Constraint status: ${output.constraint_loop?.summary?.constraint_status ?? "n/a"}`);
      console.log(`Constraint trend: ${output.constraint_loop?.summary?.trend_status ?? "n/a"}`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
