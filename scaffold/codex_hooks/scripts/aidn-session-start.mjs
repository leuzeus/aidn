#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function resolveProjectRoot(invocationCwd) {
  const gitResult = spawnSync(
    "git",
    ["-C", invocationCwd, "rev-parse", "--show-toplevel"],
    {
      encoding: "utf8",
      shell: false,
      timeout: 5000,
    },
  );
  if (gitResult.status !== 0) {
    const detail = String(gitResult.stderr ?? gitResult.stdout ?? "").trim();
    throw new Error(`cannot resolve the Git project root from ${invocationCwd}: ${detail}`);
  }
  return path.resolve(String(gitResult.stdout).trim());
}

async function main() {
  const raw = await readStdin();
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const invocationCwd = path.resolve(payload.cwd || process.cwd());
  const projectRoot = resolveProjectRoot(invocationCwd);
  const required = [
    "AGENTS.md",
    path.join(".agents", "skills"),
    path.join(".codex", "agents"),
  ];
  const missing = required.filter((entry) => !fs.existsSync(path.resolve(projectRoot, entry)));
  const context = missing.length === 0
    ? "AIDN client assets are installed. Read AGENTS.md and use its routing before acting."
    : `AIDN client discovery is incomplete; missing: ${missing.join(", ")}.`;
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
    aidnDiagnostics: {
      schemaVersion: 1,
      projectRoot,
      invocationCwd,
      checked: required,
      missing,
    },
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`AIDN SessionStart hook failed: ${error.message}\n`);
  process.exitCode = 1;
});
