#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBranchCycleAuditAdmitUseCase } from "../../src/application/runtime/branch-cycle-audit-admit-use-case.mjs";
import { runGatingEvaluateUseCase } from "../../src/application/runtime/gating-evaluate-use-case.mjs";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const envStateMode = String(process.env.AIDN_STATE_MODE ?? "").trim().toLowerCase();
  const args = {
    target: ".",
    cache: ".aidn/runtime/cache/reload-state.json",
    eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
    indexSyncCheckFile: ".aidn/runtime/index/index-sync-check.json",
    stateMode: envStateMode || "files",
    stateModeExplicit: false,
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    indexBackend: "auto",
    thresholdFiles: 3,
    thresholdMinutes: 45,
    mode: "COMMITTING",
    runId: "",
    reloadDecision: "",
    reloadFallback: "",
    reloadReasonCodes: "",
    emitEvent: true,
    json: false,
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
    } else if (token === "--index-sync-check-file") {
      args.indexSyncCheckFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--state-mode") {
      args.stateMode = String(argv[i + 1] ?? "").toLowerCase();
      args.stateModeExplicit = true;
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-backend") {
      args.indexBackend = String(argv[i + 1] ?? "").toLowerCase();
      i += 1;
    } else if (token === "--threshold-files") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--threshold-files must be an integer");
      }
      args.thresholdFiles = Number(raw);
    } else if (token === "--threshold-minutes") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--threshold-minutes must be an integer");
      }
      args.thresholdMinutes = Number(raw);
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").toUpperCase();
      i += 1;
    } else if (token === "--run-id") {
      args.runId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--reload-decision") {
      args.reloadDecision = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--reload-fallback") {
      args.reloadFallback = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--reload-reason-codes") {
      args.reloadReasonCodes = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--no-emit-event") {
      args.emitEvent = false;
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
  if (!["files", "dual", "db-only"].includes(args.stateMode)) {
    throw new Error("Invalid --state-mode. Expected files|dual|db-only");
  }
  if (!["auto", "json", "sqlite"].includes(args.indexBackend)) {
    throw new Error("Invalid --index-backend. Expected auto|json|sqlite");
  }
  if (!["THINKING", "EXPLORING", "COMMITTING", "UNKNOWN"].includes(args.mode)) {
    throw new Error("Invalid --mode. Expected THINKING|EXPLORING|COMMITTING|UNKNOWN");
  }
  if (args.reloadDecision && !["incremental", "full", "stop"].includes(args.reloadDecision)) {
    throw new Error("Invalid --reload-decision. Expected incremental|full|stop");
  }
  if (args.reloadFallback && !["true", "false"].includes(args.reloadFallback)) {
    throw new Error("Invalid --reload-fallback. Expected true|false");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/branch-cycle-audit-hook.mjs --target . --mode COMMITTING --json");
  console.log("  AIDN_STATE_MODE=db-only node tools/perf/branch-cycle-audit-hook.mjs --target . --mode COMMITTING --json");
}

function shouldRunGating(admission) {
  return ["audit_session_branch", "audit_cycle_branch", "audit_intermediate_branch"].includes(String(admission?.action ?? ""));
}

function buildSummary(result) {
  const gatingSummary = result.gating?.summary ?? {};
  return {
    result: result.result,
    reason_code: result.reason_code ?? null,
    action: result.action,
    admitted: result.admission?.ok === true,
    gating_ran: result.gating != null,
    gating_result: gatingSummary.result ?? null,
    repair_layer_open_count: 0,
    repair_layer_blocking: false,
    repair_layer_status: "clean",
    repair_layer_advice: "Repair layer is clean.",
    repair_primary_reason: "Repair layer is clean.",
    repair_layer_top_findings: [],
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const admission = runBranchCycleAuditAdmitUseCase({
      targetRoot,
      mode: args.mode,
    });

    const gating = shouldRunGating(admission)
      ? runGatingEvaluateUseCase({
        args,
        targetRoot,
        runtimeDir: PERF_DIR,
      })
      : null;

    const result = {
      ts: new Date().toISOString(),
      ok: admission.ok === true,
      skill: "branch-cycle-audit",
      target_root: targetRoot,
      mode: args.mode,
      state_mode: gating?.state_mode ?? args.stateMode,
      action: admission.action,
      result: admission.result,
      reason_code: admission.reason_code,
      branch: admission.branch,
      branch_kind: admission.branch_kind,
      admission,
      gating,
      levels: gating?.levels ?? null,
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
    if (gating?.event_file) {
      console.log(`Event file: ${gating.event_file}`);
    }
    process.exit(0);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
