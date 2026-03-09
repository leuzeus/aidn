#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
  console.log("  node tools/perf/verify-coordinator-orchestrate-fixtures.mjs");
  console.log("  node tools/perf/verify-coordinator-orchestrate-fixtures.mjs --json");
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
    timeout: 240000,
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
    const orchestrateScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-orchestrate.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-coordinator-orchestrate-"));
    const readyTarget = path.join(tempRoot, "ready");
    const escalatedTarget = path.join(tempRoot, "escalated");
    const resumedTarget = path.join(tempRoot, "resumed");
    const roleBlockedTarget = path.join(tempRoot, "role-blocked");
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), readyTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), escalatedTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), resumedTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "warn"), roleBlockedTarget, { recursive: true });

    runJson(handoffProjectScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    buildEscalatedFixture(escalatedTarget, repoRoot, handoffProjectScript, summaryScript);
    buildEscalatedFixture(resumedTarget, repoRoot, handoffProjectScript, summaryScript);
    buildRoleBlockedFixture(roleBlockedTarget, repoRoot, handoffProjectScript);
    runJson(arbitrationScript, ["--target", resumedTarget, "--decision", "continue", "--note", "validated by user", "--json"], repoRoot, 0);

    const dryRun = runJson(orchestrateScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    const blocked = runJson(orchestrateScript, ["--target", escalatedTarget, "--execute", "--json"], repoRoot, 1);
    const resumed = runJson(orchestrateScript, ["--target", resumedTarget, "--execute", "--max-iterations", "3", "--json"], repoRoot, 1);
    const roleBlocked = runJson(orchestrateScript, ["--target", roleBlockedTarget, "--execute", "--json"], repoRoot, 1);

    const resumedHistoryFile = path.join(resumedTarget, ".aidn", "runtime", "context", "coordination-history.ndjson");
    const resumedLogFile = path.join(resumedTarget, "docs", "audit", "COORDINATION-LOG.md");

    assert(dryRun.orchestration_status === "dry_run", "orchestrate dry-run should stay in dry_run");
    assert(dryRun.iterations_completed === 0, "dry-run should not execute iterations");
    assert(Array.isArray(dryRun.runs) && dryRun.runs.length === 0, "dry-run should not produce executed runs");
    assert(dryRun.initial_preview.resume_status === "ready", "dry-run should preview a ready resume");

    assert(blocked.orchestration_status === "blocked", "orchestrate should block unresolved escalation");
    assert(blocked.stop_reason === "resume_blocked_until_user_arbitration", "blocked orchestration should cite arbitration gate");
    assert(blocked.iterations_completed === 0, "blocked orchestration should not execute iterations");
    assert(Array.isArray(blocked.runs) && blocked.runs.length === 0, "blocked orchestration should not execute runs");
    assert(blocked.preferred_decision === "reanchor", "blocked orchestration should surface preferred arbitration decision");
    assert(blocked.arbitration_suggestions?.preferred_decision === "reanchor", "blocked orchestration should surface arbitration suggestions");

    assert(resumed.orchestration_status === "blocked", "orchestrate should stop once the post-run loop requires a fresh arbitration");
    assert(resumed.stop_reason === "resume_blocked_until_user_arbitration", "orchestrate should surface the renewed arbitration gate");
    assert(resumed.iterations_completed === 1, "orchestrate should execute one bounded iteration");
    assert(Array.isArray(resumed.runs) && resumed.runs.length === 1, "orchestrate should record the executed iteration");
    assert(resumed.runs[0].resume_status === "resumed_after_arbitration", "orchestrate should preserve arbitration-aware resume status");
    assert(resumed.runs[0].execution_status === "executed", "orchestrate should execute the resumed dispatch");
    assert(fs.existsSync(resumedHistoryFile), "orchestrate should write coordination history");
    assert(fs.existsSync(resumedLogFile), "orchestrate should write coordination log");
    assert(fs.readFileSync(resumedHistoryFile, "utf8").includes("\"event\":\"user_arbitration\""), "orchestrate history should retain arbitration event");

    assert(roleBlocked.orchestration_status === "blocked", "role-blocked orchestration should be blocked");
    assert(roleBlocked.stop_reason === "resume_blocked_until_user_arbitration", "role-blocked orchestration should stop on arbitration gate");
    assert(roleBlocked.iterations_completed === 0, "role-blocked orchestration should not execute iterations");
    assert(roleBlocked.initial_preview.dispatch.recommended_role_coverage?.status === "blocked", "role-blocked orchestration should expose blocked role coverage");
    assert(roleBlocked.preferred_decision === "reanchor", "role-blocked orchestration should prefer reanchor");
    assert(roleBlocked.arbitration_suggestions?.suggestions?.some((item) => item.decision === "reanchor" && item.immediately_actionable === true), "role-blocked orchestration should expose actionable reanchor suggestion");
    assert(roleBlocked.arbitration_suggestions?.suggestions?.some((item) => item.decision === "continue" && item.immediately_actionable === false), "role-blocked orchestration should expose non-actionable continue suggestion");

    const output = {
      ts: new Date().toISOString(),
      dry_run: dryRun,
      blocked,
      resumed,
      role_blocked: roleBlocked,
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
