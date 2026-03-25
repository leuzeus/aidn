#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { copyFixtureToTmp, initGitRepo } from "./test-git-fixture-lib.mjs";

function upsertScalarLine(text, key, value) {
  const pattern = new RegExp(`^${key}:\\s*.*$`, "im");
  if (pattern.test(text)) {
    return text.replace(pattern, `${key}: ${value}`);
  }
  const normalized = text.endsWith("\n") ? text : `${text}\n`;
  return `${normalized}${key}: ${value}\n`;
}

const CASES = [
  {
    id: "open_cycle_allows_checkpoint",
    fixture: "tests/fixtures/perf-integration-risk/direct-merge",
    workingBranch: "S301-integration",
    expectedAction: "cycle_close_allowed",
    expectedResult: "ok",
    expectedReasonCode: null,
    expectsCheckpoint: true,
  },
  {
    id: "done_shared_surface_requires_verified_usage_matrix",
    fixture: "tests/fixtures/perf-integration-risk/direct-merge",
    workingBranch: "S301-integration",
    mutate(targetRoot) {
      const currentStatePath = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
      const currentState = fs.readFileSync(currentStatePath, "utf8").replace(/^active_cycle:\s*.*$/im, "active_cycle: C301");
      fs.writeFileSync(currentStatePath, currentState, "utf8");
      const statusPath = path.join(targetRoot, "docs", "audit", "cycles", "C301-feature-alpha", "status.md");
      let status = fs.readFileSync(statusPath, "utf8").replace(/^state:\s*.*$/im, "state: DONE");
      status = upsertScalarLine(status, "usage_matrix_scope", "shared");
      status = upsertScalarLine(status, "usage_matrix_state", "NOT_DEFINED");
      status = upsertScalarLine(status, "usage_matrix_summary", "nominal + alternate");
      status = upsertScalarLine(status, "usage_matrix_rationale", "none");
      fs.writeFileSync(statusPath, status, "utf8");
    },
    expectedAction: "blocked_validation_incomplete",
    expectedResult: "stop",
    expectedReasonCode: "CYCLE_CLOSE_USAGE_MATRIX_INCOMPLETE",
    expectsCheckpoint: false,
  },
  {
    id: "done_high_risk_waiver_allows_checkpoint",
    fixture: "tests/fixtures/perf-integration-risk/direct-merge",
    workingBranch: "S301-integration",
    mutate(targetRoot) {
      const currentStatePath = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
      const currentState = fs.readFileSync(currentStatePath, "utf8").replace(/^active_cycle:\s*.*$/im, "active_cycle: C301");
      fs.writeFileSync(currentStatePath, currentState, "utf8");
      const statusPath = path.join(targetRoot, "docs", "audit", "cycles", "C301-feature-alpha", "status.md");
      let status = fs.readFileSync(statusPath, "utf8").replace(/^state:\s*.*$/im, "state: DONE");
      status = upsertScalarLine(status, "usage_matrix_scope", "high-risk");
      status = upsertScalarLine(status, "usage_matrix_state", "WAIVED");
      status = upsertScalarLine(status, "usage_matrix_summary", "nominal + adversarial pending");
      status = upsertScalarLine(status, "usage_matrix_rationale", "explicit temporary waiver approved in cycle decisions");
      fs.writeFileSync(statusPath, status, "utf8");
    },
    expectedAction: "cycle_close_allowed",
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
  console.log("  node tools/perf/verify-cycle-close-admission-fixtures.mjs");
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
  const targetRoot = copyFixtureToTmp(sourceTarget, tmpRoot, `tmp-cycle-close-${testCase.id}`);
  if (typeof testCase.mutate === "function") {
    testCase.mutate(targetRoot);
  }
  initGitRepo(targetRoot, {
    sourceBranch: "dev",
    workingBranch: testCase.workingBranch,
  });

  const hook = runJson("tools/perf/cycle-close-hook.mjs", [
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);
  const codex = runJson("tools/codex/run-json-hook.mjs", [
    "--skill",
    "cycle-close",
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
