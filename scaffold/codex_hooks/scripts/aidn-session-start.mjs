#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readHookPayload, resolveHookProject, readAdmission, compactAdmission } from "./aidn-hook-runtime.mjs";

async function main() {
  const payload = await readHookPayload();
  const location = resolveHookProject(import.meta.url, payload.cwd);
  const required = ["AGENTS.md", path.join(".agents", "skills"), path.join(".codex", "agents")];
  const missing = required.filter((entry) => !fs.existsSync(path.join(location.projectRoot, entry)));
  let context;
  let admissionStatus = "unavailable";
  let diagnostic = null;
  try {
    const admission = readAdmission(location.projectRoot, { skill: "start-session" });
    admissionStatus = admission.admission_status;
    context = `AIDN canonical admission (read-only): ${compactAdmission(admission)} Read AGENTS.md and its routing. This summary grants no write permission.`;
  } catch (error) {
    diagnostic = error.message;
    context = `AIDN resume is degraded (${diagnostic}). Read AGENTS.md; inspect or repair the local installation before relying on native admission. No write permission is granted.`;
  }
  if (missing.length) context += ` Missing installed assets: ${missing.join(", ")}.`;
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
    aidnDiagnostics: { schemaVersion: 1, ...location, checked: required, missing,
      admissionStatus, diagnostic, effect: "read-only", source: payload.source ?? "unknown" },
  })}\n`);
}
main().catch(() => {
  process.stdout.write(`${JSON.stringify({hookSpecificOutput:{hookEventName:"SessionStart",
    additionalContext:"AIDN resume is degraded: invalid hook input or project binding. Remain read-only and diagnose the installation."}})}\n`);
});
