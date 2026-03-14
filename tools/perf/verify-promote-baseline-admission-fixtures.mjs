#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { copyFixtureToTmp, initGitRepo } from "./test-git-fixture-lib.mjs";

const CASES = [
  {
    id: "multiple_done_cycles_require_choice",
    fixture: "tests/fixtures/perf-integration-risk/direct-merge",
    workingBranch: "S301-integration",
    expectedAction: "choose_cycle",
    expectedResult: "stop",
    expectsCheckpoint: false,
  },
  {
    id: "single_done_cycle_allows_promotion",
    fixture: "tests/fixtures/perf-integration-risk/direct-merge",
    workingBranch: "S301-integration",
    mutate(targetRoot) {
      fs.rmSync(path.join(targetRoot, "docs", "audit", "cycles", "C302-feature-beta"), { recursive: true, force: true });
    },
    expectedAction: "promote_baseline_allowed",
    expectedResult: "ok",
    expectsCheckpoint: true,
  },
  {
    id: "open_gap_blocks_promotion",
    fixture: "tests/fixtures/perf-integration-risk/direct-merge",
    workingBranch: "S301-integration",
    mutate(targetRoot) {
      fs.rmSync(path.join(targetRoot, "docs", "audit", "cycles", "C302-feature-beta"), { recursive: true, force: true });
      fs.writeFileSync(
        path.join(targetRoot, "docs", "audit", "cycles", "C301-feature-alpha", "gap-report.md"),
        "# Gap Report — C301-feature-alpha\n\n## GAP-001\n- Status: open\n",
        "utf8",
      );
    },
    expectedAction: "blocked_validation_incomplete",
    expectedResult: "stop",
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
  console.log("  node tools/perf/verify-promote-baseline-admission-fixtures.mjs");
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
  const targetRoot = copyFixtureToTmp(sourceTarget, tmpRoot, `tmp-promote-baseline-${testCase.id}`);
  if (typeof testCase.mutate === "function") {
    testCase.mutate(targetRoot);
  }
  initGitRepo(targetRoot, {
    sourceBranch: "dev",
    workingBranch: testCase.workingBranch,
  });

  const hook = runJson("tools/perf/promote-baseline-hook.mjs", [
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);
  const codex = runJson("tools/codex/run-json-hook.mjs", [
    "--skill",
    "promote-baseline",
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);

  const checks = {
    hook_action_expected: String(hook?.action ?? "") === testCase.expectedAction,
    hook_result_expected: String(hook?.result ?? "") === testCase.expectedResult,
    hook_checkpoint_expected: Boolean(hook?.checkpoint) === testCase.expectsCheckpoint,
    codex_action_expected: String(codex?.action ?? "") === testCase.expectedAction,
    codex_result_expected: String(codex?.result ?? "") === testCase.expectedResult,
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
      codex_action: codex?.action ?? null,
      codex_result: codex?.result ?? null,
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
