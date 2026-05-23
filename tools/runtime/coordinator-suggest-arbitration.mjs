#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildCoordinatorArbitrationResult,
  selectCoordinatorArbitrationSuggestionBundle,
} from "../../src/application/runtime/coordinator-suggest-arbitration-use-case.mjs";
import { resolveDbBackedMode } from "./db-first-runtime-view-lib.mjs";
import { computeCoordinatorDispatchPlan } from "./coordinator-dispatch-plan.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    agent: "auto",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: "docs/audit/RUNTIME-STATE.md",
    packetFile: "docs/audit/HANDOFF-PACKET.md",
    agentRosterFile: "docs/audit/AGENT-ROSTER.md",
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/coordinator-suggest-arbitration.mjs --target .");
  console.log("  node tools/runtime/coordinator-suggest-arbitration.mjs --target . --json");
}

export async function suggestCoordinatorArbitration({
  targetRoot,
  agent = "auto",
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  packetFile = "docs/audit/HANDOFF-PACKET.md",
  agentRosterFile = "docs/audit/AGENT-ROSTER.md",
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const { effectiveStateMode, dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
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

  const suggestionBundle = selectCoordinatorArbitrationSuggestionBundle(dispatch, absoluteTargetRoot);
  return buildCoordinatorArbitrationResult({
    absoluteTargetRoot,
    effectiveStateMode,
    dbBackedMode,
    dispatch,
    suggestionBundle,
  });
}

function renderText(result) {
  const lines = [];
  lines.push("Coordinator arbitration suggestions:");
  lines.push(`- dispatch_status=${result.dispatch_status}`);
  lines.push(`- arbitration_required=${result.arbitration_required ? "yes" : "no"}`);
  lines.push(`- preferred_decision=${result.preferred_decision}`);
  lines.push(`- arbitration_reason=${result.arbitration_reason}`);
  lines.push("- suggestions:");
  for (const suggestion of result.suggestions) {
    lines.push(`  - ${suggestion.decision} recommended=${suggestion.recommended ? "yes" : "no"} actionable=${suggestion.immediately_actionable ? "yes" : "no"}`);
    lines.push(`    rationale=${suggestion.rationale}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await suggestCoordinatorArbitration({
      targetRoot: args.target,
      agent: args.agent,
      currentStateFile: args.currentStateFile,
      runtimeStateFile: args.runtimeStateFile,
      packetFile: args.packetFile,
      agentRosterFile: args.agentRosterFile,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      process.stdout.write(renderText(result));
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
