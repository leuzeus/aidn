#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildRepairLayerTriageSummaryMarkdown } from "../../src/application/observability/repair-layer-triage-summary-use-case.mjs";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    triageFile: ".aidn/runtime/index/repair-layer-triage.json",
    out: ".aidn/runtime/index/repair-layer-triage-summary.md",
    top: 10,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--triage-file") {
      args.triageFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--out") {
      args.out = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--top") {
      const raw = String(argv[i + 1] ?? "").trim();
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
  if (!args.triageFile || !args.out) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/render-repair-layer-triage-summary.mjs");
  console.log("  node tools/perf/render-repair-layer-triage-summary.mjs --triage-file .aidn/runtime/index/repair-layer-triage.json --out .aidn/runtime/index/repair-layer-triage-summary.md");
}

function readJson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Triage file not found: ${absolute}`);
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON at ${absolute}: ${error.message}`);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const triage = readJson(args.triageFile);
    const content = buildRepairLayerTriageSummaryMarkdown(triage, args.top);
    const outWrite = writeUtf8IfChanged(args.out, content);
    console.log(`Repair triage summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
