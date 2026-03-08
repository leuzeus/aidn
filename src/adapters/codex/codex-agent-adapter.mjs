import { spawnSync } from "node:child_process";
import { assertAgentAdapter } from "../../core/ports/agent-adapter-port.mjs";

export function createCodexAgentAdapter() {
  return assertAgentAdapter({
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
