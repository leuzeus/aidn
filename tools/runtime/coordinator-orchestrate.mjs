#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveDbBackedMode } from "./db-first-runtime-view-lib.mjs";
import { resumeCoordinatorDispatch } from "./coordinator-resume.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    agent: "auto",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: "docs/audit/RUNTIME-STATE.md",
    packetFile: "docs/audit/HANDOFF-PACKET.md",
    agentRosterFile: "docs/audit/AGENT-ROSTER.md",
    historyFile: ".aidn/runtime/context/coordination-history.ndjson",
    summaryFile: "docs/audit/COORDINATION-SUMMARY.md",
    coordinationLogFile: "docs/audit/COORDINATION-LOG.md",
    coordinationSummaryFile: "docs/audit/COORDINATION-SUMMARY.md",
    coordinationHistoryFile: ".aidn/runtime/context/coordination-history.ndjson",
    maxIterations: 1,
    execute: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--target") {
      args.target = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--agent") {
      args.agent = String(argv[index + 1] ?? "").trim().toLowerCase();
      index += 1;
    } else if (token === "--current-state-file") {
      args.currentStateFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--runtime-state-file") {
      args.runtimeStateFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--packet-file") {
      args.packetFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--agent-roster-file") {
      args.agentRosterFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--history-file") {
      args.historyFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--summary-file") {
      args.summaryFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--coordination-log-file") {
      args.coordinationLogFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--coordination-summary-file") {
      args.coordinationSummaryFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--coordination-history-file") {
      args.coordinationHistoryFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--max-iterations") {
      args.maxIterations = Number.parseInt(String(argv[index + 1] ?? "").trim(), 10);
      index += 1;
    } else if (token === "--execute") {
      args.execute = true;
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
  if (!args.agent) {
    throw new Error("Missing value for --agent");
  }
  if (!Number.isInteger(args.maxIterations) || args.maxIterations < 1 || args.maxIterations > 10) {
    throw new Error("Invalid --max-iterations. Expected an integer between 1 and 10.");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/coordinator-orchestrate.mjs --target .");
  console.log("  node tools/runtime/coordinator-orchestrate.mjs --target . --execute --max-iterations 2 --json");
}

function buildResumeOptions(args, execute) {
  return {
    targetRoot: args.target,
    agent: args.agent,
    currentStateFile: args.currentStateFile,
    runtimeStateFile: args.runtimeStateFile,
    packetFile: args.packetFile,
    agentRosterFile: args.agentRosterFile,
    historyFile: args.historyFile,
    summaryFile: args.summaryFile,
    coordinationLogFile: args.coordinationLogFile,
    coordinationSummaryFile: args.coordinationSummaryFile,
    coordinationHistoryFile: args.coordinationHistoryFile,
    execute,
    sharedCoordination: args.sharedCoordination ?? null,
    sharedCoordinationOptions: args.sharedCoordinationOptions ?? {},
  };
}

function sameDispatch(left, right) {
  const leftRecommendation = left?.dispatch?.coordinator_recommendation;
  const rightRecommendation = right?.dispatch?.coordinator_recommendation;
  return String(leftRecommendation?.role ?? "").trim() === String(rightRecommendation?.role ?? "").trim()
    && String(leftRecommendation?.action ?? "").trim() === String(rightRecommendation?.action ?? "").trim()
    && String(leftRecommendation?.goal ?? "").trim() === String(rightRecommendation?.goal ?? "").trim();
}

function buildArbitrationSurface(preview) {
  return {
    arbitration_required: Boolean(preview?.arbitration_required),
    preferred_decision: preview?.preferred_decision ?? preview?.arbitration_suggestions?.preferred_decision ?? null,
    arbitration_suggestions: preview?.arbitration_suggestions ?? null,
    preferred_dispatch_source: preview?.preferred_dispatch_source ?? "workflow",
    shared_planning_candidate: preview?.shared_planning_candidate ?? null,
  };
}

export async function orchestrateCoordinatorDispatch(options = {}) {
  const args = {
    target: path.resolve(process.cwd(), options.targetRoot ?? options.target ?? "."),
    agent: options.agent ?? "auto",
    currentStateFile: options.currentStateFile ?? "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: options.runtimeStateFile ?? "docs/audit/RUNTIME-STATE.md",
    packetFile: options.packetFile ?? "docs/audit/HANDOFF-PACKET.md",
    agentRosterFile: options.agentRosterFile ?? "docs/audit/AGENT-ROSTER.md",
    historyFile: options.historyFile ?? ".aidn/runtime/context/coordination-history.ndjson",
    summaryFile: options.summaryFile ?? "docs/audit/COORDINATION-SUMMARY.md",
    coordinationLogFile: options.coordinationLogFile ?? "docs/audit/COORDINATION-LOG.md",
    coordinationSummaryFile: options.coordinationSummaryFile ?? "docs/audit/COORDINATION-SUMMARY.md",
    coordinationHistoryFile: options.coordinationHistoryFile ?? ".aidn/runtime/context/coordination-history.ndjson",
    maxIterations: Number.isInteger(options.maxIterations) ? options.maxIterations : 1,
    execute: Boolean(options.execute),
    sharedCoordination: options.sharedCoordination ?? null,
    sharedCoordinationOptions: options.sharedCoordinationOptions ?? {},
  };
  const { effectiveStateMode, dbBackedMode } = resolveDbBackedMode(args.target);

  const initialPreview = await resumeCoordinatorDispatch(buildResumeOptions(args, false));
  if (!args.execute) {
    return {
      target_root: args.target,
      state_mode: effectiveStateMode,
      db_backed_mode: dbBackedMode,
      orchestration_status: initialPreview.can_resume ? "dry_run" : "blocked",
      stop_reason: initialPreview.can_resume
        ? "dry_run_only"
        : "resume_blocked_until_user_arbitration",
      execute_requested: false,
      max_iterations: args.maxIterations,
      iterations_completed: 0,
      can_continue: initialPreview.can_resume,
      initial_preview: initialPreview,
      last_preview: initialPreview,
      ...buildArbitrationSurface(initialPreview),
      runs: [],
    };
  }

  if (!initialPreview.can_resume) {
    return {
      target_root: args.target,
      state_mode: effectiveStateMode,
      db_backed_mode: dbBackedMode,
      orchestration_status: "blocked",
      stop_reason: "resume_blocked_until_user_arbitration",
      execute_requested: true,
      max_iterations: args.maxIterations,
      iterations_completed: 0,
      can_continue: false,
      initial_preview: initialPreview,
      last_preview: initialPreview,
      ...buildArbitrationSurface(initialPreview),
      runs: [],
    };
  }

  const runs = [];
  let currentPreview = initialPreview;
  let lastPreview = initialPreview;
  let orchestrationStatus = "executed";
  let stopReason = "max_iterations_reached";

  for (let iteration = 0; iteration < args.maxIterations; iteration += 1) {
    const execution = await resumeCoordinatorDispatch(buildResumeOptions(args, true));
    runs.push(execution);
    if (execution.execution_status !== "executed") {
      orchestrationStatus = execution.execution_status === "blocked" ? "blocked" : "failed";
      stopReason = `execution_status=${execution.execution_status}`;
      lastPreview = execution;
      break;
    }

    if (iteration === args.maxIterations - 1) {
      lastPreview = await resumeCoordinatorDispatch(buildResumeOptions(args, false));
      break;
    }

    const nextPreview = await resumeCoordinatorDispatch(buildResumeOptions(args, false));
    lastPreview = nextPreview;

    if (!nextPreview.can_resume) {
      orchestrationStatus = "blocked";
      stopReason = "resume_blocked_until_user_arbitration";
      break;
    }

    if (sameDispatch(currentPreview, nextPreview)) {
      orchestrationStatus = "paused";
      stopReason = "repeat_guard_same_dispatch";
      break;
    }

    currentPreview = nextPreview;
  }

  return {
    target_root: args.target,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
    orchestration_status: orchestrationStatus,
    stop_reason: stopReason,
    execute_requested: true,
    max_iterations: args.maxIterations,
    iterations_completed: runs.length,
    can_continue: orchestrationStatus === "executed" || orchestrationStatus === "paused",
    initial_preview: initialPreview,
    last_preview: lastPreview,
    ...buildArbitrationSurface(lastPreview),
    runs,
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await orchestrateCoordinatorDispatch({
      targetRoot: args.target,
      agent: args.agent,
      currentStateFile: args.currentStateFile,
      runtimeStateFile: args.runtimeStateFile,
      packetFile: args.packetFile,
      agentRosterFile: args.agentRosterFile,
      historyFile: args.historyFile,
      summaryFile: args.summaryFile,
      coordinationLogFile: args.coordinationLogFile,
      coordinationSummaryFile: args.coordinationSummaryFile,
      coordinationHistoryFile: args.coordinationHistoryFile,
      maxIterations: args.maxIterations,
      execute: args.execute,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Coordinator orchestrate:");
      console.log(`- orchestration_status=${result.orchestration_status}`);
      console.log(`- stop_reason=${result.stop_reason}`);
      console.log(`- iterations_completed=${result.iterations_completed}/${result.max_iterations}`);
      if (result.preferred_decision) {
        console.log(`- preferred_decision=${result.preferred_decision}`);
      }
    }
    if (args.execute && result.orchestration_status !== "executed" && result.orchestration_status !== "paused") {
      process.exit(1);
    }
  }).catch((error) => {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
