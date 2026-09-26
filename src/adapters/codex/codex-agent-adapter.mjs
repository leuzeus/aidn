import { spawnSync } from "node:child_process";
import path from "node:path";
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
    runCommand({ command, commandArgs = [], commandLine = "", envOverrides = {}, cwd = process.cwd() }) {
      const workingDirectory = path.resolve(cwd);
      const env = {
        ...process.env,
        ...envOverrides,
      };
      if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
        // /s strips the outer pair; preserve quoted executable and argument tokens.
        return spawnSync("cmd.exe", ["/d", "/s", "/c", `"${commandLine}"`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          cwd: workingDirectory,
          env,
          shell: false,
          windowsVerbatimArguments: true,
        });
      }
      return spawnSync(command, commandArgs, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        cwd: workingDirectory,
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
