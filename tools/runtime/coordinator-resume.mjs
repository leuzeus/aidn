#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildCoordinatorResumeBlockedResult,
  buildCoordinatorResumeResult,
  deriveCoordinatorResumeState,
} from "../../src/application/runtime/coordinator-resume-use-case.mjs";
import { deriveCoordinatorResumeDiagnostic } from "../../src/application/runtime/coordinator-diagnostics-lib.mjs";
import { resolveDbBackedMode } from "./db-first-runtime-view-lib.mjs";
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

async function runCoordinatorResumeDispatch({
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
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const { effectiveStateMode, dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
  const loopState = await computeCoordinatorLoopState({
    targetRoot: absoluteTargetRoot,
    currentStateFile,
    runtimeStateFile,
    packetFile,
    historyFile,
    summaryFile,
    sharedCoordination,
    sharedCoordinationOptions,
  });
  const dispatch = await computeCoordinatorDispatchPlan({
    targetRoot: absoluteTargetRoot,
    agent,
    currentStateFile,
    runtimeStateFile,
    packetFile,
    agentRosterFile,
    sharedCoordination,
    sharedCoordinationOptions,
  });

  if (dispatch.dispatch_status === "escalated") {
    const arbitrationSuggestions = await suggestCoordinatorArbitration({
      targetRoot: absoluteTargetRoot,
      agent,
      currentStateFile,
      runtimeStateFile,
      packetFile,
      agentRosterFile,
      sharedCoordination,
      sharedCoordinationOptions,
    });
    return buildCoordinatorResumeBlockedResult({
      absoluteTargetRoot,
      effectiveStateMode,
      dbBackedMode,
      dispatch,
      loopState,
      arbitrationSuggestions,
      executeRequested: execute,
    });
  }

  const resumeState = deriveCoordinatorResumeState({
    loopState,
    dispatch,
  });

  if (!execute) {
    return buildCoordinatorResumeResult({
      absoluteTargetRoot,
      effectiveStateMode,
      dbBackedMode,
      loopState,
      dispatch,
      resumeState,
      executeRequested: false,
    });
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
    sharedCoordination,
    sharedCoordinationOptions,
  });

  return buildCoordinatorResumeResult({
    absoluteTargetRoot,
    effectiveStateMode,
    dbBackedMode,
    loopState,
    dispatch,
    resumeState,
    executeRequested: true,
    execution,
  });
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
    result.resume_diagnostic = deriveCoordinatorResumeDiagnostic(result);
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

export async function resumeCoordinatorDispatch(options = {}) {
  const result = await runCoordinatorResumeDispatch(options);
  return {
    ...result,
    resume_diagnostic: deriveCoordinatorResumeDiagnostic(result),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
