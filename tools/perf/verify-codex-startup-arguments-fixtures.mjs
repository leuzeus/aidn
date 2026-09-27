import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { buildCodexStartupArguments as build, assertCodexStartupArgumentsConfiguration as validate,
  CODEX_STARTUP_ENVIRONMENT_PROFILES as profiles } from "../../src/core/agents/codex-startup-arguments.mjs";
import { buildCodexNativeProfileArguments, fingerprintCodexNativeProfilePolicy, resolveCodexNativeProfileStatePaths,
  CODEX_NATIVE_PROFILE_ENVIRONMENT_NAMES } from "../../src/adapters/agents/codex-native-profile-policy.mjs";
const checks = [], copy = value => structuredClone(value), H = "a".repeat(64);
async function check(name, action) { try { await action(); checks.push({ name, status: "PASS" }); }
  catch (error) { checks.push({ name, status: "FAIL", detail: String(error.stack ?? error).slice(0, 1800) }); } }
function configuration() { return { mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [],
  environment_names: [...profiles.managed], log_dir: "/fixture/state/logs", sqlite_home: "/fixture/state/sqlite" }; }
function worker(configurationOverrides = {}, stateRoot) {
  const base = process.platform === "win32" ? "C:\\Fixture" : "/fixture";
  const policy = { contract_version: "codex-native-profile-policy.v1", mode: "preexisting",
    home: { physical_path: path.join(base, "profile"), identity_sha256: H }, client_sha256: H,
    backend: { platform: "win32", architecture: "x64", sandbox: "elevated", provisioning: "existing-only" },
    configuration: { sources_sha256: H, effective_settings_sha256: H, mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [], ...configurationOverrides },
    hooks_sha256: H, effects: { state_root: stateRoot ?? path.join(base, "state"), shared_effects_sha256: H } };
  const request = { attempt_id: "fixture.attempt", cwd: path.join(base, "workspace"),
    execution: { native_profile: { mode: "preexisting", policy_sha256: fingerprintCodexNativeProfilePolicy(policy) } } };
  return { policy, request };
}
// Frozen pre-extraction formula: verifies historical byte content/order, including
// sorting, default app deduplication and paths derived from the real wrapper.
function historical(policy, request) {
  const state = resolveCodexNativeProfileStatePaths(policy, request);
  const disabled = names => `{${[...new Set(names)].sort().map(name => `${JSON.stringify(name)}={enabled=false}`).join(",")}}`;
  return [
    `mcp_servers=${disabled(policy.configuration.mcp_server_ids)}`,
    `plugins=${disabled(policy.configuration.plugin_ids)}`,
    `apps=${disabled(["_default", ...policy.configuration.app_ids])}`,
    "features.plugins=false", "features.apps=false", "notify=[]", 'model_provider="openai"', 'history.persistence="none"',
    "memories.generate_memories=false", "memories.use_memories=false", "features.memories=false", 'developer_instructions=""', 'instructions=""',
    `shell_environment_policy.set={${[...policy.configuration.environment_override_names].sort().map(name => `${JSON.stringify(name)}=""`).join(",")}}`,
    'shell_environment_policy.inherit="all"', "shell_environment_policy.ignore_default_excludes=true",
    `shell_environment_policy.filters={${CODEX_NATIVE_PROFILE_ENVIRONMENT_NAMES.map(name => `${JSON.stringify(name)}="include"`).join(",")}}`,
    `log_dir=${JSON.stringify(state.logs)}`, `sqlite_home=${JSON.stringify(state.sqlite)}`,
  ].flatMap(setting => ["-c", setting]);
}
await check("managed empty configuration has the exact historical setting order", () => {
  const args = build(configuration());
  assert.deepEqual(args.filter((_, index) => index % 2 === 1), [
    "mcp_servers={}", "plugins={}", 'apps={"_default"={enabled=false}}', "features.plugins=false", "features.apps=false", "notify=[]",
    'model_provider="openai"', 'history.persistence="none"', "memories.generate_memories=false", "memories.use_memories=false", "features.memories=false",
    'developer_instructions=""', 'instructions=""', "shell_environment_policy.set={}", 'shell_environment_policy.inherit="all"',
    "shell_environment_policy.ignore_default_excludes=true",
    'shell_environment_policy.filters={"SYSTEMROOT"="include","WINDIR"="include","COMSPEC"="include","PATH"="include","PATHEXT"="include","USERPROFILE"="include","LOCALAPPDATA"="include","APPDATA"="include","PROGRAMDATA"="include","CODEX_HOME"="include","TEMP"="include","TMP"="include"}',
    'log_dir="/fixture/state/logs"', 'sqlite_home="/fixture/state/sqlite"',
  ]);
  assert.equal(args.length, 38); assert(args.filter((_, index) => index % 2 === 0).every(arg => arg === "-c"));
});
await check("only the two canonical environment profiles are exposed immutable", () => {
  assert.equal(profiles.managed.length, 12); assert.equal(profiles.worker.length, 16);
  assert.deepEqual(profiles.worker, CODEX_NATIVE_PROFILE_ENVIRONMENT_NAMES);
  assert(Object.isFrozen(profiles) && Object.values(profiles).every(Object.isFrozen));
});
for (const [name, edits] of [
  ["empty", {}], ["sorting and dotted IDs", { mcp_server_ids: ["z.last", "a.first"], plugin_ids: ["plug.in", "PLUG"], app_ids: ["_default", "app.z"], environment_override_names: ["Z_VALUE", "a_value"] }],
  ["quotes, backslash and shell metacharacters remain data", { mcp_server_ids: ['q"uote', "back\\slash", "$(command)", "x;exit"], plugin_ids: ["\u00e9quipe"], app_ids: ["app.dot"] }],
  ["maximum ID and override limits", { mcp_server_ids: Array.from({ length: 128 }, (_, i) => `${i}`.padEnd(256, "x")), plugin_ids: Array.from({ length: 128 }, (_, i) => `plugin${i}`), app_ids: Array.from({ length: 128 }, (_, i) => `app${i}`), environment_override_names: Array.from({ length: 128 }, (_, i) => `V${i}`.padEnd(256, "x")) }],
]) await check("worker preserves historical arguments: " + name, () => {
  const { policy, request } = worker(edits), before = copy({ policy, request });
  assert.deepEqual(buildCodexNativeProfileArguments(policy, request), historical(policy, request));
  assert.deepEqual({ policy, request }, before);
});
await check("worker accepts the historical 4096-character state-root boundary", () => {
  const prefix = process.platform === "win32" ? "C:\\" : "/";
  const { policy, request } = worker({}, prefix + "x".repeat(4096 - prefix.length));
  assert.deepEqual(buildCodexNativeProfileArguments(policy, request), historical(policy, request));
});
await check("absent historical native profile still contributes no arguments", () => assert.deepEqual(buildCodexNativeProfileArguments(undefined, {}), []));
await check("historical wrong policy binding is still rejected", () => {
  const { policy, request } = worker(); request.execution.native_profile.policy_sha256 = "b".repeat(64);
  assert.throws(() => buildCodexNativeProfileArguments(policy, request), { code: "CODEX_NATIVE_PROFILE_BINDING_MISMATCH" });
});
await check("Windows spaces and accents are quoted as one argument", () => {
  const value = configuration(); value.log_dir = "C:\\Fixture \u00e9quipe\\logs"; value.sqlite_home = "D:\\Fixture \u00e9quipe\\sqlite";
  assert.deepEqual(build(value).slice(-4), ["-c", 'log_dir="C:\\\\Fixture \u00e9quipe\\\\logs"', "-c", 'sqlite_home="D:\\\\Fixture \u00e9quipe\\\\sqlite"']);
});
await check("keys are quoted whole and default app appears once", () => {
  const value = configuration(); value.mcp_server_ids = ['x.y', 'q"uote']; value.app_ids = ["_default"];
  const args = build(value); assert.equal(args[1], 'mcp_servers={"q\\"uote"={enabled=false},"x.y"={enabled=false}}');
  assert.equal(args[5], 'apps={"_default"={enabled=false}}');
});
await check("input remains unchanged and returned arrays share no state", () => {
  const value = configuration(), before = copy(value); const first = build(value); first[0] = "changed";
  assert.deepEqual(value, before); assert.equal(build(value)[0], "-c"); assert.equal(validate(value), true);
});
await check("wrapper-only sandbox, agents, model and service flags are not introduced", () => {
  const settings = build(configuration()).filter((_, i) => i % 2);
  assert(settings.every(value => !/^(?:model=|model_reasoning_effort=|sandbox_|windows\.|agents\.|features\.windows_sandbox_service=|hooks[.=])/u.test(value)));
});
for (const [name, mutate] of [
  ["missing field", value => { delete value.log_dir; }], ["extra free command", value => { value.args = ["--execute"]; }],
  ["symbol field", value => { value[Symbol("hidden")] = true; }], ["custom object prototype", value => { Object.setPrototypeOf(value, { inherited: true }); }],
  ["ID array missing", value => { value.mcp_server_ids = null; }], ["ID number", value => { value.mcp_server_ids = [42]; }],
  ["ID empty", value => { value.mcp_server_ids = [""]; }], ["duplicate ID", value => { value.mcp_server_ids = ["same", "same"]; }],
  ["ID newline injection", value => { value.plugin_ids = ['x\nfeatures.apps=true']; }], ["ID null injection", value => { value.app_ids = ["x\0y"]; }],
  ["ID 257 characters", value => { value.app_ids = ["x".repeat(257)]; }], ["129 IDs", value => { value.plugin_ids = Array.from({ length: 129 }, (_, i) => String(i)); }],
  ["array extra field", value => { value.app_ids.extra = true; }], ["sparse array", value => { value.app_ids = Array(1); }],
  ["unknown environment profile", value => { value.environment_names = ["PATH"]; }], ["environment profile reordered", value => { value.environment_names.reverse(); }],
  ["environment name lowercase", value => { value.environment_names[0] = "systemroot"; }], ["17 environment names", value => { value.environment_names = [...profiles.worker, "EXTRA"]; }],
  ["override injection", value => { value.environment_override_names = ['EXTRA"="include']; }], ["override reserved case insensitive", value => { value.environment_override_names = ["Path"]; }],
  ["override duplicate case insensitive", value => { value.environment_override_names = ["VALUE", "value"]; }],
  ["override numeric", value => { value.environment_override_names = [12]; }], ["override length 257", value => { value.environment_override_names = ["X".repeat(257)]; }],
  ["129 overrides", value => { value.environment_override_names = Array.from({ length: 129 }, (_, i) => `X${i}`); }],
  ["relative path", value => { value.log_dir = "relative/logs"; }], ["POSIX traversal", value => { value.log_dir = "/fixture/../logs"; }],
  ["Windows traversal", value => { value.log_dir = "C:\\fixture\\..\\logs"; }], ["Windows drive relative", value => { value.log_dir = "C:logs"; }],
  ["Windows nonnormalized slash", value => { value.log_dir = "C:/fixture/logs"; }], ["UNC path", value => { value.log_dir = "\\\\server\\share\\logs"; }],
  ["path line injection", value => { value.sqlite_home = "/fixture\nargs"; }], ["path 8193 characters", value => { value.sqlite_home = "/" + "x".repeat(8192); }],
]) await check("refuses " + name, () => {
  const value = configuration(); mutate(value); assert.throws(() => build(value), error => /^CODEX_STARTUP_/u.test(error.code ?? ""));
});
for (const location of ["object", "array"]) await check("accessor is rejected without invocation: " + location, () => {
  const value = configuration(); let calls = 0;
  if (location === "object") Object.defineProperty(value, "log_dir", { enumerable: true, get() { calls++; return "/fixture"; } });
  else { value.mcp_server_ids = ["x"]; Object.defineProperty(value.mcp_server_ids, "0", { enumerable: true, get() { calls++; return "x"; } }); }
  assert.throws(() => build(value), error => /^CODEX_STARTUP_/u.test(error.code ?? "")); assert.equal(calls, 0);
});
await check("import and construction do not read state, write, spawn, connect or read the clock", async () => {
  // Read the exact module bytes before trapping I/O; evaluating the data URL
  // then checks module effects without trapping Node's own file loader.
  const moduleUrl = "data:text/javascript;base64," + fs.readFileSync(new URL("../../src/core/agents/codex-startup-arguments.mjs", import.meta.url)).toString("base64");
  const input = configuration(), saved = [];
  const block = (target, key) => { saved.push([target, key, target[key]]); target[key] = () => { throw new Error(`UNEXPECTED_EFFECT_${key}`); }; };
  try {
    for (const key of ["readFileSync", "writeFileSync", "openSync", "mkdirSync", "statSync", "readdirSync", "rmSync"]) block(fs, key);
    for (const key of ["readFile", "writeFile", "open", "mkdir", "stat", "readdir", "rm"]) block(fs.promises, key);
    for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) block(childProcess, key);
    for (const target of [http, https]) for (const key of ["get", "request"]) block(target, key);
    for (const key of ["connect", "createConnection"]) block(net, key);
    block(process, "cwd"); block(Date, "now"); syncBuiltinESMExports();
    const module = await import(moduleUrl);
    assert.equal(module.assertCodexStartupArgumentsConfiguration(input), true); assert.deepEqual(module.buildCodexStartupArguments(input), build(input));
  } finally { for (const [target, key, value] of saved.reverse()) target[key] = value; syncBuiltinESMExports(); }
});
const fail = checks.filter(row => row.status === "FAIL").length;
console.log(JSON.stringify({ status: fail ? "FAIL" : "PASS", checks, pass: checks.length - fail, fail,
  evidence: "pure argument and historical compatibility fixtures", native: "NOT_RUN", system_effects: "NOT_RUN", cleanup: { status: "PASS", created_resources: 0 } }, null, 2));
process.exitCode = fail ? 1 : 0;
