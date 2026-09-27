import path from "node:path";
import { isExcludedAgentPath } from "./agent-local-path-policy.mjs";
import { buildCodexStartupArguments, CODEX_STARTUP_ENVIRONMENT_PROFILES } from "./codex-startup-arguments.mjs";

const FIELDS = ["state_root", "mcp_server_ids", "plugin_ids", "app_ids", "environment_override_names"];
const PERMISSION_FIELDS = ["contract_version", "profile_id", "cwd", "project_volume_root", "user_profile", "read_roots", "write_roots", "excluded_paths"];
const fail = code => { throw Object.assign(new Error(code), { code }); };
const ensure = (ok, code) => { if (!ok) fail(code); };
const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...fields].sort().join("|");
function data(value, depth = 0, seen = new Set()) {
  ensure(depth <= 6 && !seen.has(value), "MANAGED_STARTUP_DATA_INVALID");
  if (typeof value === "string") { ensure(value.isWellFormed(), "MANAGED_STARTUP_DATA_INVALID"); return; }
  ensure(value && typeof value === "object" && (Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value))), "MANAGED_STARTUP_DATA_INVALID");
  seen.add(value); const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) ensure(keys.length === value.length + 1 && value.length <= 256, "MANAGED_STARTUP_DATA_INVALID");
  for (const key of keys) {
    ensure(typeof key === "string", "MANAGED_STARTUP_DATA_INVALID");
    const field = Object.getOwnPropertyDescriptor(value, key);
    ensure(Object.hasOwn(field, "value"), "MANAGED_STARTUP_DATA_INVALID");
    if (Array.isArray(value) && key === "length") continue;
    ensure(field.enumerable && (!Array.isArray(value) || /^(0|[1-9][0-9]*)$/u.test(key) && Number(key) < value.length), "MANAGED_STARTUP_DATA_INVALID");
    data(field.value, depth + 1, seen);
  }
  seen.delete(value);
}
function flavor(value) {
  ensure(typeof value === "string" && value.length > 1 && value.length <= 4096 && value.isWellFormed()
    && value.normalize("NFC") === value && !/[\x00-\x1f\x7f]/u.test(value), "MANAGED_STARTUP_PATH_INVALID");
  if (/^[A-Za-z]:\\/u.test(value)) {
    ensure(path.win32.normalize(value) === value && !/[\\/]$/u.test(value)
      && value.slice(3).split("\\").every(part => part && !/[. ]$/u.test(part) && !/[<>:"/|?*]/u.test(part)
        && !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)), "MANAGED_STARTUP_PATH_INVALID");
    return path.win32;
  }
  ensure(value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    && path.posix.normalize(value) === value && !value.endsWith("/"), "MANAGED_STARTUP_PATH_INVALID");
  return path.posix;
}
function paths(startup) {
  data(startup); ensure(exact(startup, FIELDS) || exact(startup, [...FIELDS, "permission_scope"]), "MANAGED_STARTUP_INVALID");
  for (const key of FIELDS.slice(1)) ensure(Array.isArray(startup[key]), "MANAGED_STARTUP_INVALID");
  const system = flavor(startup.state_root);
  const selected = Object.freeze({ state_root: startup.state_root, log_dir: system.join(startup.state_root, "logs"), sqlite_home: system.join(startup.state_root, "sqlite") });
  // Reuse the startup policy's strict identifier/environment validation. This
  // builds values only; no probe, process, environment read, directory or clock.
  buildCodexStartupArguments({ mcp_server_ids: startup.mcp_server_ids, plugin_ids: startup.plugin_ids, app_ids: startup.app_ids,
    environment_override_names: startup.environment_override_names, environment_names: CODEX_STARTUP_ENVIRONMENT_PROFILES.managed,
    log_dir: selected.log_dir, sqlite_home: selected.sqlite_home });
  if (Object.hasOwn(startup, "permission_scope")) permissionScope(startup);
  return selected;
}
const windowsInside = (root, child) => {
  const relative = path.win32.relative(root.toLowerCase(), child.toLowerCase());
  return !relative || relative !== ".." && !relative.startsWith("..\\") && !path.win32.isAbsolute(relative);
};
function permissionScope(startup) {
  const scope = startup.permission_scope;
  ensure(exact(scope, PERMISSION_FIELDS) && scope.contract_version === "codex-managed-setup-permission-scope.v1"
    && scope.profile_id === "aidn-managed-setup", "MANAGED_STARTUP_PERMISSION_INVALID");
  ensure([scope.cwd, scope.user_profile, startup.state_root].every(value => flavor(value) === path.win32), "MANAGED_STARTUP_PERMISSION_PATH_INVALID");
  ensure(/^[A-Z]:\\$/u.test(scope.project_volume_root) && path.win32.parse(scope.cwd).root.toUpperCase() === scope.project_volume_root
    && scope.project_volume_root !== "C:\\" && scope.project_volume_root !== path.win32.parse(scope.user_profile).root.toUpperCase(), "MANAGED_STARTUP_PERMISSION_VOLUME_INVALID");
  ensure(Array.isArray(scope.read_roots) && scope.read_roots.length <= 64 && Array.isArray(scope.write_roots)
    && scope.write_roots.length === 1 && scope.write_roots[0] === scope.cwd
    && Array.isArray(scope.excluded_paths) && scope.excluded_paths.length > 0 && scope.excluded_paths.length <= 32,
  "MANAGED_STARTUP_PERMISSION_ROOTS_INVALID");
  for (const roots of [scope.read_roots, scope.write_roots, scope.excluded_paths]) {
    ensure(roots.every(value => flavor(value) === path.win32) && new Set(roots.map(value => value.toLowerCase())).size === roots.length,
      "MANAGED_STARTUP_PERMISSION_ROOTS_INVALID");
  }
  ensure(!scope.read_roots.some(value => value.toLowerCase() === scope.cwd.toLowerCase()), "MANAGED_STARTUP_PERMISSION_ROOTS_INVALID");
  // AIDN exclusion only: no deny ACE is requested on these paths. The official
  // WRITE_RESTRICTED token does not prove an independent OS read prohibition.
  ensure(scope.excluded_paths.some(value => value.toLowerCase() === path.win32.join(scope.user_profile, "OneDrive").toLowerCase()),
    "MANAGED_STARTUP_PERMISSION_EXCLUSION_REQUIRED");
  for (const root of [scope.cwd, startup.state_root, ...scope.read_roots]) {
    ensure(!windowsInside(root, scope.user_profile) && !isExcludedAgentPath(root) && !root.includes("~")
      && !scope.excluded_paths.some(excluded => windowsInside(root, excluded) || windowsInside(excluded, root)),
    "MANAGED_STARTUP_PERMISSION_EXCLUDED_PATH");
  }
  ensure(!scope.excluded_paths.some(excluded => windowsInside(scope.project_volume_root, excluded)), "MANAGED_STARTUP_PERMISSION_EXCLUDED_VOLUME");
  return scope;
}
function overlap(a, b) {
  const system = flavor(a); if (system !== flavor(b)) return false;
  const left = system === path.win32 ? a.toLowerCase() : a, right = system === path.win32 ? b.toLowerCase() : b;
  const inside = (root, child) => { const relative = system.relative(root, child); return !relative || relative !== ".." && !relative.startsWith(".." + system.sep) && !system.isAbsolute(relative); };
  return inside(left, right) || inside(right, left);
}
/** Closed startup values shared by metadata observation and setup. Context, when
 * supplied, is complete and enforces disjoint roots in both directions. These
 * lexical checks never establish physical isolation or create directories. */
export function assertManagedSetupStartup(startup, context) {
  paths(startup);
  if (context !== undefined) {
    data(context); ensure(exact(context, ["cwd", "profile_root", "candidate_root"]), "MANAGED_STARTUP_CONTEXT_INVALID");
    for (const root of Object.values(context)) ensure(!overlap(startup.state_root, root), "MANAGED_STARTUP_ROOT_OVERLAP");
    if (Object.hasOwn(startup, "permission_scope")) {
      const scope = permissionScope(startup);
      ensure(scope.cwd === context.cwd, "MANAGED_STARTUP_PERMISSION_CWD_MISMATCH");
      for (const root of Object.values(context)) ensure(flavor(root) === path.win32
        && !windowsInside(root, scope.user_profile) && !isExcludedAgentPath(root) && !root.includes("~")
        && !scope.excluded_paths.some(excluded => windowsInside(root, excluded) || windowsInside(excluded, root)),
      "MANAGED_STARTUP_PERMISSION_EXCLUDED_PATH");
    }
  }
  return true;
}
export function buildManagedSetupStartupPaths(startup) { return paths(startup); }

/** Source settings for setup only. No implicit builtin profile, inheritance,
 * symbolic :root, filesystem glob, deny entry, or persistent configuration edit.
 * Upstream 0d9c7cbf config/permissions.rs:376-443,542-553; setup.rs:616-642. */
export function buildManagedSetupPermissionSettings(startup) {
  paths(startup);
  if (!Object.hasOwn(startup, "permission_scope")) return null;
  const scope = permissionScope(startup);
  return { default_permissions: scope.profile_id, permissions: { [scope.profile_id]: {
    workspace_roots: { [scope.cwd]: true },
    filesystem: Object.fromEntries([[scope.project_volume_root, "read"], ...scope.read_roots.map(root => [root, "read"]), [scope.cwd, "write"]]),
    network: { enabled: false },
  } } };
}
