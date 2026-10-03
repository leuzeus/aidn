#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { inspectImmediateProcessExitArguments } from "../verify/spawn-sync-evidence-lib.mjs";
import { prepareActivationFixture } from "./test-activation-fixture-lib.mjs";
import { createLocalGitAdapter } from "../../src/adapters/runtime/local-git-adapter.mjs";

const SELF_FILE = fileURLToPath(import.meta.url);
const CLEANUP_PROBE_ENV = "AIDN_PRE_WRITE_ADMIT_CLEANUP_PROBE";
const TEMP_PREFIX = "aidn-pre-write-admit-";

function parseArgs(argv) {
  const args = {
    fixturesRoot: "tests/fixtures/perf-handoff",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--fixtures-root") {
      args.fixturesRoot = String(argv[i + 1] ?? "").trim();
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
  console.log("  node tools/perf/verify-pre-write-admit-fixtures.mjs");
  console.log("  node tools/perf/verify-pre-write-admit-fixtures.mjs --fixtures-root tests/fixtures/perf-handoff --json");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runAidn(repoRoot, args, expectStatus = 0) {
  return runAidnWithEnv(repoRoot, args, {}, expectStatus);
}

function runAidnWithEnv(repoRoot, args, env = {}, expectStatus = 0) {
  const cli = path.resolve(repoRoot, "bin", "aidn.mjs");
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== expectStatus) {
    throw new Error(`Command failed (aidn ${args.join(" ")}): ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "{}"));
}

function runNodeJson(repoRoot, script, args, env = {}, expectStatus = 0) {
  const file = path.resolve(repoRoot, script);
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== expectStatus) {
    throw new Error(`Command failed (${script} ${args.join(" ")}): ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "{}"));
}

function installSharedPlanningFixture(targetRoot, { selectedExecutionScope = "none" } = {}) {
  const currentStateFile = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
  const currentStateText = fs.readFileSync(currentStateFile, "utf8");
  fs.writeFileSync(currentStateFile, currentStateText.replace(
    "first_plan_step: implement alpha feature validation",
    [
      "first_plan_step: implement alpha feature validation",
      "active_backlog: backlog/BL-S101-session-planning.md",
      "backlog_status: promoted",
      "backlog_next_step: select the first cycle scope",
      `backlog_selected_execution_scope: ${selectedExecutionScope}`,
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
    "backlog_next_step: select the first cycle scope",
    `selected_execution_scope: ${selectedExecutionScope}`,
    "",
  ].join("\n"), "utf8");
}

function installRepairWarningFixture(targetRoot) {
  const runtimeStateFile = path.join(targetRoot, "docs", "audit", "RUNTIME-STATE.md");
  fs.writeFileSync(runtimeStateFile, [
    "# Runtime State Digest",
    "",
    "## Summary",
    "",
    "updated_at: 2026-03-09T01:05:00Z",
    "runtime_state_mode: dual",
    "repair_layer_status: warn",
    "repair_layer_advice: Review open repair findings, starting with UNTRACKED_CYCLE_STATUS_REFERENCE.",
    "repair_primary_reason: warning: UNTRACKED_CYCLE_STATUS_REFERENCE: docs/audit/snapshots/context-snapshot.md: Artifact references cycle C901; matching cycle status artifact cycles/C901-local-only/status.md exists locally, but it is not tracked/materialized in the current index.",
    "repair_routing_hint: audit-first",
    "repair_routing_reason: Review open repair findings, starting with UNTRACKED_CYCLE_STATUS_REFERENCE.",
    "",
    "## Current State Freshness",
    "",
    "current_state_freshness: ok",
    "current_state_freshness_basis: current-state timestamps are aligned with active cycle timestamps",
    "",
    "## Blocking Findings",
    "",
    "blocking_findings:",
    "- warning: UNTRACKED_CYCLE_STATUS_REFERENCE: docs/audit/snapshots/context-snapshot.md: Artifact references cycle C901; matching cycle status artifact cycles/C901-local-only/status.md exists locally, but it is not tracked/materialized in the current index.",
    "",
    "## Prioritized Reads",
    "",
    "prioritized_artifacts:",
    "- `docs/audit/CURRENT-STATE.md`",
    "- `docs/audit/RUNTIME-STATE.md`",
    "",
  ].join("\n"), "utf8");
}

function installDbOnlyReadyRuntimeFixture(targetRoot, stateMode = "db-only") {
  const runtimeStateFile = path.join(targetRoot, "docs", "audit", "RUNTIME-STATE.md");
  fs.writeFileSync(runtimeStateFile, [
    "# Runtime State Digest",
    "",
    "## Summary",
    "",
    "updated_at: 2026-03-22T12:05:00Z",
    `runtime_state_mode: ${stateMode}`,
    "repair_layer_status: ok",
    "repair_layer_advice: none",
    "repair_routing_hint: continue",
    "repair_routing_reason: runtime repair layer is clear",
    "",
    "## Current State Freshness",
    "",
    "current_state_freshness: ok",
    "current_state_freshness_basis: CURRENT-STATE facts are synchronized in SQLite",
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
    "- `docs/audit/RUNTIME-STATE.md`",
    "- `docs/audit/cycles/C101-*/status.md`",
    "",
  ].join("\n"), "utf8");
}

function setSessionBranchCurrentState(targetRoot) {
  const currentStateFile = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
  const currentStateText = fs.readFileSync(currentStateFile, "utf8")
    .replace("branch_kind: cycle", "branch_kind: session");
  fs.writeFileSync(currentStateFile, currentStateText, "utf8");
}

function runGit(targetRoot, args) {
  const result = spawnSync("git", ["-C", targetRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return String(result.stdout ?? "").trim();
}

function installGitCycleCreateFixtures(targetRoot, mode) {
  initGitRepo(targetRoot, {
    workingBranch: "feature/C101-alpha",
  });
  const remoteRoot = path.join(path.dirname(targetRoot), `${path.basename(targetRoot)}-origin.git`);
  runGit(path.dirname(targetRoot), ["init", "--bare", remoteRoot]);
  runGit(targetRoot, ["remote", "add", "origin", remoteRoot]);
  runGit(targetRoot, ["push", "-u", "origin", "main"]);
  runGit(targetRoot, ["push", "-u", "origin", "feature/C101-alpha"]);

  const workingFile = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
  if (mode === "dirty") {
    fs.writeFileSync(workingFile, `${fs.readFileSync(workingFile, "utf8")}\nlocal change\n`, "utf8");
    return;
  }

  if (mode === "ahead") {
    fs.writeFileSync(workingFile, `${fs.readFileSync(workingFile, "utf8")}\nlocal commit ahead\n`, "utf8");
    runGit(targetRoot, ["add", "docs/audit/CURRENT-STATE.md"]);
    runGit(targetRoot, ["commit", "-m", "ahead fixture"]);
  }
}

function installSessionMergeFixture(targetRoot) {
  setSessionBranchCurrentState(targetRoot);
  initGitRepo(targetRoot, {
    workingBranch: "main",
  });
  const remoteRoot = path.join(path.dirname(targetRoot), `${path.basename(targetRoot)}-origin.git`);
  runGit(path.dirname(targetRoot), ["init", "--bare", remoteRoot]);
  runGit(targetRoot, ["remote", "add", "origin", remoteRoot]);
  runGit(targetRoot, ["push", "-u", "origin", "main"]);
  runGit(targetRoot, ["checkout", "-b", "S101-alpha"]);
  runGit(targetRoot, ["push", "-u", "origin", "S101-alpha"]);
  runGit(targetRoot, ["checkout", "-b", "feature/C101-alpha"]);
  const cycleStatusFile = path.join(targetRoot, "docs", "audit", "cycles", "C101-feature-alpha", "status.md");
  fs.writeFileSync(cycleStatusFile, `${fs.readFileSync(cycleStatusFile, "utf8")}\nmerge fixture\n`, "utf8");
  runGit(targetRoot, ["add", "docs/audit/cycles/C101-feature-alpha/status.md"]);
  runGit(targetRoot, ["commit", "-m", "cycle branch work"]);
  runGit(targetRoot, ["push", "-u", "origin", "feature/C101-alpha"]);
  runGit(targetRoot, ["checkout", "S101-alpha"]);
}

function installDbOnlyIndexFixture(repoRoot, targetRoot, stateMode = "db-only") {
  const env = {
    AIDN_STATE_MODE: "db-only",
    AIDN_INDEX_STORE_MODE: "sqlite",
  };
  installDbOnlyReadyRuntimeFixture(targetRoot, stateMode);
  runNodeJson(repoRoot, "tools/perf/index-sync.mjs", [
    "--target",
    targetRoot,
    "--store",
    "sqlite",
    "--with-content",
    "--json",
  ], env);
}

function upsertScalarLine(text, key, value) {
  const pattern = new RegExp(`^${key}:\\s*.*$`, "im");
  if (pattern.test(text)) {
    return text.replace(pattern, `${key}: ${value}`);
  }
  const normalized = text.endsWith("\n") ? text : `${text}\n`;
  return `${normalized}${key}: ${value}\n`;
}

function installCycleCloseUsageMatrixFixture(targetRoot, {
  scope = "shared",
  state = "NOT_DEFINED",
  summary = "nominal + alternate",
  rationale = "none",
} = {}) {
  const statusFile = path.join(targetRoot, "docs", "audit", "cycles", "C101-feature-alpha", "status.md");
  let statusText = fs.readFileSync(statusFile, "utf8");
  statusText = upsertScalarLine(statusText, "state", "DONE");
  statusText = upsertScalarLine(statusText, "usage_matrix_scope", scope);
  statusText = upsertScalarLine(statusText, "usage_matrix_state", state);
  statusText = upsertScalarLine(statusText, "usage_matrix_summary", summary);
  statusText = upsertScalarLine(statusText, "usage_matrix_rationale", rationale);
  fs.writeFileSync(statusFile, statusText, "utf8");
}

function installInvalidSharedRuntimeLocator(targetRoot, {
  workspaceId = "workspace-locator",
  backendKind = "sqlite-file",
  root = "docs/audit/shared-runtime",
  connectionRef = "",
} = {}) {
  const locatorDir = path.join(targetRoot, ".aidn", "project");
  fs.mkdirSync(locatorDir, { recursive: true });
  fs.writeFileSync(path.join(locatorDir, "shared-runtime.locator.json"), `${JSON.stringify({
    version: 1,
    enabled: true,
    workspaceId,
    backend: {
      kind: backendKind,
      root,
      connectionRef,
    },
    projection: {
      localIndexMode: "preserve-current",
    },
  }, null, 2)}\n`, "utf8");
}

function listOwnedTempRoots() {
  return fs.readdirSync(os.tmpdir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(TEMP_PREFIX))
    .map((entry) => path.resolve(os.tmpdir(), entry.name))
    .sort();
}

function verifyExitPolicy(repoRoot) {
  const runtimePath = path.resolve(repoRoot, "tools", "runtime", "pre-write-admit.mjs");
  const runtimeSource = fs.readFileSync(runtimePath, "utf8");
  const fixtureSource = fs.readFileSync(SELF_FILE, "utf8");
  const runtimeImmediateExitArguments = inspectImmediateProcessExitArguments(runtimeSource);
  const fixtureImmediateExitArguments = inspectImmediateProcessExitArguments(fixtureSource);
  assert(
    runtimeImmediateExitArguments.length === 1 && runtimeImmediateExitArguments[0] === "0",
    "pre-write-admit may only use immediate process.exit(0) for help; "
      + `found ${runtimeImmediateExitArguments.join(", ")}`,
  );
  assert(
    fixtureImmediateExitArguments.length === 1 && fixtureImmediateExitArguments[0] === "0",
    "pre-write-admit fixture may only use immediate process.exit(0) for help; "
      + `found ${fixtureImmediateExitArguments.join(", ")}`,
  );

  const mutationNeedle = "process.exitCode = 1;";
  assert(
    runtimeSource.includes(mutationNeedle),
    "pre-write-admit must defer nonzero termination through process.exitCode",
  );
  assert(
    fixtureSource.includes(mutationNeedle),
    "pre-write-admit fixture must defer nonzero termination through process.exitCode",
  );
  const runtimeMutantArguments = inspectImmediateProcessExitArguments(
    runtimeSource.replace(mutationNeedle, "process.exit(1);"),
  );
  const fixtureMutantLines = fixtureSource.split(/\r?\n/);
  const fixtureMutationIndex = fixtureMutantLines.findIndex(
    (line, index) => line.trim() === mutationNeedle
      && fixtureMutantLines[index + 1]?.trim() === "} finally {",
  );
  assert(
    fixtureMutationIndex >= 0,
    "pre-write-admit fixture deferred catch exit was not found for mutation",
  );
  fixtureMutantLines[fixtureMutationIndex] = "    process.exit(1);";
  const fixtureMutantArguments = inspectImmediateProcessExitArguments(
    fixtureMutantLines.join("\n"),
  );
  assert(
    runtimeMutantArguments.includes("1"),
    "pre-write-admit immediate-exit mutant was not detected",
  );
  assert(
    fixtureMutantArguments.includes("1"),
    "pre-write-admit fixture immediate-exit mutant was not detected",
  );
  return {
    runtime_immediate_exit_arguments: runtimeImmediateExitArguments,
    fixture_immediate_exit_arguments: fixtureImmediateExitArguments,
    deferred_nonzero_exit: true,
    runtime_process_exit_1_mutant_rejected: true,
    fixture_process_exit_1_mutant_rejected: true,
  };
}

function verifyInjectedFailureCleanup(repoRoot) {
  const before = listOwnedTempRoots();
  const result = spawnSync(process.execPath, [SELF_FILE], {
    cwd: repoRoot,
    env: {
      ...process.env,
      [CLEANUP_PROBE_ENV]: "1",
    },
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  const after = listOwnedTempRoots();
  const introduced = after.filter((item) => !before.includes(item));
  assert(result.status === 1, "pre-write-admit injected cleanup probe should exit 1");
  assert(
    String(result.stderr ?? "").includes("injected pre-write-admit fixture failure"),
    "pre-write-admit injected cleanup probe should preserve its primary error",
  );
  assert(
    introduced.length === 0,
    `pre-write-admit injected cleanup probe leaked owned roots: ${introduced.join(", ")}`,
  );
  return {
    exit_code: result.status,
    primary_error_preserved: true,
    introduced_owned_roots_remaining: introduced.length,
  };
}

function verifyInitialContextReload(repoRoot, tempRoot, source) {
  const snapshot = (root) => {
    const entries = fs.readdirSync(root, { recursive: true, withFileTypes: true });
    return JSON.stringify(entries.filter((entry) => entry.isFile()).map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(root, file), fs.readFileSync(file).toString("base64")];
    }).sort(([a], [b]) => a.localeCompare(b)));
  };
  const results = [];
  for (const stateMode of ["files", "dual", "db-only"]) {
    const target = path.join(tempRoot, `initial-context-${stateMode}`);
    fs.cpSync(source, target, { recursive: true });
    const current = path.join(target, "docs/audit/CURRENT-STATE.md");
    let text = fs.readFileSync(current, "utf8");
    for (const [key, value] of Object.entries({ mode: "unknown", active_session: "none", active_cycle: "none", branch_kind: "unknown" })) {
      text = upsertScalarLine(text, key, value);
    }
    fs.writeFileSync(current, text);
    if (stateMode !== "files") installDbOnlyIndexFixture(repoRoot, target, stateMode);
    prepareActivationFixture(target, repoRoot);
    const env = { AIDN_STATE_MODE: stateMode };
    const before = snapshot(target);
    for (const skill of ["context-reload", "aidn-context-reload"]) {
      const result = runAidnWithEnv(repoRoot, ["runtime", "pre-write-admit", "--target", target, "--skill", skill, "--strict", "--json"], env);
      assert(result.ok && result.activation.active, `${stateMode}: initial context reload must be admitted`);
      assert(result.context.mode === "unknown", `${stateMode}: context reload must not invent a mode`);
      assert(result.context.active_session === "none", `${stateMode}: context reload must not invent a session`);
    }
    const write = runAidnWithEnv(repoRoot, ["runtime", "pre-write-admit", "--target", target, "--skill", "requirements-delta", "--strict", "--json"], env, 1);
    assert(!write.ok && write.blocking_reasons.includes("mode is unknown"), `${stateMode}: write admission must retain the mode gate`);
    assert(snapshot(target) === before, `${stateMode}: admission must leave every file unchanged`);
    results.push({ state_mode: stateMode, initial_read: "PASS", write_refusal: "PASS", unchanged: true });
  }
  const unavailable = path.join(tempRoot, "initial-context-unavailable");
  fs.cpSync(source, unavailable, { recursive: true });
  fs.mkdirSync(path.join(unavailable, ".aidn"), { recursive: true });
  fs.writeFileSync(path.join(unavailable, ".aidn/config.json"), JSON.stringify({
    runtime: { stateMode: "db-only", persistence: { backend: "postgres", localProjectionPolicy: "none", connectionRef: "env:AIDN_CONTEXT_RELOAD_UNAVAILABLE" } },
  }));
  prepareActivationFixture(unavailable, repoRoot);
  const before = snapshot(unavailable);
  const result = runAidnWithEnv(repoRoot, ["runtime", "pre-write-admit", "--target", unavailable, "--skill", "context-reload", "--strict", "--json"], { AIDN_STATE_MODE: "db-only", AIDN_CONTEXT_RELOAD_UNAVAILABLE: "" }, 1);
  assert(!result.ok && result.blocking_reasons.includes("canonical runtime backend is unavailable for context reload"), `context reload must reject an unavailable canonical backend despite visible anchors: ${JSON.stringify({ reasons: result.blocking_reasons, warnings: result.warnings, backend: result.context.shared_state_backend, skill: result.skill })}`);
  assert(snapshot(unavailable) === before, "unavailable backend diagnosis must not write");
  const inactive = path.join(tempRoot, "initial-context-inactive");
  fs.mkdirSync(inactive);
  const denied = runAidn(repoRoot, ["runtime", "pre-write-admit", "--target", inactive, "--skill", "context-reload", "--strict", "--json"], 1);
  assert(!denied.ok && !denied.activation.active && Object.values(denied.source_of_truth.observed_sources).every((s) => s === "not-read"), "inactive context reload must refuse before reading workflow context");
  return results;
}

function verifyInitialCycleAdmission(repoRoot, tempRoot, source) {
  const evidence = [];
  for (const stateMode of ["dual", "db-only"]) {
    for (const scenario of ["initial", "legacy-ok", "repair-warn", "repair-block", "repair-unknown", "unknown-cycle", "missing-cycle", "stale"]) {
      const admitted = ["initial", "legacy-ok"].includes(scenario);
      const repairStatus = scenario === "legacy-ok" ? "ok" : scenario.startsWith("repair-") ? scenario.slice(7) : "clean";
      const target = path.join(tempRoot, `initial-cycle-${stateMode}-${scenario}`);
      fs.cpSync(source, target, { recursive: true });
      const currentFile = path.join(target, "docs/audit/CURRENT-STATE.md");
      let current = fs.readFileSync(currentFile, "utf8");
      for (const [key, value] of Object.entries({ mode: "THINKING", active_session: "S101", active_cycle: scenario === "unknown-cycle" ? "unknown" : scenario === "missing-cycle" ? "C999" : "none",
        cycle_branch: "none", branch_kind: "session", session_branch: "S101-initial", updated_at: "2026-09-25" })) current = upsertScalarLine(current, key, value);
      fs.writeFileSync(currentFile, current);
      fs.writeFileSync(path.join(target, "docs/audit/sessions/S101-alpha.md"), "## WORK MODE - THINKING\nsession_branch: S101-initial\ncycle_branch: none\nprimary_focus_cycle: none\n");
      installDbOnlyReadyRuntimeFixture(target, stateMode);
      const runtimeFile = path.join(target, "docs/audit/RUNTIME-STATE.md");
      fs.writeFileSync(runtimeFile, upsertScalarLine(upsertScalarLine(fs.readFileSync(runtimeFile, "utf8"), "repair_layer_status", repairStatus), "current_state_freshness", scenario === "stale" ? "stale" : "unknown"));
      initGitRepo(target, { workingBranch: "S101-initial" });
      fs.appendFileSync(path.join(target, ".git/info/exclude"), "\n/.aidn/runtime/\n");
      prepareActivationFixture(target, repoRoot);
      runNodeJson(repoRoot, "tools/perf/index-sync.mjs", ["--target", target, "--store", "sqlite", "--with-content", "--json"], { AIDN_STATE_MODE: stateMode });
      // Misleading projection must not replace the canonical DB observation.
      fs.writeFileSync(currentFile, upsertScalarLine(current, "mode", "unknown"));
      runGit(target, ["add", "."]); runGit(target, ["commit", "-m", "prepared initial session"]);
      // Same bytes with stale stat metadata would make ordinary git status
      // refresh .git/index. Admission must preserve even this optional cache.
      fs.utimesSync(currentFile, new Date("2020-01-01"), new Date("2020-01-01"));
      const snapshot = () => JSON.stringify(fs.readdirSync(target, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile()).map(entry => { const file = path.join(entry.parentPath, entry.name); return [path.relative(target, file), fs.readFileSync(file).toString("base64")]; }).sort(([a], [b]) => a.localeCompare(b)));
      const before = snapshot();
      assert(!createLocalGitAdapter().hasWorkingTreeChanges(target), "stat-only changes must not count as dirty content");
      assert(snapshot() === before, "working tree inspection must not refresh the Git index");
      const result = runAidnWithEnv(repoRoot, ["runtime", "pre-write-admit", "--target", target, "--skill", "cycle-create", "--strict", "--json"], { AIDN_STATE_MODE: stateMode }, admitted ? 0 : 1);
      assert(result.ok === admitted, `${stateMode}/${scenario}: ${JSON.stringify(result.blocking_reasons)}`);
      assert(result.context.repair_layer_status === repairStatus, `${stateMode}/${scenario}: canonical repair status expected ${repairStatus}, got ${result.context.repair_layer_status}`);
      assert(result.context.current_state_source === "sqlite" && result.context.mode === "THINKING", "cycle-create must use canonical context despite misleading projection");
      assert(result.context.current_state_freshness === (scenario === "stale" ? "stale" : "unknown"), "admission must not invent freshness=ok");
      assert(Boolean(result.checks.cycle_create_initial_state_verified?.pass) === admitted, "initial-cycle evidence must be explicit and narrow");
      assert(snapshot() === before, "cycle admission must not change the project or its database");
      evidence.push({ state_mode: stateMode, scenario, pass: true, unchanged: true });
    }
  }
  return evidence;
}

function verifyCanonicalSourceSelection(repoRoot, tempRoot, source) {
  // Inject only the snapshot transport. Configuration, activation, canonical
  // artifact selection and admission policies execute from the source module.
  const readerFile = path.join(tempRoot, "canonical-reader.mjs");
  const loaderFile = path.join(tempRoot, "canonical-loader.mjs");
  const recordFile = path.join(tempRoot, "canonical-record.json");
  const initializerFile = path.join(tempRoot, "canonical-register.mjs");
  const runtimeFile = pathToFileURL(path.join(repoRoot, "tools/runtime/pre-write-admit.mjs")).href;
  const realReader = pathToFileURL(path.join(repoRoot, "tools/runtime/db-first-runtime-view-lib.mjs")).href;
  fs.writeFileSync(readerFile, `
    import fs from 'node:fs';
    export { resolveDbArtifactSourceName } from ${JSON.stringify(realReader)};
    export const calls = [];
    export async function loadDbIndexPayloadSafe(targetRoot, options = {}) {
      const record = JSON.parse(fs.readFileSync(process.env.AIDN_CANONICAL_FIXTURE_RECORD, 'utf8'));
      calls.push({ backend: options.backend ?? null, config_backend: options.configData?.runtime?.persistence?.backend ?? null });
      return { exists: record.available, payload: record.available ? record.payload : null,
        runtimeHeads: record.runtimeHeads ?? {}, sqliteFile: '',
        warning: record.available ? '' : 'controlled canonical backend unavailable',
        backend: { projection_backend_kind: options.backend || process.env.AIDN_RUNTIME_PERSISTENCE_BACKEND || record.backend,
          projection_scope: 'runtime-canonical' } };
    }
  `);
  fs.writeFileSync(loaderFile, `
    export async function resolve(specifier, context, nextResolve) {
      if (context.parentURL === ${JSON.stringify(runtimeFile)} && specifier === './db-first-runtime-view-lib.mjs')
        return { url: ${JSON.stringify(pathToFileURL(readerFile).href)}, shortCircuit: true };
      return nextResolve(specifier, context);
    }
  `);
  fs.writeFileSync(initializerFile, `import { register } from 'node:module'; register(${JSON.stringify(pathToFileURL(loaderFile).href)}, import.meta.url);`);
  const runner = `
    import { register } from 'node:module';
    register(${JSON.stringify(pathToFileURL(loaderFile).href)}, import.meta.url);
    const { preWriteAdmit } = await import(${JSON.stringify(runtimeFile)});
    const { calls } = await import(${JSON.stringify(pathToFileURL(readerFile).href)});
    try { console.log(JSON.stringify({ result: await preWriteAdmit({ targetRoot: process.env.AIDN_CANONICAL_FIXTURE_TARGET,
      skill: process.env.AIDN_CANONICAL_FIXTURE_SKILL }), calls })); }
    catch (error) { console.log(JSON.stringify({ error: error.message, calls })); }
  `;
  const snapshot = root => JSON.stringify(fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(root, file), fs.readFileSync(file).toString("base64")];
    }).sort(([a], [b]) => a.localeCompare(b)));
  const artifacts = root => ["CURRENT-STATE.md", "RUNTIME-STATE.md", "sessions/S101-alpha.md",
    "cycles/C101-feature-alpha/status.md", "cycles/C101-feature-alpha/plan.md"].map(relative => ({
    path: relative, content_format: "utf8", content: fs.readFileSync(path.join(root, "docs/audit", relative), "utf8"),
  }));
  const targets = new Map();
  function fixture(backend, stateMode) {
    const key = `${backend}-${stateMode}`;
    if (targets.has(key)) return targets.get(key);
    const root = path.join(tempRoot, `canonical-${key}`);
    fs.cpSync(source, root, { recursive: true });
    fs.mkdirSync(path.join(root, ".aidn"), { recursive: true });
    fs.writeFileSync(path.join(root, ".aidn/config.json"), JSON.stringify({ runtime: { stateMode,
      ...(backend === "postgres" ? { persistence: { backend, localProjectionPolicy: "none", connectionRef: "env:CONTROLLED_TEST_ONLY" } } : {}) } }));
    installDbOnlyReadyRuntimeFixture(root, stateMode);
    const current = path.join(root, "docs/audit/CURRENT-STATE.md");
    fs.writeFileSync(current, upsertScalarLine(fs.readFileSync(current, "utf8"), "mode", "THINKING"));
    fs.writeFileSync(path.join(root, "docs/audit/cycles/C101-feature-alpha/plan.md"), "## Tasks\n1. implement alpha feature validation\n");
    initGitRepo(root, { workingBranch: "feature/C101-alpha" });
    prepareActivationFixture(root, repoRoot);
    runGit(root, ["add", "."]); runGit(root, ["commit", "-m", "canonical selection fixture"]);
    const payload = { sessions: [], cycles: [], artifacts: artifacts(root), migration_findings: [] };
    payload.artifacts[0].content = upsertScalarLine(payload.artifacts[0].content, "mode", "EXPLORING");
    const value = { root, payload }; targets.set(key, value); return value;
  }
  const cases = [];
  const genericSkills = ["context-reload", "start-session", "cycle-create", "requirements-delta", "close-session", "handoff-close"];
  for (const stateMode of ["files", "dual", "db-only"]) {
    for (const skill of genericSkills) cases.push({ id: `postgres-${stateMode}-${skill}`, backend: "postgres", stateMode, skill, source: "postgres", mode: "EXPLORING" });
    for (const skill of ["context-reload", "start-session", "cycle-create"]) cases.push({ id: `postgres-${stateMode}-unavailable-${skill}`, backend: "postgres", stateMode, skill, unavailable: true, blocked: true });
    for (const missing of ["CURRENT-STATE.md", "RUNTIME-STATE.md", "sessions/S101-alpha.md", "cycles/C101-feature-alpha/status.md", "cycles/C101-feature-alpha/plan.md"])
      cases.push({ id: `postgres-${stateMode}-missing-${missing}`, backend: "postgres", stateMode, skill: "start-session", missing,
        blocked: !missing.endsWith("/plan.md"), ...(missing.endsWith("/plan.md") ? { source: "postgres", mode: "EXPLORING" } : {}) });
  }
  for (const skill of ["aidn-context-reload", "aidn-start-session", "aidn-cycle-create"])
    cases.push({ id: `postgres-dual-${skill}`, backend: "postgres", stateMode: "dual", skill, source: "postgres", mode: "EXPLORING" });
  cases.push({ id: "postgres-config-defeats-env-sqlite", backend: "postgres", stateMode: "dual", skill: "start-session", source: "postgres", mode: "EXPLORING", envBackend: "sqlite" });
  for (const defect of ["head-mismatch", "session-ambiguous", "cycle-ambiguous", "session-row-ambiguous", "session-row-path-mismatch", "session-row-branch-mismatch", "session-prefix", "cycle-prefix", "session-id-mismatch", "runtime-empty"])
    cases.push({ id: `postgres-${defect}`, backend: "postgres", stateMode: "dual", skill: "start-session", defect, blocked: true });
  cases.push({ id: "postgres-historical-current-head", backend: "postgres", stateMode: "dual", skill: "start-session", defect: "historical-head", source: "postgres", mode: "EXPLORING" });
  for (const strict of [false, true]) cases.push({ id: `postgres-head-cli-${strict ? "strict" : "default"}`, backend: "postgres", stateMode: "dual", skill: "start-session", defect: "head-mismatch", cli: true, strict, blocked: true });
  for (const stateMode of ["files", "dual", "db-only"]) for (const strict of [false, true])
    cases.push({ id: `postgres-${stateMode}-empty-head-cli-${strict ? "strict" : "default"}`, backend: "postgres", stateMode,
      skill: "start-session", defect: "empty-historical-head", cli: true, strict, blocked: true, mode: "unknown" });
  for (const skill of ["context-reload", "start-session", "cycle-create"])
    cases.push({ id: `sqlite-dual-${skill}`, backend: "sqlite", stateMode: "dual", skill, source: skill === "cycle-create" ? "sqlite" : "file", mode: skill === "cycle-create" ? "EXPLORING" : "THINKING" });
  cases.push({ id: "sqlite-dual-unavailable-compatible", backend: "sqlite", stateMode: "dual", skill: "start-session", unavailable: true, source: "file", mode: "THINKING" });
  cases.push({ id: "sqlite-dual-empty-head-db-preference-compatible", backend: "sqlite", stateMode: "dual", skill: "cycle-create", defect: "empty-historical-head", source: "sqlite", mode: "EXPLORING" });
  cases.push({ id: "sqlite-dual-empty-head-fileless-current-compatible", backend: "sqlite", stateMode: "dual", skill: "start-session", defect: "empty-historical-head", visibleCurrentMissing: true, source: "file", currentSource: "sqlite", mode: "EXPLORING" });
  cases.push({ id: "sqlite-db-only-unavailable", backend: "sqlite", stateMode: "db-only", skill: "start-session", unavailable: true, blocked: true });
  cases.push({ id: "sqlite-db-only-missing-current", backend: "sqlite", stateMode: "db-only", skill: "start-session", missing: "CURRENT-STATE.md", blocked: true });
  cases.push({ id: "files-optional-no-backend-read", backend: "sqlite", stateMode: "files", skill: "start-session", source: "file", mode: "THINKING", noRead: true });
  return cases.map(testCase => {
    const { root, payload: initial } = fixture(testCase.backend, testCase.stateMode);
    const payload = structuredClone(initial);
    const runtimeHeads = {};
    if (testCase.missing) payload.artifacts = payload.artifacts.filter(row => row.path !== testCase.missing);
    if (testCase.defect === "head-mismatch") {
      payload.artifacts[0].sha256 = "actual";
      runtimeHeads.current_state = { head_key: "current_state", artifact_path: "CURRENT-STATE.md", artifact_sha256: "different" };
    }
    if (testCase.defect === "historical-head") {
      payload.artifacts.push({ ...payload.artifacts[0], path: "history/CURRENT-STATE-S009.md", sha256: "pinned" });
      payload.artifacts[0].content = upsertScalarLine(payload.artifacts[0].content, "mode", "THINKING");
      runtimeHeads.current_state = { head_key: "current_state", artifact_path: "history/CURRENT-STATE-S009.md", artifact_sha256: "pinned" };
    }
    if (testCase.defect === "empty-historical-head") {
      payload.artifacts.push({ path: "history/CURRENT-STATE-S009.md", content_format: "utf8", content: "", sha256: "pinned-empty" });
      runtimeHeads.current_state = { head_key: "current_state", artifact_path: "history/CURRENT-STATE-S009.md", artifact_sha256: "pinned-empty" };
    }
    const session = payload.artifacts.find(row => row.path.startsWith("sessions/"));
    const cycle = payload.artifacts.find(row => row.path.endsWith("/status.md"));
    if (testCase.defect === "session-ambiguous") payload.artifacts.push({ ...session, path: "sessions/S101-other.md" });
    if (testCase.defect === "cycle-ambiguous") payload.artifacts.push({ ...cycle, path: "cycles/C101-feature-other/status.md" });
    if (testCase.defect === "session-row-ambiguous") payload.sessions = [{ session_id: "S101" }, { session_id: "S101" }];
    if (testCase.defect === "session-row-path-mismatch") payload.sessions = [{ session_id: "S101", source_artifact_path: cycle.path }];
    if (testCase.defect === "session-row-branch-mismatch") payload.sessions = [{ session_id: "S101", branch_name: "S101-other" }];
    if (testCase.defect === "session-prefix") payload.artifacts[0].content = upsertScalarLine(payload.artifacts[0].content, "active_session", "S10");
    if (testCase.defect === "cycle-prefix") payload.artifacts[0].content = upsertScalarLine(payload.artifacts[0].content, "active_cycle", "C10");
    if (testCase.defect === "session-id-mismatch") session.content += "\nsession_id: S999\n";
    if (testCase.defect === "runtime-empty") payload.artifacts.find(row => row.path === "RUNTIME-STATE.md").content = " \n";
    fs.writeFileSync(recordFile, JSON.stringify({ backend: testCase.backend, available: !testCase.unavailable, payload, runtimeHeads }));
    const visibleCurrent = path.join(root, "docs/audit/CURRENT-STATE.md");
    const visibleCurrentText = testCase.visibleCurrentMissing ? fs.readFileSync(visibleCurrent) : null;
    if (testCase.visibleCurrentMissing) fs.unlinkSync(visibleCurrent);
    const before = snapshot(root);
    const canonicalBefore = fs.readFileSync(recordFile, "utf8");
    const childArgs = testCase.cli ? ["--import", initializerFile, path.join(repoRoot, "tools/runtime/pre-write-admit.mjs"),
      "--target", root, "--skill", testCase.skill, ...(testCase.strict ? ["--strict"] : []), "--json"]
      : ["--input-type=module", "--eval", runner];
    const child = spawnSync(process.execPath, childArgs, {
      cwd: repoRoot, encoding: "utf8", timeout: 30000,
      env: { ...process.env, AIDN_STATE_MODE: testCase.stateMode, AIDN_RUNTIME_PERSISTENCE_BACKEND: testCase.envBackend ?? "",
        AIDN_CANONICAL_FIXTURE_RECORD: recordFile, AIDN_CANONICAL_FIXTURE_TARGET: root, AIDN_CANONICAL_FIXTURE_SKILL: testCase.skill },
    });
    assert(child.status !== null && !child.error, `controlled admission child failed: ${child.stderr}`);
    let observed;
    try { observed = testCase.cli ? { result: JSON.parse(child.stdout), calls: [] } : JSON.parse(child.stdout); }
    catch { observed = { error: child.stderr.trim(), calls: [] }; }
    const result = observed.result;
    const sources = result?.source_of_truth?.observed_sources ?? {};
    const missingKey = { "CURRENT-STATE.md": "current_state", "RUNTIME-STATE.md": "runtime_state",
      "sessions/S101-alpha.md": "session_artifact", "cycles/C101-feature-alpha/status.md": "cycle_status",
      "cycles/C101-feature-alpha/plan.md": "plan_artifact" }[testCase.missing];
    const checks = {
      structured_result: Boolean(result) && !observed.error,
      exit_status_expected: child.status === (testCase.cli && testCase.strict && testCase.blocked ? 1 : 0),
      admission_expected: result?.ok === !testCase.blocked,
      source_expected: !testCase.source || Object.entries(sources).every(([key, value]) => value === (key === missingKey ? "missing" : key === "current_state" && testCase.currentSource ? testCase.currentSource : testCase.source)),
      missing_source_observed: !missingKey || sources[missingKey] === "missing",
      mode_expected: !testCase.mode || result?.context?.mode === testCase.mode,
      required_canonical_no_file_fallback: !(testCase.backend === "postgres" || testCase.stateMode === "db-only") || !Object.values(sources).includes("file"),
      blocking_reason_present: !testCase.blocked || result?.blocking_reasons?.length > 0,
      diagnostic_reason_expected: testCase.defect === "head-mismatch"
        ? result?.blocking_reasons?.some(reason => reason.includes("RUNTIME_HEAD_ARTIFACT_IDENTITY_MISMATCH"))
        : testCase.defect === "empty-historical-head" && testCase.blocked
          ? result?.blocking_reasons?.some(reason => reason.includes("RUNTIME_CONTINUITY_ARTIFACT_EMPTY")) : true,
      backend_pinned: testCase.cli || testCase.backend !== "postgres" || observed.calls[0]?.backend === "postgres" && observed.calls[0]?.config_backend === "postgres",
      optional_files_no_read: !testCase.noRead || observed.calls.length === 0,
      checkout_and_git_index_unchanged: snapshot(root) === before,
      canonical_snapshot_unchanged: fs.readFileSync(recordFile, "utf8") === canonicalBefore,
    };
    if (testCase.visibleCurrentMissing) fs.writeFileSync(visibleCurrent, visibleCurrentText);
    return { id: testCase.id, checks, error: observed.error ?? null, observed_sources: sources,
      blocking_reasons: result?.blocking_reasons ?? [], pass: Object.values(checks).every(Boolean) };
  });
}

function main() {
  let tempRoot = "";
  let primaryError = null;
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const fixturesRoot = path.resolve(repoRoot, args.fixturesRoot);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
    const readyTarget = path.join(tempRoot, "ready");
    const blockedTarget = path.join(tempRoot, "blocked");
    fs.cpSync(path.join(fixturesRoot, "ready"), readyTarget, { recursive: true });
    fs.cpSync(path.join(fixturesRoot, "blocked"), blockedTarget, { recursive: true });
    if (process.env[CLEANUP_PROBE_ENV] === "1") {
      throw new Error("injected pre-write-admit fixture failure");
    }
    const exitPolicyEvidence = verifyExitPolicy(repoRoot);
    const contextReloadEvidence = verifyInitialContextReload(repoRoot, tempRoot, readyTarget);
    const initialCycleEvidence = verifyInitialCycleAdmission(repoRoot, tempRoot, readyTarget);
    const canonicalSourceEvidence = verifyCanonicalSourceSelection(repoRoot, tempRoot, readyTarget);
    const injectedFailureCleanup = verifyInjectedFailureCleanup(repoRoot);
    const cycleCreateTarget = path.join(tempRoot, "cycle-create");
    const warningTarget = path.join(tempRoot, "repair-warning");
    const dirtyCycleCreateTarget = path.join(tempRoot, "cycle-create-dirty");
    const aheadCycleCreateTarget = path.join(tempRoot, "cycle-create-ahead");
    const unmergedSessionCycleCreateTarget = path.join(tempRoot, "cycle-create-session-unmerged");
    const cycleCloseBlockedTarget = path.join(tempRoot, "cycle-close-usage-matrix-blocked");
    const cycleCloseWaivedTarget = path.join(tempRoot, "cycle-close-usage-matrix-waived");
    const promoteBaselineBlockedTarget = path.join(tempRoot, "promote-baseline-usage-matrix-blocked");
    const promoteBaselineWaivedTarget = path.join(tempRoot, "promote-baseline-usage-matrix-waived");
    const dbOnlyDbFirstTarget = path.join(tempRoot, "db-only-db-first");
    const dbOnlyRequirementsTarget = path.join(tempRoot, "db-only-fileless-requirements");
    const dbOnlyCloseSessionTarget = path.join(tempRoot, "db-only-fileless-close-session");
    const invalidSharedRuntimeTarget = path.join(tempRoot, "invalid-shared-runtime");
    const locatorWorkspaceMismatchTarget = path.join(tempRoot, "locator-workspace-mismatch");
    const stateModeMismatchTarget = path.join(tempRoot, "source-of-truth-state-mode-mismatch");
    fs.cpSync(readyTarget, cycleCreateTarget, { recursive: true });
    fs.cpSync(readyTarget, warningTarget, { recursive: true });
    fs.cpSync(readyTarget, dirtyCycleCreateTarget, { recursive: true });
    fs.cpSync(readyTarget, aheadCycleCreateTarget, { recursive: true });
    fs.cpSync(readyTarget, unmergedSessionCycleCreateTarget, { recursive: true });
    fs.cpSync(readyTarget, cycleCloseBlockedTarget, { recursive: true });
    fs.cpSync(readyTarget, cycleCloseWaivedTarget, { recursive: true });
    fs.cpSync(readyTarget, promoteBaselineBlockedTarget, { recursive: true });
    fs.cpSync(readyTarget, promoteBaselineWaivedTarget, { recursive: true });
    fs.cpSync(readyTarget, dbOnlyDbFirstTarget, { recursive: true });
    fs.cpSync(readyTarget, dbOnlyRequirementsTarget, { recursive: true });
    fs.cpSync(readyTarget, dbOnlyCloseSessionTarget, { recursive: true });
    fs.cpSync(readyTarget, invalidSharedRuntimeTarget, { recursive: true });
    fs.cpSync(readyTarget, locatorWorkspaceMismatchTarget, { recursive: true });
    fs.cpSync(readyTarget, stateModeMismatchTarget, { recursive: true });
    installSharedPlanningFixture(cycleCreateTarget, { selectedExecutionScope: "none" });
    installRepairWarningFixture(warningTarget);
    installGitCycleCreateFixtures(dirtyCycleCreateTarget, "dirty");
    installGitCycleCreateFixtures(aheadCycleCreateTarget, "ahead");
    installSessionMergeFixture(unmergedSessionCycleCreateTarget);
    installCycleCloseUsageMatrixFixture(cycleCloseBlockedTarget);
    installCycleCloseUsageMatrixFixture(cycleCloseWaivedTarget, {
      scope: "high-risk",
      state: "WAIVED",
      summary: "nominal + adversarial pending",
      rationale: "explicit temporary waiver approved in cycle decisions",
    });
    installCycleCloseUsageMatrixFixture(promoteBaselineBlockedTarget);
    installCycleCloseUsageMatrixFixture(promoteBaselineWaivedTarget, {
      scope: "high-risk",
      state: "WAIVED",
      summary: "nominal + adversarial pending",
      rationale: "explicit temporary waiver approved in cycle decisions",
    });
    installDbOnlyIndexFixture(repoRoot, dbOnlyRequirementsTarget);
    installDbOnlyIndexFixture(repoRoot, dbOnlyCloseSessionTarget);
    installDbOnlyIndexFixture(repoRoot, dbOnlyDbFirstTarget);
    installInvalidSharedRuntimeLocator(invalidSharedRuntimeTarget);
    installInvalidSharedRuntimeLocator(locatorWorkspaceMismatchTarget, {
      root: ".aidn-shared",
    });
    const mismatchRuntimeStateFile = path.join(stateModeMismatchTarget, "docs", "audit", "RUNTIME-STATE.md");
    fs.writeFileSync(
      mismatchRuntimeStateFile,
      upsertScalarLine(fs.readFileSync(mismatchRuntimeStateFile, "utf8"), "runtime_state_mode", "db-only"),
      "utf8",
    );
    fs.rmSync(path.join(dbOnlyRequirementsTarget, "docs", "audit", "CURRENT-STATE.md"), { force: true });
    fs.rmSync(path.join(dbOnlyRequirementsTarget, "docs", "audit", "RUNTIME-STATE.md"), { force: true });
    fs.rmSync(path.join(dbOnlyRequirementsTarget, "docs", "audit", "cycles", "C101-feature-alpha", "status.md"), { force: true });
    fs.rmSync(path.join(dbOnlyCloseSessionTarget, "docs", "audit", "CURRENT-STATE.md"), { force: true });
    fs.rmSync(path.join(dbOnlyCloseSessionTarget, "docs", "audit", "RUNTIME-STATE.md"), { force: true });
    fs.rmSync(path.join(dbOnlyCloseSessionTarget, "docs", "audit", "sessions", "S101-alpha.md"), { force: true });
    const dbOnlyDbFirstCurrentStateFile = path.join(dbOnlyDbFirstTarget, "docs", "audit", "CURRENT-STATE.md");
    fs.writeFileSync(
      dbOnlyDbFirstCurrentStateFile,
      upsertScalarLine(fs.readFileSync(dbOnlyDbFirstCurrentStateFile, "utf8"), "mode", "unknown"),
      "utf8",
    );
    const dbOnlyDbFirstRuntimeStateFile = path.join(dbOnlyDbFirstTarget, "docs", "audit", "RUNTIME-STATE.md");
    fs.writeFileSync(
      dbOnlyDbFirstRuntimeStateFile,
      upsertScalarLine(fs.readFileSync(dbOnlyDbFirstRuntimeStateFile, "utf8"), "runtime_state_mode", "dual"),
      "utf8",
    );

    for (const target of [readyTarget, blockedTarget, cycleCreateTarget, warningTarget, dirtyCycleCreateTarget,
      aheadCycleCreateTarget, unmergedSessionCycleCreateTarget, cycleCloseBlockedTarget, cycleCloseWaivedTarget,
      promoteBaselineBlockedTarget, promoteBaselineWaivedTarget, dbOnlyDbFirstTarget, dbOnlyRequirementsTarget,
      dbOnlyCloseSessionTarget, invalidSharedRuntimeTarget, locatorWorkspaceMismatchTarget, stateModeMismatchTarget]) {
      prepareActivationFixture(target, repoRoot);
    }
    const ready = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      readyTarget,
      "--skill",
      "requirements-delta",
      "--json",
    ], 0);
    const blocked = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      blockedTarget,
      "--skill",
      "requirements-delta",
      "--strict",
      "--json",
    ], 1);
    const cycleCreateBlocked = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      cycleCreateTarget,
      "--skill",
      "cycle-create",
      "--strict",
      "--json",
    ], 1);
    const warning = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      warningTarget,
      "--skill",
      "requirements-delta",
      "--json",
    ], 0);
    const dirtyCycleCreateBlocked = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      dirtyCycleCreateTarget,
      "--skill",
      "cycle-create",
      "--strict",
      "--json",
    ], 1);
    const aheadCycleCreateBlocked = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      aheadCycleCreateTarget,
      "--skill",
      "cycle-create",
      "--strict",
      "--json",
    ], 1);
    const unmergedSessionCycleCreateBlocked = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      unmergedSessionCycleCreateTarget,
      "--skill",
      "cycle-create",
      "--strict",
      "--json",
    ], 1);
    const dbOnlyDbFirst = runAidnWithEnv(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      dbOnlyDbFirstTarget,
      "--skill",
      "requirements-delta",
      "--json",
    ], {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    }, 0);
    const dbOnlyRequirements = runAidnWithEnv(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      dbOnlyRequirementsTarget,
      "--skill",
      "requirements-delta",
      "--json",
    ], {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    }, 0);
    const dbOnlyCloseSession = runAidnWithEnv(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      dbOnlyCloseSessionTarget,
      "--skill",
      "close-session",
      "--json",
    ], {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    }, 0);
    const cycleCloseBlocked = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      cycleCloseBlockedTarget,
      "--skill",
      "cycle-close",
      "--strict",
      "--json",
    ], 1);
    const cycleCloseWaived = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      cycleCloseWaivedTarget,
      "--skill",
      "cycle-close",
      "--json",
    ], 0);
    const promoteBaselineBlocked = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      promoteBaselineBlockedTarget,
      "--skill",
      "promote-baseline",
      "--strict",
      "--json",
    ], 1);
    const promoteBaselineWaived = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      promoteBaselineWaivedTarget,
      "--skill",
      "promote-baseline",
      "--json",
    ], 0);
    const invalidSharedRuntime = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      invalidSharedRuntimeTarget,
      "--skill",
      "requirements-delta",
      "--strict",
      "--json",
    ], 1);
    const locatorWorkspaceMismatch = runAidnWithEnv(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      locatorWorkspaceMismatchTarget,
      "--skill",
      "requirements-delta",
      "--strict",
      "--json",
    ], {
      AIDN_WORKSPACE_ID: "workspace-override",
    }, 1);
    const stateModeMismatch = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      stateModeMismatchTarget,
      "--skill",
      "requirements-delta",
      "--strict",
      "--json",
    ], 1);

    assert(ready.ok === true, "ready pre-write admission should pass");
    assert(ready.admission_status === "admitted", "ready pre-write admission should be admitted");
    assert(String(ready.workspace?.workspace_id ?? "").length > 0, "ready pre-write admission should expose workspace_id");
    assert(String(ready.workspace?.worktree_id ?? "").length > 0, "ready pre-write admission should expose worktree_id");
    assert(ready.context.workspace_id === ready.workspace.workspace_id, "ready pre-write admission should mirror workspace_id in context");
    assert(ready.context.worktree_id === ready.workspace.worktree_id, "ready pre-write admission should mirror worktree_id in context");
    assert(ready.context.shared_runtime_mode === "local-only", "ready pre-write admission should default to local-only runtime mode");
    assert(ready.context.shared_runtime_validation_status === "clear", "ready pre-write admission should expose clear shared runtime validation");
    assert(ready.context.shared_runtime_locator_ref === "none", "ready pre-write admission should expose no locator ref by default");
    assert(ready.context.active_cycle === "C101", "ready pre-write admission should expose active cycle");
    assert(ready.context.first_plan_step === "implement alpha feature validation", "ready pre-write admission should keep first plan step");
    assert(ready.source_of_truth?.state_mode === "files", "ready pre-write admission should expose source-of-truth state mode");
    assert(ready.context.source_of_truth_status === "clear", "ready pre-write admission should expose clear source-of-truth status");
    assert(ready.checks?.source_of_truth_policy_resolved?.reason_code === "SOT_POLICY_RESOLVED", "ready pre-write admission should expose SoT policy reason code");
    assert(Array.isArray(ready.prioritized_artifacts) && ready.prioritized_artifacts.includes("docs/audit/CURRENT-STATE.md"), "ready pre-write admission should prioritize CURRENT-STATE.md");

    assert(blocked.ok === false, "blocked pre-write admission should fail");
    assert(blocked.admission_status === "blocked", "blocked pre-write admission should report blocked");
    assert(blocked.context.repair_layer_status === "block", "blocked pre-write admission should expose repair block");
    assert(blocked.blocking_reasons.some((item) => String(item).includes("repair layer is blocking")), "blocked pre-write admission should expose repair blocking reason");
    assert(blocked.blocking_findings.includes("branch_cycle_mismatch"), "blocked pre-write admission should expose blocking findings");
    assert(cycleCreateBlocked.ok === false, "cycle-create pre-write admission should fail when shared planning scope is missing");
    assert(cycleCreateBlocked.context.active_backlog === "backlog/BL-S101-session-planning.md", "cycle-create pre-write admission should expose the active backlog");
    assert(cycleCreateBlocked.context.backlog_selected_execution_scope === "none", "cycle-create pre-write admission should expose the missing execution scope");
    assert(cycleCreateBlocked.blocking_reasons.some((item) => String(item).includes("selected execution scope")), "cycle-create pre-write admission should explain the missing shared planning scope");
    assert(dirtyCycleCreateBlocked.ok === false, "dirty cycle-create pre-write admission should fail");
    assert(dirtyCycleCreateBlocked.blocking_reasons.some((item) => String(item).includes("git working tree is not clean")), "dirty cycle-create pre-write admission should require git hygiene first");
    assert(dirtyCycleCreateBlocked.context.git_branch === "feature/C101-alpha", "dirty cycle-create pre-write admission should expose the active git branch");
    assert(aheadCycleCreateBlocked.ok === false, "ahead cycle-create pre-write admission should fail");
    assert(aheadCycleCreateBlocked.blocking_reasons.some((item) => String(item).includes("diverges from origin/feature/C101-alpha")), "ahead cycle-create pre-write admission should require upstream reconciliation");
    assert(Number(aheadCycleCreateBlocked.context.git_upstream_ahead) === 1, "ahead cycle-create pre-write admission should expose ahead count");
    assert(unmergedSessionCycleCreateBlocked.ok === false, "session cycle-create pre-write admission should fail when previous cycle is not merged");
    assert(unmergedSessionCycleCreateBlocked.blocking_reasons.some((item) => String(item).includes("is not merged into session branch S101-alpha")), "session cycle-create pre-write admission should require merge into the session branch");
    assert(unmergedSessionCycleCreateBlocked.context.previous_cycle_merged_into_session === "no", "session cycle-create pre-write admission should expose merge state");
    assert(warning.ok === true, "warning pre-write admission should stay admitted");
    assert(warning.context.repair_layer_status === "warn", "warning pre-write admission should expose repair warn status");
    assert(warning.warnings.some((item) => String(item).includes("locally present cycle status artifact")), "warning pre-write admission should explain local-but-untracked repair state");
    assert(cycleCloseBlocked.ok === false, "cycle-close pre-write admission should fail when usage matrix is incomplete on DONE");
    assert(cycleCloseBlocked.context.cycle_state === "DONE", "cycle-close pre-write admission should expose DONE cycle state");
    assert(cycleCloseBlocked.context.usage_matrix_scope === "shared", "cycle-close pre-write admission should expose usage matrix scope");
    assert(cycleCloseBlocked.context.usage_matrix_state === "NOT_DEFINED", "cycle-close pre-write admission should expose usage matrix state");
    assert(cycleCloseBlocked.blocking_reasons.some((item) => String(item).includes("usage matrix is not complete")), "cycle-close pre-write admission should explain the missing usage matrix evidence");
    assert(cycleCloseWaived.ok === true, "cycle-close pre-write admission should allow an explicit waiver");
    assert(cycleCloseWaived.context.usage_matrix_scope === "high-risk", "cycle-close waiver pre-write admission should expose high-risk scope");
    assert(cycleCloseWaived.context.usage_matrix_state === "WAIVED", "cycle-close waiver pre-write admission should expose waived state");
    assert(promoteBaselineBlocked.ok === false, "promote-baseline pre-write admission should fail when usage matrix is incomplete on DONE");
    assert(promoteBaselineBlocked.context.cycle_state === "DONE", "promote-baseline pre-write admission should expose DONE cycle state");
    assert(promoteBaselineBlocked.context.usage_matrix_scope === "shared", "promote-baseline pre-write admission should expose usage matrix scope");
    assert(promoteBaselineBlocked.context.usage_matrix_state === "NOT_DEFINED", "promote-baseline pre-write admission should expose usage matrix state");
    assert(promoteBaselineBlocked.blocking_reasons.some((item) => String(item).includes("promote-baseline")), "promote-baseline pre-write admission should explain the missing usage matrix evidence");
    assert(promoteBaselineWaived.ok === true, "promote-baseline pre-write admission should allow an explicit waiver");
    assert(promoteBaselineWaived.context.usage_matrix_scope === "high-risk", "promote-baseline waiver pre-write admission should expose high-risk scope");
    assert(promoteBaselineWaived.context.usage_matrix_state === "WAIVED", "promote-baseline waiver pre-write admission should expose waived state");
    assert(invalidSharedRuntime.ok === false, "invalid shared runtime locator should block pre-write admission");
    assert(invalidSharedRuntime.shared_runtime_validation?.status === "reject", "invalid shared runtime locator should expose reject validation status");
    assert(invalidSharedRuntime.blocking_reasons.some((item) => String(item).includes("overlaps versioned workflow artifacts")), "invalid shared runtime locator should explain the rejected path overlap");
    assert(locatorWorkspaceMismatch.ok === false, "workspace mismatch override should block pre-write admission");
    assert(locatorWorkspaceMismatch.shared_runtime_validation?.status === "reject", "workspace mismatch override should expose reject validation status");
    assert(locatorWorkspaceMismatch.blocking_reasons.some((item) => String(item).includes("workspace_id mismatch")), "workspace mismatch override should explain the rejected workspace identity");
    assert(stateModeMismatch.ok === false, "state mode mismatch should block pre-write admission");
    assert(stateModeMismatch.context.source_of_truth_status === "block", "state mode mismatch should expose source-of-truth block status");
    assert(stateModeMismatch.context.source_of_truth_reason_codes.includes("SOT_STATE_MODE_MISMATCH"), "state mode mismatch should expose SoT reason code");
    assert(stateModeMismatch.blocking_reasons.some((item) => String(item).includes("SOT_STATE_MODE_MISMATCH")), "state mode mismatch should include a coded blocking reason");
    assert(dbOnlyDbFirst.ok === true, "db-only admission should prefer database artifacts over stale visible projections");
    assert(dbOnlyDbFirst.context.effective_state_mode === "db-only", "db-only db-first admission should expose the effective state mode");
    assert(dbOnlyDbFirst.context.current_state_source === "sqlite", "db-only db-first admission should load CURRENT-STATE from SQLite even when a visible projection exists");
    assert(dbOnlyDbFirst.context.runtime_state_source === "sqlite", "db-only db-first admission should load RUNTIME-STATE from SQLite even when a visible projection exists");
    assert(dbOnlyDbFirst.context.source_of_truth_status === "clear", "db-only db-first admission should ignore stale visible source-of-truth projections");
    assert(dbOnlyRequirements.ok === true, "db-only fileless requirements admission should pass from SQLite artifacts");
    assert(String(dbOnlyRequirements.workspace?.workspace_id ?? "").length > 0, "db-only fileless requirements admission should expose workspace_id");
    assert(String(dbOnlyRequirements.workspace?.worktree_id ?? "").length > 0, "db-only fileless requirements admission should expose worktree_id");
    assert(dbOnlyRequirements.context.effective_state_mode === "db-only", "db-only fileless requirements admission should expose the effective state mode");
    assert(dbOnlyRequirements.context.current_state_source === "sqlite", "db-only fileless requirements admission should load CURRENT-STATE from SQLite");
    assert(dbOnlyRequirements.context.runtime_state_source === "sqlite", "db-only fileless requirements admission should load RUNTIME-STATE from SQLite");
    assert(dbOnlyRequirements.context.cycle_status_source === "sqlite", "db-only fileless requirements admission should load cycle status from SQLite");
    assert(dbOnlyRequirements.blocking_reasons.every((item) => !String(item).includes("missing docs/audit/CURRENT-STATE.md")), "db-only fileless requirements admission should not block on missing CURRENT-STATE.md when SQLite is populated");
    assert(dbOnlyCloseSession.ok === true, "db-only fileless close-session admission should pass from SQLite artifacts");
    assert(String(dbOnlyCloseSession.workspace?.workspace_id ?? "").length > 0, "db-only fileless close-session admission should expose workspace_id");
    assert(dbOnlyCloseSession.context.current_state_source === "sqlite", "db-only fileless close-session admission should load CURRENT-STATE from SQLite");
    assert(dbOnlyCloseSession.context.session_artifact_source === "sqlite", "db-only fileless close-session admission should load the session artifact from SQLite");

    const output = {
      ts: new Date().toISOString(),
      fixtures_root: fixturesRoot,
      ready,
      blocked,
      warning,
      cycle_close_blocked: cycleCloseBlocked,
      cycle_close_waived: cycleCloseWaived,
      promote_baseline_blocked: promoteBaselineBlocked,
      promote_baseline_waived: promoteBaselineWaived,
      db_only_db_first: dbOnlyDbFirst,
      db_only_requirements: dbOnlyRequirements,
      db_only_close_session: dbOnlyCloseSession,
      invalid_shared_runtime: invalidSharedRuntime,
      locator_workspace_mismatch: locatorWorkspaceMismatch,
      source_of_truth_state_mode_mismatch: stateModeMismatch,
      cycle_create_blocked: cycleCreateBlocked,
      cycle_create_dirty_blocked: dirtyCycleCreateBlocked,
      cycle_create_ahead_blocked: aheadCycleCreateBlocked,
      cycle_create_session_unmerged_blocked: unmergedSessionCycleCreateBlocked,
      exit_policy: exitPolicyEvidence,
      initial_context_reload: contextReloadEvidence,
      initial_cycle_admission: initialCycleEvidence,
      canonical_source_selection: canonicalSourceEvidence,
      injected_failure_cleanup: injectedFailureCleanup,
      pass: canonicalSourceEvidence.every(testCase => testCase.pass),
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Fixtures root: ${fixturesRoot}`);
      console.log(`Result: ${output.pass ? "PASS" : "FAIL"}`);
    }
    if (!output.pass) process.exitCode = 1;
  } catch (error) {
    primaryError = error;
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exitCode = 1;
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        console.error(`CLEANUP ERROR: ${cleanup.error.message}`);
        process.exitCode = 1;
        if (!primaryError) {
          primaryError = cleanup.error;
        }
      }
    }
  }
}

main();
