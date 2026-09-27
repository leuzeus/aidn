import path from "node:path";
import { fingerprintAgentExecutionValue as hash } from "./agent-execution-contracts.mjs";
import { assertManagedSetupStartup, buildManagedSetupStartupPaths } from "./codex-managed-startup.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from "./codex-startup-arguments.mjs";
import { getManagedSandboxOperationPolicy } from "./codex-managed-sandbox-operation-policy.mjs";

// The pinned protocol exposes merged source TOML and layers, NOT the compiled
// PermissionProfile. Physical source observations and process provenance belong
// to the caller; neither is established by this pure structural assessment.
const INPUT = ["metadata", "startup", "cwd", "profile_root", "candidate_root", "client_sha256", "source_files"];
const HASH = /^[a-f0-9]{64}$/u;
const fail = code => { const reason = "MANAGED_CONFIGURATION_" + code; throw Object.assign(new Error(reason), { code: reason }); };
const ensure = (ok, code) => { if (!ok) fail(code); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const same = (a, b) => hash(a) === hash(b);
const digest = value => typeof value === "string" && HASH.test(value);
const text = value => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/u.test(value);
function json(value) {
  let count = 0; const seen = new Set();
  function visit(row, depth) {
    ensure(++count <= 65536 && depth <= 24, "JSON_LIMIT");
    if (row === null || typeof row === "boolean" || typeof row === "number" && Number.isFinite(row)) return;
    if (typeof row === "string") { ensure(row.isWellFormed() && row.length <= 2097152, "JSON_INVALID"); return; }
    ensure(row && typeof row === "object" && [Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(row))
      && (Array.isArray(row) || Object.getPrototypeOf(row) !== Array.prototype) && !seen.has(row), "JSON_INVALID");
    seen.add(row); const keys = Reflect.ownKeys(row);
    if (Array.isArray(row)) ensure(keys.length === row.length + 1 && row.length <= 65536, "JSON_INVALID");
    for (const key of keys) {
      ensure(typeof key === "string" && key.isWellFormed(), "JSON_INVALID");
      const descriptor = Object.getOwnPropertyDescriptor(row, key);
      ensure(Object.hasOwn(descriptor, "value"), "JSON_INVALID");
      if (Array.isArray(row) && key === "length") continue;
      ensure(descriptor.enumerable && (!Array.isArray(row) || /^(0|[1-9][0-9]*)$/u.test(key) && Number(key) < row.length), "JSON_INVALID");
      visit(descriptor.value, depth + 1);
    }
    seen.delete(row);
  }
  visit(value, 0);
  ensure(Buffer.byteLength(JSON.stringify(value), "utf8") <= 2097152, "JSON_LIMIT");
}
function absolute(value) {
  ensure(typeof value === "string" && value.length > 1 && value.length <= 4096 && value.normalize("NFC") === value
    && !/[\x00-\x1f\x7f]/u.test(value), "SOURCE_PATH_INVALID");
  if (/^[A-Za-z]:\\/u.test(value)) {
    ensure(path.win32.normalize(value) === value && !value.endsWith("\\") && value.slice(3).split("\\").every(part => part
      && !/[<>:"/|?*]|[. ]$/u.test(part) && !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)), "SOURCE_PATH_INVALID");
    return path.win32;
  }
  ensure(value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !value.endsWith("/")
    && path.posix.normalize(value) === value, "SOURCE_PATH_INVALID");
  return path.posix;
}
const pathKey = value => absolute(value) === path.win32 ? value.toLowerCase() : value;
function sourcePath(name) {
  ensure(object(name) && typeof name.type === "string", "LAYER_SOURCE_INVALID");
  if (name.type === "sessionFlags") { ensure(exact(name, ["type"]), "LAYER_SOURCE_INVALID"); return null; }
  if (name.type === "project") {
    ensure(exact(name, ["type", "dotCodexFolder"]), "LAYER_SOURCE_INVALID");
    return absolute(name.dotCodexFolder).join(name.dotCodexFolder, "config.toml");
  }
  if (name.type === "user") {
    ensure(exact(name, ["type", "file", "profile"]), "LAYER_SOURCE_INVALID");
    ensure(name.profile === null, "PROFILE_SELECTION_UNSUPPORTED");
  } else {
    ensure(["packagedDefaults", "system", "legacyManagedConfigTomlFromFile"].includes(name.type), "LAYER_SOURCE_UNSUPPORTED");
    ensure(exact(name, ["type", "file"]), "LAYER_SOURCE_INVALID");
  }
  absolute(name.file); return name.file;
}
function noPermissionSelection(config) {
  ensure(object(config), "CONFIG_INVALID");
  ensure(config.permissions == null && config.default_permissions == null, "NAMED_PERMISSIONS_UNSUPPORTED");
  ensure(config.profile == null && config.default_profile == null, "PROFILE_SELECTION_UNSUPPORTED");
  // Profile definitions are not selection. Their raw data remain opaque and
  // hashed; a selected v2 profile is rejected by the source name above.
}
function settings(startup) {
  const paths = buildManagedSetupStartupPaths(startup);
  const disabled = ids => Object.fromEntries([...new Set(ids)].sort().map(id => [id, { enabled: false }]));
  return {
    sandbox_mode: "workspace-write", windows: { sandbox: "elevated" }, approval_policy: "never",
    features: { windows_sandbox_service: false, plugins: false, apps: false, memories: false },
    sandbox_workspace_write: { writable_roots: [], network_access: false, exclude_tmpdir_env_var: true, exclude_slash_tmp: true },
    agents: { enabled: false }, mcp_servers: disabled(startup.mcp_server_ids), plugins: disabled(startup.plugin_ids), apps: disabled(["_default", ...startup.app_ids]),
    notify: [], model_provider: "openai", history: { persistence: "none" }, memories: { generate_memories: false, use_memories: false },
    developer_instructions: "", instructions: "",
    shell_environment_policy: { set: Object.fromEntries([...startup.environment_override_names].sort().map(name => [name, ""])), inherit: "all",
      ignore_default_excludes: true, filters: Object.fromEntries(CODEX_STARTUP_ENVIRONMENT_PROFILES.managed.map(name => [name, "include"])) },
    log_dir: paths.log_dir, sqlite_home: paths.sqlite_home,
  };
}
function checkSettings(config, expected, session) {
  noPermissionSelection(config);
  if (session) { ensure(same(config, expected), "SESSION_SETTINGS_MISMATCH"); return; }
  for (const name of ["mcp_servers", "plugins", "apps"]) {
    const rows = config[name];
    ensure(object(rows) && same(Object.keys(rows).sort(), Object.keys(expected[name]).sort())
      && Object.values(rows).every(row => object(row) && row.enabled === false), "INTEGRATION_MISMATCH");
  }
  for (const name of ["sandbox_mode", "approval_policy", "model_provider", "developer_instructions", "instructions", "log_dir", "sqlite_home", "notify"])
    ensure(Object.hasOwn(config, name) && same(config[name], expected[name]), "SETTINGS_MISMATCH");
  ensure(config.windows?.sandbox === "elevated" && config.agents?.enabled === false
    && object(config.features) && Object.entries(expected.features).every(([key, value]) => config.features[key] === value)
    && config.history?.persistence === "none" && config.memories?.generate_memories === false && config.memories?.use_memories === false,
  "SETTINGS_MISMATCH");
  ensure(exact(config.sandbox_workspace_write, Object.keys(expected.sandbox_workspace_write))
    && same(config.sandbox_workspace_write, expected.sandbox_workspace_write), "SANDBOX_SETTINGS_MISMATCH");
  ensure(config.model_providers == null || object(config.model_providers), "PROVIDER_OVERRIDE_UNSUPPORTED");
  ensure(config.model_providers?.openai == null && config.openai_base_url == null && config.auth_command == null, "PROVIDER_OVERRIDE_UNSUPPORTED");
  const environment = config.shell_environment_policy;
  // Upstream 0d9c7cbf config/src/shell_environment_policy.rs:13-37 serializes the
  // absent Option<bool> as null in merged ConfigToml, unlike raw session flags.
  ensure(object(environment) && Object.keys(environment).every(key => [...Object.keys(expected.shell_environment_policy), "include_only", "exclude", "experimental_use_profile"].includes(key))
    && Object.entries(expected.shell_environment_policy).every(([key, value]) => Object.hasOwn(environment, key) && same(environment[key], value))
    && (!Object.hasOwn(environment, "experimental_use_profile") || environment.experimental_use_profile === null)
    && [environment.include_only, environment.exclude].every(value => value == null || Array.isArray(value) && value.length === 0), "ENVIRONMENT_SETTINGS_MISMATCH");
}

/** Hash-only source assessment. Not a PermissionProfile, prerequisites receipt,
 * hook admission, execution authorization, native qualification or host probe. */
export function assessManagedSetupConfiguration(input) {
  json(input); ensure(exact(input, INPUT), "INPUT_INVALID");
  const { metadata, startup, cwd, profile_root, candidate_root, client_sha256, source_files } = input;
  ensure(client_sha256 === getManagedSandboxOperationPolicy().client_sha256, "CLIENT_MISMATCH");
  try { assertManagedSetupStartup(startup, { cwd, profile_root, candidate_root }); }
  catch { fail("STARTUP_INVALID"); }
  ensure(exact(metadata, ["configs", "requirements", "hooks", "readiness", "process"]), "METADATA_INVALID");
  ensure(exact(metadata.requirements, ["requirements"]) && metadata.requirements.requirements === null, "REQUIREMENTS_UNSUPPORTED");
  // These envelopes contribute to the digest only. Their claims never grant a
  // capability or substitute for the controller's independent tree proof.
  ensure(object(metadata.hooks) && object(metadata.readiness) && object(metadata.process), "METADATA_INVALID");
  ensure(Array.isArray(metadata.configs) && metadata.configs.length === 1, "CONFIG_COUNT_INVALID");
  const response = metadata.configs[0];
  ensure(exact(response, ["config", "origins", "layers"]) && object(response.origins), "CONFIG_RESPONSE_INVALID");
  ensure(Array.isArray(response.layers) && response.layers.length > 0 && response.layers.length <= 64, "LAYERS_INVALID");
  ensure(Array.isArray(source_files) && source_files.length <= 128, "SOURCE_FILES_INVALID");
  const sources = new Map();
  for (const row of source_files) {
    ensure(exact(row, ["path", "sha256"]) && (row.sha256 === null || digest(row.sha256)), "SOURCE_FILES_INVALID");
    const key = pathKey(row.path); ensure(!sources.has(key), "SOURCE_DUPLICATE"); sources.set(key, row);
  }
  const expected = settings(startup), identities = new Set(); let session = null;
  for (const layer of response.layers) {
    // Pinned protocol config.rs:329-334 uses skip_serializing_if=Option::is_none.
    // Absence and explicit null are accepted; no other value disables this guard.
    ensure((exact(layer, ["name", "version", "config"]) || exact(layer, ["name", "version", "config", "disabledReason"]))
      && text(layer.version), "LAYER_INVALID");
    ensure(!Object.hasOwn(layer, "disabledReason") || layer.disabledReason === null, "LAYER_DISABLED");
    noPermissionSelection(layer.config);
    const file = sourcePath(layer.name), identity = file === null ? "sessionFlags" : pathKey(file);
    ensure(!identities.has(identity), "LAYER_DUPLICATE"); identities.add(identity);
    if (file === null) { session = layer; checkSettings(layer.config, expected, true); }
    else { ensure(sources.has(identity), "SOURCE_UNOBSERVED");
      ensure(sources.get(identity).sha256 !== null || Object.keys(layer.config).length === 0, "ABSENT_SOURCE_HAS_CONTENT"); }
  }
  ensure(session !== null, "SESSION_FLAGS_REQUIRED");
  // Additional observed paths are fingerprinted, never promoted to authority.
  const controlledPaths = [];
  const leaves = (value, prefix = "") => { for (const [key, row] of Object.entries(value)) {
    const field = prefix ? prefix + "." + key : key;
    if (object(row) && Object.keys(row).length) leaves(row, field); else controlledPaths.push(field);
  } };
  leaves(expected);
  ensure(Object.keys(response.origins).length <= 4096, "ORIGINS_INVALID");
  for (const [key, origin] of Object.entries(response.origins)) {
    ensure(key.length > 0 && key.length <= 4096 && !/[\x00-\x1f\x7f]/u.test(key)
      && exact(origin, ["name", "version"]) && text(origin.version), "ORIGINS_INVALID");
    sourcePath(origin.name);
    ensure(response.layers.some(layer => same(layer.name, origin.name) && layer.version === origin.version), "ORIGIN_UNBOUND");
    if (controlledPaths.some(field => field === key || field.startsWith(key + ".")))
      ensure(same(origin.name, session.name) && origin.version === session.version, "CONTROL_ORIGIN_MISMATCH");
  }
  checkSettings(response.config, expected, false);
  return Object.freeze({ contract_version: "codex-managed-configuration-assessment.v1", status: "SOURCE_CONFIGURATION_VERIFIED",
    permission_scope: "PERMISSION_SCOPE_UNRESOLVED", authority: "STRUCTURAL_NOT_AUTHENTICATED", native: false, execution_available: false,
    authorization: "NOT_AUTHORIZED", qualification: "NOT_RUN", client_sha256,
    context_sha256: hash({ cwd, profile_root, candidate_root }), startup_sha256: hash(startup),
    metadata_sha256: hash(metadata), configuration_sha256: hash(response.config), session_flags_sha256: hash(session.config),
    layers_sha256: hash(response.layers), sources_sha256: hash([...sources.values()].sort((a, b) => pathKey(a.path) < pathKey(b.path) ? -1 : pathKey(a.path) > pathKey(b.path) ? 1 : 0)),
    requirements_sha256: hash(metadata.requirements), origins_sha256: hash(response.origins) });
}
