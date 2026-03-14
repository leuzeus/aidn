#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { copyFixtureToTmp, initGitRepo } from "./test-git-fixture-lib.mjs";

const CASES = [
  {
    id: "source_branch_requires_choice",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "main",
    mutate(targetRoot) {
      const configDir = path.join(targetRoot, ".aidn");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify({
        version: 1,
        profile: "dual",
        install: {
          artifactImportStore: "dual-sqlite",
        },
        runtime: {
          stateMode: "dual",
        },
        workflow: {
          sourceBranch: "main",
        },
      }, null, 2)}\n`, "utf8");
    },
    expectedAction: "stop_choose_continuity_rule",
    expectedResult: "stop",
    expectsCheckpoint: false,
  },
  {
    id: "session_branch_allows_r2",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "S103-multi",
    mutate(targetRoot) {
      const configDir = path.join(targetRoot, ".aidn");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify({
        version: 1,
        profile: "dual",
        install: {
          artifactImportStore: "dual-sqlite",
        },
        runtime: {
          stateMode: "dual",
        },
        workflow: {
          sourceBranch: "main",
        },
      }, null, 2)}\n`, "utf8");
    },
    expectedAction: "proceed_r2_session_base_with_import",
    expectedResult: "ok",
    expectsCheckpoint: true,
  },
  {
    id: "latest_cycle_allows_r1",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "feature/C104-delta",
    mutate(targetRoot) {
      const configDir = path.join(targetRoot, ".aidn");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify({
        version: 1,
        profile: "dual",
        install: {
          artifactImportStore: "dual-sqlite",
        },
        runtime: {
          stateMode: "dual",
        },
        workflow: {
          sourceBranch: "main",
        },
      }, null, 2)}\n`, "utf8");
    },
    expectedAction: "proceed_r1_strict_chain",
    expectedResult: "ok",
    expectsCheckpoint: true,
  },
  {
    id: "promoted_backlog_requires_scope_selection",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "S103-multi",
    mutate(targetRoot) {
      writeDualConfig(targetRoot);
      installSharedPlanningFixture(targetRoot, { selectedExecutionScope: "none" });
    },
    expectedAction: "stop_select_execution_scope",
    expectedResult: "stop",
    expectsCheckpoint: false,
  },
  {
    id: "promoted_backlog_new_cycle_scope_allows_r2",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "S103-multi",
    mutate(targetRoot) {
      writeDualConfig(targetRoot);
      installSharedPlanningFixture(targetRoot, { selectedExecutionScope: "new_cycle" });
    },
    expectedAction: "proceed_r2_session_base_with_import",
    expectedResult: "ok",
    expectsCheckpoint: true,
  },
];

function writeDualConfig(targetRoot) {
  const configDir = path.join(targetRoot, ".aidn");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify({
    version: 1,
    profile: "dual",
    install: {
      artifactImportStore: "dual-sqlite",
    },
    runtime: {
      stateMode: "dual",
    },
    workflow: {
      sourceBranch: "main",
    },
  }, null, 2)}\n`, "utf8");
}

function installSharedPlanningFixture(targetRoot, { selectedExecutionScope = "none" } = {}) {
  const currentStateFile = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
  const currentStateText = fs.existsSync(currentStateFile)
    ? fs.readFileSync(currentStateFile, "utf8")
    : [
      "# Current State",
      "",
      "## Summary",
      "",
      "updated_at: 2026-03-09T01:05:00Z",
      "structure_profile: modern",
      "runtime_state_mode: dual",
      "repair_layer_status: ok",
      "",
      "## Active Context",
      "",
      "active_session: S103",
      "session_branch: S103-multi",
      "branch_kind: session",
      "mode: COMMITTING",
      "",
      "active_cycle: C104",
      "cycle_branch: feature/C104-delta",
      "dor_state: READY",
      "first_plan_step: select the first cycle scope",
      "",
    ].join("\n");
  const nextCurrentState = currentStateText.includes("active_backlog:")
    ? currentStateText
      .replace(/active_backlog:\s*.+/g, "active_backlog: backlog/BL-S103-session-planning.md")
      .replace(/backlog_status:\s*.+/g, "backlog_status: promoted")
      .replace(/backlog_next_step:\s*.+/g, "backlog_next_step: select the first cycle scope")
      .replace(/backlog_selected_execution_scope:\s*.+/g, `backlog_selected_execution_scope: ${selectedExecutionScope}`)
      .replace(/planning_arbitration_status:\s*.+/g, "planning_arbitration_status: none")
    : currentStateText.replace(
      "first_plan_step: select the first cycle scope",
      [
        "first_plan_step: select the first cycle scope",
        "active_backlog: backlog/BL-S103-session-planning.md",
        "backlog_status: promoted",
        "backlog_next_step: select the first cycle scope",
        `backlog_selected_execution_scope: ${selectedExecutionScope}`,
        "planning_arbitration_status: none",
      ].join("\n"),
    );
  fs.mkdirSync(path.dirname(currentStateFile), { recursive: true });
  fs.writeFileSync(currentStateFile, `${nextCurrentState.replace(/\n+$/u, "")}\n`, "utf8");
  const backlogDir = path.join(targetRoot, "docs", "audit", "backlog");
  fs.mkdirSync(backlogDir, { recursive: true });
  fs.writeFileSync(path.join(backlogDir, "BL-S103-session-planning.md"), [
    "# Session Backlog - S103",
    "",
    "## Summary",
    "",
    "updated_at: 2026-03-09T01:10:00Z",
    "session_id: S103",
    "session_branch: S103-multi",
    "mode: COMMITTING",
    "planning_status: promoted",
    "linked_cycles: C103, C104",
    "dispatch_ready: yes",
    "planning_arbitration_status: none",
    "next_dispatch_scope: cycle",
    "next_dispatch_action: implement",
    "backlog_next_step: select the first cycle scope",
    `selected_execution_scope: ${selectedExecutionScope}`,
    "",
  ].join("\n"), "utf8");
}

function parseArgs(argv) {
  const args = {
    tmpRoot: "tests/fixtures",
    keepTmp: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--tmp-root") {
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-cycle-create-admission-fixtures.mjs");
}

function runJson(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  try {
    const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...env,
      },
    });
    return JSON.parse(stdout);
  } catch (error) {
    const stdout = String(error?.stdout ?? "").trim();
    if (stdout) {
      return JSON.parse(stdout);
    }
    throw error;
  }
}

function runCase(tmpRoot, testCase) {
  const sourceTarget = path.resolve(process.cwd(), testCase.fixture);
  const targetRoot = copyFixtureToTmp(sourceTarget, tmpRoot, `tmp-cycle-create-${testCase.id}`);
  if (typeof testCase.mutate === "function") {
    testCase.mutate(targetRoot);
  }
  initGitRepo(targetRoot, {
    workingBranch: testCase.workingBranch,
  });

  const hook = runJson("tools/perf/cycle-create-hook.mjs", [
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);
  const codex = runJson("tools/codex/run-json-hook.mjs", [
    "--skill",
    "cycle-create",
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);
  const codexAction = codex?.action ?? codex?.normalized?.action ?? null;
  const codexResult = codex?.result ?? codex?.normalized?.result ?? null;

  const checks = {
    hook_action_expected: String(hook?.action ?? "") === testCase.expectedAction,
    hook_result_expected: String(hook?.result ?? "") === testCase.expectedResult,
    hook_checkpoint_expected: Boolean(hook?.checkpoint) === testCase.expectsCheckpoint,
    codex_action_expected: String(codexAction ?? "") === testCase.expectedAction,
    codex_result_expected: String(codexResult ?? "") === testCase.expectedResult,
  };
  return {
    id: testCase.id,
    source_target: sourceTarget,
    target_root: targetRoot,
    checks,
    sample: {
      hook_action: hook?.action ?? null,
      hook_result: hook?.result ?? null,
      hook_checkpoint_ran: Boolean(hook?.checkpoint),
      codex_action: codexAction,
      codex_result: codexResult,
      codex_ok: codex?.ok ?? null,
    },
    pass: Object.values(checks).every((value) => value === true),
  };
}

function main() {
  const createdTargets = [];
  try {
    const args = parseArgs(process.argv.slice(2));
    const tmpRoot = path.resolve(process.cwd(), args.tmpRoot);
    const runs = CASES.map((testCase) => {
      const run = runCase(tmpRoot, testCase);
      createdTargets.push(run.target_root);
      return run;
    });
    const pass = runs.every((run) => run.pass === true);
    const output = {
      ts: new Date().toISOString(),
      runs,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      for (const run of runs) {
        console.log(`${run.pass ? "PASS" : "FAIL"} ${run.id}`);
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!args.keepTmp) {
      for (const target of createdTargets) {
        fs.rmSync(target, { recursive: true, force: true });
      }
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
