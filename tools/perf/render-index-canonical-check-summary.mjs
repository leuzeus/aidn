#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildIndexCanonicalCheckSummaryMarkdown } from "../../src/application/observability/index-canonical-check-summary-use-case.mjs";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    checkFile: ".aidn/runtime/index/index-canonical-check.json",
    out: ".aidn/runtime/index/index-canonical-check-summary.md",
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
  console.log("  node tools/perf/render-index-canonical-check-summary.mjs");
  console.log("  node tools/perf/render-index-canonical-check-summary.mjs --check-file .aidn/runtime/index/index-canonical-check.json --out .aidn/runtime/index/index-canonical-check-summary.md");
}

function readJson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Canonical check file not found: ${absolute}`);
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    throw new Error(`Canonical check file invalid JSON: ${error.message}`);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { data } = readJson(args.checkFile);
    const markdown = buildIndexCanonicalCheckSummaryMarkdown(data);
    const outWrite = writeUtf8IfChanged(args.out, markdown);
    console.log(`Index canonical summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
