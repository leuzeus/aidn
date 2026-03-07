import { execFileSync } from "node:child_process";

export function createLocalProcessAdapter() {
  return {
    runNodeScript(scriptPath, scriptArgs = []) {
      return execFileSync(process.execPath, [
        scriptPath,
        ...scriptArgs,
      ], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    },
    runJsonNodeScript(scriptPath, scriptArgs = []) {
      const out = this.runNodeScript(scriptPath, scriptArgs);
      return JSON.parse(out);
    },
  };
}
