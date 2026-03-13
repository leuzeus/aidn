import { spawnSync } from "node:child_process";

export function createExampleExternalAuditorAdapter({ id = "external-example-auditor" } = {}) {
  const profile = {
    id,
    label: "Example External Auditor Adapter",
    default_role: "auditor",
    supported_roles: ["auditor"],
    capabilities_by_role: {
      auditor: ["audit", "analyze", "relay"],
    },
  };

  return {
    getProfile() {
      return profile;
    },
    canHandleRole({ role, action } = {}) {
      return profile.supported_roles.includes(role) && (!action || profile.capabilities_by_role.auditor.includes(action));
    },
    checkEnvironment({ probeCommand = process.execPath, probeArgs = ["--version"] } = {}) {
      const result = spawnSync(probeCommand, probeArgs, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        cwd: process.cwd(),
        env: { ...process.env, AIDN_AGENT_ENV_PROBE: "1" },
        shell: false,
      });
      const exitCode = Number.isInteger(result?.status) ? result.status : 1;
      if (exitCode === 0) {
        return {
          status: "ready",
          reason: "example external adapter can execute the default environment probe",
        };
      }
      return {
        status: "unavailable",
        reason: String(result?.stderr ?? result?.stdout ?? "").trim() || `environment probe failed with exit code ${exitCode}`,
      };
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
  };
}

export default createExampleExternalAuditorAdapter;
