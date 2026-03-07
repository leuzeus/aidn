import { execFileSync } from "node:child_process";

export function createLocalProcessAdapter() {
  return {
    runJsonNodeScript(scriptPath, scriptArgs = []) {
      const out = execFileSync(process.execPath, [
        scriptPath,
        ...scriptArgs,
      ], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return JSON.parse(out);
    },
  };
}
