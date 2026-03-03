#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SCENARIOS = [
  { stateMode: "dual", indexStore: "dual-sqlite", expectedStore: "dual-sqlite" },
  { stateMode: "db-only", indexStore: "sqlite", expectedStore: "sqlite" },
];

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
  console.log("  node tools/perf/verify-workflow-hook-constraint-loop-fixtures.mjs");
  console.log("  node tools/perf/verify-workflow-hook-constraint-loop-fixtures.mjs --target tests/fixtures/repo-installed-core");
  console.log("  node tools/perf/verify-workflow-hook-constraint-loop-fixtures.mjs --tmp-root tests/fixtures --keep-tmp");
}

function copyFixtureToTmp(source, tmpRoot, suffix) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const destination = path.resolve(tmpRoot, `tmp-${suffix}-${stamp}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  return destination;
}

function resolveTargetPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
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

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function runScenario(targetRoot, scenario) {
  const env = {
    AIDN_STATE_MODE: scenario.stateMode,
    AIDN_INDEX_STORE_MODE: scenario.indexStore,
  };

  const start = runJson("tools/perf/workflow-hook.mjs", [
    "--phase",
    "session-start",
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ], env);

  const close = runJson("tools/perf/workflow-hook.mjs", [
    "--phase",
    "session-close",
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ], env);

  const artifacts = close?.constraint_loop?.artifacts ?? {};
  const requiredArtifactKeys = [
    "report_file",
    "thresholds_file",
    "actions_file",
    "history_file",
    "trend_file",
    "trend_thresholds_file",
    "trend_summary_file",
    "lot_plan_file",
    "lot_advance_file",
    "lot_summary_file",
    "summary_file",
  ];
  const missingArtifactKeys = requiredArtifactKeys.filter((key) => !isNonEmptyString(artifacts?.[key]));
  const missingArtifactFiles = requiredArtifactKeys
    .map((key) => String(artifacts?.[key] ?? ""))
    .filter((filePath) => isNonEmptyString(filePath) && !fs.existsSync(filePath));

  const checks = {
    start_ok: String(start?.result ?? "") === "ok",
    close_ok: String(close?.result ?? "") === "ok",
    run_id_stable: isNonEmptyString(start?.run_id) && String(start?.run_id) === String(close?.run_id ?? ""),
    start_state_mode: String(start?.checkpoint?.state_mode ?? "") === scenario.stateMode,
    close_state_mode: String(close?.checkpoint?.state_mode ?? "") === scenario.stateMode,
    close_index_store: String(close?.checkpoint?.index?.store ?? "") === scenario.expectedStore,
    constraint_loop_present: close?.constraint_loop != null && typeof close.constraint_loop === "object",
    constraint_loop_error_empty: !isNonEmptyString(close?.constraint_loop_error),
    constraint_loop_target: String(close?.constraint_loop?.target_root ?? "") === targetRoot,
    constraint_status_present: isNonEmptyString(close?.constraint_loop?.summary?.constraint_status),
    trend_status_present: isNonEmptyString(close?.constraint_loop?.summary?.trend_status),
    constraint_active_skill_present: isNonEmptyString(close?.constraint_loop?.summary?.active_constraint_skill),
    constraint_artifacts_keys: missingArtifactKeys.length === 0,
    constraint_artifacts_files: missingArtifactFiles.length === 0,
  };

  const pass = Object.values(checks).every((value) => value === true);
  return {
    scenario,
    target_root: targetRoot,
    checks,
    pass,
    samples: {
      run_id: start?.run_id ?? null,
      checkpoint_gate_action: close?.checkpoint?.gate?.action ?? null,
      constraint_status: close?.constraint_loop?.summary?.constraint_status ?? null,
      trend_status: close?.constraint_loop?.summary?.trend_status ?? null,
      active_constraint_skill: close?.constraint_loop?.summary?.active_constraint_skill ?? null,
      missing_artifact_keys: missingArtifactKeys,
      missing_artifact_files: missingArtifactFiles,
    },
  };
}

function main() {
  const createdTargets = [];
  let keepTmp = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    keepTmp = args.keepTmp === true;
    const sourceTarget = path.resolve(process.cwd(), args.target);
    const tmpRoot = path.resolve(process.cwd(), args.tmpRoot);

    const runs = [];
    for (const scenario of SCENARIOS) {
      const tmpTarget = copyFixtureToTmp(sourceTarget, tmpRoot, `workflow-hook-constraint-loop-${scenario.stateMode}`);
      createdTargets.push(tmpTarget);
      runs.push(runScenario(tmpTarget, scenario));
    }

    const pass = runs.every((run) => run.pass === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      targets: createdTargets,
      summary: {
        runs_total: runs.length,
        pass_count: runs.filter((run) => run.pass).length,
        fail_count: runs.filter((run) => !run.pass).length,
      },
      runs,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${output.source_target}`);
      console.log(`Dual mode chain: ${runs.find((run) => run.scenario.stateMode === "dual")?.pass ? "PASS" : "FAIL"}`);
      console.log(`DB-only mode chain: ${runs.find((run) => run.scenario.stateMode === "db-only")?.pass ? "PASS" : "FAIL"}`);
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!keepTmp) {
      for (const tmpTarget of createdTargets) {
        fs.rmSync(tmpTarget, { recursive: true, force: true });
      }
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    if (!keepTmp) {
      for (const tmpTarget of createdTargets) {
        fs.rmSync(tmpTarget, { recursive: true, force: true });
      }
    }
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
