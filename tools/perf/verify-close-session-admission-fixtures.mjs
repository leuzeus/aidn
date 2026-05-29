#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { copyFixtureToTmp, initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";

function runGit(target, args) {
  execFileSync("git", ["-C", target, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const CASES = [
  {
    id: "unresolved_open_cycles_block",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "S103-multi",
    expectedAction: "blocked_open_cycles_require_resolution",
    expectedResult: "stop",
    expectsWorkflowHook: false,
  },
  {
    id: "resolved_open_cycles_allow_close",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "S103-multi",
    mutate(targetRoot) {
      const sessionFile = path.join(targetRoot, "docs", "audit", "sessions", "S103-multi.md");
      fs.appendFileSync(sessionFile, "\n### Cycle Resolution At Session Close (required)\n- `C103` | state: `IMPLEMENTING` | decision: `report` | target session: `none` | rationale: defer\n- `C104` | state: `VERIFYING` | decision: `integrate-to-session` | target session: `S103` | rationale: ready\n\n### Session close gate satisfied?\n- [x] Yes\n", "utf8");
    },
    expectedAction: "close_session_allowed",
    expectedResult: "ok",
    expectsWorkflowHook: true,
  },
  {
    id: "stale_reported_cycle_blocks",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "S103-multi",
    mutate(targetRoot) {
      const sessionFile = path.join(targetRoot, "docs", "audit", "sessions", "S103-multi.md");
      fs.appendFileSync(sessionFile, "\n### Cycle Resolution At Session Close (required)\n- `C103` | state: `IMPLEMENTING` | decision: `report` | target session: `none` | rationale: defer\n- `C104` | state: `VERIFYING` | decision: `integrate-to-session` | target session: `S103` | rationale: ready\n\n### Session close gate satisfied?\n- [x] Yes\n", "utf8");
    },
    configureGit(targetRoot) {
      runGit(targetRoot, ["checkout", "-b", "feature/C103-gamma"]);
      fs.appendFileSync(path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md"), "\n", "utf8");
      runGit(targetRoot, ["add", "."]);
      runGit(targetRoot, ["commit", "-m", "cycle C103"]);
      runGit(targetRoot, ["checkout", "S103-multi"]);
      runGit(targetRoot, ["merge", "--no-ff", "--no-edit", "feature/C103-gamma"]);
    },
    expectedAction: "blocked_stale_reported_cycles_require_regularization",
    expectedResult: "stop",
    expectsWorkflowHook: false,
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
  console.log("  node tools/perf/verify-close-session-admission-fixtures.mjs");
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
  const targetRoot = copyFixtureToTmp(sourceTarget, tmpRoot, `tmp-close-session-${testCase.id}`);
  if (typeof testCase.mutate === "function") {
    testCase.mutate(targetRoot);
  }
  initGitRepo(targetRoot, {
    workingBranch: testCase.workingBranch,
  });
  if (typeof testCase.configureGit === "function") {
    testCase.configureGit(targetRoot);
  }

  const hook = runJson("tools/perf/close-session-hook.mjs", [
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);
  const codex = runJson("tools/codex/run-json-hook.mjs", [
    "--skill",
    "close-session",
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);

  const checks = {
    hook_action_expected: String(hook?.action ?? "") === testCase.expectedAction,
    hook_result_expected: String(hook?.result ?? "") === testCase.expectedResult,
    hook_workflow_hook_expected: Boolean(hook?.workflow_hook) === testCase.expectsWorkflowHook,
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
      hook_workflow_ran: Boolean(hook?.workflow_hook),
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
        const cleanup = removePathWithRetry(target);
        if (!cleanup.ok) {
          throw cleanup.error;
        }
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
