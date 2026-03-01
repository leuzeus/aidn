#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    kpiFile: ".aidn/runtime/perf/kpi-report.json",
    thresholdsFile: ".aidn/runtime/perf/kpi-thresholds.json",
    out: ".aidn/runtime/perf/kpi-summary.md",
    maxRuns: 10,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--kpi-file") {
      args.kpiFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--thresholds-file") {
      args.thresholdsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--max-runs") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--max-runs must be an integer");
      }
      args.maxRuns = Number(raw);
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.kpiFile) {
    throw new Error("Missing value for --kpi-file");
  }
  if (!args.out) {
    throw new Error("Missing value for --out");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/render-summary.mjs");
  console.log("  node tools/perf/render-summary.mjs --kpi-file .aidn/runtime/perf/kpi-report.json --out .aidn/runtime/perf/kpi-summary.md");
}

function readJsonOptional(filePath, requiredLabel) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    if (requiredLabel) {
      throw new Error(`${requiredLabel} not found: ${absolute}`);
    }
    return { absolute, data: null, exists: false };
  }
  try {
    const data = JSON.parse(fs.readFileSync(absolute, "utf8"));
    return { absolute, data, exists: true };
  } catch (error) {
    throw new Error(`Invalid JSON at ${absolute}: ${error.message}`);
  }
}

function fmt(value, digits = 3) {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return Number(value).toFixed(digits);
}

function buildMarkdown(kpi, thresholds, maxRuns) {
  const summary = kpi.summary ?? {};
  const overhead = summary.overhead_ratio ?? {};
  const churn = summary.artifacts_churn ?? {};
  const gates = summary.gates_frequency ?? {};
  const thresholdStatus = thresholds?.summary?.overall_status ?? "not-generated";
  const checks = Array.isArray(thresholds?.checks) ? thresholds.checks : [];

  const lines = [];
  lines.push("## Perf KPI Summary");
  lines.push("");
  lines.push(`- Runs analyzed: ${summary.runs_analyzed ?? 0}`);
  lines.push(`- Overhead ratio (mean/median/p90): ${fmt(overhead.mean)} / ${fmt(overhead.median)} / ${fmt(overhead.p90)}`);
  lines.push(`- Artifacts churn (mean/median/p90): ${fmt(churn.mean, 2)} / ${fmt(churn.median, 2)} / ${fmt(churn.p90, 2)}`);
  lines.push(`- Gates frequency (mean/median/p90): ${fmt(gates.mean, 2)} / ${fmt(gates.median, 2)} / ${fmt(gates.p90, 2)}`);
  lines.push(`- Threshold status: ${thresholdStatus}`);
  lines.push("");

  if (checks.length > 0) {
    lines.push("### Threshold Checks");
    lines.push("");
    lines.push("| id | status | severity | actual | op | expected |");
    lines.push("|---|---|---|---:|---|---:|");
    for (const check of checks) {
      lines.push(`| ${check.id ?? "n/a"} | ${check.status ?? "n/a"} | ${check.severity ?? "n/a"} | ${check.actual ?? "n/a"} | ${check.op ?? "n/a"} | ${check.expected ?? "n/a"} |`);
    }
    lines.push("");
  }

  const runs = Array.isArray(kpi.runs) ? kpi.runs.slice(0, maxRuns) : [];
  if (runs.length > 0) {
    lines.push("### Top Runs");
    lines.push("");
    lines.push("| run_id | overhead_ratio | artifacts_churn | gates_frequency | events |");
    lines.push("|---|---:|---:|---:|---:|");
    for (const run of runs) {
      lines.push(`| ${run.run_id ?? "n/a"} | ${fmt(run.overhead_ratio)} | ${run.artifacts_churn ?? "n/a"} | ${run.gates_frequency ?? "n/a"} | ${run.events_count ?? "n/a"} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function writeFile(filePath, content) {
  const absolute = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
  return absolute;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const kpi = readJsonOptional(args.kpiFile, "KPI report");
    const thresholds = readJsonOptional(args.thresholdsFile, null);
    const markdown = buildMarkdown(kpi.data, thresholds.data, args.maxRuns);
    const outPath = writeFile(args.out, markdown);
    console.log(`Summary written: ${outPath}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
