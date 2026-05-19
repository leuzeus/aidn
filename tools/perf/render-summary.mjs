#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildCampaignSummaryMarkdown, mergeCampaignRuns } from "../../src/application/observability/campaign-summary-use-case.mjs";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    kpiFile: ".aidn/runtime/perf/kpi-report.json",
    historyFile: ".aidn/runtime/perf/kpi-history.ndjson",
    thresholdsFile: ".aidn/runtime/perf/kpi-thresholds.json",
    regressionFile: ".aidn/runtime/perf/kpi-regression.json",
    fallbackReportFile: ".aidn/runtime/perf/fallback-report.json",
    fallbackThresholdsFile: ".aidn/runtime/perf/fallback-thresholds.json",
    out: ".aidn/runtime/perf/kpi-summary.md",
    maxRuns: 10,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--kpi-file") {
      args.kpiFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--history-file") {
      args.historyFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--thresholds-file") {
      args.thresholdsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--regression-file") {
      args.regressionFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--fallback-report-file") {
      args.fallbackReportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--fallback-thresholds-file") {
      args.fallbackThresholdsFile = argv[i + 1] ?? "";
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

function readNdjsonOptional(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return { absolute, data: [], exists: false };
  }
  const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    try {
      out.push(JSON.parse(lines[i]));
    } catch (error) {
      throw new Error(`Invalid NDJSON at ${absolute} line ${i + 1}: ${error.message}`);
    }
  }
  return { absolute, data: out, exists: true };
}

function writeFile(filePath, content) {
  return writeUtf8IfChanged(filePath, content);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const kpi = readJsonOptional(args.kpiFile, "KPI report");
    const history = readNdjsonOptional(args.historyFile);
    const thresholds = readJsonOptional(args.thresholdsFile, null);
    const regression = readJsonOptional(args.regressionFile, null);
    const fallbackReport = readJsonOptional(args.fallbackReportFile, null);
    const fallbackThresholds = readJsonOptional(args.fallbackThresholdsFile, null);
    const currentRuns = Array.isArray(kpi.data?.runs) ? kpi.data.runs : [];
    const mergedRuns = mergeCampaignRuns(currentRuns, history.data);
    const markdown = buildCampaignSummaryMarkdown(
      kpi.data,
      mergedRuns,
      thresholds.data,
      regression.data,
      fallbackReport.data,
      fallbackThresholds.data,
      args.maxRuns,
    );
    const outWrite = writeFile(args.out, markdown);
    console.log(`Summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
