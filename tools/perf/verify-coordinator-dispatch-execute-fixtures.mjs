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
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--handoff-fixtures-root") {
      args.handoffFixturesRoot = String(argv[i + 1] ?? "").trim();
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
  console.log("  node tools/perf/verify-coordinator-dispatch-execute-fixtures.mjs");
  console.log("  node tools/perf/verify-coordinator-dispatch-execute-fixtures.mjs --json");
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
    throw new Error([
      `Command failed (${path.basename(script)})`,
      `args=${JSON.stringify(args)}`,
      `expected_status=${expectStatus}`,
      `actual_status=${String(result.status ?? "null")}`,
      `stdout=${JSON.stringify(String(result.stdout ?? "").trim())}`,
      `stderr=${JSON.stringify(String(result.stderr ?? "").trim())}`,
    ].join(" | "));
  }
  return JSON.parse(String(result.stdout ?? "{}"));
}

function writeDualConfig(targetRoot) {
  const aidnRoot = path.join(targetRoot, ".aidn");
  fs.mkdirSync(aidnRoot, { recursive: true });
  fs.writeFileSync(path.join(aidnRoot, "config.json"), JSON.stringify({
    runtime: {
      stateMode: "dual",
      indexStoreMode: "dual-sqlite",
    },
    version: 1,
    install: {
      artifactImportStore: "dual-sqlite",
    },
    profile: "dual",
    workflow: {
      sourceBranch: "dev",
    },
  }, null, 2), "utf8");
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
    "## Backlog Items",
    "",
    "backlog_items:",
    "- implement alpha feature validation",
    "",
    "## Open Questions",
    "",
    "open_questions:",
    "- none",
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
    const dispatchExecuteScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-dispatch-execute.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-coordinator-execute-"));
    const readyTarget = path.join(tempRoot, "ready");
    const warnTarget = path.join(tempRoot, "warn");
    const blockedTarget = path.join(tempRoot, "blocked");
    const escalatedTarget = path.join(tempRoot, "escalated");
    const roleBlockedTarget = path.join(tempRoot, "role-blocked");

    fs.cpSync(path.join(handoffFixturesRoot, "ready"), readyTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "warn"), warnTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "blocked"), blockedTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), escalatedTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "warn"), roleBlockedTarget, { recursive: true });
    installSharedPlanningFixture(readyTarget);
    writeDualConfig(warnTarget);
    writeDualConfig(roleBlockedTarget);
    initGitRepo(readyTarget, { workingBranch: "feature/C101-alpha" });
    initGitRepo(warnTarget, { workingBranch: "feature/C101-alpha" });
    initGitRepo(blockedTarget, { workingBranch: "feature/C101-alpha" });
    initGitRepo(escalatedTarget, { workingBranch: "feature/C101-alpha" });
    initGitRepo(roleBlockedTarget, { workingBranch: "feature/C101-alpha" });

    runJson(handoffProjectScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", warnTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", blockedTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", roleBlockedTarget, "--json"], repoRoot, 0);

    const escalatedHistory = path.join(escalatedTarget, ".aidn", "runtime", "context", "coordination-history.ndjson");
    fs.mkdirSync(path.dirname(escalatedHistory), { recursive: true });
    const repeatedEvents = [
      { ts: "2026-03-09T02:00:00Z", event: "coordinator_dispatch", selected_agent: "codex", recommended_role: "executor", recommended_action: "implement", goal: "implement alpha feature validation", dispatch_status: "ready", execution_status: "executed", entrypoint_kind: "skill", entrypoint_name: "branch-cycle-audit", stop_required: false, executed: true, executed_steps: [] },
      { ts: "2026-03-09T02:05:00Z", event: "coordinator_dispatch", selected_agent: "codex", recommended_role: "executor", recommended_action: "implement", goal: "implement alpha feature validation", dispatch_status: "ready", execution_status: "executed", entrypoint_kind: "skill", entrypoint_name: "branch-cycle-audit", stop_required: false, executed: true, executed_steps: [] },
      { ts: "2026-03-09T02:10:00Z", event: "coordinator_dispatch", selected_agent: "codex", recommended_role: "executor", recommended_action: "implement", goal: "implement alpha feature validation", dispatch_status: "ready", execution_status: "executed", entrypoint_kind: "skill", entrypoint_name: "branch-cycle-audit", stop_required: false, executed: true, executed_steps: [] },
      { ts: "2026-03-09T02:15:00Z", event: "coordinator_dispatch", selected_agent: "codex", recommended_role: "executor", recommended_action: "implement", goal: "implement alpha feature validation", dispatch_status: "ready", execution_status: "executed", entrypoint_kind: "skill", entrypoint_name: "branch-cycle-audit", stop_required: false, executed: true, executed_steps: [] },
      { ts: "2026-03-09T02:20:00Z", event: "coordinator_dispatch", selected_agent: "codex", recommended_role: "executor", recommended_action: "implement", goal: "implement alpha feature validation", dispatch_status: "ready", execution_status: "executed", entrypoint_kind: "skill", entrypoint_name: "branch-cycle-audit", stop_required: false, executed: true, executed_steps: [] }
    ];
    fs.writeFileSync(escalatedHistory, repeatedEvents.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
    const escalatedSummary = path.join(escalatedTarget, "docs", "audit", "COORDINATION-SUMMARY.md");
    fs.writeFileSync(escalatedSummary, [
      "# Coordination Summary",
      "",
      "## Summary",
      "",
      "updated_at: 2026-03-09T02:21:00Z",
      "history_status: available",
      "total_dispatches: 5",
      "last_recommended_role: executor",
      "last_recommended_action: implement",
      "last_execution_status: executed",
      "",
    ].join("\n"), "utf8");

    const externalAgentDir = path.join(warnTarget, ".aidn", "runtime", "agents");
    fs.mkdirSync(externalAgentDir, { recursive: true });
    fs.writeFileSync(path.join(externalAgentDir, "external-auditor.mjs"), [
      "import { spawnSync } from \"node:child_process\";",
      "",
      "export function createExternalAuditorAdapter({ id }) {",
      "  return {",
      "    getProfile() {",
      "      return {",
      "        id,",
      "        label: \"External Auditor Adapter\",",
      "        default_role: \"auditor\",",
      "        supported_roles: [\"auditor\"],",
      "        capabilities_by_role: { auditor: [\"audit\", \"analyze\", \"relay\"] },",
      "      };",
      "    },",
      "    canHandleRole({ role, action } = {}) {",
      "      return role === \"auditor\" && (!action || action === \"audit\" || action === \"analyze\" || action === \"relay\");",
      "    },",
      "    runCommand({ command, commandArgs = [], envOverrides = {} }) {",
      "      if (process.platform === \"win32\" && /\\.(cmd|bat)$/i.test(command)) {",
      "        return spawnSync(\"cmd.exe\", [\"/d\", \"/s\", \"/c\", [command, ...commandArgs].join(\" \")], {",
      "          encoding: \"utf8\",",
      "          stdio: [\"ignore\", \"pipe\", \"pipe\"],",
      "          cwd: process.cwd(),",
      "          env: { ...process.env, ...envOverrides },",
      "          shell: false,",
      "        });",
      "      }",
      "      return spawnSync(command, commandArgs, {",
      "        encoding: \"utf8\",",
      "        stdio: [\"ignore\", \"pipe\", \"pipe\"],",
      "        cwd: process.cwd(),",
      "        env: { ...process.env, ...envOverrides },",
      "        shell: false,",
      "      });",
      "    },",
      "  };",
      "}",
    ].join("\n"), "utf8");
    const heterogeneousRoster = [
      "# Agent Roster",
      "",
      "default_agent_selection: auto",
      "",
      "## codex",
      "enabled: yes",
      "priority: 5",
      "roles: coordinator, executor, auditor, repair",
      "",
      "## codex-auditor",
      "enabled: yes",
      "priority: 40",
      "roles: auditor",
      "",
      "## codex-repair",
      "enabled: yes",
      "priority: 50",
      "roles: repair",
      "",
      "## local-shell-auditor",
      "enabled: yes",
      "priority: 150",
      "roles: auditor",
      "",
      "## local-shell-repair",
      "enabled: yes",
      "priority: 160",
      "roles: repair",
      "",
      "## external-auditor",
      "enabled: yes",
      "priority: 200",
      "roles: auditor",
      "adapter_module: .aidn/runtime/agents/external-auditor.mjs",
      "adapter_export: createExternalAuditorAdapter",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(warnTarget, "docs", "audit", "AGENT-ROSTER.md"), heterogeneousRoster, "utf8");
    const roleBlockedAgentDir = path.join(roleBlockedTarget, ".aidn", "runtime", "agents");
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
    fs.writeFileSync(path.join(roleBlockedTarget, "docs", "audit", "AGENT-ROSTER.md"), [
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

    const dryRun = runJson(dispatchExecuteScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    const executed = runJson(dispatchExecuteScript, ["--target", readyTarget, "--execute", "--json"], repoRoot, 0);
    const warnLocalShellExecuted = runJson(dispatchExecuteScript, ["--target", warnTarget, "--execute", "--json"], repoRoot, 1);
    const blockedExecuted = runJson(dispatchExecuteScript, ["--target", blockedTarget, "--execute", "--json"], repoRoot, 0);
    const escalatedDryRun = runJson(dispatchExecuteScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    const escalatedExecute = runJson(dispatchExecuteScript, ["--target", escalatedTarget, "--execute", "--json"], repoRoot, 1);
    const roleBlockedDryRun = runJson(dispatchExecuteScript, ["--target", roleBlockedTarget, "--json"], repoRoot, 0);
    const roleBlockedExecute = runJson(dispatchExecuteScript, ["--target", roleBlockedTarget, "--execute", "--json"], repoRoot, 1);
    const readyLogFile = path.join(readyTarget, "docs", "audit", "COORDINATION-LOG.md");
    const warnLogFile = path.join(warnTarget, "docs", "audit", "COORDINATION-LOG.md");
    const warnSummaryFile = path.join(warnTarget, "docs", "audit", "COORDINATION-SUMMARY.md");
    const warnHistoryFile = path.join(warnTarget, ".aidn", "runtime", "context", "coordination-history.ndjson");
    const blockedLogFile = path.join(blockedTarget, "docs", "audit", "COORDINATION-LOG.md");
    const escalatedLogFile = path.join(escalatedTarget, "docs", "audit", "COORDINATION-LOG.md");
    const roleBlockedLogFile = path.join(roleBlockedTarget, "docs", "audit", "COORDINATION-LOG.md");
    const readySummaryFile = path.join(readyTarget, "docs", "audit", "COORDINATION-SUMMARY.md");
    const blockedSummaryFile = path.join(blockedTarget, "docs", "audit", "COORDINATION-SUMMARY.md");
    const readyHistoryFile = path.join(readyTarget, ".aidn", "runtime", "context", "coordination-history.ndjson");
    const blockedHistoryFile = path.join(blockedTarget, ".aidn", "runtime", "context", "coordination-history.ndjson");
    const escalatedHistoryFile = path.join(escalatedTarget, ".aidn", "runtime", "context", "coordination-history.ndjson");

    assert(dryRun.execution_status === "dry_run", "dry run should report dry_run");
    assert(dryRun.executed === false, "dry run should not execute");
    assert(Array.isArray(dryRun.executed_steps) && dryRun.executed_steps.length === 0, "dry run should not record executed steps");
    assert(dryRun.coordination_log_appended === false, "dry run should not append coordination log");
    assert(String(dryRun.coordination_log_entry ?? "").includes("Dispatch "), "dry run should expose coordination log entry preview");
    assert(dryRun.coordination_summary_written === false, "dry run should not write coordination summary");
    assert(dryRun.coordination_summary === null, "dry run should not build coordination summary");
    assert(dryRun.coordination_history_appended === false, "dry run should not append coordination history");
    assert(String(dryRun.coordination_history_event?.event ?? "") === "coordinator_dispatch", "dry run should expose coordination history preview");
    assert(dryRun.preferred_dispatch_source === "shared_planning", "dry run should expose shared planning provenance");
    assert(dryRun.shared_planning_candidate?.candidate_aligned === true, "dry run should expose aligned shared planning candidate");

    assert(executed.execution_status === "executed", "ready execution should report executed");
    assert(executed.executed === true, "ready execution should execute");
    assert(Array.isArray(executed.executed_steps) && executed.executed_steps.length === 2, "ready execution should run two steps");
    assert(executed.executed_steps.every((step) => step.ok === true), "ready execution steps should pass");
    assert(executed.executed_steps[0].command_line.includes("branch-cycle-audit"), "ready execution should start with branch-cycle-audit");
    assert(executed.executed_steps[1].command_line.includes("hydrate-context"), "ready execution should hydrate context after branch-cycle-audit");
    assert(executed.coordination_log_appended === true, "ready execution should append coordination log");
    assert(executed.coordination_summary_written === true, "ready execution should refresh coordination summary");
    assert(executed.coordination_history_appended === true, "ready execution should append coordination history");
    assert(executed.preferred_dispatch_source === "shared_planning", "ready execution should record shared planning provenance");
    assert(executed.shared_planning_candidate?.candidate_aligned === true, "ready execution should keep aligned shared planning candidate");
    assert(fs.existsSync(readyLogFile), "ready execution should write coordination log");
    assert(fs.existsSync(readySummaryFile), "ready execution should write coordination summary");
    assert(fs.existsSync(readyHistoryFile), "ready execution should write coordination history");
    assert(fs.readFileSync(readyLogFile, "utf8").includes("recommended_role: executor"), "ready coordination log should record executor relay");
    assert(fs.readFileSync(readyLogFile, "utf8").includes("preferred_dispatch_source: shared_planning"), "ready coordination log should record shared planning provenance");
    assert(fs.readFileSync(readySummaryFile, "utf8").includes("last_recommended_role: executor"), "ready coordination summary should record executor relay");
    assert(fs.readFileSync(readySummaryFile, "utf8").includes("last_preferred_dispatch_source: shared_planning"), "ready coordination summary should record shared planning provenance");
    assert(fs.readFileSync(readyHistoryFile, "utf8").includes("\"recommended_role\":\"executor\""), "ready coordination history should record executor relay");
    assert(fs.readFileSync(readyHistoryFile, "utf8").includes("\"preferred_dispatch_source\":\"shared_planning\""), "ready coordination history should record shared planning provenance");

    assert(warnLocalShellExecuted.execution_status === "failed", "warn execution should report failed when strict drift-check stops");
    assert(warnLocalShellExecuted.executed === false, "warn execution should not report executed when drift-check stops");
    assert(warnLocalShellExecuted.selected_agent.id === "external-auditor", "warn execution should use the externally registered auditor adapter");
    assert(Array.isArray(warnLocalShellExecuted.executed_steps) && warnLocalShellExecuted.executed_steps.length === 1, "warn execution should stop after the failing drift-check step");
    assert(warnLocalShellExecuted.executed_steps[0].ok === false, "warn execution should record the failing drift-check step");
    assert(warnLocalShellExecuted.executed_steps[0].command_line.includes("drift-check"), "warn execution should start with drift-check");
    assert(warnLocalShellExecuted.coordination_log_appended === true, "warn execution should append coordination log");
    assert(warnLocalShellExecuted.coordination_summary_written === true, "warn execution should refresh coordination summary");
    assert(warnLocalShellExecuted.coordination_history_appended === true, "warn execution should append coordination history");
    assert(fs.existsSync(warnLogFile), "warn execution should write coordination log");
    assert(fs.existsSync(warnSummaryFile), "warn execution should write coordination summary");
    assert(fs.existsSync(warnHistoryFile), "warn execution should write coordination history");
    assert(fs.readFileSync(warnLogFile, "utf8").includes("selected_agent: external-auditor"), "warn coordination log should record the external auditor adapter");
    assert(fs.readFileSync(warnSummaryFile, "utf8").includes("last_recommended_role: auditor"), "warn coordination summary should record auditor relay");
    assert(fs.readFileSync(warnSummaryFile, "utf8").includes("last_execution_status: failed"), "warn coordination summary should record the failed audit relay");
    assert(fs.readFileSync(warnHistoryFile, "utf8").includes("\"selected_agent\":\"external-auditor\""), "warn coordination history should record the external auditor adapter");

    assert(blockedExecuted.execution_status === "executed", "blocked execution should still execute gated repair steps");
    assert(blockedExecuted.executed === true, "blocked execution should execute");
    assert(blockedExecuted.dispatch_status === "gated", "blocked execution should stay gated");
    assert(blockedExecuted.executed_steps[0].command_line.includes("project-runtime-state"), "blocked execution should refresh runtime state");
    assert(blockedExecuted.executed_steps.every((step) => step.ok === true), "blocked execution steps should pass");
    assert(blockedExecuted.coordination_log_appended === true, "blocked execution should append coordination log");
    assert(blockedExecuted.coordination_summary_written === true, "blocked execution should refresh coordination summary");
    assert(blockedExecuted.coordination_history_appended === true, "blocked execution should append coordination history");
    assert(fs.existsSync(blockedLogFile), "blocked execution should write coordination log");
    assert(fs.existsSync(blockedSummaryFile), "blocked execution should write coordination summary");
    assert(fs.existsSync(blockedHistoryFile), "blocked execution should write coordination history");
    assert(fs.readFileSync(blockedLogFile, "utf8").includes("recommended_role: repair"), "blocked coordination log should record repair relay");
    assert(fs.readFileSync(blockedSummaryFile, "utf8").includes("last_recommended_role: repair"), "blocked coordination summary should record repair relay");
    assert(fs.readFileSync(blockedHistoryFile, "utf8").includes("\"recommended_role\":\"repair\""), "blocked coordination history should record repair relay");

    assert(escalatedDryRun.dispatch_status === "escalated", "escalated dry run should expose escalated dispatch");
    assert(escalatedDryRun.execution_status === "dry_run", "escalated dry run should remain dry_run");
    assert(escalatedExecute.dispatch_status === "escalated", "escalated execute should stay escalated");
    assert(escalatedExecute.execution_status === "escalated", "escalated execute should refuse execution");
    assert(escalatedExecute.executed === false, "escalated execute should not execute");
    assert(Array.isArray(escalatedExecute.executed_steps) && escalatedExecute.executed_steps.length === 0, "escalated execute should have no steps");
    assert(escalatedExecute.coordination_log_appended === false, "escalated execute should not append coordination log");
    assert(escalatedExecute.coordination_history_appended === false, "escalated execute should not append coordination history");
    assert(escalatedExecute.coordination_summary_written === false, "escalated execute should not rewrite coordination summary");
    assert(fs.existsSync(escalatedHistoryFile), "escalated fixture should retain original history");
    assert(!fs.existsSync(escalatedLogFile), "escalated execute should not create coordination log");
    assert(roleBlockedDryRun.dispatch_status === "escalated", "role-blocked dry run should expose escalated dispatch");
    assert(roleBlockedExecute.dispatch_status === "escalated", "role-blocked execute should stay escalated");
    assert(roleBlockedExecute.execution_status === "escalated", "role-blocked execute should refuse execution");
    assert(roleBlockedExecute.executed === false, "role-blocked execute should not execute");
    assert(roleBlockedExecute.coordination_log_appended === false, "role-blocked execute should not append coordination log");
    assert(roleBlockedExecute.coordination_history_appended === false, "role-blocked execute should not append coordination history");
    assert(roleBlockedExecute.recommended_role_coverage.status === "blocked", "role-blocked execute should expose blocked coverage");
    assert(!fs.existsSync(roleBlockedLogFile), "role-blocked execute should not create coordination log");

    const output = {
      ts: new Date().toISOString(),
      dry_run: dryRun,
      ready_execute: executed,
      warn_local_shell_execute: warnLocalShellExecuted,
      blocked_execute: blockedExecuted,
      escalated_dry_run: escalatedDryRun,
      escalated_execute: escalatedExecute,
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
