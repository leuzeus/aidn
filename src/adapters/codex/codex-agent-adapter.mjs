import { spawnSync } from "node:child_process";
import { assertAgentAdapter } from "../../core/ports/agent-adapter-port.mjs";
import {
  buildAgentProfile,
  canAgentRolePerform,
  normalizeAgentRole,
} from "../../core/agents/agent-role-model.mjs";

function buildCodexAgentAdapter({
  id = "codex",
  label = "Codex Agent Adapter",
  defaultRole = "coordinator",
  roles = ["coordinator", "executor", "auditor", "repair"],
} = {}) {
  const profile = buildAgentProfile({
    id,
    label,
    defaultRole,
    roles,
  });
  return assertAgentAdapter({
    getProfile() {
      return profile;
    },
    canHandleRole({ role, action } = {}) {
      const normalizedRole = normalizeAgentRole(role || profile.default_role);
      if (!profile.supported_roles.includes(normalizedRole)) {
        return false;
      }
      if (!action) {
        return true;
      }
      return canAgentRolePerform(normalizedRole, action);
    },
    runCommand({ command, commandArgs = [], commandLine = "", envOverrides = {} }) {
      const env = {
        ...process.env,
        ...envOverrides,
      };
      if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
        return spawnSync("cmd.exe", ["/d", "/s", "/c", commandLine], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          cwd: process.cwd(),
          env,
          shell: false,
        });
      }
      return spawnSync(command, commandArgs, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        cwd: process.cwd(),
        env,
        shell: false,
      });
    },
  }, "CodexAgentAdapter");
}

export function createCodexAgentAdapter(options = {}) {
  return buildCodexAgentAdapter(options);
}

export function createCodexAuditorAgentAdapter() {
  return buildCodexAgentAdapter({
    id: "codex-auditor",
    label: "Codex Auditor Adapter",
    defaultRole: "auditor",
    roles: ["auditor"],
  });
}

export function createCodexRepairAgentAdapter() {
  return buildCodexAgentAdapter({
    id: "codex-repair",
    label: "Codex Repair Adapter",
    defaultRole: "repair",
    roles: ["repair"],
  });
}

export function listBuiltInCodexAgentAdapters() {
  return [
    createCodexAgentAdapter(),
    createCodexAuditorAgentAdapter(),
    createCodexRepairAgentAdapter(),
  ];
}
