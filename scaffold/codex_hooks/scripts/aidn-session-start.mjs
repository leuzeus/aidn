#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readHookPayload, resolveHookProject, readAdmission, isNeutralAdmission, compactAdmission } from "./aidn-hook-runtime.mjs";

async function main() {
  const payload = await readHookPayload();
  const location = resolveHookProject(import.meta.url, payload.cwd);
  const required = ["AGENTS.md", path.join(".agents", "skills"), path.join(".codex", "agents")];
  const missing = required.filter((entry) => !fs.existsSync(path.join(location.projectRoot, entry)));
  let context;
  try {
    const admission = readAdmission(location.projectRoot, { skill: "start-session" });
    if (isNeutralAdmission(admission)) { process.stdout.write("{}\n"); return; }
    if (admission.activation.active !== true) throw new Error("admission_activation_degraded");
    context = `AIDN canonical admission (read-only): ${compactAdmission(admission)} Read AGENTS.md and its routing. This summary grants no write permission.`;
  } catch (error) {
    context = `AIDN resume is degraded (${error.message}). Read AGENTS.md; inspect or repair the local installation before relying on native admission. No write permission is granted.`;
  }
  if (missing.length) context += ` Missing installed assets: ${missing.join(", ")}.`;
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
  })}\n`);
}
main().catch(() => {
  process.stdout.write(`${JSON.stringify({hookSpecificOutput:{hookEventName:"SessionStart",
    additionalContext:"AIDN resume is degraded: invalid hook input or project binding. Remain read-only and diagnose the installation."}})}\n`);
});
