#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { initGitRepo } from "./test-git-fixture-lib.mjs";

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

function installDbOnlyReadyRuntimeFixture(targetRoot) {
  const runtimeStateFile = path.join(targetRoot, "docs", "audit", "RUNTIME-STATE.md");
  fs.writeFileSync(runtimeStateFile, [
    "# Runtime State Digest",
    "",
    "## Summary",
    "",
    "updated_at: 2026-03-22T12:05:00Z",
    "runtime_state_mode: db-only",
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

function installDbOnlyIndexFixture(repoRoot, targetRoot) {
  const env = {
    AIDN_STATE_MODE: "db-only",
    AIDN_INDEX_STORE_MODE: "sqlite",
  };
  installDbOnlyReadyRuntimeFixture(targetRoot);
  runNodeJson(repoRoot, "tools/perf/index-sync.mjs", [
    "--target",
    targetRoot,
    "--store",
    "sqlite",
    "--with-content",
    "--json",
  ], env);
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const fixturesRoot = path.resolve(repoRoot, args.fixturesRoot);
    const readyTarget = path.join(fixturesRoot, "ready");
    const blockedTarget = path.join(fixturesRoot, "blocked");
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-pre-write-admit-"));
    const cycleCreateTarget = path.join(tempRoot, "cycle-create");
    const warningTarget = path.join(tempRoot, "repair-warning");
    const dirtyCycleCreateTarget = path.join(tempRoot, "cycle-create-dirty");
    const aheadCycleCreateTarget = path.join(tempRoot, "cycle-create-ahead");
    const unmergedSessionCycleCreateTarget = path.join(tempRoot, "cycle-create-session-unmerged");
    const dbOnlyRequirementsTarget = path.join(tempRoot, "db-only-fileless-requirements");
    const dbOnlyCloseSessionTarget = path.join(tempRoot, "db-only-fileless-close-session");
    fs.cpSync(readyTarget, cycleCreateTarget, { recursive: true });
    fs.cpSync(readyTarget, warningTarget, { recursive: true });
    fs.cpSync(readyTarget, dirtyCycleCreateTarget, { recursive: true });
    fs.cpSync(readyTarget, aheadCycleCreateTarget, { recursive: true });
    fs.cpSync(readyTarget, unmergedSessionCycleCreateTarget, { recursive: true });
    fs.cpSync(readyTarget, dbOnlyRequirementsTarget, { recursive: true });
    fs.cpSync(readyTarget, dbOnlyCloseSessionTarget, { recursive: true });
    installSharedPlanningFixture(cycleCreateTarget, { selectedExecutionScope: "none" });
    installRepairWarningFixture(warningTarget);
    installGitCycleCreateFixtures(dirtyCycleCreateTarget, "dirty");
    installGitCycleCreateFixtures(aheadCycleCreateTarget, "ahead");
    installSessionMergeFixture(unmergedSessionCycleCreateTarget);
    installDbOnlyIndexFixture(repoRoot, dbOnlyRequirementsTarget);
    installDbOnlyIndexFixture(repoRoot, dbOnlyCloseSessionTarget);
    fs.rmSync(path.join(dbOnlyRequirementsTarget, "docs", "audit", "CURRENT-STATE.md"), { force: true });
    fs.rmSync(path.join(dbOnlyRequirementsTarget, "docs", "audit", "RUNTIME-STATE.md"), { force: true });
    fs.rmSync(path.join(dbOnlyRequirementsTarget, "docs", "audit", "cycles", "C101-feature-alpha", "status.md"), { force: true });
    fs.rmSync(path.join(dbOnlyCloseSessionTarget, "docs", "audit", "CURRENT-STATE.md"), { force: true });
    fs.rmSync(path.join(dbOnlyCloseSessionTarget, "docs", "audit", "RUNTIME-STATE.md"), { force: true });
    fs.rmSync(path.join(dbOnlyCloseSessionTarget, "docs", "audit", "sessions", "S101-alpha.md"), { force: true });

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

    assert(ready.ok === true, "ready pre-write admission should pass");
    assert(ready.admission_status === "admitted", "ready pre-write admission should be admitted");
    assert(ready.context.active_cycle === "C101", "ready pre-write admission should expose active cycle");
    assert(ready.context.first_plan_step === "implement alpha feature validation", "ready pre-write admission should keep first plan step");
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
    assert(dbOnlyRequirements.ok === true, "db-only fileless requirements admission should pass from SQLite artifacts");
    assert(dbOnlyRequirements.context.effective_state_mode === "db-only", "db-only fileless requirements admission should expose the effective state mode");
    assert(dbOnlyRequirements.context.current_state_source === "sqlite", "db-only fileless requirements admission should load CURRENT-STATE from SQLite");
    assert(dbOnlyRequirements.context.runtime_state_source === "sqlite", "db-only fileless requirements admission should load RUNTIME-STATE from SQLite");
    assert(dbOnlyRequirements.context.cycle_status_source === "sqlite", "db-only fileless requirements admission should load cycle status from SQLite");
    assert(dbOnlyRequirements.blocking_reasons.every((item) => !String(item).includes("missing docs/audit/CURRENT-STATE.md")), "db-only fileless requirements admission should not block on missing CURRENT-STATE.md when SQLite is populated");
    assert(dbOnlyCloseSession.ok === true, "db-only fileless close-session admission should pass from SQLite artifacts");
    assert(dbOnlyCloseSession.context.current_state_source === "sqlite", "db-only fileless close-session admission should load CURRENT-STATE from SQLite");
    assert(dbOnlyCloseSession.context.session_artifact_source === "sqlite", "db-only fileless close-session admission should load the session artifact from SQLite");

    const output = {
      ts: new Date().toISOString(),
      fixtures_root: fixturesRoot,
      ready,
      blocked,
      warning,
      db_only_requirements: dbOnlyRequirements,
      db_only_close_session: dbOnlyCloseSession,
      cycle_create_blocked: cycleCreateBlocked,
      cycle_create_dirty_blocked: dirtyCycleCreateBlocked,
      cycle_create_ahead_blocked: aheadCycleCreateBlocked,
      cycle_create_session_unmerged_blocked: unmergedSessionCycleCreateBlocked,
      pass: true,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Fixtures root: ${fixturesRoot}`);
      console.log("Result: PASS");
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
