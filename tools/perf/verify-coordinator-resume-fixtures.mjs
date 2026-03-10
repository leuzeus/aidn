#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { initGitRepo } from "./test-git-fixture-lib.mjs";

function parseArgs(argv) {
  const args = {
    handoffFixturesRoot: "tests/fixtures/perf-handoff",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--handoff-fixtures-root") {
      args.handoffFixturesRoot = String(argv[index + 1] ?? "").trim();
      index += 1;
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
  console.log("  node tools/perf/verify-coordinator-resume-fixtures.mjs");
  console.log("  node tools/perf/verify-coordinator-resume-fixtures.mjs --json");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(script, args, repoRoot, expectStatus = 0) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== expectStatus) {
    throw new Error(`Command failed (${path.basename(script)}): ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "{}"));
}

function appendHistoryEvent(targetRoot, event) {
  const historyFile = path.join(targetRoot, ".aidn", "runtime", "context", "coordination-history.ndjson");
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.appendFileSync(historyFile, `${JSON.stringify(event)}\n`, "utf8");
}

function buildDispatchEvent(ts) {
  return {
    ts,
    event: "coordinator_dispatch",
    selected_agent: "codex",
    recommended_role: "executor",
    recommended_action: "implement",
    goal: "implement alpha feature validation",
    dispatch_status: "ready",
    execution_status: "executed",
    entrypoint_kind: "skill",
    entrypoint_name: "branch-cycle-audit",
    stop_required: false,
    executed: true,
    executed_steps: [],
  };
}

function buildEscalatedFixture(targetRoot, repoRoot, handoffProjectScript, summaryScript) {
  runJson(handoffProjectScript, ["--target", targetRoot, "--json"], repoRoot, 0);
  appendHistoryEvent(targetRoot, buildDispatchEvent("2026-03-09T02:00:00Z"));
  appendHistoryEvent(targetRoot, buildDispatchEvent("2026-03-09T02:05:00Z"));
  appendHistoryEvent(targetRoot, buildDispatchEvent("2026-03-09T02:10:00Z"));
  appendHistoryEvent(targetRoot, buildDispatchEvent("2026-03-09T02:15:00Z"));
  appendHistoryEvent(targetRoot, buildDispatchEvent("2026-03-09T02:20:00Z"));
  runJson(summaryScript, ["--target", targetRoot, "--json"], repoRoot, 0);
}

function buildRoleBlockedFixture(targetRoot, repoRoot, handoffProjectScript) {
  runJson(handoffProjectScript, ["--target", targetRoot, "--json"], repoRoot, 0);
  const roleBlockedAgentDir = path.join(targetRoot, ".aidn", "runtime", "agents");
  fs.mkdirSync(roleBlockedAgentDir, { recursive: true });
  fs.writeFileSync(path.join(roleBlockedAgentDir, "probe-failing-auditor.mjs"), [
    "import { spawnSync } from \"node:child_process\";",
    "export function createProbeFailingAuditorAdapter({ id }) {",
    "  return {",
    "    getProfile() { return { id, label: \"Probe Failing Auditor Adapter\", default_role: \"auditor\", supported_roles: [\"auditor\"], capabilities_by_role: { auditor: [\"audit\", \"analyze\", \"relay\"] } }; },",
    "    canHandleRole({ role, action } = {}) { return role === \"auditor\" && (!action || action === \"audit\" || action === \"analyze\" || action === \"relay\"); },",
    "    checkEnvironment() { return { status: \"unavailable\", reason: \"external runner is not configured\" }; },",
    "    runCommand({ command, commandArgs = [], envOverrides = {} }) { return spawnSync(command, commandArgs, { encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"], cwd: process.cwd(), env: { ...process.env, ...envOverrides }, shell: false }); },",
    "  };",
    "}",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(targetRoot, "docs", "audit", "AGENT-ROSTER.md"), [
    "# Agent Roster",
    "",
    "default_agent_selection: auto",
    "",
    "## codex",
    "enabled: yes",
    "priority: 5",
    "roles: coordinator, executor, repair",
    "",
    "## codex-auditor",
    "enabled: no",
    "priority: 40",
    "roles: auditor",
    "",
    "## local-shell-auditor",
    "enabled: no",
    "priority: 150",
    "roles: auditor",
    "",
    "## probe-failing-auditor",
    "enabled: yes",
    "priority: 300",
    "roles: auditor",
    "adapter_module: .aidn/runtime/agents/probe-failing-auditor.mjs",
    "adapter_export: createProbeFailingAuditorAdapter",
    "",
  ].join("\n"), "utf8");
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const handoffFixturesRoot = path.resolve(repoRoot, args.handoffFixturesRoot);
    const handoffProjectScript = path.resolve(repoRoot, "tools", "runtime", "project-handoff-packet.mjs");
    const summaryScript = path.resolve(repoRoot, "tools", "runtime", "project-coordination-summary.mjs");
    const arbitrationScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-record-arbitration.mjs");
    const resumeScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-resume.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-coordinator-resume-"));
    const escalatedTarget = path.join(tempRoot, "escalated");
    const reanchorTarget = path.join(tempRoot, "reanchor");
    const roleBlockedTarget = path.join(tempRoot, "role-blocked");
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), escalatedTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), reanchorTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "warn"), roleBlockedTarget, { recursive: true });
    initGitRepo(escalatedTarget, { workingBranch: "feature/C101-alpha" });
    initGitRepo(reanchorTarget, { workingBranch: "feature/C101-alpha" });
    initGitRepo(roleBlockedTarget, { workingBranch: "feature/C101-alpha" });

    buildEscalatedFixture(escalatedTarget, repoRoot, handoffProjectScript, summaryScript);
    buildEscalatedFixture(reanchorTarget, repoRoot, handoffProjectScript, summaryScript);
    buildRoleBlockedFixture(roleBlockedTarget, repoRoot, handoffProjectScript);

    const blockedDryRun = runJson(resumeScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    const blockedExecute = runJson(resumeScript, ["--target", escalatedTarget, "--execute", "--json"], repoRoot, 1);

    const continueArbitration = runJson(arbitrationScript, ["--target", escalatedTarget, "--decision", "continue", "--note", "validated by user", "--json"], repoRoot, 0);
    const resumedDryRun = runJson(resumeScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    const resumedExecute = runJson(resumeScript, ["--target", escalatedTarget, "--execute", "--json"], repoRoot, 0);

    const reanchorArbitration = runJson(arbitrationScript, ["--target", reanchorTarget, "--decision", "reanchor", "--note", "reload before resuming", "--goal", "reload session and runtime facts", "--json"], repoRoot, 0);
    const reanchorDryRun = runJson(resumeScript, ["--target", reanchorTarget, "--json"], repoRoot, 0);
    const roleBlockedDryRun = runJson(resumeScript, ["--target", roleBlockedTarget, "--json"], repoRoot, 0);
    const roleBlockedExecute = runJson(resumeScript, ["--target", roleBlockedTarget, "--execute", "--json"], repoRoot, 1);

    const escalatedLogFile = path.join(escalatedTarget, "docs", "audit", "COORDINATION-LOG.md");
    const escalatedHistoryFile = path.join(escalatedTarget, ".aidn", "runtime", "context", "coordination-history.ndjson");
    const roleBlockedLogFile = path.join(roleBlockedTarget, "docs", "audit", "COORDINATION-LOG.md");

    assert(blockedDryRun.resume_status === "blocked", "resume should block while escalation is unresolved");
    assert(blockedDryRun.can_resume === false, "blocked resume should not be resumable");
    assert(blockedDryRun.execution_status === "blocked", "blocked dry-run should expose blocked execution state");
    assert(blockedDryRun.dispatch.dispatch_status === "escalated", "blocked resume should show escalated dispatch");
    assert(blockedDryRun.preferred_decision === "reanchor", "blocked resume should expose the preferred arbitration decision");
    assert(blockedDryRun.arbitration_suggestions?.preferred_decision === "reanchor", "blocked resume should expose arbitration suggestions");
    assert(blockedDryRun.execute_requested === false, "blocked dry-run should report execute_requested=false");
    assert(Array.isArray(blockedDryRun.arbitration_suggestions?.suggestions) && blockedDryRun.arbitration_suggestions.suggestions.some((item) => String(item.record_command ?? "").includes("coordinator-record-arbitration")), "blocked resume suggestions should include record-arbitration commands");
    assert(blockedExecute.resume_status === "blocked", "blocked execute should stay blocked");
    assert(blockedExecute.execution_status === "blocked", "blocked execute should refuse execution");
    assert(blockedExecute.executed === false, "blocked execute should not run steps");
    assert(blockedExecute.execution === null, "blocked execute should not include execution details");
    assert(blockedExecute.arbitration_suggestions?.preferred_decision === "reanchor", "blocked execute should keep arbitration suggestions");
    assert(blockedExecute.execute_requested === true, "blocked execute should preserve execute_requested=true");

    assert(continueArbitration.arbitration_event.decision === "continue", "fixture should record continue arbitration");
    assert(resumedDryRun.resume_status === "resumed_after_arbitration", "continue arbitration should unlock resume");
    assert(resumedDryRun.arbitration_satisfied === true, "continue arbitration should satisfy resume gate");
    assert(resumedDryRun.dispatch.dispatch_status === "ready", "continue arbitration should restore ready dispatch");
    assert(resumedExecute.resume_status === "resumed_after_arbitration", "executed resume should preserve arbitration resume status");
    assert(resumedExecute.execution_status === "executed", "executed resume should complete execution");
    assert(resumedExecute.executed === true, "executed resume should report executed");
    assert(resumedExecute.execution?.dispatch_status === "ready", "executed resume should execute a ready dispatch");
    assert(Array.isArray(resumedExecute.execution?.executed_steps) && resumedExecute.execution.executed_steps.length === 2, "executed resume should run the implementation dispatch");
    assert(fs.existsSync(escalatedLogFile), "executed resume should write coordination log after arbitration");
    assert(fs.existsSync(escalatedHistoryFile), "executed resume should preserve coordination history");
    assert(fs.readFileSync(escalatedHistoryFile, "utf8").includes("\"event\":\"user_arbitration\""), "history should include arbitration event before resumed dispatch");

    assert(reanchorArbitration.arbitration_event.decision === "reanchor", "fixture should record reanchor arbitration");
    assert(reanchorDryRun.resume_status === "resumed_after_arbitration", "reanchor arbitration should also unlock resume");
    assert(reanchorDryRun.dispatch.entrypoint_name === "context-reload", "reanchor arbitration should resume through context-reload");
    assert(Array.isArray(reanchorDryRun.dispatch.commands) && reanchorDryRun.dispatch.commands.some((line) => line.includes("start-session")), "reanchor resume should include start-session in its plan");

    assert(roleBlockedDryRun.resume_status === "blocked", "role-blocked resume should stay blocked");
    assert(roleBlockedDryRun.dispatch.dispatch_status === "escalated", "role-blocked resume should surface escalated dispatch");
    assert(roleBlockedDryRun.dispatch.recommended_role_coverage?.status === "blocked", "role-blocked resume should expose blocked role coverage");
    assert(roleBlockedDryRun.preferred_decision === "reanchor", "role-blocked resume should prefer reanchor");
    assert(roleBlockedDryRun.arbitration_suggestions?.preferred_decision === "reanchor", "role-blocked resume should include reanchor suggestions");
    assert(roleBlockedDryRun.arbitration_suggestions?.suggestions?.some((item) => item.decision === "reanchor" && item.immediately_actionable === true), "role-blocked resume should include an actionable reanchor suggestion");
    assert(roleBlockedDryRun.arbitration_suggestions?.suggestions?.some((item) => item.decision === "continue" && item.immediately_actionable === false), "role-blocked resume should include a non-actionable continue suggestion");
    assert(/no runnable adapter remains for role auditor/i.test(String(roleBlockedDryRun.resume_reason ?? "")), "role-blocked resume should explain blocked auditor coverage");
    assert(roleBlockedExecute.resume_status === "blocked", "role-blocked execute should stay blocked");
    assert(roleBlockedExecute.execution_status === "blocked", "role-blocked execute should not run");
    assert(roleBlockedExecute.executed === false, "role-blocked execute should report not executed");
    assert(roleBlockedExecute.arbitration_suggestions?.preferred_decision === "reanchor", "role-blocked execute should keep arbitration suggestions");
    assert(roleBlockedExecute.execute_requested === true, "role-blocked execute should preserve execute_requested=true");
    assert(!fs.existsSync(roleBlockedLogFile), "role-blocked execute should not create coordination log");

    const output = {
      ts: new Date().toISOString(),
      blocked_dry_run: blockedDryRun,
      blocked_execute: blockedExecute,
      continue_arbitration: continueArbitration,
      resumed_dry_run: resumedDryRun,
      resumed_execute: resumedExecute,
      reanchor_arbitration: reanchorArbitration,
      reanchor_dry_run: reanchorDryRun,
      role_blocked_dry_run: roleBlockedDryRun,
      role_blocked_execute: roleBlockedExecute,
      pass: true,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log("PASS");
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
