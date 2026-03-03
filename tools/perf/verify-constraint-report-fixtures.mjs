#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    file: "tests/fixtures/perf-constraints/workflow-events.ndjson",
    out: ".aidn/runtime/perf/fixtures/constraints/constraint-report.json",
    targets: "docs/performance/CONSTRAINT_TARGETS.json",
    thresholdsOut: ".aidn/runtime/perf/fixtures/constraints/constraint-thresholds.json",
    actionsOut: ".aidn/runtime/perf/fixtures/constraints/constraint-actions.json",
    summaryOut: ".aidn/runtime/perf/fixtures/constraints/constraint-summary.md",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") {
      args.file = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--targets") {
      args.targets = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--thresholds-out") {
      args.thresholdsOut = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--actions-out") {
      args.actionsOut = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--summary-out") {
      args.summaryOut = argv[i + 1] ?? "";
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
  if (!args.file || !args.out || !args.targets || !args.thresholdsOut || !args.actionsOut || !args.summaryOut) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-constraint-report-fixtures.mjs");
  console.log("  node tools/perf/verify-constraint-report-fixtures.mjs --file tests/fixtures/perf-constraints/workflow-events.ndjson");
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
    const eventFile = path.resolve(process.cwd(), args.file);
    const outFile = path.resolve(process.cwd(), args.out);
    const targetsFile = path.resolve(process.cwd(), args.targets);
    const thresholdsOutFile = path.resolve(process.cwd(), args.thresholdsOut);
    const actionsOutFile = path.resolve(process.cwd(), args.actionsOut);
    const summaryOutFile = path.resolve(process.cwd(), args.summaryOut);

    const report = runJson("tools/perf/report-constraints.mjs", [
      "--file",
      eventFile,
      "--out",
      outFile,
      "--json",
    ]);
    const thresholds = runJson("tools/perf/check-thresholds.mjs", [
      "--kpi-file",
      outFile,
      "--targets",
      targetsFile,
      "--out",
      thresholdsOutFile,
      "--json",
    ]);
    const actions = runJson("tools/perf/report-constraint-actions.mjs", [
      "--report-file",
      outFile,
      "--thresholds-file",
      thresholdsOutFile,
      "--out",
      actionsOutFile,
      "--json",
    ]);
    execFileSync(process.execPath, [
      path.resolve(process.cwd(), "tools/perf/render-constraint-summary.mjs"),
      "--report-file",
      outFile,
      "--thresholds-file",
      thresholdsOutFile,
      "--actions-file",
      actionsOutFile,
      "--out",
      summaryOutFile,
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const topSkill = Array.isArray(report.skills) && report.skills.length > 0
      ? report.skills[0]
      : null;
    const active = report?.summary?.active_constraint ?? null;
    const checks = {
      events_analyzed: Number(report?.summary?.events_analyzed ?? -1) === 9,
      runs_analyzed: Number(report?.summary?.runs_analyzed ?? -1) === 2,
      control_share_present: Number(report?.summary?.control_share_of_total ?? -1) > 0,
      active_constraint_present: active != null,
      active_constraint_skill: String(active?.skill ?? "") === "context-reload",
      active_constraint_signal: String(active?.signal ?? "") === "control_duration_ms",
      active_constraint_share: Number(active?.share ?? 0) > 0.5,
      output_written_exists: fs.existsSync(String(report?.output_file ?? "")),
      thresholds_written_exists: fs.existsSync(String(thresholds?.output_file ?? "")),
      thresholds_status_pass: String(thresholds?.summary?.overall_status ?? "") === "pass",
      actions_written_exists: fs.existsSync(String(actions?.output_file ?? "")),
      actions_generated: Number(actions?.summary?.generated_actions ?? 0) >= 1,
      actions_top_skill: String(actions?.actions?.[0]?.skill ?? "") === "context-reload",
      summary_written_exists: fs.existsSync(summaryOutFile),
      summary_contains_active_constraint: fs.existsSync(summaryOutFile)
        && fs.readFileSync(summaryOutFile, "utf8").includes("Active constraint:"),
      summary_contains_action_backlog: fs.existsSync(summaryOutFile)
        && fs.readFileSync(summaryOutFile, "utf8").includes("Action Backlog"),
      top_skill_context_reload: String(topSkill?.skill ?? "") === "context-reload",
      top_skill_reason_code: Array.isArray(topSkill?.top_reason_codes)
        && topSkill.top_reason_codes.some((entry) => entry?.reason_code === "STALE_MAPPING"),
    };

    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      file: eventFile,
      out: outFile,
      summary_out: summaryOutFile,
      checks,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`File: ${output.file}`);
      console.log(`Out: ${output.out}`);
      console.log(`Active constraint: ${checks.active_constraint_skill ? "context-reload" : "unexpected"}`);
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
