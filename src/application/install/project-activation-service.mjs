import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileAtomicSync } from "../../lib/fs/atomic-write-lib.mjs";
import { isAidnProductVersion } from "../../lib/config/aidn-config-lib.mjs";
import { isLocalInstallationTarget } from "./installation-ownership-service.mjs";
import { SKILL_IDENTITIES } from "../../core/skills/skill-policy.mjs";
import { resolveGlobalProjectBinding } from "./global-project-integration.mjs";

const RECEIPT = ".aidn/install/receipt.json";
const HASH = /^[a-f0-9]{64}$/;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : object(value) ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value);
const equal = (left, right) => stable(left) === stable(right);
const identityPath = (value) => process.platform === "win32" ? value.toLowerCase() : value;
const scopeId = (value) => hash(identityPath(value));
const seal = (value) => ({ ...value, integrity_sha256: hash(stable(value)) });
function fail(code, detail = "") { throw Object.assign(new Error(`${code}${detail ? `: ${detail}` : ""}`), { code }); }

// Reject redirects on the whole path, including ancestors outside the checkout.
function safeAbsolute(input, { directory = false, mustExist = false } = {}) {
  const absolute = path.resolve(input), parsed = path.parse(absolute);
  let cursor = parsed.root;
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) fail("ACTIVATION_UNSAFE_PATH");
      if (index < parts.length - 1 || directory) {
        if (!stat.isDirectory()) fail("ACTIVATION_UNSAFE_DIRECTORY");
      } else if (!stat.isFile() || stat.nlink > 1) fail("ACTIVATION_UNSAFE_FILE");
    } catch (error) { if (error.code !== "ENOENT" || mustExist) throw error; }
  }
  return absolute;
}
function physicalDirectory(input, allowMissing = false) {
  const absolute = safeAbsolute(input, { directory: true, mustExist: !allowMissing });
  let existing = absolute;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  return path.join(fs.realpathSync.native(existing), path.relative(existing, absolute));
}
function localPath(root, relative) {
  if (typeof relative !== "string" || relative.includes("\\") || relative.startsWith("/")
      || relative.split("/").some((part) => !part || part === "." || part === ".." || part.includes(":"))) fail("ACTIVATION_INVALID_ASSET_PATH");
  return safeAbsolute(path.join(root, ...relative.split("/")));
}
function readBytes(file, maxBytes = 8 * 1024 * 1024) {
  const absolute = safeAbsolute(file);
  if (!fs.existsSync(absolute)) return null;
  if (fs.statSync(absolute).size > maxBytes) fail("ACTIVATION_RECORD_TOO_LARGE");
  return fs.readFileSync(absolute);
}
function parse(bytes) {
  if (bytes === null) return null;
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail("ACTIVATION_INVALID_JSON"); }
}
function unseal(value) {
  if (!object(value)) fail("ACTIVATION_INVALID_RECORD");
  const { integrity_sha256, ...content } = value;
  if (!HASH.test(String(integrity_sha256)) || integrity_sha256 !== hash(stable(content))) fail("ACTIVATION_INVALID_RECORD_INTEGRITY");
  return content;
}

export function createActivationGitEnvironment(env = process.env) {
  const result = Object.fromEntries(Object.entries(env).filter(([key]) => !/^GIT_/i.test(key)));
  const count = Number(env.GIT_CONFIG_COUNT ?? 0);
  if (!Number.isSafeInteger(count) || count < 0 || count > 1024) return result;
  let retained = 0;
  for (let index = 0; index < count; index += 1) {
    const value = env["GIT_CONFIG_VALUE_" + index];
    if (env["GIT_CONFIG_KEY_" + index] !== "safe.directory" || typeof value !== "string") continue;
    // Preserve only exceptions already supplied by the host, in their original
    // order (including empty reset values); never grant an additional path.
    result["GIT_CONFIG_KEY_" + retained] = "safe.directory";
    result["GIT_CONFIG_VALUE_" + retained] = value;
    retained += 1;
  }
  if (retained) result.GIT_CONFIG_COUNT = String(retained);
  return result;
}

export function resolveActivationTarget({ targetRoot = process.cwd() } = {}) {
  const input = physicalDirectory(targetRoot, true);
  let markerRoot = input;
  while (!fs.existsSync(path.join(markerRoot, ".git"))) {
    const parent = path.dirname(markerRoot);
    if (parent === markerRoot) { markerRoot = null; break; }
    markerRoot = parent;
  }
  let root = input, gitDir = null, commonDir = null;
  if (markerRoot) {
    const marker = path.join(markerRoot, ".git"), stat = fs.lstatSync(marker);
    safeAbsolute(marker, { directory: stat.isDirectory(), mustExist: true });
    // A caller's Git environment must never redirect project authorization.
    const env = createActivationGitEnvironment();
    const result = spawnSync("git", ["-C", markerRoot, "rev-parse", "--path-format=absolute", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"], {
      env, encoding: "utf8", timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024,
    });
    if (result.error || result.signal || result.status !== 0) fail("ACTIVATION_GIT_RESOLUTION_FAILED");
    const lines = result.stdout.trim().split(/\r?\n/);
    if (lines.length !== 3 || lines.some((line) => !path.isAbsolute(line))) fail("ACTIVATION_GIT_RESOLUTION_FAILED");
    [root, gitDir, commonDir] = lines.map((line) => physicalDirectory(line));
    if (identityPath(root) !== identityPath(physicalDirectory(markerRoot))) fail("ACTIVATION_GIT_ROOT_MISMATCH");
    if (identityPath(gitDir) !== identityPath(commonDir)) {
      const backlink = readBytes(path.join(gitDir, "gitdir"));
      if (!backlink || identityPath(path.resolve(backlink.toString("utf8").trim())) !== identityPath(marker)) fail("ACTIVATION_WORKTREE_BACKLINK_MISMATCH");
    }
  }
  const scope = commonDir ? "repository" : "local";
  const authorityRoot = commonDir ?? root;
  return {
    target_root: root, root_id: scopeId(root), scope, git_dir: gitDir, common_dir: commonDir,
    authority_id: scopeId(authorityRoot),
    authority_path: safeAbsolute(path.join(authorityRoot, commonDir ? "aidn/authorization.json" : ".aidn/install/authorization.json")),
  };
}

function readAuthority(identity) {
  const bytes = readBytes(identity.authority_path, 65536);
  if (bytes === null) return { bytes: null, document: null };
  const document = unseal(parse(bytes));
  if (document.schema_version !== 1 || document.scope !== identity.scope || document.authority_id !== identity.authority_id
      || !Number.isSafeInteger(document.revision) || document.revision < 1 || !["authorized", "revoked"].includes(document.status)) fail("ACTIVATION_INVALID_AUTHORITY");
  return { bytes, document };
}
function codexPath(relative) {
  return ["AGENTS.md", ".codex/hooks.json", ".aidn/codex/skills.yaml", ".codex/skills/pr-orchestrate/SKILL.md"].includes(relative)
    || [".agents/skills/", ".codex/agents/", ".codex/hooks/"].some((prefix) => relative.startsWith(prefix));
}
function tokens(config) {
  if (!object(config?.hooks)) fail("ACTIVATION_INVALID_HOOKS");
  const result = [];
  for (const [event, groups] of Object.entries(config.hooks)) {
    if (!Array.isArray(groups)) fail("ACTIVATION_INVALID_HOOKS");
    for (const group of groups) {
      if (!object(group) || !Array.isArray(group.hooks)) fail("ACTIVATION_INVALID_HOOKS");
      const { hooks, ...attributes } = group;
      for (const hook of hooks) { if (!object(hook)) fail("ACTIVATION_INVALID_HOOKS"); result.push({ event, group: attributes, hook }); }
    }
  }
  return result;
}
function matchesOwnedHook(actual, owned) {
  // Same ownership rule as codex-assets-service: client group attributes may grow.
  return actual.event === owned.event && equal(actual.hook, owned.hook)
    && Object.entries(owned.group).every(([key, value]) => equal(actual.group[key], value));
}
function validateNativeAssets(root, assets, globalRuntime = null) {
  const required = {
    "AGENTS.md": "agents-block", ".codex/hooks.json": "hooks",
    ".codex/hooks/aidn-hook-runtime.mjs": "file", ".codex/hooks/aidn-session-start.mjs": "file", ".codex/hooks/aidn-pre-tool-use.mjs": "file",
  };
  if (globalRuntime) delete required[".codex/hooks/aidn-hook-runtime.mjs"];
  for (const skill of SKILL_IDENTITIES.filter((entry) => !globalRuntime && ["context-reload", "start-session"].includes(entry.id))) {
    const candidates = [skill.id, skill.publicName].map((name) => `.agents/skills/${name}/SKILL.md`);
    if (!candidates.some((relative) => assets[relative]?.kind === "file")) fail("ACTIVATION_REQUIRED_SKILL_MISSING", skill.id);
  }
  for (const [relative, kind] of Object.entries(required)) if (assets[relative]?.kind !== kind) fail("ACTIVATION_REQUIRED_ASSET_MISSING", relative);
  for (const [relative, asset] of Object.entries(assets)) {
    const bytes = readBytes(localPath(root, relative));
    if (bytes === null) fail("ACTIVATION_ASSET_MISSING", relative);
    if (asset.kind === "file") {
      if (bytes.toString("base64") !== asset.current) fail("ACTIVATION_ASSET_CHANGED", relative);
    } else if (asset.kind === "agents-block") {
      const text = bytes.toString("utf8"), start = "<!-- CODEX-AUDIT-WORKFLOW START -->", end = "<!-- CODEX-AUDIT-WORKFLOW END -->";
      if (text.split(start).length !== 2 || text.split(end).length !== 2 || text.indexOf(end) < text.indexOf(start)
          || text.slice(text.indexOf(start), text.indexOf(end) + end.length) !== asset.current) fail("ACTIVATION_AGENTS_CHANGED");
    } else {
      const actual = tokens(parse(bytes));
      for (const owned of asset.current) {
        if (!object(owned) || !object(owned.group) || !object(owned.hook)) fail("ACTIVATION_INVALID_HOOK_RECEIPT");
        const count = actual.filter((item) => matchesOwnedHook(item, owned)).length;
        if (count !== 1) fail("ACTIVATION_HOOK_CHANGED");
      }
      for (const event of ["SessionStart", "PreToolUse"]) if (!asset.current.some((item) => item.event === event)) fail("ACTIVATION_REQUIRED_HOOK_MISSING", event);
    }
  }
}

function validateReceipt(identity, { globalRecoveryPlanId } = {}) {
  const bytes = readBytes(localPath(identity.target_root, RECEIPT));
  if (bytes === null) return null;
  const receipt = unseal(parse(bytes)), root = identity.target_root;
  if (receipt.schema_version !== 1 || receipt.scope !== "codex-integration" || receipt.root_id !== identity.root_id || !object(receipt.assets)) fail("ACTIVATION_INVALID_RECEIPT");
  for (const [relative, asset] of Object.entries(receipt.assets)) {
    localPath(root, relative);
    if (!codexPath(relative) || !object(asset) || !["file", "hooks", "agents-block"].includes(asset.kind)
        || (asset.kind === "hooks" ? !Array.isArray(asset.current) : typeof asset.current !== "string")) fail("ACTIVATION_INVALID_RECEIPT_ASSET");
    if ((asset.kind === "hooks") !== (relative === ".codex/hooks.json") || (asset.kind === "agents-block") !== (relative === "AGENTS.md")) fail("ACTIVATION_INVALID_RECEIPT_ASSET_KIND");
  }
  if (receipt.installation !== undefined) {
    if (!object(receipt.installation) || !object(receipt.installation.assets)) fail("ACTIVATION_INVALID_INSTALLATION_RECEIPT");
    for (const [relative, asset] of Object.entries(receipt.installation.assets)) {
      localPath(root, relative);
      if (!isLocalInstallationTarget(relative) || !object(asset) || !["local-file", "config-fields", "append-lines", "seed-file"].includes(asset.kind)) fail("ACTIVATION_INVALID_RECEIPT_ASSET");
    }
  }
  if (receipt.activation !== undefined && (!object(receipt.activation) || receipt.activation.mode !== identity.scope || receipt.activation.authority_id !== identity.authority_id)) fail("ACTIVATION_RECEIPT_AUTHORITY_MISMATCH");
  const binding = receipt.package;
  if (!object(binding) || !path.isAbsolute(binding.root ?? "") || !isAidnProductVersion(binding.version) || binding.entry !== "bin/aidn.mjs"
      || !HASH.test(String(binding.entry_sha256)) || !HASH.test(String(binding.version_sha256))) fail("ACTIVATION_INVALID_PACKAGE_BINDING");
  if (receipt.global_runtime) {
    resolveGlobalProjectBinding(receipt.global_runtime, { recoveryPlanId: globalRecoveryPlanId });
  } else {
    const packageRoot = physicalDirectory(binding.root);
    const version = readBytes(localPath(packageRoot, "VERSION")), entry = readBytes(localPath(packageRoot, binding.entry));
    if (!version || !entry || version.toString("utf8").trim() !== binding.version || hash(version) !== binding.version_sha256 || hash(entry) !== binding.entry_sha256) fail("ACTIVATION_PACKAGE_CHANGED");
  }
  const id = receipt.last_transaction;
  if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) fail("ACTIVATION_COMPLETION_MISSING");
  const tx = unseal(parse(readBytes(localPath(root, `.aidn/install/transactions/${id}.json`))));
  const externalComplete = tx.external_status === "complete"
    || (["rollback", "uninstall"].includes(tx.action) && tx.external_status === "skipped");
  if (tx.schema_version !== 1 || tx.id !== id || tx.root_id !== identity.root_id || !["codex-integration", "installation"].includes(tx.scope)
      || tx.status !== "complete" || (tx.scope === "installation" && !externalComplete) || !Array.isArray(tx.operations)) fail("ACTIVATION_INSTALLATION_INCOMPLETE");
  for (const operation of tx.operations) {
    if (!object(operation)) fail("ACTIVATION_INVALID_TRANSACTION_OPERATION");
    localPath(root, operation.path);
    if (!codexPath(operation.path) && !(tx.scope === "installation" && isLocalInstallationTarget(operation.path))) fail("ACTIVATION_INVALID_TRANSACTION_OPERATION");
  }
  if (Object.keys(receipt.assets).length) validateNativeAssets(root, receipt.assets, receipt.global_runtime);
  return receipt;
}

export function readActivation({ targetRoot = process.cwd() } = {}) {
  let identity = null, authorization = null, receipt = null;
  const errors = [];
  let state = "degraded";
  try {
    identity = resolveActivationTarget({ targetRoot });
    authorization = readAuthority(identity).document;
    if (authorization?.status === "revoked") return { state: "revoked", active: false, identity, authorization, receipt, errors };
    if (readBytes(localPath(identity.target_root, ".aidn/install/global-migration.json")) !== null) fail("ACTIVATION_GLOBAL_MIGRATION_PENDING");
    if (readBytes(localPath(identity.target_root, ".aidn/install/pending.json")) !== null) fail("ACTIVATION_INSTALLATION_PENDING");
    receipt = validateReceipt(identity);
    if (receipt?.activation && !authorization) fail("ACTIVATION_AUTHORITY_MISSING");
    if (!receipt || !Object.keys(receipt.assets).length) state = authorization ? "unprepared" : "absent";
    else if (receipt.activation) {
      if (!authorization) fail("ACTIVATION_AUTHORITY_MISSING");
      state = "active";
    } else state = authorization ? "unprepared" : "legacy-active";
  } catch (error) { errors.push(error.code?.startsWith("ACTIVATION_") ? error.message : "ACTIVATION_READ_FAILED"); }
  return { state, active: ["active", "legacy-active"].includes(state), identity, authorization, receipt, errors };
}

// Compatibility checking must verify a deliberately revoked project's assets
// without changing its authority or turning that check into activation.
export function inspectPreparedProject({ targetRoot = process.cwd(), globalRecoveryPlanId, globalMigrationPlanId } = {}) {
  const identity = resolveActivationTarget({ targetRoot });
  const migrationBytes = readBytes(localPath(identity.target_root, ".aidn/install/global-migration.json"));
  if (migrationBytes) {
    const { journal_sha256, ...migration } = parse(migrationBytes);
    if (!globalMigrationPlanId || migration.plan?.plan_id !== globalMigrationPlanId
        || journal_sha256 !== hash(JSON.stringify(migration))) fail("ACTIVATION_GLOBAL_MIGRATION_PENDING");
  }
  if (readBytes(localPath(identity.target_root, ".aidn/install/pending.json")) !== null) fail("ACTIVATION_INSTALLATION_PENDING");
  const receipt = validateReceipt(identity, { globalRecoveryPlanId });
  if (!receipt || !Object.keys(receipt.assets).length) fail("ACTIVATION_PREPARATION_MISSING");
  const authorization = readAuthority(identity).document;
  if (receipt.activation && !authorization) fail("ACTIVATION_AUTHORITY_MISSING");
  if (authorization && !receipt.activation) fail("ACTIVATION_PREPARATION_MISSING");
  return { identity, receipt, authorization };
}

function planContent(plan) { const { plan_id, ...content } = plan; return content; }
export function planAuthorization({ targetRoot = process.cwd(), action } = {}) {
  const identity = resolveActivationTarget({ targetRoot });
  if (identityPath(physicalDirectory(targetRoot, true)) !== identityPath(identity.target_root)) fail("ACTIVATION_TARGET_NOT_ROOT");
  if (!["authorize", "revoke"].includes(action)) fail("ACTIVATION_INVALID_ACTION");
  const { bytes, document } = readAuthority(identity);
  const status = action === "authorize" ? "authorized" : "revoked";
  const next = document?.status === status ? document : {
    schema_version: 1, scope: identity.scope, authority_id: identity.authority_id,
    revision: (document?.revision ?? 0) + 1, status,
  };
  const before = bytes?.toString("base64") ?? null;
  const after = document?.status === status ? before : Buffer.from(`${JSON.stringify(seal(next), null, 2)}\n`).toString("base64");
  const plan = { ok: true, action, identity, authorization: { path: identity.authority_path, before, after, expected_revision: document?.revision ?? 0, next_revision: next.revision }, errors: [] };
  return { ...plan, plan_id: hash(stable(plan)) };
}

// This lock is held before the installation worktree lock. The caller journals
// pre/postimages in its existing transaction; this module has no journal.
export function acquireAuthorizationLock({ targetRoot = process.cwd() } = {}) {
  const identity = resolveActivationTarget({ targetRoot });
  const lockPath = safeAbsolute(`${identity.authority_path}.lock`);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  safeAbsolute(lockPath);
  const recoveryPath = safeAbsolute(`${lockPath}.recovery`);
  if (fs.existsSync(recoveryPath)) fail("ACTIVATION_AUTHORIZATION_RECOVERY_LOCKED");
  const existing = parse(readBytes(lockPath, 65536));
  let recoveryDescriptor, recoveryToken;
  try {
    if (existing) {
      if (existing.schema_version !== 1 || existing.authority_id !== identity.authority_id || typeof existing.token !== "string"
          || !ownerProvenDead(existing.pid)) fail("ACTIVATION_AUTHORIZATION_LOCKED");
      recoveryToken = crypto.randomUUID();
      try { recoveryDescriptor = fs.openSync(recoveryPath, "wx", 0o600); }
      catch (error) { if (error.code === "EEXIST") fail("ACTIVATION_AUTHORIZATION_RECOVERY_LOCKED"); throw error; }
      fs.writeFileSync(recoveryDescriptor, JSON.stringify({ pid: process.pid, token: recoveryToken })); fs.fsyncSync(recoveryDescriptor);
      const current = parse(readBytes(lockPath, 65536));
      if (!equal(current, existing) || !ownerProvenDead(current?.pid)) fail("ACTIVATION_AUTHORIZATION_LOCKED");
      fs.unlinkSync(lockPath);
    }
    const token = crypto.randomUUID();
    let fd;
    try {
      fd = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify({ schema_version: 1, pid: process.pid, token, authority_id: identity.authority_id })); fs.fsyncSync(fd);
    } catch (error) { if (error.code === "EEXIST") fail("ACTIVATION_AUTHORIZATION_LOCKED"); throw error; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    return () => { if (parse(readBytes(lockPath, 65536))?.token === token) fs.unlinkSync(lockPath); };
  } finally {
    if (recoveryDescriptor !== undefined) {
      fs.closeSync(recoveryDescriptor);
      if (parse(readBytes(recoveryPath, 65536))?.token === recoveryToken) fs.unlinkSync(recoveryPath);
    }
  }
}

function ownerProvenDead(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; } catch (error) { return error.code === "ESRCH"; }
}

export function applyAuthorization(plan, { alreadyLocked = false } = {}) {
  if (!object(plan) || plan.plan_id !== hash(stable(planContent(plan))) || !plan.ok) fail("ACTIVATION_INVALID_AUTHORIZATION_PLAN");
  const identity = resolveActivationTarget({ targetRoot: plan.identity.target_root });
  if (!equal(identity, plan.identity) || plan.authorization.path !== identity.authority_path) fail("ACTIVATION_AUTHORIZATION_SCOPE_CHANGED");
  const release = alreadyLocked ? null : acquireAuthorizationLock({ targetRoot: identity.target_root });
  try {
    const actual = readAuthority(identity).bytes?.toString("base64") ?? null;
    if (actual === plan.authorization.after) return { written: false, revision: plan.authorization.next_revision, idempotent: true };
    if (actual !== plan.authorization.before) fail("ACTIVATION_AUTHORIZATION_CAS_CONFLICT");
    const currentPlan = planAuthorization({ targetRoot: identity.target_root, action: plan.action });
    if (currentPlan.plan_id !== plan.plan_id) fail("ACTIVATION_AUTHORIZATION_CAS_CONFLICT");
    writeFileAtomicSync(identity.authority_path, Buffer.from(plan.authorization.after, "base64"), { mode: 0o600 });
    return { written: true, revision: plan.authorization.next_revision, idempotent: false };
  } finally { release?.(); }
}
