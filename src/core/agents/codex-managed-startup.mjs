import path from "node:path";
import { buildCodexStartupArguments, CODEX_STARTUP_ENVIRONMENT_PROFILES } from "./codex-startup-arguments.mjs";

const FIELDS = ["state_root", "mcp_server_ids", "plugin_ids", "app_ids", "environment_override_names"];
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
  data(startup); ensure(exact(startup, FIELDS), "MANAGED_STARTUP_INVALID");
  for (const key of FIELDS.slice(1)) ensure(Array.isArray(startup[key]), "MANAGED_STARTUP_INVALID");
  const system = flavor(startup.state_root);
  const selected = Object.freeze({ state_root: startup.state_root, log_dir: system.join(startup.state_root, "logs"), sqlite_home: system.join(startup.state_root, "sqlite") });
  // Reuse the startup policy's strict identifier/environment validation. This
  // builds values only; no probe, process, environment read, directory or clock.
  buildCodexStartupArguments({ mcp_server_ids: startup.mcp_server_ids, plugin_ids: startup.plugin_ids, app_ids: startup.app_ids,
    environment_override_names: startup.environment_override_names, environment_names: CODEX_STARTUP_ENVIRONMENT_PROFILES.managed,
    log_dir: selected.log_dir, sqlite_home: selected.sqlite_home });
  return selected;
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
  }
  return true;
}
export function buildManagedSetupStartupPaths(startup) { return paths(startup); }
