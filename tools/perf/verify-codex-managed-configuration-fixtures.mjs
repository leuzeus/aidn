import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { assessManagedSetupConfiguration as assess } from "../../src/core/agents/codex-managed-configuration.mjs";
import { getManagedSandboxOperationPolicy } from "../../src/core/agents/codex-managed-sandbox-operation-policy.mjs";
import { fingerprintAgentExecutionValue as hash } from "../../src/core/agents/agent-execution-contracts.mjs";
import { buildManagedSetupArguments } from "../../src/adapters/agents/codex-managed-setup-transport.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from "../../src/core/agents/codex-startup-arguments.mjs";

const checks = [], H = "a".repeat(64), copy = value => structuredClone(value);
async function check(name, action) { try { await action(); checks.push({ name, status: "PASS" }); }
  catch (error) { checks.push({ name, status: "FAIL", detail: String(error.stack ?? error).slice(0, 1800) }); } }
function settings(startup) {
  const disabled = ids => Object.fromEntries([...new Set(ids)].sort().map(id => [id, { enabled: false }]));
  return { sandbox_mode: "workspace-write", windows: { sandbox: "elevated" }, approval_policy: "never",
    sandbox_workspace_write: { writable_roots: [], network_access: false, exclude_tmpdir_env_var: true, exclude_slash_tmp: true },
    features: { windows_sandbox_service: false, plugins: false, apps: false, memories: false }, agents: { enabled: false },
    mcp_servers: disabled(startup.mcp_server_ids), plugins: disabled(startup.plugin_ids), apps: disabled(["_default", ...startup.app_ids]),
    notify: [], model_provider: "openai", history: { persistence: "none" }, memories: { generate_memories: false, use_memories: false },
    instructions: "", developer_instructions: "", shell_environment_policy: { set: Object.fromEntries(startup.environment_override_names.map(name => [name, ""])),
      inherit: "all", ignore_default_excludes: true, filters: Object.fromEntries(CODEX_STARTUP_ENVIRONMENT_PROFILES.managed.map(name => [name, "include"])) },
    log_dir: startup.state_root + "/logs", sqlite_home: startup.state_root + "/sqlite" };
}
function fixture() {
  const startup = { state_root: "/fixture/state", mcp_server_ids: ["fixture.mcp"], plugin_ids: ["fixture.plugin"], app_ids: ["fixture.app"], environment_override_names: ["FIXTURE_KEY"] };
  const config = settings(startup), session = { name: { type: "sessionFlags" }, version: "opaque.session", config: copy(config), disabledReason: null };
  const user = { name: { type: "user", file: "/fixture/profile/config.toml", profile: null }, version: "opaque.user", config: { model: "fixture-model" }, disabledReason: null };
  return { metadata: { configs: [{ config, origins: { sandbox_mode: { name: copy(session.name), version: session.version } }, layers: [user, session] }],
    requirements: { requirements: null }, hooks: { data: [] }, readiness: { status: "notConfigured" },
    process: { closed: true, pid_absent: true, exit_code: 0, signal: null, response_count: 5, budget_ms: 10000 } },
    startup, cwd: "/fixture/workspace", profile_root: "/fixture/profile", candidate_root: "/fixture/candidate",
    client_sha256: getManagedSandboxOperationPolicy().client_sha256, source_files: [{ path: user.name.file, sha256: H }] };
}
const response = f => f.metadata.configs[0], session = f => response(f).layers.find(row => row.name.type === "sessionFlags");
const reject = (mutate, code) => { const f = fixture(); mutate(f); assert.throws(() => assess(f), error => error.code === "MANAGED_CONFIGURATION_" + code); };
await check("valid pinned source projection remains permission-unresolved and non-executing", () => {
  const f = fixture(), result = assess(f);
  assert.equal(result.status, "SOURCE_CONFIGURATION_VERIFIED"); assert.equal(result.permission_scope, "PERMISSION_SCOPE_UNRESOLVED");
  assert.equal(result.authority, "STRUCTURAL_NOT_AUTHENTICATED"); assert.equal(result.native, false); assert.equal(result.execution_available, false);
  assert.equal(result.authorization, "NOT_AUTHORIZED"); assert.equal(result.qualification, "NOT_RUN");
  assert.equal(result.configuration_sha256, hash(response(f).config)); assert.equal(result.session_flags_sha256, hash(session(f).config));
  assert(Object.isFrozen(result));
});
await check("merged model/effort may be absent or independently selected without adding setup flags", () => {
  const f = fixture(); assess(f); response(f).config.model = "arbitrary-fixture-model"; response(f).config.model_reasoning_effort = "ultra"; assess(f);
  assert(!buildManagedSetupArguments(f.startup).some(arg => /^(model|model_reasoning_effort)=/u.test(arg)));
});
await check("all actual setup -c settings have matching semantic values in the accepted session", () => {
  const f = fixture(), settings = session(f).config, args = buildManagedSetupArguments(f.startup), projected = {};
  function toml(value) {
    if (!value.startsWith("{")) return JSON.parse(value);
    const result = {}, matches = [...value.slice(1, -1).matchAll(/("(?:[^"\\]|\\.)*")=(\{enabled=false\}|"(?:[^"\\]|\\.)*")(?:,|$)/gu)];
    assert.equal(matches.map(match => match[0]).join(""), value.slice(1, -1));
    for (const match of matches) result[JSON.parse(match[1])] = match[2] === "{enabled=false}" ? { enabled: false } : JSON.parse(match[2]);
    return result;
  }
  for (let i = 0; i < args.length - 3; i += 2) {
    assert.equal(args[i], "-c"); const [name, ...parts] = args[i + 1].split("="), expected = toml(parts.join("=")), keys = name.split(".");
    let actual = settings, target = projected;
    for (const key of keys.slice(0, -1)) { actual = actual[key]; target = target[key] ??= {}; }
    assert.deepEqual(actual[keys.at(-1)], expected, name); target[keys.at(-1)] = expected;
  }
  assert.deepEqual(projected, settings); assert.deepEqual(args.slice(-3), ["app-server", "--listen", "stdio://"]); assess(f);
});
await check("case-preserving Windows source identities and spaces are accepted", () => {
  const f = fixture(); f.cwd = "C:\\Fixture team\\workspace"; f.profile_root = "C:\\Fixture team\\profile"; f.candidate_root = "C:\\Fixture team\\candidate";
  f.startup.state_root = "D:\\Fixture state"; f.source_files[0].path = "C:\\Fixture team\\profile\\config.toml";
  response(f).layers[0].name.file = "c:\\Fixture team\\profile\\config.toml";
  for (const config of [response(f).config, session(f).config]) { config.log_dir = f.startup.state_root + "\\logs"; config.sqlite_home = f.startup.state_root + "\\sqlite"; }
  assess(f);
});
await check("empty layer backed by explicitly observed absence is accepted", () => {
  const f = fixture(); response(f).layers.unshift({ name: { type: "system", file: "/fixture/system/config.toml" }, version: "absent", config: {}, disabledReason: null });
  f.source_files.push({ path: "/fixture/system/config.toml", sha256: null }); assess(f);
});
await check("physically observed project/package/legacy source variants bind exact files", () => {
  const f = fixture(); for (const type of ["packagedDefaults", "project", "legacyManagedConfigTomlFromFile"]) {
    const directory = "/fixture/" + type; const name = type === "project" ? { type, dotCodexFolder: directory } : { type, file: directory + "/config.toml" };
    response(f).layers.unshift({ name, version: type, config: {}, disabledReason: null }); f.source_files.push({ path: directory + "/config.toml", sha256: H });
  } assess(f);
});
await check("additional source observations are fingerprinted without becoming configuration", () => {
  const f = fixture(), old = assess(f); f.source_files.push({ path: "/fixture/unused/config.toml", sha256: null });
  const result = assess(f); assert.notEqual(old.sources_sha256, result.sources_sha256); assert.equal(old.configuration_sha256, result.configuration_sha256);
});
await check("source list ordering does not change its canonical digest", () => {
  const f = fixture(); f.source_files.push({ path: "/fixture/unused/config.toml", sha256: H }); const a = assess(f); f.source_files.reverse(); assert.equal(assess(f).sources_sha256, a.sources_sha256);
});
await check("raw opaque source data and disabled integration commands never escape the hash-only result", () => {
  const f = fixture(), secret = "FAKE_SECRET_NEVER_EXPOSE"; response(f).config.plugins["fixture.plugin"].private = secret;
  response(f).layers[0].config.private_config = secret; response(f).config.opaque_additional_toml = { content: secret };
  const result = JSON.stringify(assess(f)); assert(!result.includes(secret)); assert(!result.includes("/fixture"));
});
await check("unknown termination and hooks never imply source assessment grants native authority", () => {
  const f = fixture(); f.metadata.process = { tree_termination: { termination_state: "unknown" } }; f.metadata.hooks = { data: [{ untrusted: true }] };
  const result = assess(f); assert.equal(result.native, false); assert.equal(result.execution_available, false); assert.equal(result.permission_scope, "PERMISSION_SCOPE_UNRESOLVED");
});
await check("inputs are immutable and output hashes bind material differences", () => {
  const f = fixture(), before = copy(f), a = assess(f); assert.deepEqual(f, before);
  response(f).config.model = "selected"; const b = assess(f); assert.notEqual(a.configuration_sha256, b.configuration_sha256); assert.notEqual(a.metadata_sha256, b.metadata_sha256);
  assert.equal(a.startup_sha256, b.startup_sha256);
});
for (const [name, mutate, code] of [
  ["foreign client", f => { f.client_sha256 = H; }, "CLIENT_MISMATCH"],
  ["missing input", f => { delete f.cwd; }, "INPUT_INVALID"], ["extra input", f => { f.permission_profile = {}; }, "INPUT_INVALID"],
  ["root overlap", f => { f.startup.state_root = f.cwd; }, "STARTUP_INVALID"],
  ["extra metadata", f => { f.metadata.permission_profile = {}; }, "METADATA_INVALID"],
  ["missing requirements", f => { delete f.metadata.requirements; }, "METADATA_INVALID"],
  ["empty requirements object", f => { f.metadata.requirements.requirements = {}; }, "REQUIREMENTS_UNSUPPORTED"],
  ["requirements response null", f => { f.metadata.requirements = null; }, "REQUIREMENTS_UNSUPPORTED"],
  ["requirements extra", f => { f.metadata.requirements.other = null; }, "REQUIREMENTS_UNSUPPORTED"],
  ["requirements empty response", f => { f.metadata.requirements = {}; }, "REQUIREMENTS_UNSUPPORTED"],
  ["two configs", f => { f.metadata.configs.push(copy(response(f))); }, "CONFIG_COUNT_INVALID"],
  ["missing config", f => { f.metadata.configs = []; }, "CONFIG_COUNT_INVALID"],
  ["missing origins", f => { delete response(f).origins; }, "CONFIG_RESPONSE_INVALID"],
  ["null layers", f => { response(f).layers = null; }, "LAYERS_INVALID"],
  ["65 layers", f => { response(f).layers = Array.from({ length: 65 }, () => copy(session(f))); }, "LAYERS_INVALID"],
  ["no session flags", f => { response(f).layers.pop(); }, "SESSION_FLAGS_REQUIRED"],
  ["two session flags", f => { response(f).layers.push(copy(session(f))); }, "LAYER_DUPLICATE"],
  ["disabled layer", f => { response(f).layers[0].disabledReason = "untrusted"; }, "LAYER_DISABLED"],
  ["missing disabledReason", f => { delete session(f).disabledReason; }, "LAYER_INVALID"],
  ["version not string", f => { session(f).version = 12; }, "LAYER_INVALID"],
  ["version empty", f => { session(f).version = ""; }, "LAYER_INVALID"],
  ["version too long", f => { session(f).version = "x".repeat(257); }, "LAYER_INVALID"],
  ["layer extra fields", f => { session(f).authority = true; }, "LAYER_INVALID"],
  ["user selected profile", f => { response(f).layers[0].name.profile = "named"; }, "PROFILE_SELECTION_UNSUPPORTED"],
  ["user profile missing", f => { delete response(f).layers[0].name.profile; }, "LAYER_SOURCE_INVALID"],
  ["MDM source", f => { response(f).layers[0].name = { type: "mdm", domain: "fixture", key: "fixture" }; }, "LAYER_SOURCE_UNSUPPORTED"],
  ["cloud managed source", f => { response(f).layers[0].name = { type: "enterpriseManaged", id: "fixture", name: "fixture" }; }, "LAYER_SOURCE_UNSUPPORTED"],
  ["unknown source", f => { response(f).layers[0].name = { type: "foreign", file: f.source_files[0].path }; }, "LAYER_SOURCE_UNSUPPORTED"],
  ["source unobserved", f => { f.source_files = []; }, "SOURCE_UNOBSERVED"],
  ["absent source with content", f => { f.source_files[0].sha256 = null; }, "ABSENT_SOURCE_HAS_CONTENT"],
  ["malformed source hash", f => { f.source_files[0].sha256 = "fake"; }, "SOURCE_FILES_INVALID"],
  ["source extra authority", f => { f.source_files[0].trusted = true; }, "SOURCE_FILES_INVALID"],
  ["duplicate source", f => { f.source_files.push(copy(f.source_files[0])); }, "SOURCE_DUPLICATE"],
  ["source traversal", f => { f.source_files[0].path = "/fixture/../config.toml"; }, "SOURCE_PATH_INVALID"],
  ["duplicate layer", f => { response(f).layers.unshift(copy(response(f).layers[0])); }, "LAYER_DUPLICATE"],
  ["origin other version", f => { response(f).origins.sandbox_mode.version = "foreign"; }, "ORIGIN_UNBOUND"],
  ["origin lower source for control", f => { const layer = response(f).layers[0]; response(f).origins.sandbox_mode = { name: copy(layer.name), version: layer.version }; }, "CONTROL_ORIGIN_MISMATCH"],
  ["origin parent lower source", f => { const layer = response(f).layers[0]; response(f).origins.features = { name: copy(layer.name), version: layer.version }; }, "CONTROL_ORIGIN_MISMATCH"],
  ["origin extra field", f => { response(f).origins.sandbox_mode.config = {}; }, "ORIGINS_INVALID"],
  ["merged named permission even empty", f => { response(f).config.permissions = {}; }, "NAMED_PERMISSIONS_UNSUPPORTED"],
  ["merged default permission", f => { response(f).config.default_permissions = "named"; }, "NAMED_PERMISSIONS_UNSUPPORTED"],
  ["source named permissions", f => { response(f).layers[0].config.permissions = {}; }, "NAMED_PERMISSIONS_UNSUPPORTED"],
  ["merged CLI profile", f => { response(f).config.profile = "named"; }, "PROFILE_SELECTION_UNSUPPORTED"],
  ["source default profile", f => { response(f).layers[0].config.default_profile = "named"; }, "PROFILE_SELECTION_UNSUPPORTED"],
  ["official provider override", f => { response(f).config.model_providers = { openai: {} }; }, "PROVIDER_OVERRIDE_UNSUPPORTED"],
  ["base URL override", f => { response(f).config.openai_base_url = "https://example.invalid"; }, "PROVIDER_OVERRIDE_UNSUPPORTED"],
  ["auth command", f => { response(f).config.auth_command = "fixture"; }, "PROVIDER_OVERRIDE_UNSUPPORTED"],
  ["extra integration", f => { response(f).config.plugins.unknown = { enabled: false }; }, "INTEGRATION_MISMATCH"],
  ["enabled integration", f => { response(f).config.mcp_servers["fixture.mcp"].enabled = true; }, "INTEGRATION_MISMATCH"],
  ["missing integration", f => { delete response(f).config.apps["fixture.app"]; }, "INTEGRATION_MISMATCH"],
  ["new environment filter", f => { response(f).config.shell_environment_policy.filters["*"] = "include"; }, "ENVIRONMENT_SETTINGS_MISMATCH"],
  ["new environment set", f => { response(f).config.shell_environment_policy.set.EXTRA = ""; }, "ENVIRONMENT_SETTINGS_MISMATCH"],
  ["nonblank override", f => { response(f).config.shell_environment_policy.set.FIXTURE_KEY = "secret"; }, "ENVIRONMENT_SETTINGS_MISMATCH"],
  ["inherited environment", f => { response(f).config.shell_environment_policy.inherit = "core"; }, "ENVIRONMENT_SETTINGS_MISMATCH"],
  ["additional environment control", f => { response(f).config.shell_environment_policy.unknown = true; }, "ENVIRONMENT_SETTINGS_MISMATCH"],
  ["environment include_only", f => { response(f).config.shell_environment_policy.include_only = ["*"]; }, "ENVIRONMENT_SETTINGS_MISMATCH"],
  ["extra sandbox key", f => { response(f).config.sandbox_workspace_write.unknown = true; }, "SANDBOX_SETTINGS_MISMATCH"],
]) await check("refuses " + name, () => reject(mutate, code));
for (const [field, wrong] of [["sandbox_mode", "danger-full-access"], ["windows.sandbox", "unelevated"], ["approval_policy", "on-request"],
  ["features.windows_sandbox_service", true], ["features.plugins", true], ["features.apps", true], ["features.memories", true], ["agents.enabled", true],
  ["sandbox_workspace_write.writable_roots", ["/foreign"]], ["sandbox_workspace_write.network_access", true],
  ["sandbox_workspace_write.exclude_tmpdir_env_var", false], ["sandbox_workspace_write.exclude_slash_tmp", false], ["notify", ["fixture"]],
  ["model_provider", "foreign"], ["history.persistence", "save-all"], ["memories.generate_memories", true], ["memories.use_memories", true],
  ["instructions", "fixture"], ["developer_instructions", "fixture"], ["log_dir", "/foreign"], ["sqlite_home", "/foreign"]]) {
  for (const layer of ["merged", "session"]) await check("refuses changed " + layer + " control " + field, () => {
    const f = fixture(), keys = field.split("."); let row = layer === "merged" ? response(f).config : session(f).config;
    for (const key of keys.slice(0, -1)) row = row[key]; row[keys.at(-1)] = wrong;
    assert.throws(() => assess(f), error => /^MANAGED_CONFIGURATION_/u.test(error.code ?? ""));
  });
}
await check("missing and additional session controls are refused", () => {
  reject(f => { delete session(f).config.log_dir; }, "SESSION_SETTINGS_MISMATCH");
  reject(f => { session(f).config.model = "injected"; }, "SESSION_SETTINGS_MISMATCH");
});
await check("source case aliases cannot substitute two observations", () => {
  const f = fixture(); f.source_files = [{ path: "C:\\Fixture\\config.toml", sha256: H }, { path: "c:\\fixture\\CONFIG.toml", sha256: null }];
  assert.throws(() => assess(f), { code: "MANAGED_CONFIGURATION_SOURCE_DUPLICATE" });
});
for (const mutate of [f => { f.source_files[0].path = "C:\\fixture\\file."; }, f => { f.source_files[0].path = "C:\\fixture\\NUL"; },
  f => { f.source_files[0].path = "\\\\server\\share\\config.toml"; }, f => { f.source_files[0].path = "C:config.toml"; }])
  await check("refuses noncanonical source path", () => reject(mutate, "SOURCE_PATH_INVALID"));
await check("accessors never execute at input, source or layer depth", () => {
  for (const locate of [f => [f, "metadata"], f => [f.source_files[0], "path"], f => [session(f), "config"]]) {
    const f = fixture(), [target, key] = locate(f); let calls = 0;
    Object.defineProperty(target, key, { enumerable: true, get() { calls++; throw new Error("getter"); } });
    assert.throws(() => assess(f), { code: "MANAGED_CONFIGURATION_JSON_INVALID" }); assert.equal(calls, 0);
  }
});
for (const [name, mutate] of [["undefined", f => { f.metadata.extra = undefined; }], ["function", f => { f.metadata.hooks = () => {}; }],
  ["cycle", f => { f.metadata.self = f; }], ["symbol", f => { f[Symbol("secret")] = true; }], ["date", f => { f.metadata.hooks = new Date(0); }],
  ["sparse array", f => { f.source_files = Array(2); }], ["nonfinite", f => { f.metadata.process.pid = Infinity; }],
  ["custom prototype", f => { Object.setPrototypeOf(f, { privileged: true }); }]])
  await check("refuses non-JSON " + name, () => reject(mutate, "JSON_INVALID"));
await check("UTF-8 document limit measures bytes rather than string length", () => {
  const f = fixture(); response(f).config.opaque = "\u00e9".repeat(1100000);
  assert(JSON.stringify(f).length < 2097152); assert.throws(() => assess(f), { code: "MANAGED_CONFIGURATION_JSON_LIMIT" });
});
await check("bounded deep values cannot overflow traversal", () => {
  const f = fixture(); let row = response(f).config; for (let i = 0; i < 30; i++) row = row.deep = {};
  assert.throws(() => assess(f), { code: "MANAGED_CONFIGURATION_JSON_LIMIT" });
});
await check("import and assessment have no filesystem, process, network or clock effects", async () => {
  const source = new URL("../../src/core/agents/codex-managed-configuration.mjs", import.meta.url);
  const bytes = fs.readFileSync(source, "utf8").replace(/from "(\.\/[^"]+)"/gu, (_, relative) => "from " + JSON.stringify(new URL(relative, source).href));
  const moduleUrl = "data:text/javascript;base64," + Buffer.from(bytes).toString("base64"), input = fixture(), expected = assess(input), saved = [];
  const block = (target, key) => { saved.push([target, key, target[key]]); target[key] = () => { throw new Error("UNEXPECTED_EFFECT_" + key); }; };
  try {
    for (const key of ["readFileSync", "writeFileSync", "openSync", "mkdirSync", "statSync", "readdirSync", "rmSync"]) block(fs, key);
    for (const key of ["readFile", "writeFile", "open", "mkdir", "stat", "readdir", "rm"]) block(fs.promises, key);
    for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) block(childProcess, key);
    for (const target of [http, https]) for (const key of ["get", "request"]) block(target, key);
    for (const key of ["connect", "createConnection"]) block(net, key); block(Date, "now"); block(process, "cwd"); syncBuiltinESMExports();
    const module = await import(moduleUrl); assert.deepEqual(module.assessManagedSetupConfiguration(input), expected);
  } finally { for (const [target, key, value] of saved.reverse()) target[key] = value; syncBuiltinESMExports(); }
});
const fail = checks.filter(check => check.status === "FAIL").length;
console.log(JSON.stringify({ status: fail ? "FAIL" : "PASS", checks, pass: checks.length - fail, fail, skip: 0,
  evidence: "pure source configuration structure and startup argument parity", native: "NOT_RUN", system_effects: "NOT_RUN",
  cleanup: { status: "PASS", created_resources: 0 } }, null, 2));
process.exitCode = fail ? 1 : 0;
