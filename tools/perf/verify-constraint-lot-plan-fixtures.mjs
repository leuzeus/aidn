#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    fixtureFile: "tests/fixtures/perf-constraints/workflow-events.ndjson",
    reportFile: ".aidn/runtime/perf/fixtures/constraints/lot-plan/constraint-report.json",
    thresholdsFile: ".aidn/runtime/perf/fixtures/constraints/lot-plan/constraint-thresholds.json",
    actionsFile: ".aidn/runtime/perf/fixtures/constraints/lot-plan/constraint-actions.json",
    trendFile: ".aidn/runtime/perf/fixtures/constraints/lot-plan/constraint-trend.json",
    planFile: ".aidn/runtime/perf/fixtures/constraints/lot-plan/constraint-lot-plan.json",
    summaryFile: ".aidn/runtime/perf/fixtures/constraints/lot-plan/constraint-lot-plan-summary.md",
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
    } else if (token === "--trend-file") {
      args.trendFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--plan-file") {
      args.planFile = argv[i + 1] ?? "";
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
  console.log("  node tools/perf/verify-constraint-lot-plan-fixtures.mjs");
}

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function runNoJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const fixtureFile = path.resolve(process.cwd(), args.fixtureFile);
    const reportFile = path.resolve(process.cwd(), args.reportFile);
    const thresholdsFile = path.resolve(process.cwd(), args.thresholdsFile);
    const actionsFile = path.resolve(process.cwd(), args.actionsFile);
    const trendFile = path.resolve(process.cwd(), args.trendFile);
    const planFile = path.resolve(process.cwd(), args.planFile);
    const summaryFile = path.resolve(process.cwd(), args.summaryFile);
    const constraintTargets = path.resolve(process.cwd(), "docs/performance/CONSTRAINT_TARGETS.json");

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
      constraintTargets,
      "--out",
      thresholdsFile,
      "--json",
    ]);
    const actions = runJson("tools/perf/report-constraint-actions.mjs", [
      "--report-file",
      reportFile,
      "--thresholds-file",
      thresholdsFile,
      "--out",
      actionsFile,
      "--json",
    ]);
    const trendSeed = {
      ts: new Date().toISOString(),
      summary: {
        dominant_constraint_skill: actions?.summary?.active_constraint_skill ?? "context-reload",
        constraint_stability_rate: 0.75,
      },
      runs: [],
    };
    fs.mkdirSync(path.dirname(trendFile), { recursive: true });
    fs.writeFileSync(trendFile, `${JSON.stringify(trendSeed, null, 2)}\n`, "utf8");

    const plan = runJson("tools/perf/report-constraint-lot-plan.mjs", [
      "--actions-file",
      actionsFile,
      "--trend-file",
      trendFile,
      "--out",
      planFile,
      "--max-lot-size",
      "3",
      "--json",
    ]);

    const firstLotId = String(plan?.lots?.[0]?.lot_id ?? "");
    const firstActionId = String(plan?.lots?.[0]?.actions?.[0]?.action_id ?? "");
    const update = runJson("tools/perf/update-constraint-lot-plan.mjs", [
      "--plan-file",
      planFile,
      "--lot-id",
      firstLotId,
      "--lot-status",
      "in_progress",
      "--action-update",
      `${firstActionId}:done`,
      "--json",
    ]);
    const updatedBeforeAdvance = JSON.parse(fs.readFileSync(planFile, "utf8"));
    const advance = runJson("tools/perf/advance-constraint-lot-plan.mjs", [
      "--plan-file",
      planFile,
      "--json",
    ]);

    runNoJson("tools/perf/render-constraint-lot-plan-summary.mjs", [
      "--plan-file",
      planFile,
      "--out",
      summaryFile,
      "--top-lots",
      "4",
    ]);

    const updatedPlan = JSON.parse(fs.readFileSync(planFile, "utf8"));
    const checks = {
      plan_written: fs.existsSync(planFile),
      summary_written: fs.existsSync(summaryFile),
      lots_generated: Number(plan?.summary?.lots_total ?? 0) >= 1,
      next_lot_present: String(plan?.summary?.next_lot_id ?? "").length > 0,
      first_lot_in_progress: String(updatedBeforeAdvance?.lots?.[0]?.status ?? "") === "in_progress",
      first_lot_completed_after_advance: String(updatedPlan?.lots?.[0]?.status ?? "") === "completed",
      first_action_done: String(updatedBeforeAdvance?.lots?.[0]?.actions?.[0]?.status ?? "") === "done",
      update_has_entries: Array.isArray(update?.updates) && update.updates.length >= 1,
      advance_has_transitions: Array.isArray(advance?.transitions) && advance.transitions.length >= 1,
      advance_completed_first_lot: Array.isArray(advance?.transitions)
        && advance.transitions.some((entry) => entry?.type === "lot_completed" && entry?.lot_id === firstLotId),
      advance_started_next_lot: Array.isArray(advance?.transitions)
        && advance.transitions.some((entry) => entry?.type === "lot_started"),
      summary_contains_title: fs.readFileSync(summaryFile, "utf8").includes("Constraint Lot Plan"),
    };

    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      files: {
        plan: planFile,
        summary: summaryFile,
      },
      checks,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Plan file: ${planFile}`);
      console.log(`Summary file: ${summaryFile}`);
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
