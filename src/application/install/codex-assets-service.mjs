import crypto from "node:crypto";
import { classifyHistoricalCodexSkill } from "./codex-legacy-repairs.mjs";
import { isLocalInstallationTarget, configFieldPatch, configFieldStates, restoreConfigFields, restoreAppendLines } from "./installation-ownership-service.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomicSync } from "../../lib/fs/atomic-write-lib.mjs";
import { renderTemplateVariables } from "./template-io.mjs";
import { inspectInstalledAidnVersion } from "../../lib/config/aidn-config-lib.mjs";
import { planAuthorization, applyAuthorization, acquireAuthorizationLock, readActivation } from "./project-activation-service.mjs";
import { planGlobalSkillsMigration, planRestoreGlobalSkillsMigration } from "./global-skills-migration-service.mjs";

const STORE = ".aidn/install";
const RECEIPT = `${STORE}/receipt.json`;
const PENDING = `${STORE}/pending.json`;
const LOCK = `${STORE}/lock.json`;
const PRIVATE_IGNORE = `${STORE}/.gitignore`;
const START = "<!-- CODEX-AUDIT-WORKFLOW START -->";
const END = "<!-- CODEX-AUDIT-WORKFLOW END -->";
const legacy = JSON.parse(fs.readFileSync(new URL("./codex-legacy-fingerprints.v1.json", import.meta.url), "utf8"));
const LEGACY_HOOK = {
  type: "command",
  command: 'node "$(git rev-parse --show-toplevel)/.codex/hooks/aidn-session-start.mjs"',
  commandWindows: 'powershell.exe -NoProfile -NonInteractive -Command "$root = git rev-parse --show-toplevel; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node (Join-Path $root \'.codex/hooks/aidn-session-start.mjs\')"',
  timeout: 10,
};
const ACTIONS = new Set(["install", "repair", "resume", "rollback", "uninstall", "authorize", "revoke", "migrate-global-skills", "restore-global-skills"]);
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const encode = (text) => Buffer.from(text).toString("base64");
const decode = (data) => data === null ? null : Buffer.from(data, "base64").toString("utf8");
const bytesHash = (data) => data === null ? null : hash(Buffer.from(data, "base64"));
const normalizedHash = (text) => hash(String(text).replace(/\r\n/g, "\n"));
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const same = (left, right) => stable(left) === stable(right);
function sealed(value) { return { ...value, integrity_sha256: hash(stable(value)) }; }
function unseal(value, relative) {
  const { integrity_sha256: integrity, ...content } = value;
  if (typeof integrity !== "string" || integrity !== hash(stable(content))) problem("INVALID_INSTALL_RECORD_INTEGRITY", relative);
  return content;
}
function problem(code, relativePath = "") {
  const error = new Error(`${code}${relativePath ? `: ${relativePath}` : ""}`);
  error.code = code;
  error.relativePath = relativePath;
  throw error;
}
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

// Check every existing path component, including the root's ancestors. Never follow
// a symlink/junction into another checkout or an external install store.
function safeRoot(root) {
  const absolute = path.resolve(root);
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) problem("UNSAFE_ROOT");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return absolute;
}
function safePath(root, relative, { directory = false } = {}) {
  if (typeof relative !== "string" || relative.includes("\\") || relative.startsWith("/")
    || relative.split("/").some((part) => !part || part === "." || part === ".." || part.includes(":"))) problem("INVALID_ASSET_PATH", relative);
  const absolute = path.resolve(root, ...relative.split("/"));
  if (!absolute.startsWith(`${root}${path.sep}`)) problem("PATH_ESCAPE", relative);
  let cursor = root;
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) problem("SYMLINK_ASSET", relative);
      if (index < parts.length - 1 || directory) {
        if (!stat.isDirectory()) problem("NOT_A_DIRECTORY", relative);
      } else if (!stat.isFile() || stat.nlink > 1) problem("UNSAFE_ASSET_FILE", relative);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return absolute;
}
function read(root, relative) {
  const absolute = safePath(root, relative);
  if (!fs.existsSync(absolute)) return null;
  if (fs.statSync(absolute).size > 8 * 1024 * 1024) problem("ASSET_TOO_LARGE", relative);
  return fs.readFileSync(absolute).toString("base64");
}
function jsonAt(root, relative) {
  const value = read(root, relative);
  if (value === null) return null;
  try { return JSON.parse(decode(value)); } catch { problem("INVALID_JSON", relative); }
}
function write(root, relative, data) {
  const absolute = safePath(root, relative);
  if (data === null) {
    if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
  } else writeFileAtomicSync(absolute, Buffer.from(data, "base64"), { mode: 0o600 });
}
function writeJson(root, relative, value) { write(root, relative, encode(`${JSON.stringify(value, null, 2)}\n`)); }
function scopeId(root) { return hash(process.platform === "win32" ? root.toLowerCase() : root); }
export function isCodexManagedTarget(relative) {
  const value = String(relative).replace(/\\/g, "/").replace(/\/$/, "");
  return value === ".codex/skills/pr-orchestrate/SKILL.md" || value === "AGENTS.md" || value === ".codex/hooks.json" || value === ".aidn/codex/skills.yaml"
    || [".agents/skills", ".codex/agents", ".codex/hooks"].some((prefix) => value === prefix || value.startsWith(`${prefix}/`));
}
function validateAssetPath(relative, scope = "codex-integration") {
  if (!isCodexManagedTarget(relative) && !(scope === "installation" && isLocalInstallationTarget(relative))) problem("UNOWNED_RECEIPT_PATH", relative);
}
function loadReceipt(root) {
  const stored = jsonAt(root, RECEIPT);
  if (!stored) return null;
  const receipt = unseal(stored, RECEIPT);
  if (receipt.schema_version !== 1 || receipt.scope !== "codex-integration" || receipt.root_id !== scopeId(root)
    || !isObject(receipt.assets)) problem("INVALID_RECEIPT", RECEIPT);
  for (const [relative, asset] of Object.entries(receipt.assets)) {
    validateAssetPath(relative);
    if (!isObject(asset) || !["file", "hooks", "agents-block"].includes(asset.kind)) problem("INVALID_RECEIPT_ASSET", relative);
    if (asset.kind === "file" && typeof asset.current !== "string") problem("INVALID_RECEIPT_ASSET", relative);
    if (asset.kind === "hooks" && !Array.isArray(asset.current)) problem("INVALID_RECEIPT_ASSET", relative);
    if (asset.kind === "agents-block" && typeof asset.current !== "string") problem("INVALID_RECEIPT_ASSET", relative);
  }
  if (receipt.installation?.assets) for (const [relative, asset] of Object.entries(receipt.installation.assets)) {
    validateAssetPath(relative, "installation");
    if (!["local-file", "config-fields", "append-lines", "seed-file"].includes(asset.kind)) problem("INVALID_RECEIPT_ASSET", relative);
  }
  return receipt;
}
function blockOf(text, relative = "AGENTS.md") {
  if (text === null) return null;
  const starts = text.split(START).length - 1;
  const ends = text.split(END).length - 1;
  if (!starts && !ends) return null;
  if (starts !== 1 || ends !== 1 || text.indexOf(END) < text.indexOf(START)) problem("AMBIGUOUS_AGENTS_BLOCK", relative);
  return text.slice(text.indexOf(START), text.indexOf(END) + END.length);
}
function replaceBlock(data, from, to) {
  const text = decode(data) ?? "";
  const actual = blockOf(text);
  if (actual !== from) problem("MODIFIED_MANAGED_BLOCK", "AGENTS.md");
  if (from !== null) return encode(text.replace(from, to ?? ""));
  if (to === null) return data;
  if (!text) return encode(`${to}\n`);
  return encode(`${text}${text.endsWith("\n") ? "" : "\n"}\n${to}\n`);
}
function hooksConfig(data) {
  let config;
  try { config = data === null ? { hooks: {} } : JSON.parse(decode(data)); }
  catch { problem("INVALID_HOOKS_JSON", ".codex/hooks.json"); }
  if (!isObject(config) || !isObject(config.hooks) || (config.version !== undefined && config.version !== 1)) problem("INVALID_HOOKS_STRUCTURE", ".codex/hooks.json");
  for (const key of Object.keys(config)) if (!["hooks", "description", "version"].includes(key)) problem("UNSUPPORTED_HOOKS_ROOT_FIELD", ".codex/hooks.json");
  if (config.description !== undefined && typeof config.description !== "string") problem("INVALID_HOOKS_STRUCTURE", ".codex/hooks.json");
  for (const groups of Object.values(config.hooks)) {
    if (!Array.isArray(groups)) problem("INVALID_HOOKS_STRUCTURE", ".codex/hooks.json");
    for (const group of groups) if (!isObject(group) || !Array.isArray(group.hooks) || group.hooks.some((hook) => !isObject(hook))) problem("INVALID_HOOKS_STRUCTURE", ".codex/hooks.json");
  }
  return config;
}
function hookTokens(config) {
  return Object.entries(config.hooks).flatMap(([event, groups]) => groups.flatMap((group) => {
    const { hooks, ...attributes } = group;
    return hooks.map((hook) => ({ event, group: attributes, hook }));
  }));
}
function sameToken(left, right) { return same(left, right); }
function matchesToken(actual, owned) {
  return actual.event === owned.event && same(actual.hook, owned.hook)
    && same(actual.group.matcher ?? null, owned.group.matcher ?? null)
    && Object.entries(owned.group).every(([key, value]) => same(actual.group[key], value));
}
function validateOwnedHooks(data, owned, { allowMissing = false } = {}) {
  const actual = hookTokens(hooksConfig(data));
  for (const token of owned) {
    const count = actual.filter((candidate) => matchesToken(candidate, token)).length;
    if (count !== 1 && !(allowMissing && count === 0)) problem("MODIFIED_OR_DUPLICATE_MANAGED_HOOK", ".codex/hooks.json");
  }
  return actual;
}
function replaceHooks(data, from, to, allowMissing = false) {
  const config = hooksConfig(data);
  validateOwnedHooks(data, from, { allowMissing });
  if (config.version === 1 && from.length) delete config.version;
  const remaining = [...to];
  for (const [event, groups] of Object.entries(config.hooks)) {
    const nextGroups = [];
    for (const group of groups) {
      const { hooks, ...attributes } = group;
      const nextHooks = [];
      let removed = false;
      for (const hook of hooks) {
        const token = { event, group: attributes, hook };
        if (!from.some((item) => matchesToken(token, item))) { nextHooks.push(hook); continue; }
        removed = true;
        const replacement = remaining.findIndex((item) => item.event === event && same(item.group, attributes));
        if (replacement >= 0) nextHooks.push(remaining.splice(replacement, 1)[0].hook);
      }
      const ownedWrapper = from.some((token) => token.event === event && same(token.group, attributes));
      if (nextHooks.length || !removed || !ownedWrapper) nextGroups.push({ ...group, hooks: nextHooks });
    }
    if (nextGroups.length || groups.length === 0) config.hooks[event] = nextGroups;
    else delete config.hooks[event];
  }
  for (const token of remaining) {
    if (!Object.hasOwn(config.hooks, token.event)) config.hooks[token.event] = [];
    config.hooks[token.event].push({ ...token.group, hooks: [token.hook] });
  }
  if (data !== null && same(config, hooksConfig(data))) return data;
  return encode(`${JSON.stringify(config, null, 2)}\n`);
}
function knownLegacy(relative, text) { return legacy.assets[relative]?.includes(normalizedHash(text)) === true; }
function desiredAssets(repoRoot, templateVars) {
  const result = new Map();
  function add(source, relative, kind = "file") {
    const sourcePath = safePath(repoRoot, source);
    const raw = fs.readFileSync(sourcePath, "utf8");
    const rendered = renderTemplateVariables(raw, templateVars);
    if (/\{\{[A-Z0-9_]+\}\}/.test(rendered)) problem("UNRESOLVED_CODEX_TEMPLATE", relative);
    result.set(relative, { kind, data: encode(rendered) });
  }
  function walk(source, target) {
    safePath(repoRoot, source, { directory: true });
    for (const entry of fs.readdirSync(path.join(repoRoot, source), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) problem("SYMLINK_PACKAGE_ASSET", source);
      if (entry.isDirectory()) walk(`${source}/${entry.name}`, `${target}/${entry.name}`);
      else add(`${source}/${entry.name}`, `${target}/${entry.name}`);
    }
  }
  for (const entry of fs.readdirSync(path.join(repoRoot, "scaffold/codex"), { withFileTypes: true })) {
    if (entry.isDirectory()) walk(`scaffold/codex/${entry.name}`, `.agents/skills/${entry.name}`);
  }
  walk("scaffold/codex_agents", ".codex/agents");
  walk("scaffold/codex_hooks/scripts", ".codex/hooks");
  add("scaffold/codex/skills.yaml", ".aidn/codex/skills.yaml");
  add("scaffold/codex_hooks/hooks.json", ".codex/hooks.json", "hooks");
  add("scaffold/root/AGENTS.md", "AGENTS.md", "agents-block");
  return result;
}
function packageBinding(repoRoot) {
  repoRoot = safeRoot(repoRoot);
  const version = fs.readFileSync(safePath(repoRoot, "VERSION"), "utf8").trim();
  return { root: repoRoot, version, entry: "bin/aidn.mjs", entry_sha256: bytesHash(read(repoRoot, "bin/aidn.mjs")), version_sha256: bytesHash(read(repoRoot, "VERSION")) };
}
function publicPlan(plan) {
  return {
    ok: plan.conflicts.length === 0, scope: plan.scope, action: plan.action,
    plan_id: plan.id, dry_run: true, written: false, write_targets: [],
    installed: Object.keys(plan.receipt?.assets ?? {}).length > 0,
    pending: plan.pending?.id ?? null,
    lock_recovery: plan.lock && ["resume", "rollback"].includes(plan.action) && !processExists(plan.lock.pid)
      ? { required: true, path: LOCK, owner: "not-running" } : { required: false },
    package_version: plan.binding?.version ?? plan.receipt?.package?.version ?? null,
    operations: plan.operations.map((op) => ({ path: op.path, kind: op.kind, owner: op.kind === "seed-file" ? "retained-project-state" : "aidn-installer", effect: op.before === op.after ? "unchanged" : op.after === null ? "remove" : op.before === null ? "create" : "update", before_hash: bytesHash(op.before), after_hash: bytesHash(op.after) })),
    conflicts: plan.conflicts, errors: plan.conflicts.map((item) => `${item.code}${item.path ? `: ${item.path}` : ""}`),
    warnings: plan.warnings,
    historical_repairs: plan.historicalRepairs ?? [],
    authorization: plan.authorization ? { action: plan.authorization.action, scope: plan.authorization.identity.scope,
      authority_id: plan.authorization.identity.authority_id, expected_revision: plan.authorization.authorization.expected_revision,
      next_revision: plan.authorization.authorization.next_revision,
      effect: plan.authorization.authorization.before === plan.authorization.authorization.after ? "unchanged" : "update" } : null,
    ...(plan.hostMigration ? { global_skills: { codex_home: plan.hostMigration.codex_home,
      candidates: plan.hostMigration.candidates, requires_restart: plan.hostMigration.requires_restart,
      operations: plan.hostMigration.operations.map(({ path: relative, before_hash, after_hash }) => ({ path: path.join(plan.hostMigration.codex_home, relative), before_hash, after_hash })) } } : {}),
    ...(plan.scope === "installation" ? { external_effects: plan.installationContext?.external_effects ?? [], version_before: plan.installationContext?.version_before ?? null, version_after: plan.installationContext?.version_after ?? null } : {}),
  };
}
function makeOperation(relative, kind, before, after, beforeOwned, afterOwned) {
  return { path: relative, kind, before, after, before_owned: beforeOwned, after_owned: afterOwned };
}
function restoredContent(op, current) {
  if (current === op.before) return current;
  if (current === op.after || (op.staged !== undefined && current === op.staged)) return op.before;
  if (op.kind === "seed-file") return current;
  if (op.kind === "config-fields") {
    try { return encode(restoreConfigFields(decode(current), op.after_owned, op.before_owned)); }
    catch {
      if (op.staged_owned) {
        try { return encode(restoreConfigFields(decode(current), op.staged_owned, op.before_owned)); } catch { /* conflict below */ }
      }
      problem("CONFIG_FIELD_POSTIMAGE_CHANGED", op.path);
    }
  }
  if (op.kind === "append-lines") { try { return encode(restoreAppendLines(decode(current), op.after_owned, op.before_owned)); } catch { problem("APPEND_LINE_POSTIMAGE_CHANGED", op.path); } }
  if (op.kind === "file" || op.kind === "local-file") problem("POSTIMAGE_CHANGED", op.path);
  if (op.kind === "agents-block") return replaceBlock(current, op.after_owned, op.before_owned);
  const restored = replaceHooks(current, op.after_owned, op.before_owned);
  if (hooksConfig(op.before).version === 1 && hooksConfig(op.after).version === undefined) {
    if (hooksConfig(current).version !== undefined) problem("HOOKS_ROOT_VERSION_POSTIMAGE_CHANGED", op.path);
    const config = hooksConfig(restored);
    config.version = 1;
    return encode(`${JSON.stringify(config, null, 2)}\n`);
  }
  return restored;
}
function loadTransaction(root, id) {
  if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) problem("INVALID_TRANSACTION_ID");
  const stored = jsonAt(root, `${STORE}/transactions/${id}.json`);
  const tx = stored ? unseal(stored, `${STORE}/transactions/${id}.json`) : null;
  if (!tx || tx.schema_version !== 1 || tx.root_id !== scopeId(root) || !Array.isArray(tx.operations)) problem("INVALID_TRANSACTION");
  for (const op of tx.operations) {
    validateAssetPath(op.path, tx.scope);
    if (!["file", "hooks", "agents-block", ...(tx.scope === "installation" ? ["local-file", "config-fields", "append-lines", "seed-file"] : [])].includes(op.kind)) problem("INVALID_TRANSACTION");
  }
  return tx;
}
function buildPlan(options = {}, { ignoreLock = false } = {}) {
  const action = options.action ?? "install";
  const targetRoot = safeRoot(options.targetRoot ?? process.cwd());
  const repoRoot = safeRoot(options.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
  const scope = options.scope ?? "codex-integration";
  const plan = { action, scope, targetRoot, repoRoot, installationContext: options.installation?.context ?? null, operations: [], conflicts: [], warnings: [], receipt: null, pending: null, nextReceipt: null, binding: null, id: "" };
  try {
    if (!ACTIONS.has(action)) problem("INVALID_INSTALL_ACTION");
    if (!["codex-integration", "installation"].includes(scope)) problem("INVALID_INSTALL_SCOPE");
    if (["authorize", "revoke", "migrate-global-skills", "restore-global-skills"].includes(action) && scope !== "codex-integration") problem("INVALID_AUTHORIZATION_SCOPE");
    const authority = planAuthorization({ targetRoot, action: "authorize" });
    if (scopeId(authority.identity.target_root) !== scopeId(targetRoot)) problem("INSTALL_REQUIRES_PROJECT_ROOT");
    plan.authorityIdentity = authority.identity;
    plan.authorizationBefore = authority.authorization.before;
    // Store safety is validated even when none of the selected assets is present.
    safePath(targetRoot, STORE, { directory: true });
    const privateIgnore = read(targetRoot, PRIVATE_IGNORE);
    if (privateIgnore !== null && decode(privateIgnore).trim() !== "*") problem("INSTALL_STORE_IGNORE_CONFLICT", PRIVATE_IGNORE);
    plan.receipt = loadReceipt(targetRoot);
    plan.pending = jsonAt(targetRoot, PENDING);
    plan.lock = jsonAt(targetRoot, LOCK);
    plan.recoveryLock = jsonAt(targetRoot, STORE + "/recovery-lock.json");
    if (!ignoreLock && plan.recoveryLock) problem("INTERRUPTED_LOCK_RECOVERY_REQUIRES_INSPECTION", STORE + "/recovery-lock.json");
    if (!ignoreLock && plan.lock) {
      if (processExists(plan.lock.pid)) problem("INSTALL_LOCKED", LOCK);
      if (!["resume", "rollback", "revoke"].includes(action)) problem("STALE_INSTALL_LOCK_REQUIRES_RESUME", LOCK);
    }
    if (plan.pending && (plan.pending.schema_version !== 1 || plan.pending.root_id !== scopeId(targetRoot))) problem("INVALID_PENDING_TRANSACTION", PENDING);
    if (plan.pending && action !== "revoke" && (plan.pending.scope ?? "codex-integration") !== scope) problem("INSTALLATION_SCOPE_REQUIRED");
    const emptyReceipt = { schema_version: 1, scope: "codex-integration", root_id: scopeId(targetRoot), package: null, assets: {}, last_transaction: null, last_action: null };
    plan.nextReceipt = structuredClone(plan.receipt ?? emptyReceipt);

    if (plan.pending && !["resume", "rollback", "revoke"].includes(action)) problem("INTERRUPTED_INSTALL_REQUIRES_RESUME_OR_ROLLBACK", PENDING);
    if (["migrate-global-skills", "restore-global-skills"].includes(action)) {
      if (!path.isAbsolute(options.codexHome ?? "")) problem("EXPLICIT_ABSOLUTE_HOST_PATH_REQUIRED");
      const home = safeRoot(options.codexHome);
      if (action === "migrate-global-skills") {
        if (!readActivation({ targetRoot }).active) problem("GLOBAL_MIGRATION_REQUIRES_ACTIVE_LOCAL_INSTALLATION");
        for (const name of ["aidn-context-reload", "aidn-start-session"]) if (!plan.receipt.assets[`.agents/skills/${name}/SKILL.md`]) problem("GLOBAL_MIGRATION_REQUIRES_NAMESPACED_SKILLS");
        plan.hostMigration = planGlobalSkillsMigration({ codexHome: home });
      } else {
        const saved = plan.receipt?.global_skills_migration;
        if (!saved || scopeId(saved.codex_home) !== scopeId(home)) problem("NO_OWNED_GLOBAL_SKILLS_MIGRATION");
        plan.hostMigration = planRestoreGlobalSkillsMigration({ codexHome: home, operation: saved.operation });
      }
      if (!plan.hostMigration.ok) { plan.conflicts.push(...plan.hostMigration.conflicts); }
      else if (action === "migrate-global-skills") {
        const saved = plan.receipt?.global_skills_migration;
        const operation = plan.hostMigration.operations[0];
        if (saved && (scopeId(saved.codex_home) !== scopeId(home) || saved.operation.after !== operation.before)) problem("GLOBAL_SKILLS_POSTIMAGE_CHANGED");
        plan.nextReceipt.global_skills_migration = { codex_home: home, operation: saved
          ? { ...operation, before: saved.operation.before, before_hash: saved.operation.before_hash } : operation };
      } else delete plan.nextReceipt.global_skills_migration;
      if (plan.hostMigration.ok) validateHostMigration(plan.hostMigration);
    } else if (["authorize", "revoke"].includes(action)) {
      if (action === "authorize" && !Object.keys(plan.receipt?.assets ?? {}).length) problem("AUTHORIZE_REQUIRES_INSTALLED_WORKTREE");
      plan.authorization = action === "authorize" ? authority : planAuthorization({ targetRoot, action });
      if (action === "authorize") plan.nextReceipt.activation = { mode: authority.identity.scope, authority_id: authority.identity.authority_id };
    } else if (action === "resume") {
      if (!plan.pending) { plan.warnings.push(plan.lock ? "No asset journal; resume will recover the abandoned installation lock." : "No interrupted Codex asset transaction."); }
      else {
        const tx = loadTransaction(targetRoot, plan.pending.id);
        if (tx.scope !== scope) problem("INSTALLATION_SCOPE_REQUIRED");
        const interruptedImport = tx.external_effect_results?.["artifact-import"];
        if (interruptedImport?.source_kind === "postgres" && !["completed", "skipped"].includes(interruptedImport.status)) problem("ARTIFACT_IMPORT_REQUIRES_INSPECTION");
        plan.resume = tx;
        plan.hostMigration = tx.host_migration ?? null;
        if (plan.hostMigration) validateHostMigration(plan.hostMigration);
        plan.authorization = tx.authorization ?? null;
        if (plan.authorization && ![plan.authorization.authorization.before, plan.authorization.authorization.after].includes(plan.authorizationBefore)) problem("ACTIVATION_AUTHORIZATION_CAS_CONFLICT");
        plan.installationContext = tx.installation_context ?? null;
        plan.binding = tx.execution_package ?? tx.receipt_after.package ?? tx.receipt_before?.package;
        if (!plan.binding) problem("MISSING_TRANSACTION_PACKAGE_BINDING");
        const actualBinding = packageBinding(plan.binding.root);
        if (!same(actualBinding, plan.binding) || !same(packageBinding(repoRoot), plan.binding)) problem("PACKAGE_CHANGED_SINCE_TRANSACTION");
        for (const operation of tx.operations) {
          const current = read(targetRoot, operation.path);
          if (current !== operation.before && current !== operation.after && current !== operation.staged) problem("TRANSACTION_POSTIMAGE_CHANGED", operation.path);
          plan.operations.push({ ...operation, before: current });
        }
        plan.nextReceipt = tx.receipt_after;
      }
    } else if (action === "rollback") {
      plan.binding = packageBinding(repoRoot);
      const id = plan.pending?.id ?? (scope === "installation" ? plan.receipt?.installation_last_transaction ?? plan.receipt?.installation?.last_transaction : null) ?? plan.receipt?.last_transaction;
      const alreadyRolledBack = scope === "installation"
        ? (plan.receipt?.installation_last_action ?? (plan.receipt?.last_scope === "installation" ? plan.receipt?.last_action : null)) === "rollback"
        : plan.receipt?.last_action === "rollback" && (plan.receipt?.last_scope ?? "codex-integration") === scope;
      if (!id || (!plan.pending && alreadyRolledBack)) plan.warnings.push("No Codex asset transaction to roll back.");
      else {
        const tx = loadTransaction(targetRoot, id);
        if (tx.host_migration) problem("HOST_MIGRATION_REQUIRES_EXPLICIT_RESTORE");
        if (tx.receipt_after?.activation && tx.receipt_before && !tx.receipt_before.activation
          && Object.keys(tx.receipt_before.assets ?? {}).length) problem("ROLLBACK_TO_LEGACY_ACTIVATION_REQUIRES_UNINSTALL");
        const codexOnlyRollback = scope === "codex-integration" && tx.scope === "installation" && !plan.pending;
        if (tx.scope !== scope && !codexOnlyRollback) problem("INSTALLATION_SCOPE_REQUIRED");
        plan.installationContext = tx.installation_context ?? null;
        plan.rollbackOf = tx.id;
        for (const operation of [...tx.operations].reverse().filter((op) => !codexOnlyRollback || isCodexManagedTarget(op.path))) {
          const current = read(targetRoot, operation.path);
          const after = operation.kind === "seed-file" ? current : restoredContent(operation, current);
          plan.operations.push(makeOperation(operation.path, operation.kind, current, after, operation.after_owned, operation.before_owned));
        }
        plan.nextReceipt = codexOnlyRollback
          ? { ...structuredClone(plan.receipt), assets: structuredClone(tx.receipt_before?.assets ?? {}), package: tx.receipt_before?.package ?? plan.receipt.package }
          : structuredClone(tx.receipt_before ?? emptyReceipt);
        if (tx.receipt_after?.activation) plan.nextReceipt.activation = structuredClone(tx.receipt_after.activation);
      }
    } else if (action === "uninstall") {
      for (const [relative, asset] of Object.entries(plan.receipt?.assets ?? {})) {
        const current = read(targetRoot, relative);
        let after;
        if (asset.kind === "file") {
          if (current !== null && current !== asset.current) problem("MODIFIED_MANAGED_ASSET", relative);
          after = asset.legacy_preimage ?? null;
        } else if (asset.kind === "hooks") {
          after = current === null ? null : replaceHooks(current, asset.current, []);
          // Receipt refresh must never adopt later third-party fields as deletable.
          if (asset.created && after !== null && same(hooksConfig(after), { hooks: {} })) after = null;
        } else {
          after = current === null ? null : replaceBlock(current, asset.current, null);
          if (after === asset.unmanaged_baseline) after = asset.uninstall_preimage;
          else if (asset.created && after !== null && decode(after).trim() === "") after = null;
        }
        plan.operations.push(makeOperation(relative, asset.kind, current, after, asset.current, asset.kind === "hooks" ? [] : null));
      }
      plan.nextReceipt.assets = {};
      if (scope === "installation" && plan.receipt?.installation) {
        for (const [relative, asset] of Object.entries(plan.receipt.installation.assets ?? {})) {
          const current = read(targetRoot, relative);
          if (asset.kind === "seed-file") continue;
          const op = makeOperation(relative, asset.kind, asset.baseline, asset.current, asset.baseline_owned, asset.current_owned);
          const after = restoredContent(op, current);
          plan.operations.push(makeOperation(relative, asset.kind, current, after, asset.current_owned, asset.baseline_owned));
        }
        delete plan.nextReceipt.installation;
      }
    } else {
      plan.binding = packageBinding(repoRoot);
      if (action === "install") {
        if (authority.authorization.before === null) {
          if (plan.receipt?.activation) problem("ACTIVATION_AUTHORITY_MISSING");
          plan.authorization = authority;
        }
        plan.nextReceipt.activation = { mode: authority.identity.scope, authority_id: authority.identity.authority_id };
      }
      const desired = desiredAssets(repoRoot, { VERSION: plan.binding.version, ...options.templateVars });
      const historical = new Map();
      for (const relative of [".agents/skills/pr-orchestrate/SKILL.md", ".codex/skills/pr-orchestrate/SKILL.md"]) {
        const current = read(targetRoot, relative);
        if (current === null) continue;
        const classification = classifyHistoricalCodexSkill({ relativePath: relative, text: decode(current) });
        const { replacementText, ...publicClassification } = classification;
        if (classification.action === "conflict" && plan.receipt?.assets?.[relative]?.current !== current
          && !knownLegacy(relative, decode(current))) problem(classification.code, relative);
        if (classification.action === "repair") {
          historical.set(relative, classification);
          (plan.historicalRepairs ??= []).push({ path: relative, ...publicClassification });
        }
        if (classification.action === "none") historical.set(relative, classification);
        // Keep the exact old bytes in the transaction, not a duplicate discoverable skill.
      }
      for (const relative of new Set([...Object.keys(legacy.assets), ...historical.keys()].filter((name) => name.startsWith(".agents/skills/") || name.startsWith(".codex/skills/")))) {
        if (desired.has(relative) || plan.receipt?.assets?.[relative]) continue;
        const current = read(targetRoot, relative);
        if (current === null) continue;
        if (!knownLegacy(relative, decode(current)) && !historical.has(relative)) problem("UNOWNED_LEGACY_SKILL_CONFLICT", relative);
        plan.operations.push(makeOperation(relative, "file", current, null, current, null));
      }
      if (action === "repair" && !plan.receipt && !historical.size) problem("NO_MANAGED_CODEX_INSTALLATION");
      plan.nextReceipt.package = plan.binding;
      for (const [relative, item] of desired) {
        const current = read(targetRoot, relative);
        const owned = plan.receipt?.assets?.[relative];
        let beforeOwned = null;
        let afterOwned = item.data;
        let after = item.data;
        if (item.kind === "file") {
          if (owned && current !== owned.current && current !== null) problem("MODIFIED_MANAGED_ASSET", relative);
          if (!owned && current !== null && current !== item.data && !knownLegacy(relative, decode(current)) && !historical.has(relative)) problem("UNOWNED_ASSET_CONFLICT", relative);
          beforeOwned = current;
        } else if (item.kind === "agents-block") {
          if (options.skipAgents) { plan.warnings.push("AGENTS.md was explicitly excluded."); continue; }
          const desiredText = decode(item.data);
          afterOwned = blockOf(desiredText) ?? `${START}\n${desiredText.trimEnd()}\n${END}`;
          beforeOwned = blockOf(decode(current));
          if (owned && beforeOwned !== owned.current && !(action === "repair" && beforeOwned === null)) problem("MODIFIED_MANAGED_BLOCK", relative);
          if (!owned && beforeOwned !== null && beforeOwned !== afterOwned && !knownLegacy(relative, beforeOwned)) problem("UNOWNED_AGENTS_BLOCK", relative);
          after = replaceBlock(current, beforeOwned, afterOwned);
        } else {
          const desiredTokens = hookTokens(hooksConfig(item.data));
          const actual = hookTokens(hooksConfig(current));
          if (owned) {
            beforeOwned = owned.current;
            validateOwnedHooks(current, beforeOwned, { allowMissing: current === null });
          } else {
            beforeOwned = actual.filter((token) => desiredTokens.some((wanted) => sameToken(token, wanted))
              || (token.event === "SessionStart" && Object.keys(token.group).length === 0 && same(token.hook, LEGACY_HOOK)));
            const fingerprints = beforeOwned.map(stable);
            if (new Set(fingerprints).size !== fingerprints.length) problem("DUPLICATE_LEGACY_HOOK", relative);
            for (const token of actual) {
              const claimsLegacy = token.hook.command === LEGACY_HOOK.command || token.hook.commandWindows === LEGACY_HOOK.commandWindows;
              if (claimsLegacy && !beforeOwned.some((known) => sameToken(known, token))) problem("AMBIGUOUS_LEGACY_HOOK", relative);
            }
          }
          if (hooksConfig(current).version === 1 && beforeOwned.length === 0) problem("UNOWNED_HOOKS_ROOT_VERSION", relative);
          afterOwned = desiredTokens;
          after = replaceHooks(current, beforeOwned, afterOwned, current === null);
        }
        plan.operations.push(makeOperation(relative, item.kind, current, after, beforeOwned, afterOwned));
        plan.nextReceipt.assets[relative] = { kind: item.kind, current: afterOwned, full_postimage: after, created: owned?.created ?? current === null, source_hash: bytesHash(item.data) };
        if (owned?.legacy_preimage !== undefined || relative.startsWith(".codex/skills/")) plan.nextReceipt.assets[relative].legacy_preimage = owned?.legacy_preimage ?? current;
        if (item.kind === "agents-block") {
          plan.nextReceipt.assets[relative].unmanaged_baseline = owned?.unmanaged_baseline ?? replaceBlock(after, afterOwned, null);
          plan.nextReceipt.assets[relative].uninstall_preimage = owned && Object.hasOwn(owned, "uninstall_preimage")
            ? owned.uninstall_preimage : beforeOwned === null ? current : replaceBlock(current, beforeOwned, null);
        }
      }
      if (scope === "installation") {
        if (!options.installation) problem("INSTALLATION_PLAN_REQUIRED");
        const previousAssets = plan.receipt?.installation?.assets ?? {};
        const localAssets = { ...previousAssets };
        for (const item of options.installation.operations) {
          const relative = item.path; validateAssetPath(relative, scope);
          if (isCodexManagedTarget(relative)) problem("DUPLICATE_MANAGED_PATH", relative);
          const current = read(targetRoot, relative), owned = previousAssets[relative];
          if (owned && item.kind === "local-file" && current !== owned.current && current !== null) problem("MODIFIED_INSTALLATION_ASSET", relative);
          if (!owned && item.kind === "local-file" && current !== null && current !== item.data && !(item.legacy_data ?? []).some((data) => normalizedHash(decode(data)) === normalizedHash(decode(current)))) problem("UNOWNED_INSTALLATION_ASSET", relative);
          let beforeOwned = current, afterOwned = item.data;
          if (item.kind === "config-fields") {
            const patch = configFieldPatch(current === null ? {} : JSON.parse(decode(current)), JSON.parse(decode(item.data)));
            beforeOwned = patch.before; afterOwned = patch.after;
          } else if (item.kind === "append-lines") {
            beforeOwned = [];
            const beforeLines = (decode(current) ?? "").replace(/\r\n/g, "\n").split("\n");
            afterOwned = (decode(item.data) ?? "").replace(/\r\n/g, "\n").split("\n").filter((line) => line && !beforeLines.includes(line));
          }
          if (owned && item.kind === "config-fields" && !(action === "repair" && current === null)) {
            try { restoreConfigFields(decode(current), owned.current_owned, owned.current_owned); } catch { problem("CONFIG_FIELD_POSTIMAGE_CHANGED", relative); }
          }
          if (owned && item.kind === "append-lines") {
            try { restoreAppendLines(decode(current), owned.current_owned, owned.current_owned); } catch { problem("APPEND_LINE_POSTIMAGE_CHANGED", relative); }
          }
          const operation = makeOperation(relative, item.kind, current, item.data, beforeOwned, afterOwned);
          operation.finalize = item.finalize === true;
          if (item.staged !== undefined) { operation.staged = item.staged; operation.staged_owned = configFieldStates(JSON.parse(decode(item.staged)), afterOwned); }
          plan.operations.push(operation);
          localAssets[relative] = { kind: item.kind, current: item.data, baseline: owned ? owned.baseline : current,
            baseline_owned: item.kind === "config-fields" ? { ...beforeOwned, ...(owned?.baseline_owned ?? {}) } : owned ? owned.baseline_owned : beforeOwned,
            current_owned: item.kind === "config-fields" ? { ...(owned?.current_owned ?? {}), ...afterOwned } : item.kind === "append-lines" ? [...new Set([...(owned?.current_owned ?? []), ...afterOwned])] : afterOwned };
        }
        plan.nextReceipt.installation = { ...(plan.receipt?.installation ?? {}), assets: localAssets, version: options.installation.context.version_after, args: options.installation.context.args };
      }
      for (const [relative, owned] of Object.entries(plan.receipt?.assets ?? {})) {
        if (desired.has(relative)) continue;
        const current = read(targetRoot, relative);
        if (owned.kind !== "file" || (current !== null && current !== owned.current)) problem("MODIFIED_OBSOLETE_ASSET", relative);
        plan.operations.push(makeOperation(relative, owned.kind, current, null, owned.current, null));
        delete plan.nextReceipt.assets[relative];
      }
    }
    // Rollback restores assets, never an old authorization model or a grant.
    if (plan.receipt?.activation && plan.nextReceipt) plan.nextReceipt.activation = structuredClone(plan.receipt.activation);
    if (action === "rollback" && plan.nextReceipt) {
      if (plan.receipt?.global_skills_migration) plan.nextReceipt.global_skills_migration = structuredClone(plan.receipt.global_skills_migration);
      else delete plan.nextReceipt.global_skills_migration;
    }
  } catch (error) {
    plan.conflicts.push({ code: error.code ?? "CODEX_ASSET_PLAN_FAILED", path: error.relativePath ?? "" });
  }
  plan.id = hash(stable({ action, root: scopeId(targetRoot), binding: plan.binding, receipt: plan.receipt, pending: plan.pending, operations: plan.operations, conflicts: plan.conflicts, nextReceipt: plan.nextReceipt, scope, installationContext: plan.installationContext, authorityIdentity: plan.authorityIdentity, authorizationBefore: plan.authorizationBefore, authorization: plan.authorization ?? null, hostMigration: plan.hostMigration ?? null }));
  return plan;
}
export function planCodexAssets(options = {}) { return publicPlan(buildPlan(options)); }
export function diagnoseCodexAssets(options = {}) {
  const plan = buildPlan({ ...options, action: "install" });
  const output = publicPlan(plan);
  let versionInfo = null;
  try { const config = jsonAt(plan.targetRoot, ".aidn/config.json") ?? {}; const version = packageBinding(plan.repoRoot).version; const base = inspectInstalledAidnVersion(config, version); const receiptVersion = plan.receipt?.installation?.version ?? null; versionInfo = { ...base, receipt_version: receiptVersion, receipt_drift: receiptVersion !== null && receiptVersion !== base.recorded_version }; } catch { /* plan error remains authoritative */ }
  return { ...output, ...(versionInfo ? { version_info: versionInfo } : {}), action: "diagnose", state: plan.pending ? "interrupted" : !output.ok ? "conflict" : !output.installed ? "not-installed" : output.operations.some((op) => op.effect !== "unchanged") ? "update-or-repair-available" : "installed", capabilities: { approved: "unknown", connected: "not-applicable", operational: "not-verified" } };
}
function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}
function acquireLock(root, action, lockRelative = LOCK) {
  const absolute = safePath(root, lockRelative);
  const recoveryRelative = lockRelative === LOCK ? `${STORE}/recovery-lock.json` : `${lockRelative}.recovery`;
  const recoveryPath = safePath(root, recoveryRelative);
  if (fs.existsSync(recoveryPath)) problem("INSTALL_RECOVERY_LOCKED", recoveryRelative);
  const existing = jsonAt(root, lockRelative);
  let recoveryDescriptor;
  let recoveryToken;
  try {
    if (existing) {
      if ((lockRelative === LOCK && !["resume", "rollback", "revoke"].includes(action)) || processExists(existing.pid)
        || existing.schema_version !== 1 || typeof existing.token !== "string" || !existing.token || existing.root_id !== scopeId(root)) problem("INSTALL_LOCKED", lockRelative);
      // Serialize stale-lock reclamation independently of the primary lock. Never
      // unlink a live replacement created by another concurrent resume process.
      recoveryToken = crypto.randomBytes(16).toString("hex");
      try { recoveryDescriptor = fs.openSync(recoveryPath, "wx", 0o600); }
      catch (error) { if (error.code === "EEXIST") problem("INSTALL_RECOVERY_LOCKED", recoveryRelative); throw error; }
      fs.writeFileSync(recoveryDescriptor, JSON.stringify({ pid: process.pid, token: recoveryToken }));
      fs.fsyncSync(recoveryDescriptor);
      const current = jsonAt(root, lockRelative);
      if (!same(existing, current) || processExists(current.pid)) problem("INSTALL_LOCKED", LOCK);
      fs.unlinkSync(absolute);
    }
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const token = crypto.randomBytes(16).toString("hex");
    let descriptor;
    try {
      descriptor = fs.openSync(absolute, "wx", 0o600);
      fs.writeFileSync(descriptor, JSON.stringify({ schema_version: 1, pid: process.pid, token, root_id: scopeId(root) }));
      fs.fsyncSync(descriptor);
    } catch (error) {
      if (error.code === "EEXIST") problem("INSTALL_LOCKED", LOCK);
      throw error;
    } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
    return () => { if (jsonAt(root, lockRelative)?.token === token) fs.unlinkSync(safePath(root, lockRelative)); };
  } finally {
    if (recoveryDescriptor !== undefined) {
      fs.closeSync(recoveryDescriptor);
      if (jsonAt(root, recoveryRelative)?.token === recoveryToken) fs.unlinkSync(safePath(root, recoveryRelative));
    }
  }
}
function validateHostMigration(migration) {
  if (!migration || !path.isAbsolute(migration.codex_home ?? "") || !Array.isArray(migration.operations)
    || migration.operations.length !== 1) problem("INVALID_HOST_MIGRATION");
  const home = safeRoot(migration.codex_home), op = migration.operations[0];
  if (op.path !== "config.toml" || op.kind !== "global-skills-config" || bytesHash(op.before) !== op.before_hash || bytesHash(op.after) !== op.after_hash) problem("INVALID_HOST_MIGRATION");
  if (![op.before, op.after].includes(read(home, "config.toml"))) problem("GLOBAL_SKILLS_POSTIMAGE_CHANGED");
  for (const candidate of migration.candidates ?? []) {
    if (!path.isAbsolute(candidate.path) || !candidate.path.startsWith(`${home}${path.sep}`)) problem("INVALID_HOST_SKILL_PATH");
    if (bytesHash(read(home, path.relative(home, candidate.path).replaceAll("\\", "/"))) !== candidate.sha256) problem("GLOBAL_SKILL_CHANGED_SINCE_PREVIEW");
  }
}
function* executeTransaction(options = {}) {
  const before = buildPlan(options);
  const output = publicPlan(before);
  if (options.dryRun !== false || !output.ok) return output;
  const expected = options.expectedPlanId ?? options.expectPlan;
  if (expected && expected !== before.id) return { ...output, ok: false, conflicts: [{ code: "STALE_INSTALL_PLAN", path: "" }], errors: ["STALE_INSTALL_PLAN"] };
  const changes = before.operations.filter((op) => op.before !== op.after);
  const receiptChanged = !same(before.nextReceipt, before.receipt) && before.nextReceipt !== null;
  const authorizationChanged = before.authorization && before.authorization.authorization.before !== before.authorization.authorization.after;
  const hostChanged = before.hostMigration?.operations.some((op) => op.before !== op.after);
  if (!changes.length && !receiptChanged && !authorizationChanged && !hostChanged && !before.pending && !before.lock) return { ...output, dry_run: false };
  // A lifecycle call is intentionally a no-op when no integration was ever installed.
  if (!changes.length && !before.receipt && !before.pending && !before.lock && ["resume", "rollback", "uninstall"].includes(before.action)) return { ...output, dry_run: false };
  let release;
  let releaseAuthorization;
  let releaseHost;
  let transaction;
  const written = [];
  const metadataWritten = [];
  let finalCommitDurable = false;
  try {
    releaseAuthorization = acquireAuthorizationLock({ targetRoot: before.targetRoot });
    if (before.hostMigration) releaseHost = acquireLock(safeRoot(before.hostMigration.codex_home), before.action, ".aidn-skills-migration.lock.json");
    release = acquireLock(before.targetRoot, before.action);
    const fresh = buildPlan(options, { ignoreLock: true });
    if (fresh.id !== before.id || fresh.conflicts.length) problem("STALE_INSTALL_PLAN");
    if (before.lock && !changes.length && !before.pending && ["resume", "rollback"].includes(before.action)) {
      return { ...output, dry_run: false, written: true, write_targets: [LOCK], recovered_lock: true };
    }
    const transactionId = before.resume?.id ?? crypto.randomBytes(16).toString("hex");
    // Keep pre-images private even if the process stops before root .gitignore is installed.
    if (read(before.targetRoot, PRIVATE_IGNORE) === null) {
      write(before.targetRoot, PRIVATE_IGNORE, encode("*\n"));
      metadataWritten.push(PRIVATE_IGNORE);
    }
    transaction = before.resume ?? {
      schema_version: 1, scope: before.scope, id: transactionId,
      root_id: scopeId(before.targetRoot), action: before.action, plan_id: before.id,
      status: "pending", operations: before.operations,
      receipt_before: before.receipt, receipt_after: before.nextReceipt,
      execution_package: before.binding ?? packageBinding(before.repoRoot),
      rollback_of: before.rollbackOf ?? null,
      authorization: before.authorization ?? null,
      host_migration: before.hostMigration ?? null,
      ...(before.scope === "installation" ? { installation_context: before.installationContext, external_status: "pending" } : {}),
    };
    writeJson(before.targetRoot, `${STORE}/transactions/${transactionId}.json`, sealed(transaction));
    metadataWritten.push(`${STORE}/transactions/${transactionId}.json`);
    if (["authorize", "revoke"].includes(before.action)) {
      applyAuthorization(transaction.authorization, { alreadyLocked: true });
      metadataWritten.push(transaction.authorization.authorization.path);
      transaction.status = "complete";
      if (before.action === "authorize") {
        const receipt = { ...before.nextReceipt, last_transaction: transactionId, last_action: before.action, last_scope: before.scope };
        transaction.receipt_after = receipt;
        writeJson(before.targetRoot, RECEIPT, sealed(receipt));
        metadataWritten.push(RECEIPT);
      }
      writeJson(before.targetRoot, `${STORE}/transactions/${transactionId}.json`, sealed(transaction));
      return { ...output, dry_run: false, written: true, write_targets: metadataWritten, transaction_id: transactionId };
    }
    writeJson(before.targetRoot, PENDING, { schema_version: 1, scope: before.scope, root_id: scopeId(before.targetRoot), id: transactionId });
    metadataWritten.push(PENDING);
    let applied = 0;
    let committedReceipt = null;
    if (options.failAfter === 0) problem("INJECTED_INSTALL_INTERRUPTION");
    for (const operation of transaction.operations) {
      if (operation.staged !== undefined && !["rollback", "uninstall"].includes(transaction.action)) {
        const current = read(before.targetRoot, operation.path);
        if (current === operation.before && current !== operation.staged) {
          write(before.targetRoot, operation.path, operation.staged); written.push(operation.path); applied += 1;
          if (options.failAfterStaging) problem("INJECTED_INSTALLATION_AFTER_STAGING");
        } else if (![operation.before, operation.staged, operation.after].includes(current)) problem("TRANSACTION_POSTIMAGE_CHANGED", operation.path);
      }
      if (operation.finalize && transaction.scope === "installation" && !["rollback", "uninstall"].includes(transaction.action) && transaction.external_status !== "complete") {
        yield { transaction, targetRoot: before.targetRoot, checkpoint: () => writeJson(before.targetRoot, `${STORE}/transactions/${transactionId}.json`, sealed(transaction)) };
        transaction.external_status = "complete";
        writeJson(before.targetRoot, `${STORE}/transactions/${transactionId}.json`, sealed(transaction));
      }
      if (operation.finalize && transaction.scope === "installation" && !["rollback", "uninstall"].includes(transaction.action)) {
        if (transaction.authorization) {
          applyAuthorization(transaction.authorization, { alreadyLocked: true });
          metadataWritten.push(transaction.authorization.authorization.path);
        }
        committedReceipt = { ...transaction.receipt_after, last_transaction: transactionId, last_action: transaction.action, last_scope: transaction.scope };
        committedReceipt.installation_last_transaction = transactionId;
        committedReceipt.installation_last_action = transaction.action;
        if (committedReceipt.installation) committedReceipt.installation = { ...committedReceipt.installation, last_transaction: transactionId };
        transaction.status = "complete"; transaction.receipt_after = committedReceipt;
        writeJson(before.targetRoot, RECEIPT, sealed(committedReceipt));
        writeJson(before.targetRoot, `${STORE}/transactions/${transactionId}.json`, sealed(transaction));
        finalCommitDurable = true;
        if (options.failBeforeVersion) problem("INJECTED_INSTALLATION_BEFORE_VERSION");
      }
      const current = read(before.targetRoot, operation.path);
      if (current === operation.after) continue;
      if (current !== operation.before && current !== operation.staged) problem("TRANSACTION_POSTIMAGE_CHANGED", operation.path);
      write(before.targetRoot, operation.path, operation.after);
      written.push(operation.path);
      applied += 1;
      if (operation.finalize && options.failAfterVersion) problem("INJECTED_INSTALLATION_AFTER_VERSION");
      if (!operation.finalize && Number.isInteger(options.failAfter) && applied >= options.failAfter) problem("INJECTED_INSTALL_INTERRUPTION");
    }
    const receipt = committedReceipt ?? { ...transaction.receipt_after, last_transaction: transactionId, last_action: transaction.action, last_scope: transaction.scope };
    if (transaction.scope === "installation") { receipt.installation_last_transaction = transactionId; receipt.installation_last_action = transaction.action; }
    if (!committedReceipt) {
      if (transaction.host_migration) {
        validateHostMigration(transaction.host_migration);
        const op = transaction.host_migration.operations[0];
        if (read(transaction.host_migration.codex_home, op.path) !== op.after) {
          write(transaction.host_migration.codex_home, op.path, op.after);
          written.push(path.join(transaction.host_migration.codex_home, op.path));
        }
        if (options.failAfterHostWrite) problem("INJECTED_HOST_MIGRATION_INTERRUPTION");
      }
      if (transaction.authorization) {
        applyAuthorization(transaction.authorization, { alreadyLocked: true });
        metadataWritten.push(transaction.authorization.authorization.path);
      }
      writeJson(before.targetRoot, RECEIPT, sealed(receipt));
      transaction.status = "complete";
      transaction.receipt_after = receipt;
      writeJson(before.targetRoot, `${STORE}/transactions/${transactionId}.json`, sealed(transaction));
    }
    write(before.targetRoot, PENDING, null);
    return { ...output, dry_run: false, installed: Object.keys(receipt.assets).length > 0, package_version: receipt.package?.version ?? null, written: written.length > 0 || receiptChanged, write_targets: [...written, ...metadataWritten, RECEIPT], transaction_id: transactionId, pending: null };
  } catch (error) {
    if (finalCommitDurable && transaction?.scope === "installation" && transaction.status === "complete" && transaction.operations.filter((op) => op.finalize).every((op) => read(before.targetRoot, op.path) === op.after)) {
      return { ...output, ok: true, dry_run: false, written: true, write_targets: [...written, ...metadataWritten, RECEIPT], pending: transaction.id, transaction_id: transaction.id, warnings: [...output.warnings, "Installation completed; resume is required to finish journal cleanup."], completion_status: "complete-cleanup-pending" };
    }
    return { ...output, ok: false, dry_run: false, written: written.length > 0 || metadataWritten.length > 0, write_targets: [...written, ...metadataWritten],
      pending: transaction?.id ?? before.pending?.id ?? null,
      conflicts: [{ code: error.code ?? "CODEX_ASSET_APPLY_FAILED", path: error.relativePath ?? "" }],
      errors: [`${error.code ?? "CODEX_ASSET_APPLY_FAILED"}${error.relativePath ? `: ${error.relativePath}` : ""}`] };
  } finally { if (release) release(); if (releaseHost) releaseHost(); if (releaseAuthorization) releaseAuthorization(); }
}

export function executeCodexAssets(options = {}) {
  if (options.scope === "installation") problem("ASYNC_INSTALLATION_EXECUTOR_REQUIRED");
  const iterator = executeTransaction(options);
  const step = iterator.next();
  if (!step.done) throw new Error("UNEXPECTED_ASYNC_INSTALLATION_STEP");
  return step.value;
}
export function planInstallationAssets(options) { return publicPlan(buildPlan({ ...options, scope: "installation" })); }
export async function executeInstallationAssets(options, beforeFinalize) {
  const iterator = executeTransaction({ ...options, scope: "installation" });
  let step = iterator.next();
  while (!step.done) {
    try { await beforeFinalize(step.value); step = iterator.next(); }
    catch (error) { step = iterator.throw(error); }
  }
  return step.value;
}
export function readInstallationContext({ targetRoot }) {
  const root = safeRoot(targetRoot), receipt = loadReceipt(root), pending = jsonAt(root, PENDING);
  if (pending) {
    const tx = loadTransaction(root, pending.id);
    return { receipt, context: tx.installation_context ?? null, scope: tx.scope, action: tx.action };
  }
  return { receipt, context: null, scope: null };
}
