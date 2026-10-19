// Only wired by the isolated manual qualifier. Not a distributed AIDN hook.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { resumeAgentWorkingMemory } from "../../src/application/runtime/agent-working-memory-service.mjs";

let input = "";
let event, binding;
try {
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 65536) throw new Error("PROBE_INPUT_TOO_LARGE");
  }
  event = JSON.parse(input);
  binding = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  fs.appendFileSync(binding.hook_observation_file + ".entries", JSON.stringify({ event: event.hook_event_name ?? null,
    source: event.source ?? null, trigger: event.trigger ?? null, cwd_matches: typeof event.cwd === "string" && path.resolve(event.cwd).toLowerCase() === path.resolve(binding.native_cwd).toLowerCase() }) + "\n");
  if (path.resolve(event.cwd).toLowerCase() !== path.resolve(binding.native_cwd).toLowerCase()
      || !["SessionStart", "PreCompact", "PostCompact"].includes(event.hook_event_name)) throw new Error("PROBE_SCOPE_REFUSED");
  let result;
  if (event.hook_event_name === "PreCompact") {
    const admission = await preWriteAdmit({ targetRoot: binding.target_root, skill: "context-reload" });
    if (admission.ok !== true) throw new Error("PROBE_ADMISSION_REFUSED");
    const out = spawnSync(process.execPath, [path.join(import.meta.dirname, "../perf/checkpoint.mjs"), "--target", binding.target_root,
      "--working-memory", ".aidn/runtime/context/qualification-memory.json", "--write", "--mode", "THINKING", "--json"],
      { encoding: "utf8", windowsHide: true, timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
    if (out.status !== 0) throw new Error("PROBE_CHECKPOINT_REFUSED");
    result = JSON.parse(out.stdout).working_memory;
    if (result.status !== "captured") throw new Error("PROBE_CHECKPOINT_REFUSED");
  } else {
    result = await resumeAgentWorkingMemory({ targetRoot: binding.target_root, agentId: binding.agent_id });
    if (result.status !== "current") throw new Error("PROBE_RESUME_REFUSED");
  }
  fs.appendFileSync(binding.hook_observation_file, JSON.stringify({ event: event.hook_event_name, source: event.source ?? null,
    trigger: event.trigger ?? null, session_id: event.session_id, observed_at: new Date().toISOString(), status: result.status }) + "\n");
  console.log(JSON.stringify({ continue: true, ...(event.hook_event_name === "SessionStart" ? { hookSpecificOutput: {
    hookEventName: "SessionStart", additionalContext: JSON.stringify({ untrusted_derived_memory: result, write_authorization: false, requires_fresh_admission: true }) } } : {}) }));
} catch (error) {
  try { if (binding) fs.appendFileSync(binding.hook_observation_file, JSON.stringify({ event: event?.hook_event_name ?? null,
    source: event?.source ?? null, trigger: event?.trigger ?? null, session_id: event?.session_id ?? null,
    observed_at: new Date().toISOString(), status: "refused",
    reason: ["PROBE_SCOPE_REFUSED", "PROBE_ADMISSION_REFUSED", "PROBE_CHECKPOINT_REFUSED", "PROBE_RESUME_REFUSED"].includes(error.message) ? error.message : "PROBE_PREREQUISITE_FAILED" }) + "\n"); } catch { /* Diagnostic failure cannot suppress the stop response. */ }
  // No compaction if its checkpoint cannot be proven. No synthetic success.
  console.log(JSON.stringify({ continue: false, stopReason: "AIDN native qualification prerequisite refused" }));
  process.exitCode = 0;
}
