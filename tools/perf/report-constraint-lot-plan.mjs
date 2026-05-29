#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildConstraintLotPlan } from "../../src/application/observability/constraint-lot-plan-report-use-case.mjs";
import { writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    actionsFile: ".aidn/runtime/perf/constraint-actions.json",
    trendFile: "",
    out: ".aidn/runtime/perf/constraint-lot-plan.json",
    maxLotSize: 3,
    lotPrefix: "L4",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--actions-file") {
      args.actionsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--trend-file") {
      args.trendFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--max-lot-size") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--max-lot-size must be an integer");
      }
      args.maxLotSize = Number(raw);
    } else if (token === "--lot-prefix") {
      args.lotPrefix = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.actionsFile) {
    throw new Error("Missing value for --actions-file");
  }
  if (!args.out) {
    throw new Error("Missing value for --out");
  }
  if (!args.lotPrefix) {
    throw new Error("Missing value for --lot-prefix");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/report-constraint-lot-plan.mjs");
  console.log("  node tools/perf/report-constraint-lot-plan.mjs --actions-file .aidn/runtime/perf/constraint-actions.json --out .aidn/runtime/perf/constraint-lot-plan.json");
  console.log("  node tools/perf/report-constraint-lot-plan.mjs --trend-file .aidn/runtime/perf/constraint-trend.json --max-lot-size 3 --json");
}

function readJson(filePath, label) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`${label} not found: ${absolute}`);
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
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
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch {
    return null;
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const actions = readJson(args.actionsFile, "Constraint actions");
    const trend = readJsonOptional(args.trendFile);
    const actionList = Array.isArray(actions?.data?.actions) ? actions.data.actions : [];
    const plan = buildConstraintLotPlan(actionList, trend?.data ?? null, args.maxLotSize, args.lotPrefix);
    const payload = {
      ts: new Date().toISOString(),
      source_actions_file: actions.absolute,
      source_trend_file: trend?.absolute ?? null,
      config: {
        max_lot_size: args.maxLotSize,
        lot_prefix: args.lotPrefix,
      },
      summary: plan.summary,
      lots: plan.lots,
    };
    const outWrite = writeJsonIfChanged(args.out, payload);
    payload.output_file = outWrite.path;
    payload.output_written = outWrite.written;

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`Lots generated: ${payload.summary.lots_total}`);
    console.log(`Actions total: ${payload.summary.actions_total}`);
    console.log(`Next lot: ${payload.summary.next_lot_id ?? "n/a"}`);
    console.log(`Output file: ${payload.output_file} (${payload.output_written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
