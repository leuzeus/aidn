#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildIndexSyncReportSummaryMarkdown } from "../../src/application/observability/index-sync-report-summary-use-case.mjs";
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

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = readJson(args.reportFile, "Index sync report", true);
    const thresholds = readJson(args.thresholdsFile, "Index sync thresholds", false);
    const markdown = buildIndexSyncReportSummaryMarkdown(report.data, thresholds.data);
    const outWrite = writeUtf8IfChanged(args.out, markdown);
    console.log(`Index sync trend summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
