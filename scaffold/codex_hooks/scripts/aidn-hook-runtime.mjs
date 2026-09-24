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

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : object(value) ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value);
const identityPath = (value) => process.platform === "win32" ? value.toLowerCase() : value;
function safePath(input, directory = false) {
  const absolute = path.resolve(input), root = path.parse(absolute).root;
  const parts = absolute.slice(root.length).split(path.sep).filter(Boolean);
  let cursor = root;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    let stat;
    try { stat = fs.lstatSync(cursor); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (stat.isSymbolicLink() || (index < parts.length - 1 || directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink > 1)) throw new Error("runtime_unsafe_path");
  }
  return absolute;
}
function sealedRecord(file, maxBytes = 8 * 1024 * 1024) {
  safePath(file);
  if (!fs.existsSync(file)) return null;
  if (fs.statSync(file).size > maxBytes) throw new Error("runtime_record_too_large");
  let record;
  try { record = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("runtime_record_invalid"); }
  if (!object(record)) throw new Error("runtime_record_invalid");
  const { integrity_sha256, ...value } = record;
  if (integrity_sha256 !== hash(stable(value))) throw new Error("runtime_record_integrity_invalid");
  return value;
}

// This probe can only disable a hook. Positive activation remains the core
// pre-write-admit decision, after the installed runtime binding is verified.
export function createActivationGitEnvironment(env = process.env) {
  const result = Object.fromEntries(Object.entries(env).filter(([key]) => !/^GIT_/i.test(key)));
  const count = Number(env.GIT_CONFIG_COUNT ?? 0);
  if (!Number.isSafeInteger(count) || count < 0 || count > 1024) return result;
  let retained = 0;
  for (let index = 0; index < count; index += 1) {
    const value = env["GIT_CONFIG_VALUE_" + index];
    if (env["GIT_CONFIG_KEY_" + index] !== "safe.directory" || typeof value !== "string") continue;
    // Same bounded filter as the activation service: retain existing host
    // exceptions, without introducing trust or other Git configuration.
    result["GIT_CONFIG_KEY_" + retained] = "safe.directory";
    result["GIT_CONFIG_VALUE_" + retained] = value;
    retained += 1;
  }
  if (retained) result.GIT_CONFIG_COUNT = String(retained);
  return result;
}

function readLocalAuthority(projectRoot) {
  const root = fs.realpathSync.native(safePath(projectRoot, true));
  let markerRoot = root;
  while (!fs.existsSync(path.join(markerRoot, ".git"))) {
    const parent = path.dirname(markerRoot);
    if (parent === markerRoot) { markerRoot = null; break; }
    markerRoot = parent;
  }
  let common = null;
  if (markerRoot) {
    if (identityPath(markerRoot) !== identityPath(root)) throw new Error("runtime_project_root_mismatch");
    const marker = path.join(root, ".git"); safePath(marker, fs.lstatSync(marker).isDirectory());
    const env = createActivationGitEnvironment();
    const result = spawnSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"], {
      env, encoding: "utf8", timeout: 7000, maxBuffer: MAX_INPUT_BYTES, windowsHide: true,
    });
    if (result.error || result.signal || result.status !== 0) throw new Error("runtime_git_resolution_failed");
    const lines = result.stdout.trim().split(/\r?\n/);
    if (lines.length !== 3 || lines.some((line) => !path.isAbsolute(line))) throw new Error("runtime_git_resolution_failed");
    const [top, gitDir, commonDir] = lines.map((line) => fs.realpathSync.native(safePath(line, true)));
    if (identityPath(top) !== identityPath(root)) throw new Error("runtime_project_root_mismatch");
    if (identityPath(gitDir) !== identityPath(commonDir)) {
      const backlink = safePath(path.join(gitDir, "gitdir"));
      if (!fs.existsSync(backlink) || fs.statSync(backlink).size > 65536
          || identityPath(path.resolve(fs.readFileSync(backlink, "utf8").trim())) !== identityPath(marker)) throw new Error("runtime_worktree_backlink_mismatch");
    }
    common = commonDir;
  }
  const scope = common ? "repository" : "local", authorityId = hash(identityPath(common ?? root));
  const authority = sealedRecord(path.join(common ?? root, common ? "aidn/authorization.json" : ".aidn/install/authorization.json"), 65536);
  if (authority && (authority.schema_version !== 1 || authority.scope !== scope || authority.authority_id !== authorityId
      || !Number.isSafeInteger(authority.revision) || authority.revision < 1 || !["authorized", "revoked"].includes(authority.status))) throw new Error("runtime_authority_invalid");
  return { authority, scope, authorityId };
}

function safeRelative(root, relative) {
  if (typeof relative !== "string" || relative.includes("\\") || relative.startsWith("/")
      || relative.split("/").some((part) => !part || part === "." || part === ".." || part.includes(":"))) throw new Error("runtime_receipt_path_invalid");
  return safePath(path.join(root, ...relative.split("/")));
}

export function resolveBoundRuntime(projectRoot) {
  const receiptPath = path.join(projectRoot, ".aidn", "install", "receipt.json");
  if (!fs.existsSync(receiptPath)) throw new Error("runtime_receipt_missing");
  const receipt = sealedRecord(receiptPath);
  const binding = receipt.package;
  const physicalRoot = fs.realpathSync.native(safePath(projectRoot, true));
  if (receipt.schema_version !== 1 || receipt.scope !== "codex-integration" || receipt.root_id !== hash(identityPath(physicalRoot))
      || !object(receipt.assets) || !object(binding) || !path.isAbsolute(binding.root ?? "")
      || binding.entry !== "bin/aidn.mjs" || typeof binding.version !== "string"
      || !/^[a-f0-9]{32}$/.test(receipt.last_transaction ?? "")) {
    throw new Error("runtime_receipt_invalid");
  }
  for (const [relative, asset] of Object.entries(receipt.assets)) {
    safeRelative(physicalRoot, relative);
    if (!object(asset) || !["file", "hooks", "agents-block"].includes(asset.kind)
        || (asset.kind === "hooks" ? !Array.isArray(asset.current) : typeof asset.current !== "string")) throw new Error("runtime_receipt_invalid");
  }
  if (receipt.installation !== undefined) {
    if (!object(receipt.installation) || !object(receipt.installation.assets)) throw new Error("runtime_receipt_invalid");
    for (const relative of Object.keys(receipt.installation.assets)) safeRelative(physicalRoot, relative);
  }
  const tx = sealedRecord(path.join(physicalRoot, `.aidn/install/transactions/${receipt.last_transaction}.json`));
  if (!tx || tx.schema_version !== 1 || tx.id !== receipt.last_transaction || tx.root_id !== receipt.root_id
      || !["codex-integration", "installation"].includes(tx.scope) || tx.status !== "complete"
      || (tx.scope === "installation" && tx.external_status !== "complete"
        && !(tx.external_status === "skipped" && ["rollback", "uninstall"].includes(tx.action)))) throw new Error("runtime_installation_incomplete");
  const packageRoot = fs.realpathSync.native(safePath(binding.root, true));
  const entry = safePath(path.join(packageRoot, "bin", "aidn.mjs"));
  const versionFile = safePath(path.join(packageRoot, "VERSION"));
  if (!fs.existsSync(entry) || !fs.existsSync(versionFile)) throw new Error("runtime_binding_missing");
  if (fs.readFileSync(versionFile, "utf8").trim() !== binding.version
      || sha256(entry) !== binding.entry_sha256 || sha256(versionFile) !== binding.version_sha256) {
    throw new Error("runtime_binding_changed");
  }
  return { entry, version: binding.version };
}

export function readAdmission(projectRoot, { skill = "", nativeRequest, commandRunner = spawnSync } = {}) {
  const deadline = Date.now() + 7000;
  const { authority, scope, authorityId } = readLocalAuthority(projectRoot);
  const inactive = (state) => ({ ok: false, admission_status: "blocked", target_root: projectRoot,
    activation: { state, active: false, scope, authority_id: authorityId, revision: authority?.revision ?? null, errors: [] } });
  if (authority?.status === "revoked") return inactive("revoked");
  const pending = safePath(path.join(projectRoot, ".aidn/install/pending.json"));
  if (fs.existsSync(pending)) throw new Error("runtime_installation_pending");
  const receipt = safePath(path.join(projectRoot, ".aidn/install/receipt.json"));
  if (!fs.existsSync(receipt)) return inactive(authority ? "unprepared" : "absent");
  const binding = resolveBoundRuntime(projectRoot);
  const args = [binding.entry, "runtime", "pre-write-admit", "--target", projectRoot, "--json"];
  if (skill) args.push("--skill", skill);
  if (nativeRequest !== undefined) args.push("--native-request-stdin");
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error("admission_runtime_unavailable");
  const result = commandRunner(process.execPath, args, {
    cwd: projectRoot, encoding: "utf8", shell: false, timeout: remainingMs, maxBuffer: 1024 * 1024,
    windowsHide: true,
    input: nativeRequest === undefined ? undefined : JSON.stringify(nativeRequest),
  });
  if (result.error || result.signal || result.status !== 0) throw Object.assign(new Error("admission_runtime_unavailable"), {
    diagnostic: { exit_code: result.status ?? null, signal: result.signal ?? null, error_code: result.error?.code ?? null },
  });
  let admission;
  try { admission = JSON.parse(String(result.stdout).trim()); }
  catch { throw new Error("admission_invalid_output"); }
  if (!admission || typeof admission.ok !== "boolean"
      || !["admitted", "admitted_with_warnings", "blocked"].includes(admission.admission_status)
      || typeof admission.target_root !== "string"
      || path.resolve(admission.target_root) !== path.resolve(projectRoot)
      || (admission.ok !== (admission.admission_status !== "blocked"))
      || !object(admission.activation) || typeof admission.activation.active !== "boolean"
      || !["absent", "unprepared", "revoked", "degraded", "active", "legacy-active"].includes(admission.activation.state)
      || admission.activation.active !== ["active", "legacy-active"].includes(admission.activation.state)
      || (!admission.activation.active && admission.ok)) {
    throw new Error("admission_invalid_output");
  }
  if (nativeRequest !== undefined && admission.activation.active && (
    admission.admission_kind !== "specific" || !object(admission.write_decision)
    || admission.write_decision.contract_version !== "native-write-admission.v1"
    || admission.write_decision.outcome !== (admission.ok ? "allow" : "deny")
    || admission.write_decision.observation?.payload_sha256 !== hash(JSON.stringify(nativeRequest))
    || admission.write_decision.observation?.project_root !== fs.realpathSync.native(projectRoot)
  )) throw new Error("admission_specific_output_invalid");
  return admission;
}

export function isNeutralAdmission(admission) {
  return admission.activation?.active === false && ["absent", "unprepared", "revoked"].includes(admission.activation.state);
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
