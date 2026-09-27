import { posix, win32 } from "node:path";

const HOST_NAMES = Object.freeze([
  "SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA",
  "CODEX_HOME", "TEMP", "TMP",
]);
export const CODEX_STARTUP_ENVIRONMENT_PROFILES = Object.freeze({
  managed: HOST_NAMES,
  worker: Object.freeze([...HOST_NAMES, "AIDN_AGENT_ADMISSION_ENDPOINT", "AIDN_AGENT_ADMISSION_TOKEN", "AIDN_AGENT_ATTEMPT_ID", "AIDN_AGENT_REQUEST_SHA256"]),
});
const FIELDS = ["mcp_server_ids", "plugin_ids", "app_ids", "environment_override_names", "environment_names", "log_dir", "sqlite_home"];
const RESERVED = new Set(CODEX_STARTUP_ENVIRONMENT_PROFILES.worker);
const fail = code => { throw Object.assign(new Error(`CODEX_STARTUP_${code}`), { code: `CODEX_STARTUP_${code}` }); };
const ensure = (condition, code) => { if (!condition) fail(code); };

function dataObject(value) {
  ensure(value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)), "CONFIGURATION_INVALID");
  const keys = Reflect.ownKeys(value);
  ensure(keys.length === FIELDS.length && keys.every(key => typeof key === "string" && FIELDS.includes(key)), "CONFIGURATION_INVALID");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    ensure(Object.hasOwn(descriptor, "value") && descriptor.enumerable, "CONFIGURATION_INVALID");
  }
}
function dataArray(value, maximum) {
  ensure(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= maximum, "ARRAY_INVALID");
  const keys = Reflect.ownKeys(value);
  ensure(keys.length === value.length + 1, "ARRAY_INVALID");
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    ensure(descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable, "ARRAY_INVALID");
  }
}
function identifiers(value) {
  dataArray(value, 128);
  ensure(value.every(id => typeof id === "string" && id.length > 0 && id.length <= 256 && !/[\x00-\x1f\x7f]/u.test(id))
    && new Set(value).size === value.length, "IDENTIFIERS_INVALID");
}
function absolute(value) {
  // Syntax only: callers retain physical identity, ownership and overlap checks.
  // 8192 also covers the historical 4096-character state root plus attempt SHA.
  return typeof value === "string" && value.length > 0 && value.length <= 8192 && !/[\x00-\x1f\x7f]/u.test(value)
    && (/^[A-Za-z]:\\/u.test(value) ? win32.isAbsolute(value) && win32.normalize(value) === value
      : value.startsWith("/") && posix.isAbsolute(value) && posix.normalize(value) === value);
}

/** Pure closed startup settings; no policy admission, hook changes or probing. */
export function assertCodexStartupArgumentsConfiguration(configuration) {
  dataObject(configuration);
  for (const field of ["mcp_server_ids", "plugin_ids", "app_ids"]) identifiers(configuration[field]);
  const names = configuration.environment_names;
  dataArray(names, 16);
  ensure(Object.values(CODEX_STARTUP_ENVIRONMENT_PROFILES).some(profile => names.length === profile.length
    && names.every((name, index) => name === profile[index])), "ENVIRONMENT_PROFILE_INVALID");
  const overrides = configuration.environment_override_names;
  dataArray(overrides, 128);
  ensure(overrides.every(name => typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,255}$/u.test(name)
    && !RESERVED.has(name.toUpperCase())) && new Set(overrides.map(name => name.toUpperCase())).size === overrides.length,
  "ENVIRONMENT_OVERRIDE_INVALID");
  ensure(absolute(configuration.log_dir) && absolute(configuration.sqlite_home), "PATH_INVALID");
  return true;
}

// Inline tables preserve dotted identifiers as one TOML key. An empty table
// merges with inherited configuration; callers must supply every observed ID.
const disabledTable = names => `{${[...new Set(names)].sort().map(name => `${JSON.stringify(name)}={enabled=false}`).join(",")}}`;
export function buildCodexStartupArguments(configuration) {
  assertCodexStartupArgumentsConfiguration(configuration);
  const settings = [
    `mcp_servers=${disabledTable(configuration.mcp_server_ids)}`,
    `plugins=${disabledTable(configuration.plugin_ids)}`,
    `apps=${disabledTable(["_default", ...configuration.app_ids])}`,
    "features.plugins=false", "features.apps=false", "notify=[]",
    'model_provider="openai"', 'history.persistence="none"',
    "memories.generate_memories=false", "memories.use_memories=false", "features.memories=false",
    'developer_instructions=""', 'instructions=""',
    `shell_environment_policy.set={${[...configuration.environment_override_names].sort().map(name => `${JSON.stringify(name)}=""`).join(",")}}`,
    'shell_environment_policy.inherit="all"', "shell_environment_policy.ignore_default_excludes=true",
    `shell_environment_policy.filters={${configuration.environment_names.map(name => `${JSON.stringify(name)}="include"`).join(",")}}`,
    `log_dir=${JSON.stringify(configuration.log_dir)}`, `sqlite_home=${JSON.stringify(configuration.sqlite_home)}`,
  ];
  // Model, effort, sandbox, agents and service controls belong to their wrapper.
  return settings.flatMap(setting => ["-c", setting]);
}
