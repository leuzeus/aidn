#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildConstraintLotPlanSummaryMarkdown } from "../../src/application/observability/constraint-lot-plan-summary-use-case.mjs";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    planFile: ".aidn/runtime/perf/constraint-lot-plan.json",
    advanceFile: "",
    out: ".aidn/runtime/perf/constraint-lot-plan-summary.md",
    topLots: 5,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--plan-file") {
      args.planFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--advance-file") {
      args.advanceFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--top-lots") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--top-lots must be an integer");
      }
      args.topLots = Number(raw);
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.planFile || !args.out) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/render-constraint-lot-plan-summary.mjs");
  console.log("  node tools/perf/render-constraint-lot-plan-summary.mjs --plan-file .aidn/runtime/perf/constraint-lot-plan.json --out .aidn/runtime/perf/constraint-lot-plan-summary.md");
  console.log("  node tools/perf/render-constraint-lot-plan-summary.mjs --advance-file .aidn/runtime/perf/constraint-lot-advance.json");
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

function readJsonOptional(filePath, label) {
  if (!filePath) {
    return null;
  }
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`${label} invalid JSON: ${error.message}`);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const plan = readJson(args.planFile, "Constraint lot plan");
    const advance = readJsonOptional(args.advanceFile, "Constraint lot advance");
    const markdown = buildConstraintLotPlanSummaryMarkdown(plan, advance, args.topLots);
    const outWrite = writeUtf8IfChanged(args.out, markdown);
    console.log(`Constraint lot plan summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
