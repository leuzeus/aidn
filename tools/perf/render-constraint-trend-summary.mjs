#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeUtf8IfChanged } from "./io-lib.mjs";

function parseArgs(argv) {
  const args = {
    reportFile: ".aidn/runtime/perf/constraint-trend.json",
    out: ".aidn/runtime/perf/constraint-trend-summary.md",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--report-file") {
      args.reportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.reportFile || !args.out) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/render-constraint-trend-summary.mjs");
  console.log("  node tools/perf/render-constraint-trend-summary.mjs --report-file .aidn/runtime/perf/constraint-trend.json --out .aidn/runtime/perf/constraint-trend-summary.md");
}

function readJson(filePath, label) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`${label} not found: ${absolute}`);
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`${label} invalid JSON: ${error.message}`);
  }
}

function fmtPct(value) {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function buildMarkdown(report) {
  const summary = report?.summary ?? {};
  const topConstraints = Array.isArray(summary?.top_constraints) ? summary.top_constraints : [];
  const topActions = Array.isArray(summary?.top_actions) ? summary.top_actions : [];

  const lines = [];
  lines.push("## Constraint Trend");
  lines.push("");
  lines.push(`- Runs analyzed: ${summary?.runs_analyzed ?? 0}`);
  lines.push(`- Dominant constraint: ${summary?.dominant_constraint_skill ?? "n/a"} (${fmtPct(summary?.dominant_constraint_share)})`);
  lines.push(`- Constraint stability rate: ${fmtPct(summary?.constraint_stability_rate)}`);
  lines.push(`- Constraint switches: ${summary?.constraint_switches ?? 0}`);
  lines.push(`- Avg control share of total: ${fmtPct(summary?.avg_control_share_of_total)}`);
  lines.push(`- Avg active constraint share: ${fmtPct(summary?.avg_active_constraint_share)}`);
  lines.push(`- High severity runs: ${summary?.high_severity_runs ?? 0}`);
  lines.push(`- Quick-win top-action runs: ${summary?.quick_win_top_runs ?? 0}`);
  lines.push("");

  if (topConstraints.length > 0) {
    lines.push("### Top Constraints");
    lines.push("");
    lines.push("| skill | count |");
    lines.push("|---|---:|");
    for (const row of topConstraints) {
      lines.push(`| ${row.skill ?? "n/a"} | ${row.count ?? 0} |`);
    }
    lines.push("");
  }

  if (topActions.length > 0) {
    lines.push("### Top Actions");
    lines.push("");
    lines.push("| action_id | count |");
    lines.push("|---|---:|");
    for (const row of topActions) {
      lines.push(`| ${row.action_id ?? "n/a"} | ${row.count ?? 0} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = readJson(args.reportFile, "Constraint trend report");
    const markdown = buildMarkdown(report);
    const outWrite = writeUtf8IfChanged(args.out, markdown);
    console.log(`Constraint trend summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
