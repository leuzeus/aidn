#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readEventSignalStats } from "../../src/application/runtime/gating-observation-service.mjs";
import { resolveWorkflowSnapshotBackend } from "../../src/application/runtime/runtime-snapshot-service.mjs";
import { copyFixtureToTmp, initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { isActivationFixtureSource, prepareActivationFixture } from "./test-activation-fixture-lib.mjs";
import { inspectImmediateProcessExitArguments } from "../verify/spawn-sync-evidence-lib.mjs";

const CASES = [
  {
    id: "complete_cycle_passes", fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "feature/C101-alpha", expectedAction: "audit_cycle_branch",
    expectedResult: "ok", expectsGating: true, complete: true, warm: true,
  },
  {
    id: "complete_cycle_warning_propagates", fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "feature/C101-alpha", expectedAction: "run_conditional_drift_check",
    expectedResult: "warn", expectsGating: true, complete: true,
  },
  {
    id: "non_compliant_branch",
    fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "feature/multi-agent-handoff-foundation",
    expectedAction: "blocked_non_compliant_branch",
    expectedResult: "stop",
    expectsGating: false,
  },
  {
    id: "cycle_branch_maps",
    fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "feature/C101-alpha",
    expectedAction: "stop_and_triage_incident",
    expectedResult: "stop",
    expectsGating: true,
  },
  {
    id: "session_branch_maps",
    fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "S101-alpha",
    expectedAction: "stop_and_triage_incident",
    expectedResult: "stop",
    expectsGating: true,
  },
  {
    id: "missing_session_mapping_blocks",
    fixture: "tests/fixtures/perf-current-state/missing-session",
    workingBranch: "S101-alpha",
    expectedAction: "blocked_non_compliant_branch",
    expectedResult: "stop",
    expectsGating: false,
  },
];

function parseArgs(argv) {
  const args = {
    tmpRoot: os.tmpdir(),
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
  console.log("  node tools/perf/verify-branch-cycle-audit-admission-fixtures.mjs");
}

function verifyHookExitPolicy() {
  const hookFile = path.resolve(process.cwd(), "tools", "perf", "branch-cycle-audit-hook.mjs");
  const source = fs.readFileSync(hookFile, "utf8");
  const immediateExitArguments = inspectImmediateProcessExitArguments(source);
  if (
    immediateExitArguments.length !== 1
    || immediateExitArguments[0] !== "0"
  ) {
    throw new Error(
      "branch-cycle-audit hook may only use immediate process.exit(0) for help; "
      + `found ${immediateExitArguments.join(", ")}`,
    );
  }
  const oldSuccessExitMutant = `${source}\nprocess.exit(0);\n`;
  const mutantArguments = inspectImmediateProcessExitArguments(oldSuccessExitMutant);
  if (mutantArguments.length === immediateExitArguments.length) {
    throw new Error("branch-cycle-audit immediate-success-exit mutant was not detected");
  }
  return {
    immediate_exit_arguments: immediateExitArguments,
    help_exit_only: true,
    immediate_success_exit_mutant_rejected: true,
  };
}

function runJson(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  const run = spawnSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  assert.notEqual(run.status, null, 'hook must complete');
  const result = JSON.parse(run.stdout);
  if (script.includes('branch-cycle-audit-hook')) {
    assert.equal(run.status, result.result === 'stop' || result.result === 'error' ? 1 : 0);
  }
  return result;
}

function verifyObservationBoundaries(root) {
  const file = path.join(root, 'events.ndjson');
  const nowMs = Date.now();
  const event = (reason, extra = {}) => ({ skill: 'reload-check', result: 'fallback',
    ts: new Date(nowMs).toISOString(), branch: 'S101-alpha', reason_code: reason, ...extra });
  const events = [event('MISSING_CACHE'), event('HEAD_CHANGED'), event('BRANCH_CHANGED'), event('HEAD_CHANGED|DIGEST_MISS'),
    event('CORRUPT_CACHE', { ts: new Date(nowMs - 46 * 60000).toISOString() }),
    event('CORRUPT_CACHE', { branch: 'S102-other' }),
    event('CORRUPT_CACHE'), event('HEAD_CHANGED|CORRUPT_CACHE'),
    event('', { reason_codes: ['STATE_MODE_FALLBACK'] })];
  fs.writeFileSync(file, events.map(row => JSON.stringify(row).replaceAll('\":', '\": ')).join('\n'));
  const before = fs.readFileSync(file);
  assert.equal(readEventSignalStats(file, { nowMs, branch: 'S101-alpha' }).fallbackRecentCount, 3);
  assert.deepEqual(fs.readFileSync(file), before, 'observation must not erase history');
  for (const ts of ['invalid', new Date(nowMs + 60000).toISOString()]) {
    fs.writeFileSync(file, JSON.stringify(event('CORRUPT_CACHE', { ts })));
    assert.equal(readEventSignalStats(file, { nowMs, branch: 'S101-alpha' }).fallbackRecentCount, 1);
  }
  fs.mkdirSync(path.join(root, '.aidn'), { recursive: true });
  fs.writeFileSync(path.join(root, '.aidn/config.json'), JSON.stringify({ runtime: { persistence: { backend: 'postgres', connectionRef: 'env:UNUSED_TEST_DB' } } }));
  assert.equal(resolveWorkflowSnapshotBackend(root, 'legacy.sqlite', 'auto'), 'postgres');
  assert.throws(() => resolveWorkflowSnapshotBackend(root, 'legacy.sqlite', 'sqlite'), /conflicts/);
}

function runCase(tmpRoot, testCase, onTargetCreated) {
  const sourceTarget = path.resolve(process.cwd(), testCase.fixture);
  const targetRoot = copyFixtureToTmp(sourceTarget, tmpRoot, `tmp-branch-cycle-audit-${testCase.id}`, {
    onDestinationCreated: onTargetCreated,
    filter: (source) => isActivationFixtureSource(sourceTarget, source, { freshContext: true }),
  });
  initGitRepo(targetRoot, {
    workingBranch: testCase.workingBranch,
  });
  prepareActivationFixture(targetRoot);
  if (testCase.complete) for (const relative of ['baseline/current.md', 'WORKFLOW.md', 'SPEC.md']) {
    const file = path.join(targetRoot, 'docs/audit', relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '# Temporary workflow artifact\n');
  }
  fs.appendFileSync(path.join(targetRoot, '.git/info/exclude'), '\n/.aidn/runtime/\n');
  execFileSync("git", ["-C", targetRoot, "add", "."], { stdio: "pipe" });
  execFileSync("git", ["-C", targetRoot, "commit", "--amend", "--no-edit"], { stdio: "pipe" });
  if (testCase.warm) runJson('tools/perf/reload-check.mjs', ['--target', targetRoot, '--write-cache', '--json']);

  const hook = runJson("tools/perf/branch-cycle-audit-hook.mjs", [
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);
  const codex = runJson("tools/codex/run-json-hook.mjs", [
    "--skill",
    "branch-cycle-audit",
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);

  const checks = {
    hook_action_expected: String(hook?.action ?? "") === testCase.expectedAction,
    hook_result_expected: String(hook?.result ?? "") === testCase.expectedResult,
    hook_gating_expected: Boolean(hook?.gating) === testCase.expectsGating,
    admission_preserved: !testCase.expectsGating || hook.admission.ok === true,
    nested_gate_propagated: !hook.gating || hook.result === hook.gating.result,
    codex_action_expected: String(codex?.action ?? "") === testCase.expectedAction,
    codex_result_expected: String(codex?.result ?? "") === testCase.expectedResult,
    codex_ok_matches_result: Boolean(codex?.ok) === (testCase.expectedResult === "ok"),
    codex_reason_code_present: String(codex?.normalized?.reason_code ?? hook?.reason_code ?? "").length > 0 || testCase.expectedResult === "ok",
  };
  return {
    id: testCase.id,
    source_target: sourceTarget,
    target_root: targetRoot,
    expected_action: testCase.expectedAction,
    expected_result: testCase.expectedResult,
    checks,
    sample: {
      hook_action: hook?.action ?? null,
      hook_result: hook?.result ?? null,
      hook_reason_code: hook?.reason_code ?? null,
      hook_gating_ran: Boolean(hook?.gating),
      codex_action: codex?.action ?? null,
      codex_result: codex?.result ?? null,
      codex_ok: codex?.ok ?? null,
      codex_reason_code: codex?.normalized?.reason_code ?? null,
      codex_command_status: codex?.command_status ?? null,
      codex_error: codex?.error ?? null,
    },
    pass: Object.values(checks).every((value) => value === true),
  };
}

function main() {
  const createdTargets = [];
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    const observationsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-gating-observations-'));
    createdTargets.push(observationsRoot);
    verifyObservationBoundaries(observationsRoot);
    const hookExitPolicy = verifyHookExitPolicy();
    const tmpRoot = path.resolve(process.cwd(), args.tmpRoot);
    const runs = CASES.map((testCase) => {
      return runCase(tmpRoot, testCase, (target) => createdTargets.push(target));
    });
    const pass = runs.every((run) => run.pass === true);
    const output = {
      ts: new Date().toISOString(),
      runs,
      hook_exit_policy: hookExitPolicy,
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

    if (!pass) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exitCode = 1;
  } finally {
    if (!args?.keepTmp) for (const target of createdTargets.reverse()) {
      const cleanup = removePathWithRetry(target);
      if (!cleanup.ok) { console.error(`Cleanup failed: ${cleanup.error?.message}`); process.exitCode = 1; }
    }
  }
}

main();
