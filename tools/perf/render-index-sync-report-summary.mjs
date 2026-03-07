#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    reportFile: ".aidn/runtime/index/index-sync-report.json",
    thresholdsFile: ".aidn/runtime/index/index-sync-thresholds.json",
    out: ".aidn/runtime/index/index-sync-report-summary.md",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--report-file") {
      args.reportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--thresholds-file") {
      args.thresholdsFile = argv[i + 1] ?? "";
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

  if (!args.reportFile) {
    throw new Error("Missing value for --report-file");
  }
  if (!args.out) {
    throw new Error("Missing value for --out");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/render-index-sync-report-summary.mjs");
  console.log("  node tools/perf/render-index-sync-report-summary.mjs --report-file .aidn/runtime/index/index-sync-report.json --out .aidn/runtime/index/index-sync-report-summary.md");
}

function readJson(filePath, label, required = true) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    if (!required) {
      return { absolute, data: null, exists: false };
    }
    throw new Error(`${label} not found: ${absolute}`);
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")), exists: true };
  } catch (error) {
    throw new Error(`${label} invalid JSON: ${error.message}`);
  }
}

function fmt(value, digits = 3) {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return Number(value).toFixed(digits);
}

function buildMarkdown(report, thresholds) {
  const summary = report?.summary ?? {};
  const thresholdStatus = thresholds?.summary?.overall_status ?? "not-generated";
  const checks = Array.isArray(thresholds?.checks) ? thresholds.checks : [];
  const topKeys = Array.isArray(summary.top_mismatch_keys) ? summary.top_mismatch_keys : [];
  const topReasonCodes = Array.isArray(summary.top_reason_codes) ? summary.top_reason_codes : [];

  const lines = [];
  lines.push("## Index Sync Trend");
  lines.push("");
  lines.push(`- Runs analyzed: ${summary.runs_analyzed ?? 0}`);
  lines.push(`- In-sync runs: ${summary.in_sync_runs ?? 0}`);
  lines.push(`- Drift runs: ${summary.drift_runs ?? 0}`);
  lines.push(`- Applied runs: ${summary.applied_runs ?? 0}`);
  lines.push(`- High-drift runs: ${summary.high_drift_runs ?? 0}`);
  lines.push(`- In-sync rate: ${fmt(summary.in_sync_rate)}`);
  lines.push(`- Avg mismatch count: ${fmt(summary.avg_mismatch_count, 2)}`);
  lines.push(`- Threshold status: ${thresholdStatus}`);
  lines.push("");

  if (topReasonCodes.length > 0) {
    lines.push("### Top Reason Codes");
    lines.push("");
    lines.push("| code | count |");
    lines.push("|---|---:|");
    for (const row of topReasonCodes) {
      lines.push(`| ${row.code ?? "n/a"} | ${row.count ?? 0} |`);
    }
    lines.push("");
  }

  if (topKeys.length > 0) {
    lines.push("### Top Mismatch Keys");
    lines.push("");
    lines.push("| key | count |");
    lines.push("|---|---:|");
    for (const row of topKeys) {
      lines.push(`| ${row.key ?? "n/a"} | ${row.count ?? 0} |`);
    }
    lines.push("");
  }

  if (checks.length > 0) {
    lines.push("### Sync Threshold Checks");
    lines.push("");
    lines.push("| id | status | severity | actual | op | expected |");
    lines.push("|---|---|---|---:|---|---:|");
    for (const check of checks) {
      lines.push(`| ${check.id ?? "n/a"} | ${check.status ?? "n/a"} | ${check.severity ?? "n/a"} | ${check.actual ?? "n/a"} | ${check.op ?? "n/a"} | ${check.expected ?? "n/a"} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = readJson(args.reportFile, "Index sync report", true);
    const thresholds = readJson(args.thresholdsFile, "Index sync thresholds", false);
    const markdown = buildMarkdown(report.data, thresholds.data);
    const outWrite = writeUtf8IfChanged(args.out, markdown);
    console.log(`Index sync trend summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
