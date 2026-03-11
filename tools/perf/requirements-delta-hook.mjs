#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCheckpointUseCase } from "../../src/application/runtime/checkpoint-use-case.mjs";
import { runRequirementsDeltaAdmitUseCase } from "../../src/application/runtime/requirements-delta-admit-use-case.mjs";
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
    } else if (token === "--json") {
      args.json = true;
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/requirements-delta-hook.mjs --target . --mode COMMITTING --json");
}

function shouldRunCheckpoint(admission) {
  return ["proceed_requirements_delta", "recommend_new_cycle"].includes(String(admission?.action ?? ""));
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
    repair_layer_top_findings: Array.isArray(checkpointSummary.repair_layer_top_findings)
      ? checkpointSummary.repair_layer_top_findings
      : [],
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const admission = runRequirementsDeltaAdmitUseCase({
      targetRoot,
      mode: args.mode,
    });
    const checkpoint = shouldRunCheckpoint(admission)
      ? runCheckpointUseCase({
        args,
        runtimeDir: PERF_DIR,
        targetRoot,
      })
      : null;

    const result = {
      ts: new Date().toISOString(),
      ok: admission.ok === true && (checkpoint ? checkpoint.ok === true : true),
      skill: "requirements-delta",
      target_root: targetRoot,
      mode: args.mode,
      state_mode: checkpoint?.state_mode ?? args.stateMode,
      action: admission.action,
      result: admission.result,
      reason_code: admission.reason_code,
      branch: admission.branch,
      branch_kind: admission.branch_kind,
      admission,
      checkpoint,
      summary: null,
    };
    result.summary = buildSummary(result);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    console.log(`Result: ${result.result}`);
    console.log(`Action: ${result.action}`);
    if (admission.recommended_next_action) {
      console.log(`Next action: ${admission.recommended_next_action}`);
    }
    process.exit(0);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
