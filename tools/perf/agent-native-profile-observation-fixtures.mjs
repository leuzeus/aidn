import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { fingerprintAgentExecutionValue as fingerprint } from "../../src/core/agents/agent-execution-contracts.mjs";
import * as profile from "../../src/adapters/agents/codex-native-profile-policy.mjs";
import { normalizeCodexNativeProfileConfiguration, validateCodexNativeProfileMetadata,
  createCodexNativeProfileVerifier, collectCodexNativeProfileMetadata } from "../verify/agent-native-profile-observation.mjs";
import { assertNativeQualificationProfileReview } from "../verify/qualify-agent-native-worker.mjs";
import { verifyNativeQualificationProfile } from "../verify/agent-native-qualification-driver.mjs";

const clone = structuredClone;
const H = letter => letter.repeat(64);
function fixture() {
  const base = path.join(os.tmpdir(), "aidn-profile-observation-pure"), home = path.join(base, "home"), stateRoot = path.join(base, "state");
  const policy = { contract_version: "codex-native-profile-policy.v1", mode: "preexisting", home: { physical_path: home, identity_sha256: H("a") },
    client_sha256: H("b"), backend: { platform: "win32", architecture: "x64", sandbox: "elevated", provisioning: "existing-only" },
    configuration: { sources_sha256: H("c"), effective_settings_sha256: H("d"), mcp_server_ids: ["one.with space"], plugin_ids: ["synthetic@local"], app_ids: ["app1"] },
    hooks_sha256: H("e"), effects: { state_root: stateRoot, shared_effects_sha256: H("f") } };
  const definition = JSON.stringify({ hooks: { PreToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: "synthetic-before", timeout: 600 }] }],
    SessionStart: [{ matcher: ".*", hooks: [{ type: "command", command: "synthetic-start", timeout: 600 }] }] } });
  const manifest = { codex_home: home, codex: { binary_path: path.join(base, "client.exe"), sha256: policy.client_sha256 },
    native_profile: { mode: "preexisting", home_identity_sha256: policy.home.identity_sha256 },
    roots: ["coordinator", "worker-a", "worker-b"].map(role => ({ role, root: path.join(base, role),
      hooks: { definition, config: { path: path.join(base, "coordinator", ".codex", "hooks.json"), sha256: H("a") }, handlers: [] } })) };
  const request = { attempt_id: "attempt-1", cwd: manifest.roots[1].root, execution: { model: "synthetic-model", effort: "high", sandbox: "workspace-write",
    native_profile: { mode: "preexisting", policy_sha256: profile.fingerprintCodexNativeProfilePolicy(policy) } } };
  const state = profile.resolveCodexNativeProfileStatePaths(policy, request);
  const config = { model: request.execution.model, model_reasoning_effort: request.execution.effort, model_provider: "openai",
    mcp_servers: { "one.with space": { enabled: false, env: { SYNTHETIC: "fake-secret-do-not-retain" } } }, plugins: { "synthetic@local": { enabled: false } },
    apps: { _default: { enabled: false }, app1: { enabled: false } }, features: { plugins: false, apps: false, memories: false }, notify: [],
    history: { persistence: "none" }, memories: { generate_memories: false, use_memories: false }, instructions: "", developer_instructions: "",
    log_dir: state.logs, sqlite_home: state.sqlite, approval_policy: "never", sandbox_mode: "workspace-write", windows: { sandbox: "elevated" }, agents: { enabled: false },
    sandbox_workspace_write: { network_access: false, writable_roots: [], exclude_tmpdir_env_var: true, exclude_slash_tmp: true } };
  const sourceFiles = [{ path: path.join(home, "config.toml"), present: true, size: 3, sha256: H("a") }];
  const metadata = { configs: manifest.roots.slice(1).map(() => ({ config: clone(config), layers: [
    { name: { type: "sessionFlags" }, version: "sha256:" + H("a"), config: { sqlite_home: state.sqlite } },
    { name: { type: "user", file: sourceFiles[0].path }, version: "sha256:" + H("b"), config: { inherited: "fake-secret-do-not-retain" } }] })),
    hooks: { data: manifest.roots.slice(1).map(root => ({ cwd: root.root, warnings: [], errors: [], hooks: ["preToolUse", "sessionStart"].map(eventName => ({
      eventName, sourcePath: manifest.roots[0].hooks.config.path, source: "project", enabled: true, trustStatus: "trusted", handlerType: "command", async: false,
      currentHash: "sha256:" + H(eventName === "preToolUse" ? "c" : "d"), matcher: ".*", timeoutSec: 600,
      command: eventName === "preToolUse" ? "synthetic-before" : "synthetic-start" })) })) },
    readiness: { status: "ready" }, process: { closed: true, pid_absent: true, exit_code: 0, signal: null, response_count: 5 } };
  const result = validateCodexNativeProfileMetadata({ metadata, manifest, policy, request, sourceFiles });
  policy.configuration.sources_sha256 = result.sources_sha256; policy.configuration.effective_settings_sha256 = result.effective_settings_sha256; policy.hooks_sha256 = result.hooks_sha256;
  request.execution.native_profile.policy_sha256 = profile.fingerprintCodexNativeProfilePolicy(policy);
  const consent = { approved: true, shared_effects_sha256: policy.effects.shared_effects_sha256, state_root: policy.effects.state_root };
  const review = { native_profile: { mode: "preexisting", policy_sha256: profile.fingerprintCodexNativeProfilePolicy(policy), consent } };
  const observation = { status: "verified", ...result, home_identity_sha256: policy.home.identity_sha256, client_sha256: policy.client_sha256,
    shared_effects_sha256: policy.effects.shared_effects_sha256, setup_sha256: H("1"), process: metadata.process, preservation: "PASS", provisioning_performed: false, environment_restricted: true };
  return { policy, request, manifest, config, metadata, sourceFiles, consent, review, observation };
}

function doubleTransport({ alter, silent = false, leaveAlive = false, chunked = false } = {}) {
  const calls = []; let alive = false;
  const spawnProcess = () => {
    alive = true; const child = new EventEmitter(); child.pid = 12345; child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const close = () => { if (leaveAlive) return; alive = false; child.emit("close", 0, null); };
    child.kill = () => { queueMicrotask(close); return true; };
    child.stdin = new Writable({ write(chunk, encoding, callback) {
      const message = JSON.parse(chunk.toString()); calls.push(message);
      if (message.id && !silent) queueMicrotask(() => {
        const reply = alter ? alter(message) : { id: message.id, result: { marker: "été", method: message.method } };
        const bytes = Buffer.from(JSON.stringify(reply) + "\r\n");
        if (chunked) for (const byte of bytes) child.stdout.write(Buffer.from([byte])); else child.stdout.write(bytes);
      }); callback();
    }, final(callback) { callback(); queueMicrotask(close); } });
    return child;
  };
  return { spawnProcess, isAlive: () => alive, calls };
}

export async function runAgentNativeProfileObservationFixtures() {
  const checks = []; const check = async (name, action) => { await action(); checks.push({ name, status: "PASS" }); };
  const code = expected => error => error.code === expected;
  const validate = value => validateCodexNativeProfileMetadata(value);
  await check("effective snapshot contains hashes, never synthetic secret values", () => {
    const value = fixture(); const result = validate(value); assert.equal(JSON.stringify(result).includes("fake-secret"), false); assert.equal(result.integrations_disabled, true);
  });
  await check("attempt paths and explicitly resolved model normalize independently", () => {
    const a = fixture(), b = fixture(); b.request.attempt_id = "attempt-2"; b.request.execution.model = "other-model"; b.request.execution.effort = "low";
    const state = profile.resolveCodexNativeProfileStatePaths(b.policy, b.request); b.config.model = b.request.execution.model; b.config.model_reasoning_effort = "low";
    b.config.log_dir = state.logs; b.config.sqlite_home = state.sqlite;
    assert.deepEqual(normalizeCodexNativeProfileConfiguration(a.config, a.policy, a.request), normalizeCodexNativeProfileConfiguration(b.config, b.policy, b.request));
  });
  await check("sandbox mode is checked against request and remains material to policy hash", () => {
    const x = fixture(), original = normalizeCodexNativeProfileConfiguration(x.config, x.policy, x.request);
    x.request.execution.sandbox = "read-only";
    assert.throws(() => normalizeCodexNativeProfileConfiguration(x.config, x.policy, x.request), code("PROFILE_SANDBOX_SETTINGS_REFUSED"));
    x.config.sandbox_mode = "read-only";
    assert.notEqual(fingerprint(normalizeCodexNativeProfileConfiguration(x.config, x.policy, x.request)), fingerprint(original));
  });
  const mutations = [
    ["active MCP", x => { x.metadata.configs[0].config.mcp_servers["one.with space"].enabled = true; }, "PROFILE_INTEGRATION_ACTIVE_OR_CHANGED"],
    ["new integration", x => { x.metadata.configs[0].config.plugins.unknown = { enabled: false }; }, "PROFILE_INTEGRATION_ACTIVE_OR_CHANGED"],
    ["provider override", x => { x.metadata.configs[0].config.model_providers = { openai: { env_key: "FAKE" } }; }, "PROFILE_PROVIDER_OVERRIDE_REFUSED"],
    ["shell credential override", x => { x.metadata.configs[0].config.shell_environment_policy = { set: { FAKE: "synthetic" } }; }, "PROFILE_ENVIRONMENT_OVERRIDE_REFUSED"],
    ["notify command", x => { x.metadata.configs[0].config.notify = ["fake.exe"]; }, "PROFILE_EFFECTIVE_SETTINGS_REFUSED"],
    ["wrong model", x => { x.metadata.configs[0].config.model = "other"; }, "PROFILE_EFFECTIVE_SETTINGS_REFUSED"],
    ["wrong SQLite", x => { x.metadata.configs[0].config.sqlite_home = x.policy.home.physical_path; }, "PROFILE_EFFECTIVE_SETTINGS_REFUSED"],
    ["network enabled", x => { x.metadata.configs[0].config.sandbox_workspace_write.network_access = true; }, "PROFILE_SANDBOX_SETTINGS_REFUSED"],
    ["unobserved config source", x => { x.metadata.configs[0].layers[1].name.file = path.join(os.tmpdir(), "other.toml"); }, "PROFILE_SOURCE_UNOBSERVED"],
    ["disabled project layer", x => { x.metadata.configs[0].layers[1].disabledReason = "untrusted"; }, "PROFILE_LAYER_DISABLED"],
    ["missing layers", x => { x.metadata.configs[0].layers = []; }, "PROFILE_LAYERS_REQUIRED"],
    ["backend unavailable", x => { x.metadata.readiness.status = "updateRequired"; }, "PROFILE_BACKEND_NOT_READY"],
    ["extra user hook", x => { x.metadata.hooks.data[0].hooks.push({ source: "user", enabled: true }); }, "PROFILE_EXTRA_OR_MISSING_HOOKS"],
    ["untrusted project hook", x => { x.metadata.hooks.data[0].hooks[0].trustStatus = "untrusted"; }, "PROFILE_HOOK_UNTRUSTED"],
    ["hook source cannot be another manifested root", x => {
      x.manifest.roots[2].hooks.config.path = path.join(x.manifest.roots[2].root, ".codex", "hooks.json");
      x.metadata.hooks.data[0].hooks[0].sourcePath = x.manifest.roots[2].hooks.config.path;
    }, "PROFILE_HOOK_UNTRUSTED"],
    ["different hook timeout", x => { x.metadata.hooks.data[0].hooks[0].timeoutSec = 1; }, "PROFILE_HOOK_DEFINITION_CHANGED"],
    ["different hook command", x => { x.metadata.hooks.data[0].hooks[0].command = "other"; }, "PROFILE_HOOK_DEFINITION_CHANGED"],
  ];
  for (const [name, mutate, expected] of mutations) await check(name, () => { const value = fixture(); mutate(value); assert.throws(() => validate(value), code(expected)); });
  await check("review accepts legacy with no profile", () => assert.equal(assertNativeQualificationProfileReview({ manifest: {}, review: {} }), null));
  await check("review requires bound shared-effect consent", () => {
    const x = fixture(); assert.deepEqual(assertNativeQualificationProfileReview(x).consent, x.consent); delete x.review.native_profile.consent;
    assert.throws(() => assertNativeQualificationProfileReview(x), code("QUALIFICATION_NATIVE_PROFILE_REVIEW_REQUIRED"));
  });
  await check("review rejects foreign policy", () => { const x = fixture(); x.review.native_profile.policy_sha256 = H("0"); assert.throws(() => assertNativeQualificationProfileReview(x), code("QUALIFICATION_NATIVE_PROFILE_REVIEW_REQUIRED")); });
  await check("factory does not inspect profile before invocation", () => {
    const x = fixture(); let calls = 0; createCodexNativeProfileVerifier({ ...x, observer: async () => { calls++; } }); assert.equal(calls, 0);
  });
  await check("factory refuses unapproved metadata before observer call", () => {
    const x = fixture(); x.consent.approved = false; let calls = 0;
    assert.throws(() => createCodexNativeProfileVerifier({ ...x, observer: async () => { calls++; } }), code("PROFILE_EXPLICIT_CONSENT_REQUIRED"));
    assert.equal(calls, 0);
  });
  await check("verifier binds challenge and fresh observation; finalize reobserves", async () => {
    const x = fixture(); let count = 0; const verifier = createCodexNativeProfileVerifier({ ...x, observer: async () => { count++; return clone(x.observation); } });
    const context = { phase: "before_create", challenge: "11111111-1111-1111-1111-111111111111" };
    const decision = await verifier(x.request, context); assert.equal(profile.assertCodexNativeProfileVerification(decision, { ...context, policy: x.policy, request: x.request }), true);
    assert.equal((await verifier.finalize({})).preservation, "PASS"); assert.equal(count, 2);
  });
  await check("finalize without initial observation refuses", async () => {
    const x = fixture(); const verifier = createCodexNativeProfileVerifier({ ...x, observer: async () => x.observation });
    await assert.rejects(verifier.finalize({}), code("PROFILE_INITIAL_OBSERVATION_REQUIRED"));
  });
  await check("observer foreign hash cannot manufacture verifier decision", async () => {
    const x = fixture(); x.observation.hooks_sha256 = H("0"); const verifier = createCodexNativeProfileVerifier({ ...x, observer: async () => x.observation });
    await assert.rejects(verifier(x.request, { phase: "before_create", challenge: "11111111-1111-1111-1111-111111111111" }), code("PROFILE_OBSERVATION_INCOMPLETE"));
  });
  await check("metadata transport uses only five permitted requests and initialized", async () => {
    const transport = doubleTransport({ chunked: true }), x = fixture();
    const result = await collectCodexNativeProfileMetadata({ executable: "never-executed", args: [], cwd: x.request.cwd, env: {}, roots: x.manifest.roots.slice(1) }, transport);
    assert.equal(result.process.pid_absent, true); assert.deepEqual(transport.calls.map(x => x.method), ["initialize", "initialized", "config/read", "config/read", "hooks/list", "windowsSandbox/readiness"]);
    assert.equal(result.configs[0].marker, "été");
  });
  await check("server request cannot trigger a command", async () => {
    const transport = doubleTransport({ alter: () => ({ id: "server-1", method: "command/exec", params: {} }) }), x = fixture();
    await assert.rejects(collectCodexNativeProfileMetadata({ roots: x.manifest.roots.slice(1) }, transport), code("PROFILE_METADATA_UNEXPECTED_RPC"));
  });
  for (const primitive of [null, 42, "text", []]) await check(`malformed protocol envelope ${JSON.stringify(primitive)}`, async () => {
    const transport = doubleTransport({ alter: () => primitive }), x = fixture();
    await assert.rejects(collectCodexNativeProfileMetadata({ roots: x.manifest.roots.slice(1) }, transport), code("PROFILE_METADATA_PROTOCOL_INVALID"));
    assert.equal(transport.isAlive(), false);
  });
  await check("metadata timeout closes owned process", async () => {
    const transport = doubleTransport({ silent: true }), x = fixture();
    await assert.rejects(collectCodexNativeProfileMetadata({ roots: x.manifest.roots.slice(1) }, { ...transport, timeoutMs: 30 }), code("PROFILE_METADATA_TIMEOUT")); assert.equal(transport.isAlive(), false);
  });
  await check("metadata output limit closes owned process", async () => {
    const x = fixture(), transport = doubleTransport({ alter: message => ({ id: message.id, result: "x".repeat(2 * 1024 * 1024) }) });
    await assert.rejects(collectCodexNativeProfileMetadata({ roots: x.manifest.roots.slice(1) }, transport), code("PROFILE_METADATA_OUTPUT_LIMIT"));
    assert.equal(transport.isAlive(), false);
  });
  await check("out-of-order response is refused and closed", async () => {
    const x = fixture(), transport = doubleTransport({ alter: () => ({ id: 42, result: {} }) });
    await assert.rejects(collectCodexNativeProfileMetadata({ roots: x.manifest.roots.slice(1) }, transport), code("PROFILE_METADATA_RPC_REFUSED"));
    assert.equal(transport.isAlive(), false);
  });
  await check("metadata cancelled before spawn", async () => {
    let spawned = false; await assert.rejects(collectCodexNativeProfileMetadata({ signal: AbortSignal.abort() }, { spawnProcess() { spawned = true; } }), code("PROFILE_METADATA_CANCELLED")); assert.equal(spawned, false);
  });
  const direct = (x, verify, options = {}) => verifyNativeQualificationProfile({ modules: profile, policy: x.policy, request: x.request,
    runtime: { codexHome: x.policy.home.physical_path, sha256: x.policy.client_sha256 }, verify, phase: "before_create", ...options });
  await check("direct path observer required", async () => { const x = fixture(); await assert.rejects(direct(x), code("QUALIFICATION_NATIVE_PROFILE_OBSERVER_REQUIRED")); });
  await check("direct path late synchronous callback is timeout", async () => {
    const x = fixture(), verifier = createCodexNativeProfileVerifier({ ...x, observer: async () => x.observation });
    await assert.rejects(direct(x, async (...args) => { const start = performance.now(); while (performance.now() - start < 4) {} return verifier(...args); }, { timeoutMs: 1 }), code("QUALIFICATION_NATIVE_PROFILE_TIMEOUT"));
  });
  await check("direct path callback late cancellation is refused", async () => {
    const x = fixture(), stop = new AbortController(), verifier = createCodexNativeProfileVerifier({ ...x, observer: async () => x.observation });
    await assert.rejects(direct(x, async (...args) => { const result = await verifier(...args); stop.abort(); return result; }, { signal: stop.signal }), code("QUALIFICATION_NATIVE_PROFILE_CANCELLED"));
  });
  return checks;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const checks = await runAgentNativeProfileObservationFixtures(); console.log(JSON.stringify({ ok: true, checks, native_codex: "NOT_RUN", postgres: "NOT_RUN", fixture_effects: "NONE" })); }
  catch (error) { console.error(JSON.stringify({ ok: false, code: error.code ?? error.name, message: error.message })); process.exitCode = 1; }
}
