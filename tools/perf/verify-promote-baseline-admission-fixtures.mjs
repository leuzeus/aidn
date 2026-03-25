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
    expectedReasonCode: "PROMOTE_BASELINE_MULTIPLE_DONE_CYCLES",
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
    expectedReasonCode: "PROMOTE_BASELINE_OPEN_GAPS",
    expectsCheckpoint: false,
  },
  {
    id: "shared_surface_requires_verified_usage_matrix",
    fixture: "tests/fixtures/perf-integration-risk/direct-merge",
    workingBranch: "S301-integration",
    mutate(targetRoot) {
      fs.rmSync(path.join(targetRoot, "docs", "audit", "cycles", "C302-feature-beta"), { recursive: true, force: true });
      const statusPath = path.join(targetRoot, "docs", "audit", "cycles", "C301-feature-alpha", "status.md");
      const base = fs.readFileSync(statusPath, "utf8");
      fs.writeFileSync(
        statusPath,
        `${base}\nusage_matrix_scope: shared\nusage_matrix_state: NOT_DEFINED\nusage_matrix_summary: nominal + alternate\nusage_matrix_rationale: none\n`,
        "utf8",
      );
    },
    expectedAction: "blocked_validation_incomplete",
    expectedResult: "stop",
    expectedReasonCode: "PROMOTE_BASELINE_USAGE_MATRIX_INCOMPLETE",
    expectsCheckpoint: false,
  },
  {
    id: "waived_usage_matrix_with_rationale_allows_promotion",
    fixture: "tests/fixtures/perf-integration-risk/direct-merge",
    workingBranch: "S301-integration",
    mutate(targetRoot) {
      fs.rmSync(path.join(targetRoot, "docs", "audit", "cycles", "C302-feature-beta"), { recursive: true, force: true });
      const statusPath = path.join(targetRoot, "docs", "audit", "cycles", "C301-feature-alpha", "status.md");
      const base = fs.readFileSync(statusPath, "utf8");
      fs.writeFileSync(
        statusPath,
        `${base}\nusage_matrix_scope: high-risk\nusage_matrix_state: WAIVED\nusage_matrix_summary: nominal + adversarial pending\nusage_matrix_rationale: explicit temporary waiver approved in cycle decisions\n`,
        "utf8",
      );
    },
    expectedAction: "promote_baseline_allowed",
    expectedResult: "ok",
    expectedReasonCode: null,
    expectsCheckpoint: true,
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
  const hookReasonCode = hook?.reason_code ?? hook?.admission?.reason_code ?? hook?.summary?.reason_code ?? "";
  const codexReasonCode = codex?.reason_code
    ?? codex?.normalized?.reason_code
    ?? codex?.hook?.reason_code
    ?? codex?.admission?.reason_code
    ?? codex?.raw?.reason_code
    ?? "";
  const hookCheckpointRan = Boolean(hook?.summary?.checkpoint_ran ?? hook?.checkpoint);

  const checks = {
    hook_action_expected: String(hook?.action ?? "") === testCase.expectedAction,
    hook_result_expected: String(hook?.result ?? "") === testCase.expectedResult,
    hook_reason_code_expected: String(hookReasonCode) === String(testCase.expectedReasonCode ?? ""),
    hook_checkpoint_expected: testCase.expectsCheckpoint === true ? hookCheckpointRan : !hookCheckpointRan,
    codex_action_expected: String(codex?.action ?? "") === testCase.expectedAction,
    codex_result_expected: String(codex?.result ?? "") === testCase.expectedResult,
    codex_reason_code_expected: String(codexReasonCode) === String(testCase.expectedReasonCode ?? ""),
    codex_blocking_reasons_expected: testCase.expectedReasonCode === "PROMOTE_BASELINE_USAGE_MATRIX_INCOMPLETE"
      ? Array.isArray(codex?.blocking_reasons) && codex.blocking_reasons.some((item) => {
        const normalized = String(item).toLowerCase();
        return normalized.includes("cross-usage evidence") || normalized.includes("usage matrix");
      })
      : true,
    codex_recommended_next_action_expected: testCase.expectedReasonCode === "PROMOTE_BASELINE_USAGE_MATRIX_INCOMPLETE"
      ? String(codex?.recommended_next_action ?? "").toLowerCase().includes("usage matrix")
      : true,
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
      codex_blocking_reasons: Array.isArray(codex?.blocking_reasons) ? codex.blocking_reasons : [],
      codex_recommended_next_action: codex?.recommended_next_action ?? null,
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
