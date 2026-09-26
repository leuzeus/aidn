#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCheckpointUseCase } from "../../src/application/runtime/checkpoint-use-case.mjs";
import { runCycleCloseAdmitUseCase } from "../../src/application/runtime/cycle-close-admit-use-case.mjs";
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
  console.log("  node tools/perf/cycle-close-hook.mjs --target . --mode COMMITTING --json");
}

function buildSummary(result) {
  const checkpointSummary = result.checkpoint?.summary ?? {};
  return {
    result: result.result,
    reason_code: result.reason_code ?? null,
    action: result.action,
    admitted: result.admission?.ok === true,
    checkpoint_ran: result.checkpoint != null,
    checkpoint_result: checkpointSummary.result ?? null,
    repair_layer_open_count: Number(checkpointSummary.repair_layer_open_count ?? 0),
    repair_layer_blocking: checkpointSummary.repair_layer_blocking === true,
    repair_layer_status: checkpointSummary.repair_layer_status ?? "clean",
    repair_layer_advice: checkpointSummary.repair_layer_advice ?? "Repair layer is clean.",
    repair_primary_reason: checkpointSummary.repair_primary_reason ?? checkpointSummary.repair_layer_advice ?? "Repair layer is clean.",
    repair_layer_top_findings: Array.isArray(checkpointSummary.repair_layer_top_findings)
      ? checkpointSummary.repair_layer_top_findings
      : [],
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const admission = await runCycleCloseAdmitUseCase({
      targetRoot,
      mode: args.mode,
    });
    const checkpoint = admission.action === "cycle_close_allowed"
      ? await runCheckpointUseCase({
        args,
        runtimeDir: PERF_DIR,
        targetRoot,
        completionCycleId: ["DONE", "NO_GO", "DROPPED"].includes(admission.target_cycle?.state)
          ? admission.target_cycle.cycle_id : null,
      })
      : null;
    const effective = admission.ok === true && checkpoint ? checkpoint.gate : admission;
    const result = {
      ts: new Date().toISOString(),
      ok: admission.ok === true && effective.result === "ok" && (checkpoint ? checkpoint.ok === true : true),
      skill: "cycle-close",
      target_root: targetRoot,
      mode: args.mode,
      state_mode: checkpoint?.state_mode ?? args.stateMode,
      action: effective.result === "ok" ? admission.action : effective.action,
      result: effective.result,
      reason_code: effective.reason_code,
      blocking_reasons: admission.ok !== true ? admission.blocking_reasons
        : effective.result === "ok" ? [] : checkpoint.reload.reason_codes,
      recommended_next_action: effective.result === "ok" ? admission.recommended_next_action
        : admission.ok !== true ? admission.recommended_next_action : "Resolve the checkpoint refusal before continuing closure or integrating the branch.",
      branch: admission.branch,
      branch_kind: admission.branch_kind,
      admission,
      checkpoint,
      summary: null,
    };
    result.summary = buildSummary(result);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.result === "stop" || result.result === "error" ? 1 : 0;
      return;
    }
    console.log(`Result: ${result.result}`);
    console.log(`Action: ${result.action}`);
    if (result.recommended_next_action) {
      console.log(`Next action: ${result.recommended_next_action}`);
    }
    process.exitCode = result.result === "stop" || result.result === "error" ? 1 : 0;
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

await main();
