#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function main() {
  let tempRoot = "";
  try {
    const repoRoot = process.cwd();
    const sourceTarget = path.resolve(repoRoot, "tests/fixtures/repo-installed-core");
    const script = path.resolve(repoRoot, "tools", "runtime", "project-multi-agent-status.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-multi-agent-status-"));
    const target = path.join(tempRoot, "target");
    fs.cpSync(sourceTarget, target, { recursive: true });

    const result = runJson(script, ["--target", target, "--json"], repoRoot, 0);
    const text = fs.readFileSync(result.output_file, "utf8");

    assert(result.written === true || result.written === false, "projection should return written flag");
    assert(String(result.coordinator?.recommendation?.role ?? "").length > 0, "projection should include coordinator recommendation");
    assert(text.includes("# Multi-Agent Status"), "status file should include title");
    assert(text.includes("## Roster Verification"), "status file should include roster verification section");
    assert(text.includes("## Selection Preview"), "status file should include selection preview section");
    assert(text.includes("## Adapter Health"), "status file should include adapter health section");
    assert(text.includes("## Environment Compatibility"), "status file should include environment compatibility section");
    assert(text.includes("## Role Coverage"), "status file should include role coverage section");
    assert(text.includes("## Coordination"), "status file should include coordination section");
    assert(text.includes("## Arbitration"), "status file should include arbitration section");
    assert(typeof result.arbitration?.preferred_decision === "string", "projection should expose arbitration summary");

    fs.writeFileSync(path.join(target, "docs", "audit", "AGENT-ROSTER.md"), [
      "# Agent Roster",
      "",
      "default_agent_selection: ghost-agent",
      "",
      "## ghost-agent",
      "enabled: yes",
      "priority: 10",
      "roles: auditor",
      "",
    ].join("\n"), "utf8");
    const invalidResult = runJson(script, ["--target", target, "--json"], repoRoot, 0);
    const invalidText = fs.readFileSync(invalidResult.output_file, "utf8");

    assert(invalidResult.roster_verification.pass === false, "invalid roster should be surfaced in multi-agent status");
    assert(invalidText.includes("roster_verification: fail"), "status file should mark roster verification failure");
    assert(invalidText.includes("ghost-agent: unknown adapter id with no adapter_module"), "status file should surface roster issues");

    const externalAgentDir = path.join(target, ".aidn", "runtime", "agents");
    fs.mkdirSync(externalAgentDir, { recursive: true });
    fs.writeFileSync(path.join(externalAgentDir, "probe-failing-adapter.mjs"), [
      "import { spawnSync } from \"node:child_process\";",
      "export function createProbeFailingAdapter({ id }) {",
      "  return {",
      "    getProfile() { return { id, label: \"Probe Failing Adapter\", default_role: \"auditor\", supported_roles: [\"auditor\"], capabilities_by_role: { auditor: [\"audit\", \"analyze\", \"relay\"] } }; },",
      "    canHandleRole({ role, action } = {}) { return role === \"auditor\" && (!action || action === \"audit\" || action === \"analyze\" || action === \"relay\"); },",
      "    checkEnvironment() { return { status: \"unavailable\", reason: \"external runner is not configured\" }; },",
      "    runCommand({ command, commandArgs = [], envOverrides = {} }) { return spawnSync(command, commandArgs, { encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"], cwd: process.cwd(), env: { ...process.env, ...envOverrides }, shell: false }); },",
      "  };",
      "}",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(target, "docs", "audit", "AGENT-ROSTER.md"), [
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
      "## probe-failing",
      "enabled: yes",
      "priority: 90",
      "roles: auditor",
      "adapter_module: .aidn/runtime/agents/probe-failing-adapter.mjs",
      "adapter_export: createProbeFailingAdapter",
      "",
    ].join("\n"), "utf8");
    fs.rmSync(path.join(target, "docs", "audit", "HANDOFF-PACKET.md"), { force: true });
    fs.writeFileSync(path.join(target, "docs", "audit", "CURRENT-STATE.md"), [
      "# Current State",
      "",
      "updated_at: 2026-03-09T10:00:00Z",
      "mode: EXPLORING",
      "active_session: S201",
      "session_branch: S201-exploring",
      "branch_kind: session",
      "active_cycle: none",
      "cycle_branch: none",
      "dor_state: DISCOVERY",
      "runtime_state_mode: dual",
      "repair_layer_status: ok",
      "",
      "## Next Actions",
      "",
      "1. investigate audit findings before implementation",
      "",
    ].join("\n"), "utf8");
    const environmentResult = runJson(script, ["--target", target, "--json"], repoRoot, 0);
    const environmentText = fs.readFileSync(environmentResult.output_file, "utf8");

    assert(environmentResult.agent_health_summary.verification.environment_summary.unavailable >= 1, "multi-agent status should expose environment-unavailable adapters");
    assert(environmentResult.recommended_role_coverage.status === "blocked", "multi-agent status should mark recommended role coverage as blocked when no runnable adapter remains");
    assert(environmentResult.coordinator.recommendation.role === "auditor", "environment coverage test should force an auditor recommendation");
    assert(environmentResult.arbitration.arbitration_required === true, "blocked role coverage should require arbitration in multi-agent status");
    assert(environmentResult.arbitration.preferred_decision === "reanchor", "blocked role coverage should prefer reanchor");
    assert(environmentText.includes("environment_unavailable_count: 1"), "status file should count environment-unavailable adapters");
    assert(environmentText.includes("recommended_role_coverage_status: blocked"), "status file should surface blocked role coverage");
    assert(environmentText.includes("recommendation: no runnable adapter remains for role auditor"), "status file should explain the blocked role coverage");
    assert(environmentText.includes("blocked_adapter: probe-failing -> external runner is not configured"), "status file should surface blocked adapter reasons");
    assert(environmentText.includes("arbitration_required: yes"), "status file should expose arbitration requirement");
    assert(environmentText.includes("preferred_decision: reanchor"), "status file should expose preferred arbitration decision");
    assert(environmentText.includes("suggestion: reanchor recommended=yes actionable=yes"), "status file should expose actionable reanchor suggestion");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
