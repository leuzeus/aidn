#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildIndexSyncSummaryMarkdown } from "../../src/application/observability/index-sync-summary-use-case.mjs";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    checkFile: ".aidn/runtime/index/index-sync-check.json",
    out: ".aidn/runtime/index/index-sync-summary.md",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--check-file") {
      args.checkFile = argv[i + 1] ?? "";
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

  if (!args.checkFile) {
    throw new Error("Missing value for --check-file");
  }
  if (!args.out) {
    throw new Error("Missing value for --out");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/render-index-sync-summary.mjs");
  console.log("  node tools/perf/render-index-sync-summary.mjs --check-file .aidn/runtime/index/index-sync-check.json --out .aidn/runtime/index/index-sync-summary.md");
}

function readJson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Check file not found: ${absolute}`);
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    throw new Error(`Invalid JSON in ${absolute}: ${error.message}`);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const check = readJson(args.checkFile);
    const content = buildIndexSyncSummaryMarkdown(check.data);
    const outWrite = writeUtf8IfChanged(args.out, content);
    console.log(`Index sync summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
