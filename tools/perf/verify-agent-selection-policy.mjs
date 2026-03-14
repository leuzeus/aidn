#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listBuiltInAgentAdapters,
  loadRegisteredAgentAdapters,
} from "../../src/application/runtime/agent-adapter-registry-service.mjs";
import { loadAgentRoster } from "../../src/application/runtime/agent-roster-service.mjs";
import { selectAgentAdapter } from "../../src/core/agents/agent-selection-policy.mjs";
import { buildAgentHealthMap, verifyAgentRoster } from "../../tools/runtime/verify-agent-roster.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  let tempRoot = "";
  try {
    const adapters = listBuiltInAgentAdapters();

    const implementAuto = selectAgentAdapter({
      requestedAgent: "auto",
      role: "executor",
      action: "implement",
      adapters,
    });
    const auditAuto = selectAgentAdapter({
      requestedAgent: "auto",
      role: "auditor",
      action: "audit",
      adapters,
    });
    const repairAuto = selectAgentAdapter({
      requestedAgent: "auto",
      role: "repair",
      action: "repair",
      adapters,
    });
    const explicitCodex = selectAgentAdapter({
      requestedAgent: "codex",
      role: "auditor",
      action: "audit",
      adapters,
    });
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-agent-roster-"));
    const auditRoot = path.join(tempRoot, "docs", "audit");
    fs.mkdirSync(auditRoot, { recursive: true });
    fs.writeFileSync(path.join(auditRoot, "AGENT-ROSTER.md"), [
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
      "enabled: no",
      "priority: 100",
      "roles: auditor",
      "",
      "## codex-repair",
      "enabled: yes",
      "priority: 100",
      "roles: repair",
      "",
      "## local-shell-auditor",
      "enabled: no",
      "priority: 120",
      "roles: auditor",
      "",
      "## local-shell-repair",
      "enabled: yes",
      "priority: 80",
      "roles: repair",
      "",
    ].join("\n"), "utf8");
    const roster = loadAgentRoster({
      targetRoot: tempRoot,
    });
    const rosteredAudit = selectAgentAdapter({
      requestedAgent: "auto",
      role: "auditor",
      action: "audit",
      adapters,
      roster,
    });
    const rosteredRepair = selectAgentAdapter({
      requestedAgent: "auto",
      role: "repair",
      action: "repair",
      adapters,
      roster,
    });
    const forcedCodexAudit = selectAgentAdapter({
      requestedAgent: "auto",
      role: "auditor",
      action: "audit",
      adapters,
      roster: {
        ...roster,
        default_requested_agent: "codex",
      },
    });
    const localShellRoster = {
      ...roster,
      agents: {
        ...roster.agents,
        "local-shell-auditor": {
          enabled: true,
          priority: 150,
          roles: ["auditor"],
          notes: "prefer local shell for audit",
        },
        "local-shell-repair": {
          enabled: true,
          priority: 150,
          roles: ["repair"],
          notes: "prefer local shell for repair",
        },
      },
    };
    const localShellAudit = selectAgentAdapter({
      requestedAgent: "auto",
      role: "auditor",
      action: "audit",
      adapters,
      roster: localShellRoster,
    });
    const localShellRepair = selectAgentAdapter({
      requestedAgent: "auto",
      role: "repair",
      action: "repair",
      adapters,
      roster: localShellRoster,
    });
    const externalAgentDir = path.join(tempRoot, ".aidn", "runtime", "agents");
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
    fs.writeFileSync(path.join(auditRoot, "AGENT-ROSTER.md"), [
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
    const externalRoster = loadAgentRoster({
      targetRoot: tempRoot,
    });
    const adaptersWithExternal = await loadRegisteredAgentAdapters({
      targetRoot: tempRoot,
      roster: externalRoster,
      ignoreLoadFailures: true,
    });
    const externalHealth = buildAgentHealthMap(await verifyAgentRoster({
      targetRoot: tempRoot,
    }));
    const externalAudit = selectAgentAdapter({
      requestedAgent: "auto",
      role: "auditor",
      action: "audit",
      adapters: adaptersWithExternal,
      roster: externalRoster,
      adapterHealth: externalHealth,
    });

    fs.writeFileSync(path.join(auditRoot, "AGENT-ROSTER.md"), [
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
    const brokenRoster = loadAgentRoster({
      targetRoot: tempRoot,
    });
    const adaptersWithBroken = await loadRegisteredAgentAdapters({
      targetRoot: tempRoot,
      roster: brokenRoster,
      ignoreLoadFailures: true,
    });
    const brokenHealth = buildAgentHealthMap(await verifyAgentRoster({
      targetRoot: tempRoot,
    }));
    const brokenAutoAudit = selectAgentAdapter({
      requestedAgent: "auto",
      role: "auditor",
      action: "audit",
      adapters: adaptersWithBroken,
      roster: brokenRoster,
      adapterHealth: brokenHealth,
    });
    const brokenExplicitAudit = selectAgentAdapter({
      requestedAgent: "broken-auditor",
      role: "auditor",
      action: "audit",
      adapters: adaptersWithBroken,
      roster: brokenRoster,
      adapterHealth: brokenHealth,
    });
    fs.writeFileSync(path.join(externalAgentDir, "probe-failing-auditor.mjs"), [
      "import { spawnSync } from \"node:child_process\";",
      "",
      "export function createProbeFailingAuditorAdapter({ id }) {",
      "  return {",
      "    getProfile() {",
      "      return {",
      "        id,",
      "        label: \"Probe Failing Auditor Adapter\",",
      "        default_role: \"auditor\",",
      "        supported_roles: [\"auditor\"],",
      "        capabilities_by_role: { auditor: [\"audit\", \"analyze\", \"relay\"] },",
      "      };",
      "    },",
      "    canHandleRole({ role, action } = {}) {",
      "      return role === \"auditor\" && (!action || action === \"audit\" || action === \"analyze\" || action === \"relay\");",
      "    },",
      "    checkEnvironment() {",
      "      return { status: \"unavailable\", reason: \"external runner is not configured\" };",
      "    },",
      "    runCommand({ command, commandArgs = [], envOverrides = {} }) {",
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
    fs.writeFileSync(path.join(auditRoot, "AGENT-ROSTER.md"), [
      "# Agent Roster",
      "",
      "default_agent_selection: auto",
      "",
      "## codex",
      "enabled: yes",
      "priority: 5",
      "roles: coordinator, executor, auditor, repair",
      "",
      "## probe-failing-auditor",
      "enabled: yes",
      "priority: 300",
      "roles: auditor",
      "adapter_module: .aidn/runtime/agents/probe-failing-auditor.mjs",
      "adapter_export: createProbeFailingAuditorAdapter",
      "",
    ].join("\n"), "utf8");
    const probeFailingRoster = loadAgentRoster({
      targetRoot: tempRoot,
    });
    const adaptersWithProbeFailing = await loadRegisteredAgentAdapters({
      targetRoot: tempRoot,
      roster: probeFailingRoster,
      ignoreLoadFailures: true,
    });
    const probeFailingHealth = buildAgentHealthMap(await verifyAgentRoster({
      targetRoot: tempRoot,
    }));
    const probeFailingAutoAudit = selectAgentAdapter({
      requestedAgent: "auto",
      role: "auditor",
      action: "audit",
      adapters: adaptersWithProbeFailing,
      roster: probeFailingRoster,
      adapterHealth: probeFailingHealth,
    });

    assert(implementAuto.status === "selected", "auto should select an executor-capable adapter");
    assert(implementAuto.selected_profile.id === "codex", "executor relay should stay on the general codex adapter");
    assert(auditAuto.status === "selected", "auto should select an auditor-capable adapter");
    assert(auditAuto.selected_profile.id === "codex-auditor", "audit relay should prefer the specialized auditor adapter");
    assert(repairAuto.status === "selected", "auto should select a repair-capable adapter");
    assert(repairAuto.selected_profile.id === "codex-repair", "repair relay should prefer the specialized repair adapter");
    assert(explicitCodex.status === "selected", "explicit codex selection should remain supported");
    assert(explicitCodex.selected_profile.id === "codex", "explicit codex selection should bypass auto specialisation");
    assert(rosteredAudit.status === "selected", "roster-backed audit selection should remain selectable");
    assert(rosteredAudit.selected_profile.id === "codex", "disabled roster entry should force audit back to codex");
    assert(rosteredRepair.status === "selected", "roster-backed repair selection should remain selectable");
    assert(rosteredRepair.selected_profile.id === "codex-repair", "roster should still allow specialized repair selection");
    assert(forcedCodexAudit.status === "selected", "forced roster default should remain selectable");
    assert(forcedCodexAudit.selected_profile.id === "codex", "roster default should be able to force the general codex adapter");
    assert(localShellAudit.status === "selected", "local-shell audit selection should remain selectable");
    assert(localShellAudit.selected_profile.id === "local-shell-auditor", "roster should be able to prefer the local-shell auditor adapter");
    assert(localShellRepair.status === "selected", "local-shell repair selection should remain selectable");
    assert(localShellRepair.selected_profile.id === "local-shell-repair", "roster should be able to prefer the local-shell repair adapter");
    assert(externalAudit.status === "selected", "external adapter selection should remain selectable");
    assert(externalAudit.selected_profile.id === "external-auditor", "roster should be able to load and prefer an external auditor adapter");
    assert(brokenAutoAudit.status === "selected", "auto selection should fall back when a preferred adapter is unavailable");
    assert(brokenAutoAudit.selected_profile.id === "codex-auditor", "unavailable adapters should not win auto selection");
    assert(brokenExplicitAudit.status === "unsupported", "explicit selection should surface unavailable adapter health");
    assert(/unavailable/.test(brokenExplicitAudit.reason), "explicit unavailable adapter should explain the health failure");
    assert(probeFailingAutoAudit.status === "selected", "auto selection should fall back when an adapter fails environment probing");
    assert(probeFailingAutoAudit.selected_profile.id === "codex-auditor", "environment-incompatible adapters should not win auto selection");

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

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
