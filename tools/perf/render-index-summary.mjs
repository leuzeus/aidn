#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildIndexSummaryMarkdown } from "../../src/application/observability/index-summary-use-case.mjs";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    reportFile: ".aidn/runtime/index/index-report.json",
    thresholdsFile: ".aidn/runtime/index/index-thresholds.json",
    regressionFile: "",
    canonicalCheckFile: "",
    out: ".aidn/runtime/index/index-summary.md",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--report-file") {
      args.reportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--thresholds-file") {
      args.thresholdsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--regression-file") {
      args.regressionFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--canonical-check-file") {
      args.canonicalCheckFile = argv[i + 1] ?? "";
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
  console.log("  node tools/perf/render-index-summary.mjs");
  console.log("  node tools/perf/render-index-summary.mjs --report-file .aidn/runtime/index/index-report.json --out .aidn/runtime/index/index-summary.md");
  console.log("  node tools/perf/render-index-summary.mjs --report-file .aidn/runtime/index/index-report.json --thresholds-file .aidn/runtime/index/index-thresholds.json --regression-file .aidn/runtime/index/index-regression.json --canonical-check-file .aidn/runtime/index/index-canonical-check.json --out .aidn/runtime/index/index-summary.md");
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

function writeFile(filePath, content) {
  return writeUtf8IfChanged(filePath, content);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = readJson(args.reportFile, "Index report", true);
    const thresholds = readJson(args.thresholdsFile, "Index thresholds", false);
    const regression = args.regressionFile
      ? readJson(args.regressionFile, "Index regression", false)
      : { absolute: null, data: null, exists: false };
    const canonicalCheck = args.canonicalCheckFile
      ? readJson(args.canonicalCheckFile, "Index canonical check", false)
      : { absolute: null, data: null, exists: false };
    const markdown = buildIndexSummaryMarkdown(report.data, thresholds.data, regression.data, canonicalCheck.data);
    const outWrite = writeFile(args.out, markdown);
    console.log(`Index summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
