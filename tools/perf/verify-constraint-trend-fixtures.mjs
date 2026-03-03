#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    fixtureFile: "tests/fixtures/perf-constraints/workflow-events.ndjson",
    reportFile: ".aidn/runtime/perf/fixtures/constraints/trend/constraint-report.json",
    thresholdsFile: ".aidn/runtime/perf/fixtures/constraints/trend/constraint-thresholds.json",
    actionsFile: ".aidn/runtime/perf/fixtures/constraints/trend/constraint-actions.json",
    historyFile: ".aidn/runtime/perf/fixtures/constraints/trend/constraint-history.ndjson",
    trendFile: ".aidn/runtime/perf/fixtures/constraints/trend/constraint-trend.json",
    summaryFile: ".aidn/runtime/perf/fixtures/constraints/trend/constraint-trend-summary.md",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--fixture-file") {
      args.fixtureFile = argv[i + 1] ?? "";
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
    } else if (token === "--summary-file") {
      args.summaryFile = argv[i + 1] ?? "";
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-constraint-trend-fixtures.mjs");
}

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const fixtureFile = path.resolve(process.cwd(), args.fixtureFile);
    const reportFile = path.resolve(process.cwd(), args.reportFile);
    const thresholdsFile = path.resolve(process.cwd(), args.thresholdsFile);
    const actionsFile = path.resolve(process.cwd(), args.actionsFile);
    const historyFile = path.resolve(process.cwd(), args.historyFile);
    const trendFile = path.resolve(process.cwd(), args.trendFile);
    const summaryFile = path.resolve(process.cwd(), args.summaryFile);
    const targetFile = path.resolve(process.cwd(), "docs/performance/CONSTRAINT_TARGETS.json");

    runJson("tools/perf/report-constraints.mjs", [
      "--file",
      fixtureFile,
      "--out",
      reportFile,
      "--json",
    ]);
    runJson("tools/perf/check-thresholds.mjs", [
      "--kpi-file",
      reportFile,
      "--targets",
      targetFile,
      "--out",
      thresholdsFile,
      "--json",
    ]);
    runJson("tools/perf/report-constraint-actions.mjs", [
      "--report-file",
      reportFile,
      "--thresholds-file",
      thresholdsFile,
      "--out",
      actionsFile,
      "--json",
    ]);
    const history = runJson("tools/perf/sync-constraint-history.mjs", [
      "--report-file",
      reportFile,
      "--actions-file",
      actionsFile,
      "--history-file",
      historyFile,
      "--json",
    ]);
    const trend = runJson("tools/perf/report-constraint-trend.mjs", [
      "--history-file",
      historyFile,
      "--out",
      trendFile,
      "--json",
    ]);
    execFileSync(process.execPath, [
      path.resolve(process.cwd(), "tools/perf/render-constraint-trend-summary.mjs"),
      "--report-file",
      trendFile,
      "--out",
      summaryFile,
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const checks = {
      history_written: fs.existsSync(historyFile),
      trend_written: fs.existsSync(trendFile),
      summary_written: fs.existsSync(summaryFile),
      runs_analyzed: Number(trend?.summary?.runs_analyzed ?? 0) >= 1,
      dominant_constraint_present: String(trend?.summary?.dominant_constraint_skill ?? "").length > 0,
      top_actions_present: Array.isArray(trend?.summary?.top_actions) && trend.summary.top_actions.length >= 1,
      history_runs_total: Number(history?.runs_total ?? 0) >= 1,
    };

    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      files: {
        report: reportFile,
        thresholds: thresholdsFile,
        actions: actionsFile,
        history: historyFile,
        trend: trendFile,
        summary: summaryFile,
      },
      checks,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`History file: ${output.files.history}`);
      console.log(`Trend file: ${output.files.trend}`);
      console.log(`Summary file: ${output.files.summary}`);
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
