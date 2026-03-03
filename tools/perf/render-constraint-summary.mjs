#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeUtf8IfChanged } from "./io-lib.mjs";

function parseArgs(argv) {
  const args = {
    reportFile: ".aidn/runtime/perf/constraint-report.json",
    out: ".aidn/runtime/perf/constraint-summary.md",
    top: 5,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--report-file") {
      args.reportFile = argv[i + 1] ?? "";
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

function buildMarkdown(report, topLimit) {
  const summary = report?.summary ?? {};
  const active = summary?.active_constraint ?? null;
  const skills = Array.isArray(report?.skills) ? report.skills.slice(0, topLimit) : [];
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
  lines.push("");
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
  return `${lines.join("\n")}\n`;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = readJson(args.reportFile);
    const content = buildMarkdown(report, args.top);
    const outWrite = writeUtf8IfChanged(args.out, content);
    console.log(`Summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
