#!/usr/bin/env node
import { readHookPayload, resolveHookProject, readAdmission, isNeutralAdmission, compactAdmission, deny,
  isDelegatedHookContext, readDelegatedAdmission } from "./aidn-hook-runtime.mjs";

async function main() {
  let payload;
  try { payload = await readHookPayload(); }
  catch { payload = {tool_name:"apply_patch", tool_input:null}; }
  const { projectRoot, invocationCwd } = resolveHookProject(import.meta.url, payload.cwd);
  if (isDelegatedHookContext(projectRoot)) {
    const decision = await readDelegatedAdmission(projectRoot, {
      cwd: invocationCwd, tool_name: payload.tool_name, tool_input: payload.tool_input,
    });
    if (!decision.ok) return deny("delegated operation refused; only the exact active attempt scope is permitted.");
    return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "AIDN delegated admission verified for this operation only." } };
  }
  // Historical admission continues to cover only the verified patch path.
  if (typeof payload.tool_name === "string" && !["apply_patch", "Edit", "Write"].includes(payload.tool_name)) return {};
  const admission = readAdmission(projectRoot, { nativeRequest: {
    cwd: invocationCwd, tool_name: payload.tool_name, tool_input: payload.tool_input,
  } });
  if (isNeutralAdmission(admission)) return {};
  if (admission.activation.active !== true) return deny("activation degraded; diagnose the local installation before editing.");
  if (!admission.ok) return deny(`admission blocked. ${compactAdmission(admission, { maxBytes: 1000 })}`);
  return { hookSpecificOutput: { hookEventName: "PreToolUse",
    additionalContext: `AIDN specific scope admission rechecked for this patch only: ${compactAdmission(admission)}` } };
}
main().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
  const known = /^(runtime_|admission_|hook_|invalid_)/.test(error.message) ? error.message : "admission_runtime_unavailable";
  process.stderr.write(`AIDN hook: ${known}${error.diagnostic ? ` ${JSON.stringify(error.diagnostic)}` : ""}\n`);
  process.stdout.write(`${JSON.stringify(deny(`${known}; diagnose the installation or canonical state before editing.`))}\n`);
});
