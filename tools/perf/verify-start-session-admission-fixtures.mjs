#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { copyFixtureToTmp, initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";
import {
  createSpawnSyncEvidenceTracker,
  isSpawnSyncEvidence,
  verifySpawnSyncOraclePolicy,
} from "../verify/spawn-sync-evidence-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const spawnSyncEvidence = createSpawnSyncEvidenceTracker();
let jsonCallCount = 0;
let injectedFailureCall = 0;

function runProcess(command, argv, options = {}) {
  const result = spawnSync(command, argv, {
    encoding: "utf8",
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    input: options.input,
    timeout: options.timeout ?? 120000,
    maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
    windowsHide: true,
  });
  spawnSyncEvidence.recordReturn();
  return result;
}

function runGit(target, args) {
  const result = runProcess("git", ["-C", target, ...args], {
    timeout: 60000,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args[0] ?? "command"} failed with status ${result.status ?? "unknown"}`);
  }
}

const CASES = [
  {
    id: "non_compliant_branch",
    fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "feature/multi-agent-handoff-foundation",
    expectedAction: "blocked_non_compliant_branch",
    expectedResult: "stop",
    expectsWorkflowHook: false,
  },
  {
    id: "source_branch_allows_create",
    fixture: "tests/fixtures/repo-installed-core",
    workingBranch: "dev",
    expectedAction: "create_session_allowed",
    expectedResult: "ok",
    expectsWorkflowHook: true,
  },
  {
    id: "source_branch_read_only_explore",
    fixture: "tests/fixtures/repo-installed-core",
    workingBranch: "dev",
    mode: "THINKING",
    expectedAction: "create_session_allowed",
    expectedResult: "ok",
    expectedLane: "EXPLORE",
    expectsWorkflowHook: false,
    expectedDbSyncReason: "deferred_by_explore_lane",
  },
  {
    id: "cycle_branch_resumes",
    fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "feature/C101-alpha",
    expectedAction: "resume_current_cycle",
    expectedResult: "ok",
    expectsWorkflowHook: true,
  },
  {
    id: "session_branch_resumes_with_single_focus",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "S201-multi",
    expectedAction: "resume_current_session",
    expectedResult: "ok",
    expectsWorkflowHook: true,
    mutate(targetRoot) {
      const sessionFile = path.join(targetRoot, "docs", "audit", "sessions", "S201-multi.md");
      const text = fs.readFileSync(sessionFile, "utf8")
        .replace(/- integration_target_cycles:\s*\r?\n\s*- C201\r?\n\s*- C202/u, "- integration_target_cycles:\n  - C201")
        .replace(/- attached_cycles:\s*\r?\n\s*- C201\r?\n\s*- C202/u, "- attached_cycles:\n  - C201")
        .replace(/- cycle_branch: `feature\/C201-alpha`/u, "- cycle_branch: `feature/C201-alpha`\n- primary_focus_cycle: `C201`");
      fs.writeFileSync(sessionFile, text, "utf8");
    },
  },
  {
    id: "session_multi_requires_choice",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "S201-multi",
    expectedAction: "choose_cycle",
    expectedResult: "stop",
    expectsWorkflowHook: false,
  },
  {
    id: "session_mapping_missing_blocks",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "S999-missing",
    expectedAction: "blocked_non_compliant_branch",
    expectedResult: "stop",
    expectsWorkflowHook: false,
  },
  {
    id: "cycle_mapping_missing_blocks",
    fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "feature/C999-missing",
    expectedAction: "blocked_non_compliant_branch",
    expectedResult: "stop",
    expectsWorkflowHook: false,
  },
  {
    id: "source_branch_resumes_previous_session_when_pr_open",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "dev",
    expectedAction: "resume_current_session",
    expectedResult: "ok",
    expectsWorkflowHook: true,
    mutate(targetRoot) {
      const currentState = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
      fs.writeFileSync(currentState, [
        "# Current State",
        "",
        "## Summary",
        "",
        "updated_at: 2026-03-19T00:00:00Z",
        "structure_profile: modern",
        "runtime_state_mode: files",
        "repair_layer_status: unknown",
        "",
        "## Active Context",
        "",
        "active_session: none",
        "session_branch: none",
        "branch_kind: source",
        "mode: THINKING",
        "",
        "active_cycle: none",
        "cycle_branch: none",
        "dor_state: unknown",
        "first_plan_step: unknown",
      ].join("\n"), "utf8");
      for (const cycleFile of [
        path.join(targetRoot, "docs", "audit", "cycles", "C201-feature-alpha", "status.md"),
        path.join(targetRoot, "docs", "audit", "cycles", "C202-feature-beta", "status.md"),
      ]) {
        const text = fs.readFileSync(cycleFile, "utf8").replace(/state:\s*(OPEN|IMPLEMENTING|VERIFYING)/gu, "state: DONE");
        fs.writeFileSync(cycleFile, text, "utf8");
      }
      const sessionFile = path.join(targetRoot, "docs", "audit", "sessions", "S201-multi.md");
      fs.appendFileSync(sessionFile, "\n\n### PR Orchestration\n- pr_status: `open`\n- pr_review_status: `pending`\n\n### Session close gate satisfied?\n- [x] Yes\n", "utf8");
    },
  },
  {
    id: "source_branch_blocks_when_post_merge_sync_required",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "dev",
    expectedAction: "blocked_session_base_gate",
    expectedResult: "stop",
    expectsWorkflowHook: false,
    mutate(targetRoot) {
      const currentState = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
      fs.writeFileSync(currentState, [
        "# Current State",
        "",
        "## Summary",
        "",
        "updated_at: 2026-03-19T00:00:00Z",
        "structure_profile: modern",
        "runtime_state_mode: files",
        "repair_layer_status: unknown",
        "",
        "## Active Context",
        "",
        "active_session: none",
        "session_branch: none",
        "branch_kind: source",
        "mode: THINKING",
        "",
        "active_cycle: none",
        "cycle_branch: none",
        "dor_state: unknown",
        "first_plan_step: unknown",
      ].join("\n"), "utf8");
      for (const cycleFile of [
        path.join(targetRoot, "docs", "audit", "cycles", "C201-feature-alpha", "status.md"),
        path.join(targetRoot, "docs", "audit", "cycles", "C202-feature-beta", "status.md"),
      ]) {
        const text = fs.readFileSync(cycleFile, "utf8").replace(/state:\s*(OPEN|IMPLEMENTING|VERIFYING)/gu, "state: DONE");
        fs.writeFileSync(cycleFile, text, "utf8");
      }
      const sessionFile = path.join(targetRoot, "docs", "audit", "sessions", "S201-multi.md");
      fs.appendFileSync(sessionFile, "\n\n### PR Orchestration\n- pr_status: `merged`\n- pr_review_status: `approved`\n- post_merge_sync_status: `required`\n\n### Session close gate satisfied?\n- [x] Yes\n", "utf8");
    },
  },
  {
    id: "source_branch_blocks_stale_open_cycle_merged_into_source",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "dev",
    expectedAction: "blocked_stale_open_cycle_state",
    expectedResult: "stop",
    expectsWorkflowHook: false,
    mutate(targetRoot) {
      const currentState = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
      fs.writeFileSync(currentState, [
        "# Current State",
        "",
        "## Summary",
        "",
        "updated_at: 2026-03-19T00:00:00Z",
        "structure_profile: modern",
        "runtime_state_mode: files",
        "repair_layer_status: unknown",
        "",
        "## Active Context",
        "",
        "active_session: none",
        "session_branch: none",
        "branch_kind: source",
        "mode: THINKING",
        "",
        "active_cycle: none",
        "cycle_branch: none",
        "dor_state: unknown",
        "first_plan_step: unknown",
      ].join("\n"), "utf8");
      const doneCycle = path.join(targetRoot, "docs", "audit", "cycles", "C202-feature-beta", "status.md");
      const doneText = fs.readFileSync(doneCycle, "utf8").replace(/state:\s*(OPEN|IMPLEMENTING|VERIFYING)/gu, "state: DONE");
      fs.writeFileSync(doneCycle, doneText, "utf8");
    },
    configureGit(targetRoot) {
      runGit(targetRoot, ["checkout", "-b", "S201-multi"]);
      runGit(targetRoot, ["checkout", "-b", "feature/C201-alpha"]);
      fs.appendFileSync(path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md"), "\n", "utf8");
      runGit(targetRoot, ["add", "."]);
      runGit(targetRoot, ["commit", "-m", "cycle C201"]);
      runGit(targetRoot, ["checkout", "S201-multi"]);
      runGit(targetRoot, ["merge", "--no-ff", "--no-edit", "feature/C201-alpha"]);
      runGit(targetRoot, ["checkout", "dev"]);
      runGit(targetRoot, ["merge", "--no-ff", "--no-edit", "S201-multi"]);
    },
  },
  {
    id: "source_branch_blocks_stale_open_cycle_merged_into_source_db_only",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "dev",
    expectedAction: "blocked_stale_open_cycle_state",
    expectedResult: "stop",
    expectsWorkflowHook: false,
    env: {
      AIDN_STATE_MODE: "db-only",
    },
    mutate(targetRoot) {
      const currentState = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
      fs.writeFileSync(currentState, [
        "# Current State",
        "",
        "## Summary",
        "",
        "updated_at: 2026-03-19T00:00:00Z",
        "structure_profile: modern",
        "runtime_state_mode: db-only",
        "repair_layer_status: unknown",
        "",
        "## Active Context",
        "",
        "active_session: none",
        "session_branch: none",
        "branch_kind: source",
        "mode: THINKING",
        "",
        "active_cycle: none",
        "cycle_branch: none",
        "dor_state: unknown",
        "first_plan_step: unknown",
      ].join("\n"), "utf8");
      const doneCycle = path.join(targetRoot, "docs", "audit", "cycles", "C202-feature-beta", "status.md");
      const doneText = fs.readFileSync(doneCycle, "utf8").replace(/state:\s*(OPEN|IMPLEMENTING|VERIFYING)/gu, "state: DONE");
      fs.writeFileSync(doneCycle, doneText, "utf8");
    },
    configureGit(targetRoot) {
      runGit(targetRoot, ["checkout", "-b", "S201-multi"]);
      runGit(targetRoot, ["checkout", "-b", "feature/C201-alpha"]);
      fs.appendFileSync(path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md"), "\n", "utf8");
      runGit(targetRoot, ["add", "."]);
      runGit(targetRoot, ["commit", "-m", "cycle C201"]);
      runGit(targetRoot, ["checkout", "S201-multi"]);
      runGit(targetRoot, ["merge", "--no-ff", "--no-edit", "feature/C201-alpha"]);
      runGit(targetRoot, ["checkout", "dev"]);
      runGit(targetRoot, ["merge", "--no-ff", "--no-edit", "S201-multi"]);
    },
  },
];

function parseArgs(argv) {
  const args = {
    tmpRoot: os.tmpdir(),
    keepTmp: false,
    json: false,
    caseId: null,
    injectFailureCall: 0,
    skipAutoProbe: false,
    help: false,
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
    } else if (token === "--case") {
      args.caseId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--inject-failure-call") {
      args.injectFailureCall = Number(argv[i + 1] ?? 0);
      i += 1;
    } else if (token === "--skip-auto-probe") {
      args.skipAutoProbe = true;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-start-session-admission-fixtures.mjs [--case <id>] [--json] [--keep-tmp]");
}

function runJson(script, scriptArgs, env = {}) {
  jsonCallCount += 1;
  if (injectedFailureCall > 0 && jsonCallCount === injectedFailureCall) {
    const error = new Error(`injected failure at JSON child call ${jsonCallCount}`);
    error.code = "AIDN_START_SESSION_INJECTED_CHILD_FAILURE";
    throw error;
  }
  const file = path.resolve(REPO_ROOT, script);
  const result = runProcess(process.execPath, [file, ...scriptArgs], {
    env: {
      ...process.env,
      ...env,
    },
  });
  const stdout = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "").trim();
  for (const candidate of [stdout, stderr]) {
    if (candidate.startsWith("{")) {
      try {
        return JSON.parse(candidate);
      } catch {
      }
    }
  }
  const tail = [stdout, stderr]
    .filter(Boolean)
    .join("\n")
    .split(/\r?\n/)
    .slice(-12)
    .join("\n");
  throw new Error(
    `JSON child failed status=${result.status ?? "unknown"} signal=${result.signal ?? "none"}`
      + (tail ? `\n${tail}` : ""),
  );
}

function listMatchingDirectories(root, prefix) {
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => path.resolve(root, entry.name))
    .sort();
}

function runCase(tmpRoot, testCase, onTargetCreated) {
  const sourceTarget = path.resolve(REPO_ROOT, testCase.fixture);
  const targetRoot = copyFixtureToTmp(
    sourceTarget,
    tmpRoot,
    `tmp-start-session-${testCase.id}`,
    { onDestinationCreated: onTargetCreated },
  );
  if (typeof testCase.mutate === "function") {
    testCase.mutate(targetRoot);
  }
  initGitRepo(targetRoot, {
    workingBranch: testCase.workingBranch,
  });
  if (typeof testCase.configureGit === "function") {
    testCase.configureGit(targetRoot);
  }

  const mode = testCase.mode ?? "COMMITTING";
  const hook = runJson("tools/perf/start-session-hook.mjs", [
    "--target",
    targetRoot,
    "--mode",
    mode,
    "--json",
  ], testCase.env);
  const cliHook = runJson("bin/aidn.mjs", [
    "perf",
    "session-start",
    "--target",
    targetRoot,
    "--mode",
    mode,
    "--json",
  ], testCase.env);
  const codex = runJson("tools/codex/run-json-hook.mjs", [
    "--skill",
    "start-session",
    "--target",
    targetRoot,
    "--mode",
    mode,
    "--json",
  ], testCase.env);

  const checks = {
    hook_action_expected: String(hook?.action ?? "") === testCase.expectedAction,
    hook_result_expected: String(hook?.result ?? "") === testCase.expectedResult,
    hook_workflow_hook_expected: Boolean(hook?.workflow_hook) === testCase.expectsWorkflowHook,
    hook_workspace_present: String(hook?.workspace?.workspace_id ?? "").length > 0,
    hook_worktree_present: String(hook?.workspace?.worktree_id ?? "").length > 0,
    cli_action_matches_admission_hook: String(cliHook?.action ?? "") === String(hook?.action ?? ""),
    cli_result_matches_admission_hook: String(cliHook?.result ?? "") === String(hook?.result ?? ""),
    cli_workflow_hook_matches_admission_hook: Boolean(cliHook?.workflow_hook) === Boolean(hook?.workflow_hook),
    codex_action_expected: String(codex?.action ?? "") === testCase.expectedAction,
    codex_result_expected: String(codex?.result ?? "") === testCase.expectedResult,
    codex_ok_matches_result: Boolean(codex?.ok) === (testCase.expectedResult === "ok"),
    codex_reason_code_present: String(codex?.normalized?.reason_code ?? hook?.reason_code ?? "").length > 0 || testCase.expectedResult === "ok",
    hook_lane_expected: String(hook?.lane ?? "") === String(testCase.expectedLane ?? "STANDARD"),
    codex_lane_expected: String(codex?.lane ?? "") === String(testCase.expectedLane ?? "STANDARD"),
    branch_role_explicit: ["source", "work", "unmanaged", "unknown"].includes(String(hook?.branch_role ?? "")),
    source_direct_writes_false: hook?.source_direct_writes === false,
    required_gates_present: Array.isArray(hook?.required_gates) && hook.required_gates.length > 0,
    source_next_action_present: String(hook?.branch_role ?? "") !== "source"
      || String(hook?.admission?.recommended_next_action ?? "").length > 0,
    codex_source_next_action_present: String(codex?.branch_role ?? "") !== "source"
      || String(codex?.recommended_next_action ?? "").length > 0,
    db_sync_lane_policy_expected: testCase.expectedDbSyncReason
      ? String(codex?.db_sync?.reason ?? "") === testCase.expectedDbSyncReason
      : true,
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
      hook_workflow_ran: Boolean(hook?.workflow_hook),
      hook_workspace_id: hook?.workspace?.workspace_id ?? null,
      hook_is_linked_worktree: hook?.workspace?.is_linked_worktree ?? null,
      cli_action: cliHook?.action ?? null,
      cli_result: cliHook?.result ?? null,
      cli_workflow_ran: Boolean(cliHook?.workflow_hook),
      codex_action: codex?.action ?? null,
      codex_result: codex?.result ?? null,
      codex_ok: codex?.ok ?? null,
      codex_reason_code: codex?.normalized?.reason_code ?? null,
      codex_command_status: codex?.command_status ?? null,
      codex_error: codex?.error ?? codex?.normalized?.error ?? null,
      lane: hook?.lane ?? null,
      branch_role: hook?.branch_role ?? null,
      work_branch_required: hook?.work_branch_required ?? null,
      codex_db_sync_reason: codex?.db_sync?.reason ?? null,
    },
    pass: Object.values(checks).every((value) => value === true),
  };
}

function runFailureCleanupProbe(args) {
  const probeRoot = fs.mkdtempSync(path.join(args.tmpRoot, "aidn-start-session-failure-probe-"));
  let result;
  try {
    result = runProcess(process.execPath, [
      path.resolve(REPO_ROOT, "tools", "perf", "verify-start-session-admission-fixtures.mjs"),
      "--case",
      "source_branch_allows_create",
      "--tmp-root",
      probeRoot,
      "--json",
      "--inject-failure-call",
      "3",
      "--skip-auto-probe",
    ], {
      timeout: 180000,
    });
    const residualTargets = listMatchingDirectories(probeRoot, "tmp-start-session-");
    let payload = null;
    try {
      payload = JSON.parse(String(result.stdout ?? "{}"));
    } catch {
    }
    const timeoutResult = runProcess(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ], {
      timeout: 250,
    });
    let transientAttempts = 0;
    const transientRetry = removePathWithRetry("synthetic-transient", {
      retries: 2,
      delayMs: 0,
      rmSyncImpl() {
        transientAttempts += 1;
        if (transientAttempts < 3) {
          const error = new Error("synthetic transient cleanup failure");
          error.code = "EPERM";
          throw error;
        }
      },
    });
    let persistentAttempts = 0;
    const persistentRetry = removePathWithRetry("synthetic-persistent", {
      retries: 2,
      delayMs: 0,
      rmSyncImpl() {
        persistentAttempts += 1;
        const error = new Error("synthetic persistent cleanup failure");
        error.code = "EBUSY";
        throw error;
      },
    });
    const timeoutObserved = timeoutResult.error?.code === "ETIMEDOUT"
      || timeoutResult.signal != null
      || timeoutResult.status == null;
    const childCompletionEvidenceValid = isSpawnSyncEvidence(payload?.processes);
    const retryProbePass = transientRetry.ok
      && transientRetry.attempts === 3
      && !persistentRetry.ok
      && persistentRetry.attempts === 3;
    return {
      pass: result.status !== 0
        && payload?.injected_failure_observed === true
        && payload?.cleanup?.all_removed === true
        && childCompletionEvidenceValid
        && residualTargets.length === 0
        && timeoutObserved
        && retryProbePass,
      expected_nonzero_exit: result.status !== 0,
      injected_failure_observed: payload?.injected_failure_observed === true,
      child_cleanup_reported: payload?.cleanup?.all_removed === true,
      child_completion_evidence_valid: childCompletionEvidenceValid,
      residual_target_count: residualTargets.length,
      timeout_probe: {
        timeout_observed: timeoutObserved,
        spawn_sync_returned: true,
      },
      retry_probe: {
        pass: retryProbePass,
        transient_success_attempts: transientRetry.attempts,
        persistent_failure_attempts: persistentRetry.attempts,
      },
    };
  } finally {
    const removal = removePathWithRetry(probeRoot);
    if (!removal.ok) {
      throw removal.error;
    }
    if (fs.existsSync(probeRoot)) {
      throw new Error("start-session failure probe root remains after cleanup");
    }
  }
}

function main() {
  const oracleRegression = verifySpawnSyncOraclePolicy({
    source: fs.readFileSync(fileURLToPath(import.meta.url), "utf8"),
    label: "verify-start-session-admission-fixtures",
  });
  const createdTargets = [];
  const cleanupResults = [];
  let args = null;
  let primaryError = null;
  let runs = [];
  let failureProbe = null;
  let pass = false;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printUsage();
      return;
    }
    args.tmpRoot = path.resolve(REPO_ROOT, args.tmpRoot);
    injectedFailureCall = Number.isInteger(args.injectFailureCall) && args.injectFailureCall > 0
      ? args.injectFailureCall
      : 0;
    jsonCallCount = 0;
    const selectedCases = args.caseId
      ? CASES.filter((testCase) => testCase.id === args.caseId)
      : CASES;
    if (selectedCases.length === 0) {
      throw new Error(`Unknown case: ${args.caseId}`);
    }
    for (const testCase of selectedCases) {
      runs.push(runCase(args.tmpRoot, testCase, (target) => {
        createdTargets.push(target);
      }));
    }
    pass = runs.every((run) => run.pass === true);
  } catch (error) {
    primaryError = error;
  } finally {
    if (!args?.keepTmp) {
      for (const target of [...createdTargets].reverse()) {
        const cleanup = removePathWithRetry(target);
        cleanupResults.push({
          target,
          ok: cleanup.ok && !fs.existsSync(target),
          attempts: cleanup.attempts,
          error: cleanup.error?.message ?? null,
        });
      }
    }
  }
  const allTargetsRemoved = args?.keepTmp === true
    || (cleanupResults.length === createdTargets.length
      && cleanupResults.every((item) => item.ok));
  if (!args?.skipAutoProbe && !args?.caseId && primaryError == null && pass && allTargetsRemoved) {
    try {
      failureProbe = runFailureCleanupProbe(args);
    } catch (error) {
      primaryError = error;
    }
  }
  const injectedFailureObserved = injectedFailureCall > 0
    && primaryError?.code === "AIDN_START_SESSION_INJECTED_CHILD_FAILURE";
  const autoProbeSatisfied = Boolean(
    args?.skipAutoProbe || args?.caseId || failureProbe?.pass === true,
  );
  const finalPass = Boolean(primaryError == null
    && pass
    && allTargetsRemoved
    && autoProbeSatisfied);
  const output = {
    ts: new Date().toISOString(),
    runs,
    cleanup: {
      targets_registered: createdTargets.length,
      targets_cleaned: cleanupResults.length,
      all_removed: allTargetsRemoved,
      results: cleanupResults,
    },
    processes: spawnSyncEvidence.snapshot(),
    oracle_regression: oracleRegression,
    failure_probe: failureProbe,
    injected_failure_observed: injectedFailureObserved,
    error: primaryError
      ? {
        name: primaryError.name,
        code: primaryError.code ?? null,
        message: primaryError.message,
      }
      : null,
    pass: finalPass,
  };
  if (args?.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    for (const run of runs) {
      console.log(`${run.pass ? "PASS" : "FAIL"} ${run.id}`);
    }
    console.log(`Cleanup: ${allTargetsRemoved ? "PASS" : "FAIL"}`);
    if (failureProbe) {
      console.log(`Injected third-call failure cleanup: ${failureProbe.pass ? "PASS" : "FAIL"}`);
    }
    if (primaryError) {
      console.error(`ERROR: ${primaryError.message}`);
    }
    console.log(`Result: ${finalPass ? "PASS" : "FAIL"}`);
  }
  if (!finalPass) {
    process.exitCode = 1;
  }
}

main();
