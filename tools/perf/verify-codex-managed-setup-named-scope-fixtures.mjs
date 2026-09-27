import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { win32 as path } from "node:path";
import { projectManagedSetupNamedScope as project } from "../../src/core/agents/codex-managed-setup-named-scope.mjs";
import { getManagedSandboxOperationPolicy } from "../../src/core/agents/codex-managed-sandbox-operation-policy.mjs";
import { fingerprintAgentExecutionValue as hash } from "../../src/core/agents/agent-execution-contracts.mjs";
import { buildManagedSetupPermissionSettings } from "../../src/core/agents/codex-managed-startup.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from "../../src/core/agents/codex-startup-arguments.mjs";

const checks = [], H = "a".repeat(64), copy = structuredClone;
const rawHash = value => createHash("sha256").update(value).digest("hex");
async function check(name, fn) { try { await fn(); checks.push({ name, status: "PASS" }); }
  catch (error) { checks.push({ name, status: "FAIL", detail: String(error.stack ?? error).slice(0, 1300) }); } }
function fixture() {
  const profile = "C:\\Users\\fixture", home = path.join(profile, ".codex"), cwd = "G:\\fixture\\work", candidate = "C:\\Tools\\Codex";
  const startup = { state_root: "G:\\fixture\\state", mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [],
    permission_scope: { contract_version: "codex-managed-setup-permission-scope.v1", profile_id: "aidn-managed-setup", cwd,
      project_volume_root: "G:\\", user_profile: profile, read_roots: ["C:\\Windows", candidate], write_roots: [cwd], excluded_paths: [path.join(profile, "OneDrive")] } };
  const settings = { windows: { sandbox: "elevated" }, approval_policy: "never", ...buildManagedSetupPermissionSettings(startup),
    features: { windows_sandbox_service: false, plugins: false, apps: false, memories: false }, agents: { enabled: false },
    mcp_servers: {}, plugins: {}, apps: { _default: { enabled: false } }, notify: [], model_provider: "openai", history: { persistence: "none" },
    memories: { generate_memories: false, use_memories: false }, instructions: "", developer_instructions: "",
    shell_environment_policy: { set: {}, inherit: "all", ignore_default_excludes: true,
      filters: Object.fromEntries(CODEX_STARTUP_ENVIRONMENT_PROFILES.managed.map(name => [name, "include"])) },
    log_dir: path.join(startup.state_root, "logs"), sqlite_home: path.join(startup.state_root, "sqlite") };
  const configuration = { metadata: { configs: [{ config: settings, origins: {}, layers: [{ name: { type: "sessionFlags" }, version: "fixture", config: copy(settings) }] }],
    requirements: { requirements: null }, hooks: {}, readiness: {}, process: {} }, startup, cwd, profile_root: home, candidate_root: candidate,
    client_sha256: getManagedSandboxOperationPolicy().client_sha256, source_files: [] };
  const environment = { SYSTEMROOT: "C:\\Windows", WINDIR: "C:\\Windows", COMSPEC: "C:\\Windows\\system32\\cmd.exe", PATH: "C:\\Windows\\system32", PATHEXT: ".EXE",
    USERPROFILE: profile, LOCALAPPDATA: path.join(profile, "AppData", "Local"), APPDATA: path.join(profile, "AppData", "Roaming"), PROGRAMDATA: "C:\\ProgramData",
    CODEX_HOME: home, TEMP: startup.state_root, TMP: startup.state_root };
  const facts = { contract_version: "aidn-managed-setup-named-facts.v1", observed_at: "2026-01-01T00:00:00.000Z", observer_context_sha256: H,
    permission_scope_sha256: hash(startup.permission_scope), paths: [], listings: [], prior_deny_read_content: null };
  const f = { configuration, environment, facts, at: "2026-01-01T00:00:00.100Z" };
  for (const p of [cwd, home, candidate, "G:\\", startup.state_root, settings.log_dir, settings.sqlite_home, path.join(home, ".sandbox-bin"), "C:\\Windows",
    path.join(environment.LOCALAPPDATA, "OpenAI", "Codex"), path.join(profile, ".cache", "codex-runtimes")]) present(f, p);
  for (const p of [".git", ".agents", ".codex"].map(n => path.join(cwd, n)).concat([path.join(profile, ".ssh", "config"), priorPath(f)])) absent(f, p);
  const rt = runtimeRoot(f), folder = path.join(rt, "v1"), file = path.join(folder, "node.exe"); present(f, rt); present(f, folder); present(f, file, "file");
  facts.listings.push({ path: rt, complete: true, entries: [folder] }, { path: folder, complete: true, entries: [file] }); return f;
}
function present(f, p, object_type = "directory") {
  const row = { path: p, state: "present", object_type, physical_path: p, volume_id: "0000000000000001",
    file_id: (f.facts.paths.reduce((max, r) => r.file_id === null ? max : Math.max(max, Number.parseInt(r.file_id, 16)), 0) + 1).toString(16).padStart(32, "0"),
    link_count: object_type === "file" ? 1 : null, ancestors_non_reparse: true, reparse: false, content_sha256: null };
  f.facts.paths.push(row); return row;
}
function absent(f, p) { f.facts.paths.push({ path: p, state: "absent", object_type: null, physical_path: null, volume_id: null, file_id: null, link_count: null,
  ancestors_non_reparse: true, reparse: null, content_sha256: null }); }
const runtimeRoot = f => path.join(f.environment.LOCALAPPDATA, "OpenAI", "Codex", "runtimes");
const priorPath = f => path.join(f.configuration.profile_root, ".sandbox", "deny_read_acl_state.json");
const row = (f, p) => f.facts.paths.find(r => r.path === p);
function rejects(mutate, code) { const f = fixture(); mutate(f); assert.throws(() => project(f), { code: "MANAGED_NAMED_SCOPE_" + code }); }
function runtimeChildren(f, count) { const rt = runtimeRoot(f); f.facts.paths = f.facts.paths.filter(r => !r.path.startsWith(rt + "\\"));
  f.facts.listings = [{ path: rt, complete: true, entries: [] }];
  for (let n = 0; n < count; n++) { const p = path.join(rt, "f" + n); present(f, p, "file"); f.facts.listings[0].entries.push(p); } }
await check("named volume selection produces six lists without operational authority", () => {
  const f = fixture(), before = copy(f), r = project(f), p = r.preimage;
  assert.equal(r.contract_version, "aidn-managed-setup-named-scope.v1"); assert.equal(r.representation, "DERIVED_NAMED_SETUP_SCOPE");
  assert.equal(r.authorization, "NOT_AUTHORIZED"); assert.equal(r.execution_available, false); assert.equal(r.native_qualified, false); assert.equal(r.qualification, "NOT_RUN");
  assert.equal(r.complete_effect_coverage, false); assert.equal(r.initial_provisioning, "CONDITIONAL_NOT_ASSESSED");
  assert.equal(r.read_exclusion_authority, "AIDN_POLICY_NOT_OS_READ_DENIAL"); assert.equal(p.runtime, "Legacy"); assert.equal(p.phase, "Full");
  assert.deepEqual(p.write_roots, [f.configuration.cwd]); for (const name of ["deny_read_paths", "prior_deny_read_paths", "deny_write_paths"]) assert.deepEqual(p[name], []);
  assert.deepEqual(p.read_roots, ["C:\\Tools\\Codex", "C:\\Users\\fixture\\.codex\\.sandbox-bin", "C:\\Windows", "G:\\"]);
  assert.equal(p.permission_scope_sha256, hash(f.configuration.startup.permission_scope)); assert.equal(r.permission_profile_sha256, hash(p));
  assert.equal(p.runtime_paths.length, 5); assert.deepEqual(f, before); assert(Object.isFrozen(r) && Object.isFrozen(p.read_roots));
});
await check("no profile listing or implicit platform fact is required", () => { const f = fixture();
  assert(!f.facts.paths.some(r => r.path === f.environment.USERPROFILE)); assert(!f.facts.listings.some(r => r.path === f.environment.USERPROFILE));
  assert(!project(f).preimage.read_roots.includes("C:\\ProgramData")); });
await check("4096 runtime descendants fit UTF8 bound and produce 4099 selectors", () => { const f = fixture(); runtimeChildren(f, 4096);
  assert(Buffer.byteLength(JSON.stringify(f)) < 2097152); assert.equal(project(f).preimage.runtime_paths.length, 4099); });
await check("4097 immediate descendants are refused", () => rejects(f => runtimeChildren(f, 4097), "LISTING_INCOMPLETE"));
await check("cumulative discoveries are bounded before adding pending entries", () => { const f = fixture(); runtimeChildren(f, 4095);
  const branch = path.join(runtimeRoot(f), "extra"), leaf = path.join(branch, "leaf"); present(f, branch); present(f, leaf, "file");
  f.facts.listings[0].entries.push(branch); f.facts.listings.push({ path: branch, complete: true, entries: [leaf] });
  assert.throws(() => project(f), { code: "MANAGED_NAMED_SCOPE_RUNTIME_LIMIT" }); });
await check("empty prior state binds exact content without granting historical completeness", () => { const f = fixture(), text = '{ "principals": {} }\n';
  f.facts.paths = f.facts.paths.filter(r => r.path !== priorPath(f)); present(f, priorPath(f), "file").content_sha256 = rawHash(text); f.facts.prior_deny_read_content = text;
  assert.deepEqual(project(f).preimage.prior_deny_read_paths, []); });
await check("absent runtime roots do not imply missing traversal", () => { const f = fixture(), rt = runtimeRoot(f);
  f.facts.paths = f.facts.paths.filter(r => r.path !== rt && !r.path.startsWith(rt + "\\")); absent(f, rt); f.facts.listings = [];
  assert.equal(project(f).preimage.runtime_paths.length, 2); });
for (const [name, mutate, code] of [
  ["foreign facts version", f => { f.facts.contract_version = "aidn-managed-setup-legacy-facts.v3"; }, "FACTS_INVALID"],
  ["wrong scope hash", f => { f.facts.permission_scope_sha256 = H; }, "FACTS_INVALID"],
  ["unknown facts field", f => { f.facts.profile_junctions = []; }, "FACTS_INVALID"],
  ["stale", f => { f.at = "2026-01-01T00:05:00.001Z"; }, "FACTS_STALE"],
  ["future", f => { f.at = "2025-12-31T23:59:59.999Z"; }, "FACTS_STALE"],
  ["extra environment", f => { f.environment.HTTP_PROXY = "http://localhost"; }, "ENVIRONMENT_INVALID"],
  ["profile mismatch", f => { f.environment.USERPROFILE = "C:\\Users\\Other"; }, "ENVIRONMENT_BINDING"],
  ["extra profile fact", f => { present(f, f.environment.USERPROFILE); }, "UNUSED_FACTS"],
  ["profile enumeration", f => { f.facts.listings.push({ path: f.environment.USERPROFILE, complete: true, entries: [] }); }, "LISTING_INVALID"],
  ["implicit platform fact", f => { present(f, "C:\\ProgramData"); }, "UNUSED_FACTS"],
  ["missing cwd fact", f => { f.facts.paths.shift(); }, "PATH_UNOBSERVED"],
  ["case duplicate", f => { f.facts.paths.push({ ...f.facts.paths[0], path: f.facts.paths[0].path.toUpperCase() }); }, "PATH_FACT_DUPLICATE"],
  ["physical alias", f => { f.facts.paths[0].physical_path = "G:\\foreign"; }, "PATH_FACT_INVALID"],
  ["physical case alias", f => { f.facts.paths[0].physical_path = f.facts.paths[0].path.toUpperCase(); }, "PATH_FACT_INVALID"],
  ["unknown ancestry", f => { f.facts.paths[0].ancestors_non_reparse = false; }, "ANCESTORS_UNVERIFIED"],
  ["reparse directory", f => { f.facts.paths[0].reparse = true; }, "PATH_FACT_INVALID"],
  ["hardlink file", f => { f.facts.paths.find(r => r.object_type === "file").link_count = 2; }, "LINK_COUNT_UNSUPPORTED"],
  ["identity duplicate", f => { f.facts.paths[1].file_id = f.facts.paths[0].file_id; }, "PHYSICAL_IDENTITY_DUPLICATE"],
  ["incomplete listing", f => { f.facts.listings[0].complete = false; }, "LISTING_INCOMPLETE"],
  ["unlisted file", f => { present(f, path.join(runtimeRoot(f), "other"), "file"); }, "UNUSED_FACTS"],
  ["missing listing", f => { f.facts.listings.shift(); }, "LISTING_UNOBSERVED"],
  ["content on unrelated path", f => { f.facts.paths.find(r => r.object_type === "file").content_sha256 = H; }, "PATH_FACT_INVALID"],
  ["prior bytes without file", f => { f.facts.prior_deny_read_content = '{"principals":{}}'; }, "PRIOR_STATE_MISMATCH"],
]) await check("refuses " + name, () => rejects(mutate, code));
for (const p of ["C:\\a\\..\\b", "\\\\server\\share", "C:\\a\\NUL", "C:\\", "G:\\x\\trail."]) await check("invalid path " + p,
  () => rejects(f => { f.facts.paths[0].path = p; }, "PATH_INVALID"));
for (const p of ["C:\\Users\\fixture\\OneDrive", "C:\\Users\\fixture\\OneDrive - Org\\x", "C:\\Users\\fixture\\ONEDRI~1"]) await check("cloud fact refused lexically " + p,
  () => { const f = fixture(); present(f, p); assert.throws(() => project(f), { code: "AGENT_CLOUD_PATH_EXCLUDED" }); });
await check("short alias refused without filesystem resolution", () => { const f = fixture(); present(f, "C:\\TOOLS~1"); assert.throws(() => project(f), { code: "AGENT_PATH_ALIAS_UNSUPPORTED" }); });
await check("alternate stream refused before physical interpretation", () => { const f = fixture(); present(f, "C:\\a:stream"); assert.throws(() => project(f), { code: "AGENT_PATH_ALIAS_UNSUPPORTED" }); });
for (const name of [".git", ".agents", ".codex"]) await check("cwd control " + name + " must be absent", () => rejects(f => {
  const p = path.join(f.configuration.cwd, name); f.facts.paths = f.facts.paths.filter(r => r.path !== p); present(f, p); }, "CWD_METADATA_UNSUPPORTED"));
await check("existing SSH config is refused without accepting content", () => rejects(f => { const p = path.join(f.environment.USERPROFILE, ".ssh", "config");
  f.facts.paths = f.facts.paths.filter(r => r.path !== p); present(f, p, "file"); }, "SSH_CONFIG_UNSUPPORTED"));
await check("nonempty prior is refused", () => rejects(f => { const text = '{"principals":{"unknown":[]}}';
  f.facts.paths = f.facts.paths.filter(r => r.path !== priorPath(f)); present(f, priorPath(f), "file").content_sha256 = rawHash(text); f.facts.prior_deny_read_content = text; }, "PRIOR_STATE_UNSUPPORTED"));
await check("configuration is reassessed, not accepted by status", () => { const f = fixture(); f.configuration.metadata.requirements.requirements = {};
  assert.throws(() => project(f), { code: "MANAGED_CONFIGURATION_REQUIREMENTS_UNSUPPORTED" }); });
await check("accessor never runs", () => { const f = fixture(); let calls = 0; Object.defineProperty(f.facts, "paths", { enumerable: true, get() { calls++; return []; } });
  assert.throws(() => project(f), { code: "MANAGED_NAMED_SCOPE_JSON_INVALID" }); assert.equal(calls, 0); });
await check("UTF8 bound before traversal", () => rejects(f => { f.facts.extra = "é".repeat(1100000); }, "JSON_LIMIT"));
await check("physical identity and observation provenance each change scope fingerprint", () => { const f = fixture(), a = project(f).permission_profile_sha256;
  f.facts.paths[0].file_id = "f".repeat(32); assert.notEqual(project(f).permission_profile_sha256, a); const b = project(f).permission_profile_sha256;
  f.facts.observer_context_sha256 = "b".repeat(64); assert.notEqual(project(f).permission_profile_sha256, b); });
await check("projection invokes no filesystem, process, network or environment provider", () => {
  const f = fixture(), restores = []; const deny = () => { throw new Error("FORBIDDEN_EFFECT"); };
  for (const [owner, names] of [[fs, ["readFileSync", "writeFileSync", "statSync", "readdirSync"]], [childProcess, ["spawn", "spawnSync", "execFile", "execFileSync"]],
    [http, ["request", "get"]], [https, ["request", "get"]], [net, ["connect", "createConnection"]]]) for (const name of names) {
    const old = owner[name]; owner[name] = deny; restores.push(() => { owner[name] = old; }); }
  syncBuiltinESMExports(); try { assert.equal(project(f).status, "RESOLVED_FOR_REVIEW"); } finally { restores.reverse().forEach(fn => fn()); syncBuiltinESMExports(); }
});
const failed = checks.filter(r => r.status === "FAIL");
console.log(JSON.stringify({ ok: !failed.length, pass: checks.length - failed.length, fail: failed.length, skip: 0, checks, native: "NOT_RUN", setup: "NOT_RUN" }, null, 2));
process.exitCode = failed.length ? 1 : 0;
