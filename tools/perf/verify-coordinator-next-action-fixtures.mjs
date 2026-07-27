#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { redactDiagnostic } from "../verify/git-worktree-state-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const FAILURE_INJECTION_ENV = "AIDN_COORDINATOR_NEXT_FIXTURE_INJECT_FAILURE";
const FAILURE_PROBE_TOKEN_ENV = "AIDN_COORDINATOR_NEXT_FIXTURE_PROBE_TOKEN";
const MAX_CHILD_DIAGNOSTIC_CHARACTERS = 2000;
const SELF_FILE = path.resolve(
  import.meta.dirname,
  "verify-coordinator-next-action-fixtures.mjs",
);

function parseArgs(argv) {
  const args = {
    handoffFixturesRoot: "tests/fixtures/perf-handoff",
    currentStateFixturesRoot: "tests/fixtures/perf-current-state",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--handoff-fixtures-root") {
      args.handoffFixturesRoot = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--current-state-fixtures-root") {
      args.currentStateFixturesRoot = String(argv[i + 1] ?? "").trim();
      i += 1;
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
  console.log("  node tools/perf/verify-coordinator-next-action-fixtures.mjs");
  console.log("  node tools/perf/verify-coordinator-next-action-fixtures.mjs --json");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function diagnosticTail(value, env) {
  const redacted = redactDiagnostic(value, env).trim();
  if (redacted.length <= MAX_CHILD_DIAGNOSTIC_CHARACTERS) {
    return redacted;
  }
  const suffixLength = MAX_CHILD_DIAGNOSTIC_CHARACTERS - 30;
  return `...[diagnostic tail truncated]${redacted.slice(-suffixLength)}`;
}

function childFailureMessage(script, args, expectStatus, result, env) {
  return [
    `Command failed (${path.basename(script)})`,
    `args=${JSON.stringify(diagnosticTail(JSON.stringify(args), env))}`,
    `expected_status=${expectStatus}`,
    `actual_status=${Number.isInteger(result?.status) ? result.status : "null"}`,
    `signal=${result?.signal ?? "null"}`,
    `error_code=${result?.error?.code ?? "null"}`,
    `error=${JSON.stringify(diagnosticTail(result?.error?.message, env))}`,
    `stdout_tail=${JSON.stringify(diagnosticTail(result?.stdout, env))}`,
    `stderr_tail=${JSON.stringify(diagnosticTail(result?.stderr, env))}`,
  ].join(" | ");
}

function runJson(
  script,
  args,
  repoRoot,
  expectStatus = 0,
  env = {},
  {
    timeoutMs = 180000,
    maxBuffer = 10 * 1024 * 1024,
  } = {},
) {
  const childEnv = { ...process.env, ...env };
  let result;
  try {
    result = spawnSync(process.execPath, [script, ...args], {
      cwd: repoRoot,
      env: childEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      timeout: timeoutMs,
      maxBuffer,
      windowsHide: true,
    });
  } catch (error) {
    result = {
      status: null,
      signal: null,
      error,
      stdout: "",
      stderr: "",
    };
  }
  const processContractSatisfied = result?.status === expectStatus
    && result?.signal == null
    && result?.error == null;
  if (!processContractSatisfied) {
    throw new Error(childFailureMessage(script, args, expectStatus, result, childEnv));
  }
  try {
    return JSON.parse(String(result.stdout ?? "{}"));
  } catch (error) {
    throw new Error([
      `Invalid JSON (${path.basename(script)})`,
      `actual_status=${result.status}`,
      `signal=${result.signal ?? "null"}`,
      `error_code=${result.error?.code ?? "null"}`,
      `parse_error=${JSON.stringify(diagnosticTail(error.message, childEnv))}`,
      `stdout_tail=${JSON.stringify(diagnosticTail(result.stdout, childEnv))}`,
      `stderr_tail=${JSON.stringify(diagnosticTail(result.stderr, childEnv))}`,
    ].join(" | "));
  }
}

function captureExpectedFailure(callback, label) {
  try {
    callback();
  } catch (error) {
    return String(error?.message ?? error);
  }
  throw new Error(`${label} unexpectedly passed`);
}

function verifyChildFailureDiagnostics(repoRoot) {
  const diagnosticRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "aidn-coordinator-next-diagnostics-"),
  );
  try {
    const configuredSecret = "postgresql://fixture:secret@localhost:5432/aidn";
    const exitScript = path.join(diagnosticRoot, "exit-with-stdout.mjs");
    fs.writeFileSync(exitScript, [
      `process.stdout.write(${JSON.stringify(`${configuredSecret}\nstdout-before-exit\n`)});`,
      "process.exitCode = 9;",
      "",
    ].join("\n"), "utf8");
    const exitMessage = captureExpectedFailure(
      () => runJson(exitScript, [], repoRoot, 0, {
        AIDN_PG_SMOKE_URL: configuredSecret,
      }),
      "nonzero child diagnostic probe",
    );
    assert(exitMessage.includes("actual_status=9"), "child failure must preserve exit status");
    assert(exitMessage.includes("signal=null"), "child failure must preserve the signal field");
    assert(exitMessage.includes("error_code=null"), "child failure must preserve error code");
    assert(
      exitMessage.includes("stdout-before-exit"),
      "child failure must preserve stdout when stderr is empty",
    );
    assert(!exitMessage.includes("fixture:secret"), "child failure diagnostics must redact secrets");

    const timeoutScript = path.join(diagnosticRoot, "timeout-with-stdout.mjs");
    fs.writeFileSync(timeoutScript, [
      "process.stdout.write('stdout-before-timeout\\n');",
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n"), "utf8");
    const timeoutMessage = captureExpectedFailure(
      () => runJson(timeoutScript, [], repoRoot, 0, {}, { timeoutMs: 200 }),
      "timeout child diagnostic probe",
    );
    assert(timeoutMessage.includes("actual_status=null"), "timeout must preserve null exit status");
    assert(timeoutMessage.includes("signal="), "timeout must preserve the signal field");
    assert(
      timeoutMessage.includes("error_code=ETIMEDOUT"),
      "timeout must preserve ETIMEDOUT",
    );

    return {
      nonzero_exit_status: 9,
      null_signal_preserved: true,
      null_error_code_preserved: true,
      stdout_tail_preserved_with_empty_stderr: true,
      configured_secret_redacted: true,
      timeout_error_code: "ETIMEDOUT",
    };
  } finally {
    removePathWithRetry(diagnosticRoot);
  }
}

function verifyInjectedFailureCleanup(repoRoot) {
  const token = randomUUID();
  const ownedPrefix = `aidn-coordinator-next-probe-${token}-`;
  const result = spawnSync(process.execPath, [SELF_FILE, "--json"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      [FAILURE_INJECTION_ENV]: "after-temp-root",
      [FAILURE_PROBE_TOKEN_ENV]: token,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  const stderr = String(result.stderr ?? "");
  const observedRemaining = fs.readdirSync(os.tmpdir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(ownedPrefix))
    .map((entry) => path.join(os.tmpdir(), entry.name));
  const recoveryFailures = [];
  for (const ownedPath of observedRemaining) {
    try {
      removePathWithRetry(ownedPath);
    } catch (error) {
      recoveryFailures.push(`${ownedPath}: ${error.message}`);
    }
  }
  assert(result.status === 1, "injected coordinator-next failure must exit 1");
  assert(
    stderr.includes("injected failure after temp root"),
    "injected coordinator-next failure must preserve the primary error",
  );
  assert(
    observedRemaining.length === 0,
    "injected coordinator-next failure leaked owned temp roots before recovery: "
      + `${observedRemaining.join(", ")}`
      + (recoveryFailures.length > 0
        ? `; recovery failures: ${recoveryFailures.join(", ")}`
        : ""),
  );
  return {
    injected_failure_exit_code: result.status,
    primary_error_preserved: true,
    owned_test_directories_remaining: observedRemaining.length,
    recovery_failures: recoveryFailures.length,
  };
}

function installSharedPlanningFixture(targetRoot) {
  const currentStateFile = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
  const currentStateText = fs.readFileSync(currentStateFile, "utf8");
  fs.writeFileSync(currentStateFile, currentStateText.replace(
    "first_plan_step: implement alpha feature validation",
    [
      "first_plan_step: implement alpha feature validation",
      "active_backlog: backlog/BL-S101-session-planning.md",
      "backlog_status: promoted",
      "backlog_next_step: implement alpha feature validation",
      "planning_arbitration_status: none",
    ].join("\n"),
  ), "utf8");
  const backlogDir = path.join(targetRoot, "docs", "audit", "backlog");
  fs.mkdirSync(backlogDir, { recursive: true });
  fs.writeFileSync(path.join(backlogDir, "BL-S101-session-planning.md"), [
    "# Session Backlog - S101",
    "",
    "## Summary",
    "",
    "updated_at: 2026-03-09T01:03:00Z",
    "session_id: S101",
    "session_branch: S101-alpha",
    "mode: COMMITTING",
    "planning_status: promoted",
    "linked_cycles: C101",
    "dispatch_ready: yes",
    "planning_arbitration_status: none",
    "next_dispatch_scope: cycle",
    "next_dispatch_action: implement",
    "backlog_next_step: implement alpha feature validation",
    "",
  ].join("\n"), "utf8");
}

function main() {
  let tempRoot = "";
  let args = null;
  let output = null;
  let primaryError = null;
  let cleanupError = null;
  try {
    args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const failureInjection = String(process.env[FAILURE_INJECTION_ENV] ?? "").trim();
    const failureProbeToken = String(process.env[FAILURE_PROBE_TOKEN_ENV] ?? "").trim();
    const childFailureDiagnostics = failureInjection
      ? null
      : verifyChildFailureDiagnostics(repoRoot);
    const injectedFailureCleanup = failureInjection
      ? null
      : verifyInjectedFailureCleanup(repoRoot);
    const handoffFixturesRoot = path.resolve(repoRoot, args.handoffFixturesRoot);
    const currentStateFixturesRoot = path.resolve(repoRoot, args.currentStateFixturesRoot);
    const coordinatorScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-next-action.mjs");
    const handoffProjectScript = path.resolve(repoRoot, "tools", "runtime", "project-handoff-packet.mjs");

    const tempPrefix = failureProbeToken
      ? `aidn-coordinator-next-probe-${failureProbeToken}-`
      : "aidn-coordinator-next-";
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), tempPrefix));
    if (failureInjection === "after-temp-root") {
      throw new Error("injected failure after temp root");
    }
    const readyTarget = path.join(tempRoot, "ready");
    const warnTarget = path.join(tempRoot, "warn");
    const blockedTarget = path.join(tempRoot, "blocked");
    const tamperedTarget = path.join(tempRoot, "tampered");
    const transitionRejectedTarget = path.join(tempRoot, "transition-rejected");
    const fallbackTarget = path.join(tempRoot, "fallback");
    const dbOnlyFilelessTarget = path.join(tempRoot, "db-only-fileless");

    fs.cpSync(path.join(handoffFixturesRoot, "ready"), readyTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "warn"), warnTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "blocked"), blockedTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), tamperedTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), transitionRejectedTarget, { recursive: true });
    fs.cpSync(path.join(currentStateFixturesRoot, "active"), fallbackTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), dbOnlyFilelessTarget, { recursive: true });
    installSharedPlanningFixture(readyTarget);
    installSharedPlanningFixture(dbOnlyFilelessTarget);

    runJson(handoffProjectScript, ["--target", readyTarget, "--write", "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", warnTarget, "--write", "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", blockedTarget, "--write", "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", tamperedTarget, "--write", "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", transitionRejectedTarget, "--write", "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", dbOnlyFilelessTarget, "--write", "--json"], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    runJson(path.resolve(repoRoot, "tools", "perf", "index-sync.mjs"), [
      "--target", dbOnlyFilelessTarget,
      "--store", "sqlite",
      "--with-content",
      "--json",
    ], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    for (const rel of [
      "docs/audit/CURRENT-STATE.md",
      "docs/audit/RUNTIME-STATE.md",
      "docs/audit/HANDOFF-PACKET.md",
      "docs/audit/sessions/S101-alpha.md",
      "docs/audit/cycles/C101-feature-alpha/status.md",
      "docs/audit/backlog/BL-S101-session-planning.md",
    ]) {
      fs.rmSync(path.join(dbOnlyFilelessTarget, rel), { force: true });
    }

    const tamperedPacketPath = path.join(tamperedTarget, "docs", "audit", "HANDOFF-PACKET.md");
    const tamperedText = fs.readFileSync(tamperedPacketPath, "utf8").replace("active_cycle: C101", "active_cycle: C999");
    fs.writeFileSync(tamperedPacketPath, tamperedText, "utf8");
    const transitionRejectedPacketPath = path.join(transitionRejectedTarget, "docs", "audit", "HANDOFF-PACKET.md");
    const transitionRejectedText = fs.readFileSync(transitionRejectedPacketPath, "utf8")
      .replace("handoff_from_agent_role: coordinator", "handoff_from_agent_role: repair")
      .replace("handoff_from_agent_action: relay", "handoff_from_agent_action: repair")
      .replace("transition_policy_status: allowed", "transition_policy_status: transition_not_allowed")
      .replace("transition_policy_reason: COMMITTING allows coordinator -> executor", "transition_policy_reason: COMMITTING does not allow repair -> executor");
    fs.writeFileSync(transitionRejectedPacketPath, transitionRejectedText, "utf8");

    const fallbackRuntimeState = path.join(fallbackTarget, "docs", "audit", "RUNTIME-STATE.md");
    fs.writeFileSync(fallbackRuntimeState, [
      "# Runtime State Digest",
      "",
      "## Summary",
      "",
      "updated_at: 2026-03-09T01:05:00Z",
      "runtime_state_mode: dual",
      "repair_layer_status: ok",
      "repair_layer_advice: continue with the planned implementation flow",
      "repair_routing_hint: execution-or-audit",
      "repair_routing_reason: repair layer reports no blocking findings for the current relay",
      "",
      "## Current State Freshness",
      "",
      "current_state_freshness: ok",
      "current_state_freshness_basis: current-state timestamps are aligned with active cycle timestamps",
      "",
      "## Blocking Findings",
      "",
      "blocking_findings:",
      "- none",
      "",
      "## Prioritized Reads",
      "",
      "prioritized_artifacts:",
      "- `docs/audit/CURRENT-STATE.md`",
      "",
    ].join("\n"), "utf8");

    const ready = runJson(coordinatorScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    const warn = runJson(coordinatorScript, ["--target", warnTarget, "--json"], repoRoot, 0);
    const blocked = runJson(coordinatorScript, ["--target", blockedTarget, "--json"], repoRoot, 0);
    const tampered = runJson(coordinatorScript, ["--target", tamperedTarget, "--json"], repoRoot, 0);
    const transitionRejected = runJson(coordinatorScript, ["--target", transitionRejectedTarget, "--json"], repoRoot, 0);
    const fallback = runJson(coordinatorScript, ["--target", fallbackTarget, "--json"], repoRoot, 0);
    const dbOnlyFileless = runJson(coordinatorScript, ["--target", dbOnlyFilelessTarget, "--json"], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });

    assert(ready.recommendation.role === "executor", "ready should route to executor");
    assert(ready.recommendation.action === "implement", "ready should route to implement");
    assert(ready.handoff?.route?.role === "executor", "ready handoff should expose normalized route");
    assert(ready.recommendation.source === "handoff-shared-planning", "ready should come from shared planning handoff");
    assert(ready.preferred_dispatch_source === "shared_planning", "ready should expose shared planning provenance");
    assert(ready.shared_planning_candidate?.shared_planning_candidate_ready === "yes", "ready should expose a ready shared planning candidate");
    assert(ready.shared_planning_candidate?.shared_planning_candidate_aligned === "yes", "ready should expose an aligned shared planning candidate");
    assert(ready.next_action_diagnostic?.recommended_role === "executor", "ready should expose the recommended role in the stable diagnostic");
    assert(ready.scope.scope_type === "cycle", "ready should preserve cycle scope");
    assert(ready.scope.scope_id === "C101", "ready should preserve active cycle id");

    assert(warn.recommendation.role === "auditor", "warn should route to auditor");
    assert(warn.recommendation.action === "audit", "warn should route to audit");
    assert(warn.scope.scope_type === "cycle", "warn should preserve cycle scope");

    assert(blocked.recommendation.role === "repair", "blocked should route to repair");
    assert(blocked.recommendation.action === "repair", "blocked should route to repair action");
    assert(blocked.handoff?.status?.admission_status === "blocked", "blocked handoff should expose normalized status");
    assert(blocked.recommendation.stop_required === true, "blocked should require stop");
    assert(blocked.next_action_diagnostic?.stop_required === true, "blocked should expose stop-required in the stable diagnostic");
    assert(blocked.scope.scope_type === "cycle", "blocked should preserve cycle scope");

    assert(tampered.recommendation.role === "coordinator", "tampered should fall back to coordinator");
    assert(tampered.recommendation.action === "reanchor", "tampered should fall back to reanchor");
    assert(tampered.recommendation.source === "handoff-admit", "tampered should come from handoff-admit");

    assert(transitionRejected.recommendation.role === "coordinator", "transition-rejected should fall back to coordinator");
    assert(transitionRejected.recommendation.action === "reanchor", "transition-rejected should fall back to reanchor");
    assert(transitionRejected.recommendation.source === "handoff-admit", "transition-rejected should come from handoff-admit");

    assert(fallback.recommendation.role === "executor", "fallback should route to executor");
    assert(fallback.recommendation.action === "implement", "fallback should route to implement");
    assert(fallback.recommendation.source === "current-state", "fallback should come from current-state");
    assert(fallback.next_action_diagnostic?.source === "current-state", "fallback should expose its source in the stable diagnostic");
    assert(fallback.scope.scope_type === "cycle", "fallback should derive cycle scope from current state");
    assert(dbOnlyFileless.recommendation.role === "executor", "db-only fileless should still route to executor");
    assert(dbOnlyFileless.recommendation.action === "implement", "db-only fileless should still route to implement");
    assert(dbOnlyFileless.recommendation.source === "handoff-shared-planning", "db-only fileless should keep shared-planning relay");
    assert(dbOnlyFileless.scope.scope_type === "cycle", "db-only fileless should preserve cycle scope");
    assert(dbOnlyFileless.context.current_state_source === "sqlite", "db-only fileless should load current state from SQLite");
    assert(dbOnlyFileless.context.runtime_state_source === "sqlite", "db-only fileless should load runtime state from SQLite");
    assert(dbOnlyFileless.context.packet_source === "sqlite", "db-only fileless should load packet from SQLite");

    output = {
      ts: new Date().toISOString(),
      ready,
      warn,
      blocked,
      tampered,
      transition_rejected: transitionRejected,
      fallback,
      db_only_fileless: dbOnlyFileless,
      child_failure_diagnostics: childFailureDiagnostics,
      injected_failure_cleanup: injectedFailureCleanup,
      pass: true,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      try {
        removePathWithRetry(tempRoot);
      } catch (error) {
        cleanupError = error;
      }
    }
  }
  if (primaryError) {
    console.error(`ERROR: ${primaryError.message}`);
  }
  if (cleanupError) {
    console.error(`ERROR: cleanup failed: ${cleanupError.message}`);
  }
  if (primaryError || cleanupError) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  output.cleanup = {
    temporary_root_removed: true,
  };
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log("PASS");
  }
}

main();
