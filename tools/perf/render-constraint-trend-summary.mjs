#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildConstraintTrendSummaryMarkdown } from "../../src/application/observability/constraint-trend-summary-use-case.mjs";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    reportFile: ".aidn/runtime/perf/constraint-trend.json",
    thresholdsFile: "",
    out: ".aidn/runtime/perf/constraint-trend-summary.md",
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

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = readJson(args.reportFile, "Constraint trend report");
    const thresholds = readJsonOptional(args.thresholdsFile);
    const markdown = buildConstraintTrendSummaryMarkdown(report, thresholds);
    const outWrite = writeUtf8IfChanged(args.out, markdown);
    console.log(`Constraint trend summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
