#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    tmpRoot: "tests/fixtures",
    keepTmp: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--tmp-root") {
      args.tmpRoot = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--keep-tmp") {
      args.keepTmp = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target || !args.tmpRoot) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-db-only-hooks-fixtures.mjs");
  console.log("  node tools/perf/verify-db-only-hooks-fixtures.mjs --target tests/fixtures/repo-installed-core");
  console.log("  node tools/perf/verify-db-only-hooks-fixtures.mjs --tmp-root tests/fixtures");
  console.log("  node tools/perf/verify-db-only-hooks-fixtures.mjs --keep-tmp");
}

function copyFixtureToTmp(source, tmpRoot) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const destination = path.resolve(tmpRoot, `tmp-db-only-hooks-${stamp}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  return destination;
}

function runJson(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  return JSON.parse(stdout);
}

function runWithStatus(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  const result = spawnSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  return {
    status: Number(result.status ?? 1),
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function readNdjson(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignore malformed line
    }
  }
  return out;
}

function main() {
  let tmpTarget = null;
  let keepTmp = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    keepTmp = args.keepTmp === true;
    const sourceTarget = path.resolve(process.cwd(), args.target);
    const tmpRoot = path.resolve(process.cwd(), args.tmpRoot);
    tmpTarget = copyFixtureToTmp(sourceTarget, tmpRoot);

    const env = {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    };

    const start = runJson("tools/perf/workflow-hook.mjs", [
      "--phase",
      "session-start",
      "--target",
      tmpTarget,
      "--mode",
      "COMMITTING",
      "--index-store",
      "sqlite",
      "--json",
    ], env);

    const close = runJson("tools/perf/workflow-hook.mjs", [
      "--phase",
      "session-close",
      "--target",
      tmpTarget,
      "--mode",
      "COMMITTING",
      "--index-store",
      "sqlite",
      "--json",
    ], env);
    const bypass = runWithStatus("tools/perf/workflow-hook.mjs", [
      "--phase",
      "session-close",
      "--target",
      tmpTarget,
      "--mode",
      "COMMITTING",
      "--index-store",
      "sqlite",
      "--no-constraint-loop",
      "--json",
    ], env);

    const sqlitePath = path.resolve(tmpTarget, ".aidn/runtime/index/workflow-index.sqlite");
    const eventsPath = path.resolve(tmpTarget, ".aidn/runtime/perf/workflow-events.ndjson");
    const constraintReportPath = path.resolve(tmpTarget, ".aidn/runtime/perf/constraint-report.json");
    const constraintThresholdsPath = path.resolve(tmpTarget, ".aidn/runtime/perf/constraint-thresholds.json");
    const constraintActionsPath = path.resolve(tmpTarget, ".aidn/runtime/perf/constraint-actions.json");
    const constraintHistoryPath = path.resolve(tmpTarget, ".aidn/runtime/perf/constraint-history.ndjson");
    const constraintTrendPath = path.resolve(tmpTarget, ".aidn/runtime/perf/constraint-trend.json");
    const constraintTrendThresholdsPath = path.resolve(tmpTarget, ".aidn/runtime/perf/constraint-trend-thresholds.json");
    const constraintTrendSummaryPath = path.resolve(tmpTarget, ".aidn/runtime/perf/constraint-trend-summary.md");
    const constraintLotPlanPath = path.resolve(tmpTarget, ".aidn/runtime/perf/constraint-lot-plan.json");
    const constraintLotAdvancePath = path.resolve(tmpTarget, ".aidn/runtime/perf/constraint-lot-advance.json");
    const constraintLotSummaryPath = path.resolve(tmpTarget, ".aidn/runtime/perf/constraint-lot-plan-summary.md");
    const constraintSummaryPath = path.resolve(tmpTarget, ".aidn/runtime/perf/constraint-summary.md");
    const events = readNdjson(eventsPath);

    const runId = String(start?.run_id ?? "");
    const runEvents = events.filter((event) => String(event?.run_id ?? "") === runId);
    const hasStartEvent = runEvents.some((event) => String(event?.event ?? "") === "hook_session_start");
    const hasCloseEvent = runEvents.some((event) => String(event?.event ?? "") === "hook_session_close");

    const checks = {
      start_ok: String(start?.result ?? "") === "ok",
      close_ok: String(close?.result ?? "") === "ok",
      start_strict_forced: start?.strict === true && start?.strict_required_by_state === true,
      close_strict_forced: close?.strict === true && close?.strict_required_by_state === true,
      run_id_stable: runId.length > 0 && runId === String(close?.run_id ?? ""),
      sqlite_exists: fs.existsSync(sqlitePath),
      checkpoint_start_state_mode_db_only: String(start?.checkpoint?.state_mode ?? "") === "db-only",
      checkpoint_close_state_mode_db_only: String(close?.checkpoint?.state_mode ?? "") === "db-only",
      checkpoint_close_gate_action_set: String(close?.checkpoint?.gate?.action ?? "").length > 0,
      constraint_loop_required: close?.constraint_loop_required === true,
      constraint_loop_present: close?.constraint_loop != null,
      constraint_loop_error_empty: String(close?.constraint_loop_error ?? "") === "",
      constraint_loop_status_present: String(close?.constraint_loop?.summary?.constraint_status ?? "").length > 0,
      constraint_loop_trend_present: String(close?.constraint_loop?.summary?.trend_status ?? "").length > 0,
      constraint_loop_active_skill_present: String(close?.constraint_loop?.summary?.active_constraint_skill ?? "").length > 0,
      constraint_loop_bypass_rejected: bypass.status !== 0
        && String(bypass.stderr).includes("--no-constraint-loop is not allowed in dual/db-only mode"),
      constraint_report_exists: fs.existsSync(constraintReportPath),
      constraint_thresholds_exists: fs.existsSync(constraintThresholdsPath),
      constraint_actions_exists: fs.existsSync(constraintActionsPath),
      constraint_history_exists: fs.existsSync(constraintHistoryPath),
      constraint_trend_exists: fs.existsSync(constraintTrendPath),
      constraint_trend_thresholds_exists: fs.existsSync(constraintTrendThresholdsPath),
      constraint_trend_summary_exists: fs.existsSync(constraintTrendSummaryPath),
      constraint_lot_plan_exists: fs.existsSync(constraintLotPlanPath),
      constraint_lot_advance_exists: fs.existsSync(constraintLotAdvancePath),
      constraint_lot_summary_exists: fs.existsSync(constraintLotSummaryPath),
      constraint_summary_exists: fs.existsSync(constraintSummaryPath),
      events_file_exists: fs.existsSync(eventsPath),
      events_has_start: hasStartEvent,
      events_has_close: hasCloseEvent,
    };

    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: tmpTarget,
      checks,
      samples: {
        run_id: runId,
        start_gate_action: start?.checkpoint?.gate?.action ?? null,
        close_gate_action: close?.checkpoint?.gate?.action ?? null,
        close_gate_result: close?.checkpoint?.gate?.result ?? null,
        constraint_status: close?.constraint_loop?.summary?.constraint_status ?? null,
        constraint_trend_status: close?.constraint_loop?.summary?.trend_status ?? null,
        constraint_active_skill: close?.constraint_loop?.summary?.active_constraint_skill ?? null,
        bypass_status: bypass.status,
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${output.source_target}`);
      console.log(`Working copy: ${output.target_root}`);
      console.log(`Start hook: ${checks.start_ok ? "PASS" : "FAIL"}`);
      console.log(`Close hook: ${checks.close_ok ? "PASS" : "FAIL"}`);
      console.log(`Run id stable: ${checks.run_id_stable ? "yes" : "no"}`);
      console.log(`SQLite exists: ${checks.sqlite_exists ? "yes" : "no"}`);
      console.log(`Events start/close: ${checks.events_has_start && checks.events_has_close ? "yes" : "no"}`);
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!keepTmp) {
      const cleanup = removePathWithRetry(tmpTarget);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
      tmpTarget = null;
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    if (tmpTarget != null && !keepTmp) {
      removePathWithRetry(tmpTarget);
    }
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
