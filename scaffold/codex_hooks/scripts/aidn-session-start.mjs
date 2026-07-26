#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

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

async function main() {
  const raw = await readStdin();
  if (raw.trim()) {
    JSON.parse(raw);
  }
  const cwd = process.cwd();
  const required = [
    "AGENTS.md",
    path.join(".agents", "skills"),
    path.join(".codex", "agents"),
  ];
  const missing = required.filter((entry) => !fs.existsSync(path.resolve(cwd, entry)));
  const context = missing.length === 0
    ? "AIDN client assets are installed. Read AGENTS.md and use its routing before acting."
    : `AIDN client discovery is incomplete; missing: ${missing.join(", ")}.`;
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`AIDN SessionStart hook failed: ${error.message}\n`);
  process.exitCode = 1;
});
