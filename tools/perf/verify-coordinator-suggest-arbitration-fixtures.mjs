#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function parseArgs(argv) {
  const args = {
    handoffFixturesRoot: "tests/fixtures/perf-handoff",
    integrationFixturesRoot: "tests/fixtures/perf-integration-risk",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--handoff-fixtures-root") {
      args.handoffFixturesRoot = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--integration-fixtures-root") {
      args.integrationFixturesRoot = String(argv[index + 1] ?? "").trim();
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
  console.log("  node tools/perf/verify-coordinator-suggest-arbitration-fixtures.mjs");
  console.log("  node tools/perf/verify-coordinator-suggest-arbitration-fixtures.mjs --json");
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

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const fixturesRoot = path.resolve(repoRoot, args.handoffFixturesRoot);
    const integrationFixturesRoot = path.resolve(repoRoot, args.integrationFixturesRoot);
    const handoffProjectScript = path.resolve(repoRoot, "tools", "runtime", "project-handoff-packet.mjs");
    const suggestScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-suggest-arbitration.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-suggest-arbitration-"));
    const readyTarget = path.join(tempRoot, "ready");
    const roleBlockedTarget = path.join(tempRoot, "role-blocked");
    const integrationCycleTarget = path.join(tempRoot, "integration-cycle");

    fs.cpSync(path.join(fixturesRoot, "ready"), readyTarget, { recursive: true });
    fs.cpSync(path.join(fixturesRoot, "warn"), roleBlockedTarget, { recursive: true });
    fs.cpSync(path.join(integrationFixturesRoot, "integration-cycle"), integrationCycleTarget, { recursive: true });

    runJson(handoffProjectScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", roleBlockedTarget, "--json"], repoRoot, 0);

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

    const ready = runJson(suggestScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    const roleBlocked = runJson(suggestScript, ["--target", roleBlockedTarget, "--json"], repoRoot, 0);
    const integrationCycle = runJson(suggestScript, ["--target", integrationCycleTarget, "--json"], repoRoot, 0);

    assert(ready.arbitration_required === false, "ready dispatch should not require arbitration");
    assert(ready.preferred_decision === "continue", "ready dispatch should prefer continue");
    assert(Array.isArray(ready.suggestions) && ready.suggestions.length === 1, "ready dispatch should emit a single continue suggestion");
    assert(ready.suggestions[0].decision === "continue", "ready suggestion should be continue");
    assert(ready.suggestions[0].immediately_actionable === true, "ready continue should be actionable");

    assert(roleBlocked.arbitration_required === true, "role-blocked dispatch should require arbitration");
    assert(roleBlocked.dispatch_status === "escalated", "role-blocked dispatch should already be escalated");
    assert(roleBlocked.preferred_decision === "reanchor", "role-blocked dispatch should prefer reanchor");
    assert(roleBlocked.recommended_role_coverage.status === "blocked", "role-blocked dispatch should expose blocked coverage");
    assert(roleBlocked.suggestions.some((item) => item.decision === "reanchor" && item.recommended === true && item.immediately_actionable === true), "role-blocked suggestions should include an actionable reanchor");
    assert(roleBlocked.suggestions.some((item) => item.decision === "continue" && item.immediately_actionable === false), "role-blocked suggestions should include a non-actionable continue");
    assert(roleBlocked.suggestions.every((item) => String(item.record_command ?? "").includes("coordinator-record-arbitration")), "suggestions should include record-arbitration commands");
    assert(/no runnable adapter remains for role auditor/i.test(roleBlocked.arbitration_reason), "role-blocked suggestions should explain the blocked auditor coverage");
    assert(integrationCycle.arbitration_required === true, "integration-cycle strategy should require arbitration");
    assert(integrationCycle.dispatch.integration_risk.recommended_strategy === "integration_cycle", "integration-cycle suggestions should expose the integration strategy");
    assert(integrationCycle.preferred_decision === "integration_cycle", "integration-cycle suggestions should prefer an integration vehicle");
    assert(integrationCycle.suggestions.some((item) => item.decision === "integration_cycle" && item.recommended === true && item.immediately_actionable === true), "integration-cycle suggestions should include an actionable integration_cycle decision");
    assert(integrationCycle.suggestions.some((item) => item.decision === "report_forward"), "integration-cycle suggestions should include report_forward as an alternative");

    const output = {
      ts: new Date().toISOString(),
      ready,
      role_blocked: roleBlocked,
      integration_cycle: integrationCycle,
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
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
