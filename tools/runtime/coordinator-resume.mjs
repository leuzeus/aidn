#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { computeCoordinatorLoopState } from "./coordinator-loop.mjs";
import { computeCoordinatorDispatchPlan } from "./coordinator-dispatch-plan.mjs";
import { executeCoordinatorDispatch } from "./coordinator-dispatch-execute.mjs";
import { suggestCoordinatorArbitration } from "./coordinator-suggest-arbitration.mjs";

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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/coordinator-resume.mjs --target .");
  console.log("  node tools/runtime/coordinator-resume.mjs --target . --execute --json");
}

function buildBlockedResult({
  absoluteTargetRoot,
  dispatch,
  loopState,
  arbitrationSuggestions,
  executeRequested,
}) {
  const escalationReason = arbitrationSuggestions?.arbitration_reason
    || loopState.loop?.escalation?.reason
    || "user arbitration is required before resuming this escalated dispatch";
  return {
    target_root: absoluteTargetRoot,
    resume_status: "blocked",
    resume_reason: escalationReason,
    arbitration_required: true,
    arbitration_satisfied: false,
    preferred_decision: arbitrationSuggestions?.preferred_decision ?? null,
    arbitration_suggestions: arbitrationSuggestions,
    execute_requested: Boolean(executeRequested),
    can_resume: false,
    loop: loopState.loop,
    context: loopState.context,
    handoff: loopState.handoff,
    dispatch,
    execution_status: "blocked",
    executed: false,
    execution: null,
  };
}

export async function resumeCoordinatorDispatch({
  targetRoot,
  agent = "auto",
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  packetFile = "docs/audit/HANDOFF-PACKET.md",
  agentRosterFile = "docs/audit/AGENT-ROSTER.md",
  historyFile = ".aidn/runtime/context/coordination-history.ndjson",
  summaryFile = "docs/audit/COORDINATION-SUMMARY.md",
  coordinationLogFile = "docs/audit/COORDINATION-LOG.md",
  coordinationSummaryFile = "docs/audit/COORDINATION-SUMMARY.md",
  coordinationHistoryFile = ".aidn/runtime/context/coordination-history.ndjson",
  execute = false,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const loopState = computeCoordinatorLoopState({
    targetRoot: absoluteTargetRoot,
    currentStateFile,
    runtimeStateFile,
    packetFile,
    historyFile,
    summaryFile,
  });
  const dispatch = await computeCoordinatorDispatchPlan({
    targetRoot: absoluteTargetRoot,
    agent,
    currentStateFile,
    runtimeStateFile,
    packetFile,
    agentRosterFile,
  });

  if (dispatch.dispatch_status === "escalated") {
    const arbitrationSuggestions = await suggestCoordinatorArbitration({
      targetRoot: absoluteTargetRoot,
      agent,
      currentStateFile,
      runtimeStateFile,
      packetFile,
      agentRosterFile,
    });
    return buildBlockedResult({
      absoluteTargetRoot,
      dispatch,
      loopState,
      arbitrationSuggestions,
      executeRequested: execute,
    });
  }

  const arbitrationSatisfied = Boolean(loopState.loop?.history?.arbitration_applied);
  const resumeStatus = arbitrationSatisfied ? "resumed_after_arbitration" : "ready";
  const resumeReason = arbitrationSatisfied
    ? "user arbitration is newer than the last escalated dispatch"
    : "no pending escalation blocks this dispatch";

  if (!execute) {
    return {
      target_root: absoluteTargetRoot,
      resume_status: resumeStatus,
      resume_reason: resumeReason,
      arbitration_required: false,
      arbitration_satisfied: arbitrationSatisfied,
      execute_requested: false,
      can_resume: true,
      loop: loopState.loop,
      context: loopState.context,
      handoff: loopState.handoff,
      dispatch,
      execution_status: "dry_run",
      executed: false,
      execution: null,
    };
  }

  const execution = await executeCoordinatorDispatch({
    targetRoot: absoluteTargetRoot,
    agent,
    currentStateFile,
    runtimeStateFile,
    packetFile,
    agentRosterFile,
    coordinationLogFile,
    coordinationSummaryFile,
    coordinationHistoryFile,
    execute: true,
  });

  return {
    target_root: absoluteTargetRoot,
    resume_status: resumeStatus,
    resume_reason: resumeReason,
    arbitration_required: false,
    arbitration_satisfied: arbitrationSatisfied,
    execute_requested: true,
    can_resume: true,
    loop: loopState.loop,
    context: loopState.context,
    handoff: loopState.handoff,
    dispatch,
    execution_status: execution.execution_status,
    executed: Boolean(execution.executed),
    execution,
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await resumeCoordinatorDispatch({
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
      execute: args.execute,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Coordinator resume:");
      console.log(`- resume_status=${result.resume_status}`);
      console.log(`- execution_status=${result.execution_status}`);
      console.log(`- arbitration_satisfied=${result.arbitration_satisfied}`);
      if (result.preferred_decision) {
        console.log(`- preferred_decision=${result.preferred_decision}`);
      }
      console.log(`- entrypoint=${result.dispatch.entrypoint_kind}:${result.dispatch.entrypoint_name}`);
    }
    if (args.execute && result.execution_status !== "executed") {
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
