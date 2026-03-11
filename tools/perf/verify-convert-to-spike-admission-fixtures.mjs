#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { copyFixtureToTmp, initGitRepo } from "./test-git-fixture-lib.mjs";

const CONFIG = {
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
};

const CASES = [
  {
    id: "source_branch_requires_choice",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "main",
    expectedAction: "stop_choose_continuity_rule",
    expectedResult: "stop",
    expectedReasonCode: "CYCLE_CREATE_CONTINUITY_CHOICE_REQUIRED",
    expectsCheckpoint: false,
  },
  {
    id: "session_branch_allows_spike_conversion",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "S103-multi",
    expectedAction: "proceed_r2_session_base_with_import",
    expectedResult: "ok",
    expectedReasonCode: null,
    expectsCheckpoint: true,
  },
  {
    id: "latest_cycle_requires_mode_override",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "feature/C104-delta",
    expectedAction: "stop_choose_continuity_rule",
    expectedResult: "stop",
    expectedReasonCode: "CYCLE_CREATE_MODE_RULE_DISALLOWS_CONTINUITY",
    expectsCheckpoint: false,
  },
];

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
  console.log("  node tools/perf/verify-convert-to-spike-admission-fixtures.mjs");
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

function writeConfig(targetRoot) {
  const configDir = path.join(targetRoot, ".aidn");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify(CONFIG, null, 2)}\n`, "utf8");
}

function runCase(tmpRoot, testCase) {
  const sourceTarget = path.resolve(process.cwd(), testCase.fixture);
  const targetRoot = copyFixtureToTmp(sourceTarget, tmpRoot, `tmp-convert-to-spike-${testCase.id}`);
  writeConfig(targetRoot);
  initGitRepo(targetRoot, {
    workingBranch: testCase.workingBranch,
  });

  const hook = runJson("tools/perf/convert-to-spike-hook.mjs", [
    "--target",
    targetRoot,
    "--mode",
    "EXPLORING",
    "--json",
  ]);
  const codex = runJson("tools/codex/run-json-hook.mjs", [
    "--skill",
    "convert-to-spike",
    "--target",
    targetRoot,
    "--mode",
    "EXPLORING",
    "--json",
  ]);

  const checks = {
    hook_action_expected: String(hook?.action ?? "") === testCase.expectedAction,
    hook_result_expected: String(hook?.result ?? "") === testCase.expectedResult,
    hook_reason_expected: String(hook?.reason_code ?? "") === String(testCase.expectedReasonCode ?? ""),
    hook_checkpoint_expected: Boolean(hook?.checkpoint) === testCase.expectsCheckpoint,
    codex_action_expected: String(codex?.action ?? "") === testCase.expectedAction,
    codex_result_expected: String(codex?.result ?? "") === testCase.expectedResult,
    codex_reason_expected: String(codex?.normalized?.reason_code ?? "") === String(testCase.expectedReasonCode ?? ""),
  };
  return {
    id: testCase.id,
    source_target: sourceTarget,
    target_root: targetRoot,
    checks,
    sample: {
      hook_action: hook?.action ?? null,
      hook_result: hook?.result ?? null,
      hook_reason_code: hook?.reason_code ?? null,
      hook_checkpoint_ran: Boolean(hook?.checkpoint),
      codex_action: codex?.action ?? null,
      codex_result: codex?.result ?? null,
      codex_reason_code: codex?.normalized?.reason_code ?? null,
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
