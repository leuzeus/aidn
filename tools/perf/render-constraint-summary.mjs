#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeUtf8IfChanged } from "./io-lib.mjs";

function parseArgs(argv) {
  const args = {
    reportFile: ".aidn/runtime/perf/constraint-report.json",
    thresholdsFile: "",
    actionsFile: "",
    out: ".aidn/runtime/perf/constraint-summary.md",
    top: 5,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--report-file") {
      args.reportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--thresholds-file") {
      args.thresholdsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--actions-file") {
      args.actionsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--top") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--top must be an integer");
      }
      args.top = Number(raw);
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
  console.log("  node tools/perf/render-constraint-summary.mjs");
  console.log("  node tools/perf/render-constraint-summary.mjs --report-file .aidn/runtime/perf/constraint-report.json --out .aidn/runtime/perf/constraint-summary.md");
}

function readJson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Constraint report not found: ${absolute}`);
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON at ${absolute}: ${error.message}`);
  }
}

function fmtPct(value) {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function readJsonOptional(filePath) {
  if (!filePath) {
    return null;
  }
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch {
    return null;
  }
}

function buildMarkdown(report, thresholds, actionsReport, topLimit) {
  const summary = report?.summary ?? {};
  const active = summary?.active_constraint ?? null;
  const skills = Array.isArray(report?.skills) ? report.skills.slice(0, topLimit) : [];
  const thresholdSummary = thresholds?.summary ?? null;
  const thresholdChecks = Array.isArray(thresholds?.checks) ? thresholds.checks : [];
  const actionsSummary = actionsReport?.summary ?? null;
  const actions = Array.isArray(actionsReport?.actions) ? actionsReport.actions.slice(0, topLimit) : [];
  const lines = [];
  lines.push("## Constraint Summary");
  lines.push("");
  lines.push(`- Events analyzed: ${summary?.events_analyzed ?? 0}`);
  lines.push(`- Runs analyzed: ${summary?.runs_analyzed ?? 0}`);
  lines.push(`- Control share of total duration: ${fmtPct(summary?.control_share_of_total)}`);
  if (active != null) {
    lines.push(`- Active constraint: ${active.skill ?? "n/a"} (${active.signal ?? "n/a"}, share=${fmtPct(active.share)}, severity=${active.severity ?? "n/a"})`);
    lines.push(`- Recommendation: ${active.recommendation ?? "n/a"}`);
  } else {
    lines.push("- Active constraint: n/a");
  }
  if (thresholdSummary != null) {
    lines.push(`- Threshold status: ${thresholdSummary.overall_status ?? "n/a"} (${thresholdSummary.pass ?? 0} pass, ${thresholdSummary.fail ?? 0} fail, ${thresholdSummary.blocking ?? 0} blocking)`);
  }
  lines.push("");
  if (thresholdChecks.length > 0) {
    lines.push("### Constraint Checks");
    lines.push("");
    lines.push("| id | status | severity | actual | op | expected |");
    lines.push("|---|---|---|---:|---|---:|");
    for (const check of thresholdChecks) {
      lines.push(`| ${check.id ?? "n/a"} | ${check.status ?? "n/a"} | ${check.severity ?? "n/a"} | ${check.actual ?? "n/a"} | ${check.op ?? "n/a"} | ${check.expected ?? "n/a"} |`);
    }
    lines.push("");
  }
  if (skills.length > 0) {
    lines.push("### Top Skills");
    lines.push("");
    lines.push("| skill | duration_ms | control_duration_ms | control_share | events | fallbacks |");
    lines.push("|---|---:|---:|---:|---:|---:|");
    for (const skill of skills) {
      lines.push(`| ${skill.skill ?? "n/a"} | ${skill.duration_ms ?? 0} | ${skill.control_duration_ms ?? 0} | ${fmtPct(skill.control_share_of_control)} | ${skill.events ?? 0} | ${skill.fallback_events ?? 0} |`);
    }
    lines.push("");
  }
  if (actionsSummary != null) {
    lines.push("### Action Backlog");
    lines.push("");
    lines.push(`- Actions generated: ${actionsSummary.generated_actions ?? 0}`);
    lines.push(`- Quick wins/foundational/deep-change: ${actionsSummary.quick_wins ?? 0}/${actionsSummary.foundational ?? 0}/${actionsSummary.deep_change ?? 0}`);
    lines.push("");
  }
  if (actions.length > 0) {
    lines.push("| action_id | skill | batch | priority | impact | effort |");
    lines.push("|---|---|---|---:|---:|---:|");
    for (const action of actions) {
      lines.push(`| ${action.action_id ?? "n/a"} | ${action.skill ?? "n/a"} | ${action.batch ?? "n/a"} | ${action.priority_score ?? "n/a"} | ${action.impact_score ?? "n/a"} | ${action.effort ?? "n/a"} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = readJson(args.reportFile);
    const thresholds = readJsonOptional(args.thresholdsFile);
    const actions = readJsonOptional(args.actionsFile);
    const content = buildMarkdown(report, thresholds, actions, args.top);
    const outWrite = writeUtf8IfChanged(args.out, content);
    console.log(`Summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
