import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAX_INPUT_BYTES = 1024 * 1024;
export async function readHookPayload(stream = process.stdin) {
  stream.setEncoding?.("utf8");
  let input = "";
  for await (const chunk of stream) {
    input += chunk.toString("utf8");
    if (Buffer.byteLength(input) > MAX_INPUT_BYTES) throw new Error("hook_input_too_large");
  }
  const payload = input.trim() ? JSON.parse(input) : {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid_hook_input");
  return payload;
}

export function resolveHookProject(scriptUrl, invocationCwd) {
  const projectRoot = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(scriptUrl)), "../.."));
  const cwd = fs.realpathSync(path.resolve(invocationCwd || process.cwd()));
  const relative = path.relative(projectRoot, cwd);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("hook_worktree_mismatch");
  }
  // A nested repository is a distinct target even when it lives below this root.
  for (let current = cwd; current !== projectRoot; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, ".git"))) throw new Error("hook_worktree_mismatch");
  }
  return { projectRoot, invocationCwd: cwd };
}

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function resolveBoundRuntime(projectRoot) {
  const receiptPath = path.join(projectRoot, ".aidn", "install", "receipt.json");
  if (!fs.existsSync(receiptPath)) throw new Error("runtime_receipt_missing");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  const binding = receipt.package;
  if (receipt.schema_version !== 1 || !binding || !path.isAbsolute(binding.root ?? "")
      || binding.entry !== "bin/aidn.mjs" || typeof binding.version !== "string") {
    throw new Error("runtime_receipt_invalid");
  }
  const packageRoot = fs.realpathSync(binding.root);
  const entry = path.join(packageRoot, "bin", "aidn.mjs");
  const versionFile = path.join(packageRoot, "VERSION");
  if (!fs.existsSync(entry) || !fs.existsSync(versionFile)) throw new Error("runtime_binding_missing");
  if (fs.readFileSync(versionFile, "utf8").trim() !== binding.version
      || sha256(entry) !== binding.entry_sha256 || sha256(versionFile) !== binding.version_sha256) {
    throw new Error("runtime_binding_changed");
  }
  return { entry, version: binding.version };
}

export function readAdmission(projectRoot, { skill = "", commandRunner = spawnSync } = {}) {
  const binding = resolveBoundRuntime(projectRoot);
  const args = [binding.entry, "runtime", "pre-write-admit", "--target", projectRoot, "--json"];
  if (skill) args.push("--skill", skill);
  const result = commandRunner(process.execPath, args, {
    cwd: projectRoot, encoding: "utf8", shell: false, timeout: 7000, maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) throw new Error("admission_runtime_unavailable");
  let admission;
  try { admission = JSON.parse(String(result.stdout).trim()); }
  catch { throw new Error("admission_invalid_output"); }
  if (!admission || typeof admission.ok !== "boolean"
      || !["admitted", "admitted_with_warnings", "blocked"].includes(admission.admission_status)
      || typeof admission.target_root !== "string"
      || path.resolve(admission.target_root) !== path.resolve(projectRoot)
      || (admission.ok !== (admission.admission_status !== "blocked"))) {
    throw new Error("admission_invalid_output");
  }
  return admission;
}

export function compactAdmission(admission) {
  const context = admission.context ?? {};
  const selected = Object.fromEntries([
    "mode", "branch_kind", "active_session", "active_cycle", "dor_state", "first_plan_step",
    "runtime_state_mode", "repair_layer_status", "current_state_freshness",
  ].filter((key) => context[key] != null).map((key) => [key, String(context[key]).slice(0,180)]));
  return JSON.stringify({
    admission: admission.admission_status,
    context: selected,
    blocking_reasons: (admission.blocking_reasons ?? []).slice(0,4).map((value) => String(value).slice(0,220)),
    next_action: admission.ok ? "Follow AGENTS.md routing; revalidate before the next covered edit."
      : "Remain read-only; resolve the admission blockers using canonical state.",
  }).slice(0,2400);
}

export function deny(reason) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: `AIDN: ${reason}`.slice(0,1200) } };
}
