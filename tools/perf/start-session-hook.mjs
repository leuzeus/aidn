#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStartSessionAdmitUseCase } from "../../src/application/runtime/start-session-admit-use-case.mjs";
import { runWorkflowHookUseCase } from "../../src/application/runtime/workflow-hook-use-case.mjs";
import { resolveDefaultIndexStore } from "../../src/core/state-mode/runtime-index-policy.mjs";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const envStore = String(process.env.AIDN_INDEX_STORE_MODE ?? "").trim().toLowerCase();
  const envStateMode = String(process.env.AIDN_STATE_MODE ?? "").trim().toLowerCase();
  const args = {
    target: ".",
    mode: "UNKNOWN",
    strict: false,
    noAutoSkipGate: false,
    json: false,
    eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
    runIdFile: ".aidn/runtime/perf/current-run-id.txt",
    indexStore: envStore || "",
    indexStoreExplicit: false,
    stateMode: envStateMode || "files",
    indexOutput: ".aidn/runtime/index/workflow-index.json",
    indexSqlOutput: ".aidn/runtime/index/workflow-index.sql",
    indexSqliteOutput: ".aidn/runtime/index/workflow-index.sqlite",
    indexSchemaFile: path.join(PERF_DIR, "sql", "schema.sql"),
    indexIncludeSchema: true,
    indexKpiFile: "",
    indexSyncCheck: false,
    indexSyncCheckStrict: false,
    indexSyncCheckOut: ".aidn/runtime/index/index-sync-check.json",
    constraintLoopMode: "auto",
    constraintLoopStrict: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").trim().toUpperCase();
      i += 1;
    } else if (token === "--event-file") {
      args.eventFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--run-id-file") {
      args.runIdFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--index-store") {
      args.indexStore = String(argv[i + 1] ?? "").trim().toLowerCase();
      args.indexStoreExplicit = true;
      i += 1;
    } else if (token === "--index-output") {
      args.indexOutput = String(argv[i + 1] ?? "").trim();
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
    } else if (token === "--constraint-loop") {
      args.constraintLoopMode = "on";
    } else if (token === "--no-constraint-loop") {
      args.constraintLoopMode = "off";
    } else if (token === "--constraint-loop-strict") {
      args.constraintLoopStrict = true;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--no-auto-skip-gate") {
      args.noAutoSkipGate = true;
    } else if (token === "--json") {
      args.json = true;
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
  console.log("  node tools/perf/start-session-hook.mjs --target . --mode COMMITTING --json");
  console.log("  node tools/perf/start-session-hook.mjs --target . --mode COMMITTING --index-store dual --json");
  console.log("  AIDN_STATE_MODE=db-only node tools/perf/start-session-hook.mjs --target . --mode COMMITTING --strict --json");
}

function shouldRunWorkflowHook(admission) {
  return ["resume_current_session", "resume_current_cycle", "create_session_allowed", "create_cycle_allowed"].includes(String(admission?.action ?? ""));
}

function buildSummary(result) {
  const workflowSummary = result.workflow_hook?.summary ?? {};
  return {
    result: result.result,
    reason_code: result.reason_code ?? null,
    action: result.action,
    admitted: result.admission?.ok === true,
    workflow_hook_ran: result.workflow_hook != null,
    workflow_hook_result: workflowSummary.result ?? null,
    repair_layer_open_count: Number(workflowSummary.repair_layer_open_count ?? 0),
    repair_layer_blocking: workflowSummary.repair_layer_blocking === true,
    repair_layer_status: workflowSummary.repair_layer_status ?? "clean",
    repair_layer_advice: workflowSummary.repair_layer_advice ?? "Repair layer is clean.",
    repair_primary_reason: workflowSummary.repair_primary_reason ?? workflowSummary.repair_layer_advice ?? "Repair layer is clean.",
    repair_layer_top_findings: Array.isArray(workflowSummary.repair_layer_top_findings)
      ? workflowSummary.repair_layer_top_findings
      : [],
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const admission = runStartSessionAdmitUseCase({
      targetRoot,
      mode: args.mode,
    });

    let workflowHook = null;
    if (shouldRunWorkflowHook(admission)) {
      workflowHook = runWorkflowHookUseCase({
        args: {
          phase: "session-start",
          target: targetRoot,
          mode: args.mode,
          eventFile: args.eventFile,
          runIdFile: args.runIdFile,
          indexStore: args.indexStore,
          indexStoreExplicit: args.indexStoreExplicit,
          stateMode: args.stateMode,
          indexOutput: args.indexOutput,
          indexSqlOutput: args.indexSqlOutput,
          indexSqliteOutput: args.indexSqliteOutput,
          indexSchemaFile: args.indexSchemaFile,
          indexIncludeSchema: args.indexIncludeSchema,
          indexKpiFile: args.indexKpiFile,
          indexSyncCheck: args.indexSyncCheck,
          indexSyncCheckStrict: args.indexSyncCheckStrict,
          indexSyncCheckOut: args.indexSyncCheckOut,
          constraintLoopMode: args.constraintLoopMode,
          constraintLoopStrict: args.constraintLoopStrict,
          startLightGate: true,
          autoSkipGateOnNoSignal: !args.noAutoSkipGate,
          strict: args.strict,
          json: true,
        },
        runtimeDir: PERF_DIR,
        targetRoot,
      });
    }

    const result = {
      ts: new Date().toISOString(),
      ok: admission.ok === true && (workflowHook ? workflowHook.ok === true : true),
      phase: "session-start",
      skill: "start-session",
      target_root: targetRoot,
      mode: args.mode,
      state_mode: workflowHook?.state_mode ?? args.stateMode,
      strict: workflowHook?.strict ?? args.strict,
      action: admission.action,
      result: admission.result,
      reason_code: admission.reason_code,
      branch: admission.branch,
      branch_kind: admission.branch_kind,
      admission,
      checkpoint: workflowHook?.checkpoint ?? null,
      checkpoint_error: workflowHook?.checkpoint_error ?? null,
      constraint_loop_required: workflowHook?.constraint_loop_required ?? false,
      constraint_loop_strict: workflowHook?.constraint_loop_strict ?? false,
      constraint_loop: workflowHook?.constraint_loop ?? null,
      constraint_loop_error: workflowHook?.constraint_loop_error ?? null,
      workflow_hook: workflowHook,
      summary: null,
    };
    result.summary = buildSummary(result);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    console.log(`Result: ${result.result}`);
    console.log(`Action: ${result.action}`);
    console.log(`Branch: ${result.branch}`);
    console.log(`Branch kind: ${result.branch_kind}`);
    if (Array.isArray(admission.blocking_reasons) && admission.blocking_reasons.length > 0) {
      console.log("Blocking reasons:");
      for (const item of admission.blocking_reasons) {
        console.log(`- ${item}`);
      }
    }
    if (Array.isArray(admission.required_user_choice) && admission.required_user_choice.length > 0) {
      console.log(`Required choice: ${admission.required_user_choice.join(", ")}`);
    }
    if (admission.recommended_next_action) {
      console.log(`Next action: ${admission.recommended_next_action}`);
    }
    if (workflowHook?.event_file) {
      console.log(`Event file: ${workflowHook.event_file}`);
    }
    process.exit(0);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
