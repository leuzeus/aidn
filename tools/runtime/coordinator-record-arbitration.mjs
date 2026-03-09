#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendRuntimeNdjsonEvent } from "../../src/application/runtime/runtime-path-service.mjs";
import { projectCoordinationSummary } from "./project-coordination-summary.mjs";

const ALLOWED_DECISIONS = new Set(["continue", "reanchor", "repair", "audit"]);

function parseArgs(argv) {
  const args = {
    target: ".",
    decision: "",
    note: "",
    goal: "",
    arbitrationFile: "docs/audit/USER-ARBITRATION.md",
    coordinationHistoryFile: ".aidn/runtime/context/coordination-history.ndjson",
    coordinationSummaryFile: "docs/audit/COORDINATION-SUMMARY.md",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--target") {
      args.target = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--decision") {
      args.decision = String(argv[index + 1] ?? "").trim().toLowerCase();
      index += 1;
    } else if (token === "--note") {
      args.note = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--goal") {
      args.goal = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--arbitration-file") {
      args.arbitrationFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--coordination-history-file") {
      args.coordinationHistoryFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--coordination-summary-file") {
      args.coordinationSummaryFile = String(argv[index + 1] ?? "").trim();
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
  if (!ALLOWED_DECISIONS.has(args.decision)) {
    throw new Error(`Invalid or missing --decision. Allowed: ${Array.from(ALLOWED_DECISIONS).join(", ")}`);
  }
  if (!args.note) {
    throw new Error("Missing value for --note");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/coordinator-record-arbitration.mjs --target . --decision continue --note \"validated by user\"");
  console.log("  node tools/runtime/coordinator-record-arbitration.mjs --target . --decision repair --note \"repair first\" --goal \"triage mismatch\" --json");
}

function resolveTargetPath(targetRoot, candidate) {
  if (!candidate) {
    return "";
  }
  if (path.isAbsolute(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(targetRoot, candidate);
}

function appendArbitrationLog(logPath, entry) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, "# User Arbitration Log\n\n", "utf8");
  }
  const current = fs.readFileSync(logPath, "utf8");
  const next = current.endsWith("\n\n") || current.length === 0
    ? `${current}${entry}`
    : `${current}\n${entry}`;
  fs.writeFileSync(logPath, next, "utf8");
}

function buildArbitrationEvent({ decision, note, goal }) {
  return {
    ts: new Date().toISOString(),
    event: "user_arbitration",
    decision,
    note,
    goal: goal || "",
    resolved: true,
  };
}

function buildArbitrationLogEntry(event) {
  const lines = [];
  lines.push(`## Arbitration ${event.ts}`);
  lines.push("");
  lines.push(`timestamp: ${event.ts}`);
  lines.push(`decision: ${event.decision}`);
  lines.push(`note: ${event.note}`);
  lines.push(`goal_override: ${event.goal || "none"}`);
  lines.push(`resolved: ${event.resolved ? "yes" : "no"}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function recordCoordinatorArbitration({
  targetRoot,
  decision,
  note,
  goal = "",
  arbitrationFile = "docs/audit/USER-ARBITRATION.md",
  coordinationHistoryFile = ".aidn/runtime/context/coordination-history.ndjson",
  coordinationSummaryFile = "docs/audit/COORDINATION-SUMMARY.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const arbitrationPath = resolveTargetPath(absoluteTargetRoot, arbitrationFile);
  const historyPath = resolveTargetPath(absoluteTargetRoot, coordinationHistoryFile);
  const summaryPath = resolveTargetPath(absoluteTargetRoot, coordinationSummaryFile);
  const event = buildArbitrationEvent({ decision, note, goal });
  appendArbitrationLog(arbitrationPath, buildArbitrationLogEntry(event));
  appendRuntimeNdjsonEvent(historyPath, event);
  const summary = projectCoordinationSummary({
    targetRoot: absoluteTargetRoot,
    historyFile: coordinationHistoryFile,
    out: coordinationSummaryFile,
  });
  return {
    target_root: absoluteTargetRoot,
    arbitration_file: arbitrationPath,
    coordination_history_file: historyPath,
    coordination_summary_file: summaryPath,
    arbitration_log_appended: true,
    coordination_history_appended: true,
    coordination_summary_written: Boolean(summary?.written),
    arbitration_event: event,
    coordination_summary: summary,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = recordCoordinatorArbitration({
      targetRoot: args.target,
      decision: args.decision,
      note: args.note,
      goal: args.goal,
      arbitrationFile: args.arbitrationFile,
      coordinationHistoryFile: args.coordinationHistoryFile,
      coordinationSummaryFile: args.coordinationSummaryFile,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Coordinator arbitration recorded:");
      console.log(`- decision=${result.arbitration_event.decision}`);
      console.log(`- arbitration_file=${result.arbitration_file}`);
      console.log(`- coordination_summary=${result.coordination_summary_file} (${result.coordination_summary_written ? "written" : "unchanged"})`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
