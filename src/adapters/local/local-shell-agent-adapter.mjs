import { spawnSync } from "node:child_process";
import path from "node:path";
import { assertAgentAdapter } from "../../core/ports/agent-adapter-port.mjs";
import {
  buildAgentProfile,
  canAgentRolePerform,
  normalizeAgentRole,
} from "../../core/agents/agent-role-model.mjs";

function buildLocalShellAgentAdapter({
  id,
  label,
  defaultRole,
  roles,
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
  }, "LocalShellAgentAdapter");
}

export function createLocalShellAuditorAgentAdapter() {
  return buildLocalShellAgentAdapter({
    id: "local-shell-auditor",
    label: "Local Shell Auditor Adapter",
    defaultRole: "auditor",
    roles: ["auditor"],
  });
}

export function createLocalShellRepairAgentAdapter() {
  return buildLocalShellAgentAdapter({
    id: "local-shell-repair",
    label: "Local Shell Repair Adapter",
    defaultRole: "repair",
    roles: ["repair"],
  });
}

export function listBuiltInLocalShellAgentAdapters() {
  return [
    createLocalShellAuditorAgentAdapter(),
    createLocalShellRepairAgentAdapter(),
  ];
}
