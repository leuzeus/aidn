#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";

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

function resolveTargetPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function runToolJson(scriptName, scriptArgs) {
  const stdout = execFileSync(process.execPath, [path.join(PERF_DIR, scriptName), ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function runToolNoJson(scriptName, scriptArgs) {
  execFileSync(process.execPath, [path.join(PERF_DIR, scriptName), ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function main() {
  const started = Date.now();
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const eventFile = resolveTargetPath(targetRoot, args.eventFile);
    const reportFile = resolveTargetPath(targetRoot, args.reportFile);
    const thresholdsFile = resolveTargetPath(targetRoot, args.thresholdsFile);
    const actionsFile = resolveTargetPath(targetRoot, args.actionsFile);
    const historyFile = resolveTargetPath(targetRoot, args.historyFile);
    const trendFile = resolveTargetPath(targetRoot, args.trendFile);
    const trendThresholdsFile = resolveTargetPath(targetRoot, args.trendThresholdsFile);
    const trendSummaryFile = resolveTargetPath(targetRoot, args.trendSummaryFile);
    const lotPlanFile = resolveTargetPath(targetRoot, args.lotPlanFile);
    const lotAdvanceFile = resolveTargetPath(targetRoot, args.lotAdvanceFile);
    const lotSummaryFile = resolveTargetPath(targetRoot, args.lotSummaryFile);
    const summaryFile = resolveTargetPath(targetRoot, args.summaryFile);

    const report = runToolJson("report-constraints.mjs", [
      "--file",
      eventFile,
      "--run-prefix",
      args.runPrefix,
      "--out",
      reportFile,
      "--json",
    ]);
    const thresholds = runToolJson("check-thresholds-defaults.mjs", [
      "--preset",
      "constraint",
      "--target",
      targetRoot,
      "--kpi-file",
      reportFile,
      "--out",
      thresholdsFile,
      ...(args.strict ? ["--strict"] : []),
      "--json",
    ]);
    const actions = runToolJson("report-constraint-actions.mjs", [
      "--report-file",
      reportFile,
      "--thresholds-file",
      thresholdsFile,
      "--out",
      actionsFile,
      "--json",
    ]);
    runToolJson("sync-constraint-history.mjs", [
      "--report-file",
      reportFile,
      "--actions-file",
      actionsFile,
      "--history-file",
      historyFile,
      "--max-runs",
      String(args.maxRuns),
      "--json",
    ]);
    const trend = runToolJson("report-constraint-trend.mjs", [
      "--history-file",
      historyFile,
      "--out",
      trendFile,
      "--json",
    ]);
    const trendThresholds = runToolJson("check-thresholds-defaults.mjs", [
      "--preset",
      "constraint-trend",
      "--target",
      targetRoot,
      "--kpi-file",
      trendFile,
      "--out",
      trendThresholdsFile,
      ...(args.strict ? ["--strict"] : []),
      "--json",
    ]);
    const lotPlan = runToolJson("report-constraint-lot-plan.mjs", [
      "--actions-file",
      actionsFile,
      "--trend-file",
      trendFile,
      "--out",
      lotPlanFile,
      "--max-lot-size",
      String(args.maxLotSize),
      "--lot-prefix",
      args.lotPrefix,
      "--json",
    ]);
    const lotAdvance = runToolJson("advance-constraint-lot-plan.mjs", [
      "--plan-file",
      lotPlanFile,
      "--json",
    ]);
    const lotAdvanceWrite = writeJsonIfChanged(lotAdvanceFile, lotAdvance);

    runToolNoJson("render-constraint-trend-summary.mjs", [
      "--report-file",
      trendFile,
      "--thresholds-file",
      trendThresholdsFile,
      "--out",
      trendSummaryFile,
    ]);
    runToolNoJson("render-constraint-lot-plan-summary.mjs", [
      "--plan-file",
      lotPlanFile,
      "--advance-file",
      lotAdvanceFile,
      "--out",
      lotSummaryFile,
    ]);
    runToolNoJson("render-constraint-summary.mjs", [
      "--report-file",
      reportFile,
      "--thresholds-file",
      thresholdsFile,
      "--actions-file",
      actionsFile,
      "--out",
      summaryFile,
    ]);

    const output = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      strict: args.strict,
      event_file: eventFile,
      run_prefix: args.runPrefix,
      artifacts: {
        report_file: reportFile,
        thresholds_file: thresholdsFile,
        actions_file: actionsFile,
        history_file: historyFile,
        trend_file: trendFile,
        trend_thresholds_file: trendThresholdsFile,
        trend_summary_file: trendSummaryFile,
        lot_plan_file: lotPlanFile,
        lot_advance_file: lotAdvanceWrite.path,
        lot_advance_written: lotAdvanceWrite.written,
        lot_summary_file: lotSummaryFile,
        summary_file: summaryFile,
      },
      summary: {
        constraint_status: thresholds?.summary?.overall_status ?? null,
        trend_status: trendThresholds?.summary?.overall_status ?? null,
        active_constraint_skill: report?.summary?.active_constraint?.skill ?? null,
        actions_generated: actions?.summary?.generated_actions ?? null,
        lots_total: lotPlan?.summary?.lots_total ?? null,
        next_lot_id: lotPlan?.summary?.next_lot_id ?? null,
      },
      duration_ms: Date.now() - started,
    };

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
