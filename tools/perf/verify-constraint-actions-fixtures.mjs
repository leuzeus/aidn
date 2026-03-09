#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    fixtureFile: "tests/fixtures/perf-constraints/workflow-events.ndjson",
    reportFile: ".aidn/runtime/perf/fixtures/constraints/constraint-report.json",
    thresholdsFile: ".aidn/runtime/perf/fixtures/constraints/constraint-thresholds.json",
    out: ".aidn/runtime/perf/fixtures/constraints/constraint-actions.verify.json",
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
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
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
  if (!args.fixtureFile || !args.reportFile || !args.thresholdsFile || !args.out) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-constraint-actions-fixtures.mjs");
  console.log("  node tools/perf/verify-constraint-actions-fixtures.mjs --fixture-file tests/fixtures/perf-constraints/workflow-events.ndjson");
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
    const outFile = path.resolve(process.cwd(), args.out);

    if (!fs.existsSync(reportFile)) {
      runJson("tools/perf/report-constraints.mjs", [
        "--file",
        fixtureFile,
        "--out",
        reportFile,
        "--json",
      ]);
    }
    if (!fs.existsSync(thresholdsFile)) {
      runJson("tools/perf/check-thresholds.mjs", [
        "--kpi-file",
        reportFile,
        "--targets",
        path.resolve(process.cwd(), "docs/performance/CONSTRAINT_TARGETS.json"),
        "--out",
        thresholdsFile,
        "--json",
      ]);
    }

    const actions = runJson("tools/perf/report-constraint-actions.mjs", [
      "--report-file",
      reportFile,
      "--thresholds-file",
      thresholdsFile,
      "--out",
      outFile,
      "--json",
    ]);

    const topAction = Array.isArray(actions?.actions) ? actions.actions[0] : null;
    const checks = {
      output_exists: fs.existsSync(String(actions?.output_file ?? "")),
      actions_generated: Number(actions?.summary?.generated_actions ?? 0) >= 1,
      quick_win_present: Number(actions?.summary?.quick_wins ?? 0) >= 1,
      active_constraint_skill_present: String(actions?.summary?.active_constraint_skill ?? "").length > 0,
      top_action_has_priority: Number(topAction?.priority_score ?? 0) > 0,
      top_action_has_batch: String(topAction?.batch ?? "").length > 0,
    };

    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      report_file: reportFile,
      thresholds_file: thresholdsFile,
      out_file: outFile,
      checks,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Report file: ${output.report_file}`);
      console.log(`Actions generated: ${actions?.summary?.generated_actions ?? 0}`);
      console.log(`Top action: ${topAction?.action_id ?? "n/a"}`);
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
