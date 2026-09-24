#!/usr/bin/env node
import { readHookPayload, resolveHookProject, readAdmission, isNeutralAdmission, compactAdmission, deny } from "./aidn-hook-runtime.mjs";

async function main() {
  const payload = await readHookPayload();
  // Only the verified native patch path is covered. Shells and MCP calls are not classified here.
  if (!["apply_patch", "Edit", "Write"].includes(payload.tool_name)) return {};
  const { projectRoot } = resolveHookProject(import.meta.url, payload.cwd);
  const admission = readAdmission(projectRoot);
  if (isNeutralAdmission(admission)) return {};
  if (admission.activation.active !== true) return deny("activation degraded; diagnose the local installation before editing.");
  if (typeof payload.tool_input?.command !== "string") return deny("invalid_patch_input");
  if (!admission.ok) return deny(`admission blocked. ${compactAdmission(admission)}`);
  return { hookSpecificOutput: { hookEventName: "PreToolUse",
    additionalContext: `AIDN generic admission rechecked for this patch only: ${compactAdmission(admission)}` } };
}
main().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
  const known = /^(runtime_|admission_|hook_|invalid_)/.test(error.message) ? error.message : "admission_runtime_unavailable";
  process.stdout.write(`${JSON.stringify(deny(`${known}; diagnose the installation or canonical state before editing.`))}\n`);
});
