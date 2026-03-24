#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    handoffFixturesRoot: "tests/fixtures/perf-handoff",
    currentStateFixturesRoot: "tests/fixtures/perf-current-state",
    integrationFixturesRoot: "tests/fixtures/perf-integration-risk",
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
    } else if (token === "--integration-fixtures-root") {
      args.integrationFixturesRoot = String(argv[i + 1] ?? "").trim();
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
  console.log("  node tools/perf/verify-coordinator-dispatch-plan-fixtures.mjs");
  console.log("  node tools/perf/verify-coordinator-dispatch-plan-fixtures.mjs --json");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(script, args, repoRoot, expectStatus = 0, env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== expectStatus) {
    throw new Error(`Command failed (${path.basename(script)}): ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "{}"));
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const handoffFixturesRoot = path.resolve(repoRoot, args.handoffFixturesRoot);
    const currentStateFixturesRoot = path.resolve(repoRoot, args.currentStateFixturesRoot);
    const integrationFixturesRoot = path.resolve(repoRoot, args.integrationFixturesRoot);
    const handoffProjectScript = path.resolve(repoRoot, "tools", "runtime", "project-handoff-packet.mjs");
    const dispatchScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-dispatch-plan.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-coordinator-dispatch-"));
    const readyTarget = path.join(tempRoot, "ready");
    const warnTarget = path.join(tempRoot, "warn");
    const blockedTarget = path.join(tempRoot, "blocked");
    const fallbackTarget = path.join(tempRoot, "fallback");
    const escalatedTarget = path.join(tempRoot, "escalated");
    const roleBlockedTarget = path.join(tempRoot, "role-blocked");
    const directMergeIntegrationTarget = path.join(tempRoot, "direct-merge-integration");
    const integrationCycleTarget = path.join(tempRoot, "integration-cycle-strategy");
    const dbOnlyFilelessTarget = path.join(tempRoot, "db-only-fileless");

    fs.cpSync(path.join(handoffFixturesRoot, "ready"), readyTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "warn"), warnTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "blocked"), blockedTarget, { recursive: true });
    fs.cpSync(path.join(currentStateFixturesRoot, "active"), fallbackTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), escalatedTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "warn"), roleBlockedTarget, { recursive: true });
    fs.cpSync(path.join(integrationFixturesRoot, "direct-merge"), directMergeIntegrationTarget, { recursive: true });
    fs.cpSync(path.join(integrationFixturesRoot, "integration-cycle"), integrationCycleTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), dbOnlyFilelessTarget, { recursive: true });

    runJson(handoffProjectScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", warnTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", blockedTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", roleBlockedTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", dbOnlyFilelessTarget, "--json"], repoRoot, 0, {
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
    ]) {
      fs.rmSync(path.join(dbOnlyFilelessTarget, rel), { force: true });
    }

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
    const fallbackCurrentState = path.join(fallbackTarget, "docs", "audit", "CURRENT-STATE.md");
    const fallbackCurrentStateText = fs.readFileSync(fallbackCurrentState, "utf8");
    fs.writeFileSync(fallbackCurrentState, fallbackCurrentStateText.replace(
      "first_plan_step: implement alpha feature validation",
      [
        "first_plan_step: implement alpha feature validation",
        "active_backlog: backlog/BL-S101-session-planning.md",
        "backlog_status: promoted",
        "backlog_next_step: validate shared planning before dispatch",
        "planning_arbitration_status: review_requested",
      ].join("\n"),
    ), "utf8");
    const fallbackBacklogDir = path.join(fallbackTarget, "docs", "audit", "backlog");
    fs.mkdirSync(fallbackBacklogDir, { recursive: true });
    fs.writeFileSync(path.join(fallbackBacklogDir, "BL-S101-session-planning.md"), [
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
      "planning_arbitration_status: review_requested",
      "next_dispatch_scope: session",
      "next_dispatch_action: coordinate",
      "backlog_next_step: validate shared planning before dispatch",
      "",
      "## Backlog Items",
      "",
      "backlog_items:",
      "- validate shared planning before dispatch",
      "- preserve session-level arbitration trace",
      "",
      "## Open Questions",
      "",
      "open_questions:",
      "- should coordinator dispatch session or cycle work next?",
      "",
      "## Addenda",
      "",
      "- ts: 2026-03-09T01:03:00Z | agent_role: coordinator | rationale: initial session backlog promotion | affected_item: validate shared planning before dispatch | affected_question: should coordinator dispatch session or cycle work next? | note: promoted from runtime draft",
      "",
    ].join("\n"), "utf8");

    const ready = runJson(dispatchScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    const warn = runJson(dispatchScript, ["--target", warnTarget, "--json"], repoRoot, 0);
    const blocked = runJson(dispatchScript, ["--target", blockedTarget, "--json"], repoRoot, 0);
    const fallback = runJson(dispatchScript, ["--target", fallbackTarget, "--json"], repoRoot, 0);
    const escalated = runJson(dispatchScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    const directMergeIntegration = runJson(dispatchScript, ["--target", directMergeIntegrationTarget, "--json"], repoRoot, 0);
    const integrationCycle = runJson(dispatchScript, ["--target", integrationCycleTarget, "--json"], repoRoot, 0);
    const dbOnlyFileless = runJson(dispatchScript, ["--target", dbOnlyFilelessTarget, "--json"], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });

    const localShellRosterContent = [
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
    ].join("\n");
    for (const target of [readyTarget, warnTarget, blockedTarget]) {
    fs.writeFileSync(path.join(target, "docs", "audit", "AGENT-ROSTER.md"), localShellRosterContent, "utf8");
    }
    const readyLocalShell = runJson(dispatchScript, ["--target", readyTarget, "--agent-roster-file", "docs/audit/AGENT-ROSTER.md", "--json"], repoRoot, 0);
    const warnLocalShell = runJson(dispatchScript, ["--target", warnTarget, "--agent-roster-file", "docs/audit/AGENT-ROSTER.md", "--json"], repoRoot, 0);
    const blockedLocalShell = runJson(dispatchScript, ["--target", blockedTarget, "--agent-roster-file", "docs/audit/AGENT-ROSTER.md", "--json"], repoRoot, 0);
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
      "        return spawnSync(\"cmd.exe\", [\"/d\", \"/s\", \"/c\", [command, ...commandArgs].join(\" \")], { encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"], cwd: process.cwd(), env: { ...process.env, ...envOverrides }, shell: false });",
      "      }",
      "      return spawnSync(command, commandArgs, { encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"], cwd: process.cwd(), env: { ...process.env, ...envOverrides }, shell: false });",
      "    },",
      "  };",
      "}",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(warnTarget, "docs", "audit", "AGENT-ROSTER.md"), [
      "# Agent Roster",
      "",
      "default_agent_selection: auto",
      "",
      "## codex",
      "enabled: yes",
      "priority: 5",
      "roles: coordinator, executor, auditor, repair",
      "",
      "## external-auditor",
      "enabled: yes",
      "priority: 200",
      "roles: auditor",
      "adapter_module: .aidn/runtime/agents/external-auditor.mjs",
      "adapter_export: createExternalAuditorAdapter",
      "",
    ].join("\n"), "utf8");
    const warnExternal = runJson(dispatchScript, ["--target", warnTarget, "--agent-roster-file", "docs/audit/AGENT-ROSTER.md", "--json"], repoRoot, 0);
    fs.writeFileSync(path.join(warnTarget, "docs", "audit", "AGENT-ROSTER.md"), [
      "# Agent Roster",
      "",
      "default_agent_selection: auto",
      "",
      "## codex",
      "enabled: yes",
      "priority: 5",
      "roles: coordinator, executor, auditor, repair",
      "",
      "## broken-auditor",
      "enabled: yes",
      "priority: 300",
      "roles: auditor",
      "adapter_module: .aidn/runtime/agents/missing-auditor.mjs",
      "adapter_export: createMissingAuditorAdapter",
      "",
    ].join("\n"), "utf8");
    const warnBroken = runJson(dispatchScript, ["--target", warnTarget, "--agent-roster-file", "docs/audit/AGENT-ROSTER.md", "--json"], repoRoot, 0);
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
    const roleBlocked = runJson(dispatchScript, ["--target", roleBlockedTarget, "--agent-roster-file", "docs/audit/AGENT-ROSTER.md", "--json"], repoRoot, 0);

    assert(ready.dispatch_status === "ready", "ready dispatch should be ready");
    assert(ready.coordinator_status?.admission_status === "admitted", "ready dispatch should expose normalized coordinator status");
    assert(ready.entrypoint_name === "branch-cycle-audit", "ready dispatch should use branch-cycle-audit");
    assert(ready.selected_agent.id === "codex", "ready dispatch should use the general codex adapter");
    assert(ready.dispatch_scope.scope_type === "cycle", "ready dispatch should expose cycle scope");
    assert(ready.dispatch_scope.scope_id === "C101", "ready dispatch should expose active cycle id");
    assert(ready.commands.some((item) => item.includes("--skill branch-cycle-audit")), "ready dispatch should include branch-cycle-audit command");

    assert(warn.dispatch_status === "ready", "warn dispatch should stay ready");
    assert(warn.entrypoint_name === "drift-check", "warn dispatch should use drift-check");
    assert(warn.selected_agent.id === "codex-auditor", "warn dispatch should prefer the specialized auditor adapter");
    assert(warn.dispatch_scope.scope_type === "cycle", "warn dispatch should expose cycle scope");
    assert(warn.commands.some((item) => item.includes("--skill drift-check")), "warn dispatch should include drift-check command");

    assert(blocked.dispatch_status === "gated", "blocked dispatch should be gated");
    assert(blocked.coordinator_status?.admission_status === "blocked", "blocked dispatch should expose blocked coordinator status");
    assert(blocked.entrypoint_kind === "runtime", "blocked dispatch should use runtime entrypoint");
    assert(blocked.selected_agent.id === "codex-repair", "blocked dispatch should prefer the specialized repair adapter");
    assert(blocked.dispatch_scope.scope_type === "cycle", "blocked dispatch should preserve cycle scope");
    assert(blocked.commands.some((item) => item.includes("runtime project-runtime-state")), "blocked dispatch should refresh runtime state");

    assert(fallback.dispatch_status === "escalated", "fallback dispatch should escalate when shared planning arbitration is unresolved");
    assert(fallback.entrypoint_kind === "manual", "fallback dispatch should become manual when shared planning arbitration is unresolved");
    assert(fallback.entrypoint_name === "user-arbitration", "fallback dispatch should point to user arbitration when shared planning arbitration is unresolved");
    assert(fallback.shared_planning.enabled === true, "fallback dispatch should expose active shared planning");
    assert(fallback.shared_planning.active_backlog === "backlog/BL-S101-session-planning.md", "fallback dispatch should expose the active backlog path");
    assert(fallback.shared_planning.artifact_found === true, "fallback dispatch should load the backlog artifact");
    assert(Array.isArray(fallback.shared_planning.backlog_items) && fallback.shared_planning.backlog_items.length === 2, "fallback dispatch should expose backlog items from the shared artifact");
    assert(Array.isArray(fallback.shared_planning.open_questions) && fallback.shared_planning.open_questions.length === 1, "fallback dispatch should expose open questions from the shared artifact");
    assert(fallback.shared_planning.dispatch_ready === true, "fallback dispatch should expose dispatch readiness from the shared artifact");
    assert(fallback.shared_planning.next_dispatch_scope === "session", "fallback dispatch should expose the backlog dispatch scope");
    assert(fallback.shared_planning.next_dispatch_action === "coordinate", "fallback dispatch should expose the backlog dispatch action");
    assert(fallback.shared_planning.freshness_status === "ok", "fallback dispatch should expose aligned shared planning freshness when backlog is newer than CURRENT-STATE");
    assert(fallback.shared_planning.gate_status === "blocked", "fallback dispatch should block unresolved shared planning arbitration");
    assert(Array.isArray(fallback.shared_planning.recent_addenda) && fallback.shared_planning.recent_addenda.length === 1, "fallback dispatch should expose structured recent addenda");
    assert(fallback.shared_planning.recent_addenda[0].agent_role === "coordinator", "fallback dispatch should preserve addendum agent role");
    assert(fallback.shared_planning.recent_addenda[0].rationale === "initial session backlog promotion", "fallback dispatch should preserve addendum rationale");
    assert(fallback.notes.some((note) => note.includes("Shared planning backlog: backlog/BL-S101-session-planning.md")), "fallback dispatch should mention the shared backlog");
    assert(fallback.notes.some((note) => note.includes("Shared planning freshness: ok")), "fallback dispatch should mention shared planning freshness");
    assert(fallback.notes.some((note) => note.includes("Shared planning next step: validate shared planning before dispatch")), "fallback dispatch should mention the shared backlog next step");
    assert(fallback.notes.some((note) => note.includes("Planning arbitration status: review_requested")), "fallback dispatch should mention the shared planning arbitration status");
    assert(fallback.notes.some((note) => note.includes("Shared planning items: validate shared planning before dispatch; preserve session-level arbitration trace")), "fallback dispatch should summarize backlog items");
    assert(fallback.notes.some((note) => note.includes("Shared planning open questions: should coordinator dispatch session or cycle work next?")), "fallback dispatch should summarize open questions");
    assert(fallback.notes.some((note) => note.includes("Shared planning addenda: 1 (coordinator: initial session backlog promotion)")), "fallback dispatch should summarize structured addenda");
    assert(fallback.notes.some((note) => note.includes("Shared planning dispatch candidate: session + coordinate")), "fallback dispatch should expose the shared planning dispatch candidate");
    assert(fallback.notes.some((note) => note.includes("Shared planning arbitration must be resolved before dispatch")), "fallback dispatch should explain the arbitration block");
    assert(fallback.preconditions.includes("read the active shared backlog artifact before acting"), "fallback dispatch should require reading the shared backlog before acting");

    assert(escalated.dispatch_status === "escalated", "escalated dispatch should require manual arbitration");
    assert(escalated.entrypoint_kind === "manual", "escalated dispatch should use manual entrypoint");
    assert(escalated.entrypoint_name === "user-arbitration", "escalated dispatch should point to user arbitration");
    assert(Array.isArray(escalated.commands) && escalated.commands.length === 0, "escalated dispatch should not emit runnable commands");

    assert(readyLocalShell.selected_agent.id === "codex", "executor relay should stay on the general codex adapter even with local-shell adapters enabled");
    assert(warnLocalShell.selected_agent.id === "local-shell-auditor", "warn dispatch should be able to select the local-shell auditor adapter through the roster");
    assert(blockedLocalShell.selected_agent.id === "local-shell-repair", "blocked dispatch should be able to select the local-shell repair adapter through the roster");
    assert(warnExternal.selected_agent.id === "external-auditor", "warn dispatch should be able to select an externally registered auditor adapter");
    assert(warnBroken.selected_agent.id === "codex-auditor", "warn dispatch should ignore unavailable auditors and fall back to a healthy adapter");
    assert(roleBlocked.dispatch_status === "escalated", "role-blocked dispatch should escalate when the recommended role has no runnable adapter");
    assert(roleBlocked.entrypoint_kind === "manual", "role-blocked dispatch should become manual");
    assert(roleBlocked.entrypoint_name === "user-arbitration", "role-blocked dispatch should point to user arbitration");
    assert(roleBlocked.recommended_role_coverage.status === "blocked", "role-blocked dispatch should expose blocked role coverage");
    assert(roleBlocked.notes.some((note) => note.includes("Recommended role coverage is blocked")), "role-blocked dispatch should explain the blocked coverage");
    assert(directMergeIntegration.dispatch_status === "ready", "direct-merge integration assessment should not escalate the coordinator");
    assert(directMergeIntegration.integration_risk.recommended_strategy === "direct_merge", "direct-merge integration assessment should expose direct_merge");
    assert(directMergeIntegration.notes.some((note) => note.includes("Integration strategy assessment: direct_merge")), "direct-merge integration assessment should be surfaced in notes");
    assert(integrationCycle.dispatch_status === "escalated", "integration-cycle assessment should escalate the session-level dispatch");
    assert(integrationCycle.entrypoint_kind === "manual", "integration-cycle assessment should force a manual entrypoint");
    assert(integrationCycle.integration_risk.recommended_strategy === "integration_cycle", "integration-cycle assessment should expose integration_cycle");
    assert(integrationCycle.integration_risk_gate.active === true, "integration-cycle assessment should activate the integration gate");
    assert(integrationCycle.notes.some((note) => note.includes("Integration strategy requires explicit resolution: integration_cycle")), "integration-cycle assessment should explain the gate");
    assert(dbOnlyFileless.dispatch_status === "ready", "db-only fileless dispatch should remain ready");
    assert(dbOnlyFileless.coordinator_recommendation.role === "executor", "db-only fileless dispatch should preserve executor relay");
    assert(dbOnlyFileless.coordinator_recommendation.action === "implement", "db-only fileless dispatch should preserve implement relay");
    assert(dbOnlyFileless.context.current_state_source === "sqlite", "db-only fileless dispatch should load current state from SQLite");
    assert(dbOnlyFileless.context.packet_source === "sqlite", "db-only fileless dispatch should load packet from SQLite");

    const output = {
      ts: new Date().toISOString(),
      ready,
      warn,
      blocked,
      fallback,
      escalated,
      direct_merge_integration: directMergeIntegration,
      integration_cycle: integrationCycle,
      db_only_fileless: dbOnlyFileless,
      ready_local_shell: readyLocalShell,
      warn_local_shell: warnLocalShell,
      blocked_local_shell: blockedLocalShell,
      warn_external: warnExternal,
      warn_broken: warnBroken,
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
