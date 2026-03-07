#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalProcessAdapter } from "../../src/adapters/runtime/local-process-adapter.mjs";
import { runConstraintLoopUseCase } from "../../src/application/runtime/constraint-loop-use-case.mjs";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    target: ".",
    eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
    runPrefix: "session-",
    reportFile: ".aidn/runtime/perf/constraint-report.json",
    thresholdsFile: ".aidn/runtime/perf/constraint-thresholds.json",
    actionsFile: ".aidn/runtime/perf/constraint-actions.json",
    historyFile: ".aidn/runtime/perf/constraint-history.ndjson",
    trendFile: ".aidn/runtime/perf/constraint-trend.json",
    trendThresholdsFile: ".aidn/runtime/perf/constraint-trend-thresholds.json",
    trendSummaryFile: ".aidn/runtime/perf/constraint-trend-summary.md",
    lotPlanFile: ".aidn/runtime/perf/constraint-lot-plan.json",
    lotAdvanceFile: ".aidn/runtime/perf/constraint-lot-advance.json",
    lotSummaryFile: ".aidn/runtime/perf/constraint-lot-plan-summary.md",
    summaryFile: ".aidn/runtime/perf/constraint-summary.md",
    maxRuns: 200,
    maxLotSize: 3,
    lotPrefix: "L4",
    strict: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--event-file") {
      args.eventFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--run-prefix") {
      args.runPrefix = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--report-file") {
      args.reportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--thresholds-file") {
      args.thresholdsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--actions-file") {
      args.actionsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--history-file") {
      args.historyFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--trend-file") {
      args.trendFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--trend-thresholds-file") {
      args.trendThresholdsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--trend-summary-file") {
      args.trendSummaryFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--lot-plan-file") {
      args.lotPlanFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--lot-advance-file") {
      args.lotAdvanceFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--lot-summary-file") {
      args.lotSummaryFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--summary-file") {
      args.summaryFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--max-runs") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--max-runs must be an integer");
      }
      args.maxRuns = Number(raw);
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
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target || !args.eventFile) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/constraint-loop.mjs --target .");
  console.log("  node tools/perf/constraint-loop.mjs --target . --event-file .aidn/runtime/perf/workflow-events.ndjson --json");
  console.log("  node tools/perf/constraint-loop.mjs --target . --strict");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const processAdapter = createLocalProcessAdapter();
    const output = runConstraintLoopUseCase({
      args,
      targetRoot,
      runtimeDir: PERF_DIR,
      processAdapter,
    });

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }
    console.log(`Constraint loop: OK (${output.duration_ms}ms)`);
    console.log(`Target: ${targetRoot}`);
    console.log(`Constraint status: ${output.summary.constraint_status ?? "n/a"}`);
    console.log(`Trend status: ${output.summary.trend_status ?? "n/a"}`);
    console.log(`Active constraint: ${output.summary.active_constraint_skill ?? "n/a"}`);
    console.log(`Actions generated: ${output.summary.actions_generated ?? "n/a"}`);
    console.log(`Lots total: ${output.summary.lots_total ?? "n/a"}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
