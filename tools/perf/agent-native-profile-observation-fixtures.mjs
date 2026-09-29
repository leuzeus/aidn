import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createCodexMetadataRpcDiagnostic, sanitizeCodexMetadataRpcDiagnostic } from "../../src/adapters/agents/codex-metadata-rpc-diagnostic.mjs";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { fingerprintAgentExecutionValue as fingerprint } from "../../src/core/agents/agent-execution-contracts.mjs";
import * as profile from "../../src/adapters/agents/codex-native-profile-policy.mjs";
import { normalizeCodexNativeProfileConfiguration, validateCodexNativeProfileMetadata,
  createCodexNativeProfileVerifier, collectCodexNativeProfileMetadata,
  buildCodexNativeProfileObservationArguments, assertCodexNativeProfileBootstrap,
  createCodexNativeProfileObserver, CODEX_NATIVE_PROFILE_SHARED_EFFECTS, CODEX_NATIVE_PROFILE_SHARED_EFFECTS_V2,
  readCodexNativeProfileSharedEffects,
  discoverCodexNativeProfileMetadata, discoverCodexNativeProfileEnvironmentOverrideNames } from "../verify/agent-native-profile-observation.mjs";
import { assertNativeQualificationProfileReview } from "../verify/qualify-agent-native-worker.mjs";
import { verifyNativeQualificationProfile } from "../verify/agent-native-qualification-driver.mjs";

const clone = structuredClone;
const H = letter => letter.repeat(64);
function fixture({ managed = false } = {}) {
  const base = path.join(os.tmpdir(), "aidn-profile-observation-pure"), home = path.join(base, "home"), stateRoot = path.join(base, "state");
  const policy = { contract_version: "codex-native-profile-policy.v1", mode: "preexisting", home: { physical_path: home, identity_sha256: H("a") },
    client_sha256: H("b"), backend: { platform: "win32", architecture: "x64", sandbox: "elevated", provisioning: "existing-only" },
    configuration: { sources_sha256: H("c"), effective_settings_sha256: H("d"), mcp_server_ids: ["one.with space"], plugin_ids: ["synthetic@local"], app_ids: ["app1"], environment_override_names: ["SYNTHETIC_EXTRA"] },
    hooks_sha256: H("e"), effects: { state_root: stateRoot, shared_effects_sha256: H("f") } };
  if (managed) {
    policy.contract_version = "codex-native-profile-policy.v2"; policy.backend.provisioning = "codex-managed";
    policy.effects.shared_effects_sha256 = fingerprint(CODEX_NATIVE_PROFILE_SHARED_EFFECTS_V2);
  }
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
    shell_environment_policy: { set: { SYNTHETIC_EXTRA: "" }, inherit: "all", ignore_default_excludes: true,
      filters: Object.fromEntries(profile.CODEX_NATIVE_PROFILE_ENVIRONMENT_NAMES.map(name => [name, "include"])) },
    sandbox_workspace_write: { network_access: false, writable_roots: [], exclude_tmpdir_env_var: true, exclude_slash_tmp: true } };
  const sourceFiles = [{ path: path.join(home, "config.toml"), present: true, size: 3, sha256: H("a") }];
  const metadata = { configs: manifest.roots.slice(1).map(() => ({ config: clone(config), layers: [
    { name: { type: "sessionFlags" }, version: "sha256:" + H("a"), config: { sqlite_home: state.sqlite } },
    { name: { type: "user", file: sourceFiles[0].path }, version: "sha256:" + H("b"), config: { inherited: "fake-secret-do-not-retain" } }] })),
    hooks: { data: manifest.roots.slice(1).map(root => ({ cwd: root.root, warnings: [], errors: [], hooks: ["preToolUse", "sessionStart"].map(eventName => ({
      eventName, sourcePath: manifest.roots[0].hooks.config.path, source: "project", enabled: true, trustStatus: "trusted", handlerType: "command", async: false,
      currentHash: "sha256:" + H(eventName === "preToolUse" ? "c" : "d"), matcher: ".*", timeoutSec: 600,
      command: eventName === "preToolUse" ? "synthetic-before" : "synthetic-start" })) })) },
    readiness: { status: "ready" }, process: { closed: true, pid_absent: true, exit_code: 0, signal: null, response_count: 5, budget_ms: 10000 } };
  const result = validateCodexNativeProfileMetadata({ metadata, manifest, policy, request, sourceFiles });
  policy.configuration.sources_sha256 = result.sources_sha256; policy.configuration.effective_settings_sha256 = result.effective_settings_sha256; policy.hooks_sha256 = result.hooks_sha256;
  request.execution.native_profile.policy_sha256 = profile.fingerprintCodexNativeProfilePolicy(policy);
  const consent = { approved: true, shared_effects_sha256: policy.effects.shared_effects_sha256, state_root: policy.effects.state_root,
    ...(managed ? { sandbox_maintenance: "codex-managed" } : {}) };
  const review = { native_profile: { mode: "preexisting", policy_sha256: profile.fingerprintCodexNativeProfilePolicy(policy), consent } };
  const observation = { protocol_version: managed ? 2 : 1, status: "verified", ...result, home_identity_sha256: policy.home.identity_sha256, client_sha256: policy.client_sha256,
    shared_effects_sha256: policy.effects.shared_effects_sha256, setup_sha256: H("1"), process: metadata.process, preservation: "PASS", ...profile.codexNativeProfilePreservationEvidence(policy), environment_restricted: true };
  return { policy, request, manifest, config, metadata, sourceFiles, consent, review, observation };
}

function doubleTransport({ alter, append = () => [], silent = false, leaveAlive = false, chunked = false } = {}) {
  const calls = [], writes = []; let alive = false;
  const spawnProcess = () => {
    alive = true; const child = new EventEmitter(); child.pid = 12345; child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const close = () => { if (leaveAlive) return; alive = false; child.emit("close", 0, null); };
    child.kill = () => { queueMicrotask(close); return true; };
    child.stdin = new Writable({ write(chunk, encoding, callback) {
      const message = JSON.parse(chunk.toString()); calls.push(message);
      if (message.id && !silent) queueMicrotask(() => {
        const reply = alter ? alter(message) : { id: message.id, result: { marker: "été", method: message.method } };
        const bytes = Buffer.from([reply, ...append(message)].map(row => JSON.stringify(row) + "\r\n").join(""));
        if (chunked) for (const byte of bytes) child.stdout.write(Buffer.from([byte])); else child.stdout.write(bytes);
      }); callback();
    }, final(callback) { callback(); queueMicrotask(close); } });
    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = (chunk, ...args) => { writes.push(JSON.parse(chunk.toString())); return write(chunk, ...args); };
    return child;
  };
  return { spawnProcess, isAlive: () => alive, calls, writes };
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
  await check("preexisting metadata argv uses explicit compatibility without bypassing native trust or sandbox", () => {
    const x = fixture(), args = buildCodexNativeProfileObservationArguments(x.policy, x.request);
    for (const forbidden of ["--strict-config", "--ignore-user-config", "--dangerously-bypass-approvals-and-sandbox", "--yolo", "--full-auto"])
      assert.equal(args.includes(forbidden), false);
    assert.deepEqual(args.slice(-3), ["app-server", "--listen", "stdio://"]);
    const settings = args.filter((value, index) => args[index - 1] === "-c");
    for (const expected of ['sandbox_mode="workspace-write"', 'windows.sandbox="elevated"', 'approval_policy="never"',
      "sandbox_workspace_write.writable_roots=[]", "sandbox_workspace_write.network_access=false",
      "sandbox_workspace_write.exclude_tmpdir_env_var=true", "sandbox_workspace_write.exclude_slash_tmp=true"])
      assert.equal(settings.includes(expected), true);
    x.request.execution.sandbox = "read-only";
    assert.equal(buildCodexNativeProfileObservationArguments(x.policy, x.request).includes('sandbox_mode="read-only"'), true);
  });
  await check("inert legacy fields are accepted but remain material to observed hashes", () => {
    const x = fixture(), before = validate(x);
    for (const response of x.metadata.configs) {
      response.config.windows_wsl_setup_acknowledged = true;
      response.config.profiles = { inactive_example: { openai_base_url: "https://example.invalid/unused" } };
      response.layers[1].config.windows_wsl_setup_acknowledged = true;
      response.layers[1].config.profiles = clone(response.config.profiles);
    }
    const after = validate(x);
    assert.equal(after.integrations_disabled, true);
    assert.notEqual(after.sources_sha256, before.sources_sha256);
    assert.notEqual(after.effective_settings_sha256, before.effective_settings_sha256);
  });
  await check("legacy compatibility never accepts an active provider override", () => {
    const x = fixture(); x.metadata.configs[0].config.windows_wsl_setup_acknowledged = true;
    x.metadata.configs[0].config.openai_base_url = "https://example.invalid/active";
    assert.throws(() => validate(x), code("PROFILE_PROVIDER_OVERRIDE_REFUSED"));
  });
  await check("environment discovery retains only names and rejects ambiguous Windows aliases", () => {
    const configs = [{ config: { shell_environment_policy: { set: { SYNTHETIC_EXTRA: "fake-secret-never-export", SECOND_VARIABLE: "different-private-value" } } } }];
    const names = discoverCodexNativeProfileEnvironmentOverrideNames(configs);
    assert.deepEqual(names, ["SECOND_VARIABLE", "SYNTHETIC_EXTRA"]); assert.equal(JSON.stringify(names).includes("fake-secret"), false);
    assert.deepEqual(discoverCodexNativeProfileEnvironmentOverrideNames([...configs, ...clone(configs)]), names);
    configs[0].config.shell_environment_policy.set.synthetic_extra = "";
    assert.throws(() => discoverCodexNativeProfileEnvironmentOverrideNames(configs), code("CODEX_NATIVE_PROFILE_ENVIRONMENT_NAMES_INVALID"));
  });
  await check("explicit empty values neutralize inherited table entries while final filters remove their names", () => {
    const x = fixture(), args = buildCodexNativeProfileObservationArguments(x.policy, x.request);
    assert.equal(args.includes('shell_environment_policy.set={"SYNTHETIC_EXTRA"=""}'), true);
    assert.equal(args.includes('shell_environment_policy.inherit="all"'), true);
    assert.equal(args.includes("shell_environment_policy.ignore_default_excludes=true"), true);
    assert.equal(args.some(arg => arg.startsWith("shell_environment_policy.include_only=") || arg.startsWith("shell_environment_policy.exclude=")), false);
    const environment = x.metadata.configs[0].config.shell_environment_policy;
    assert.equal(Object.hasOwn(environment.filters, "SYNTHETIC_EXTRA"), false);
    assert.equal(validate(x).integrations_disabled, true);
    // An empty TOML table would merge with this value rather than erase it.
    environment.set.SYNTHETIC_EXTRA = "still-inherited";
    assert.throws(() => validate(x), code("PROFILE_ENVIRONMENT_OVERRIDE_REFUSED"));
  });
  await check("empty legacy lists are inert but broadened or narrowing lists are refused", () => {
    const x = fixture(), environment = x.metadata.configs[0].config.shell_environment_policy;
    environment.include_only = []; environment.exclude = null; assert.equal(validate(x).integrations_disabled, true);
    environment.include_only = ["*"];
    assert.throws(() => validate(x), code("PROFILE_ENVIRONMENT_FILTER_REFUSED"));
    environment.include_only = []; environment.exclude = ["PATH"];
    assert.throws(() => validate(x), code("PROFILE_ENVIRONMENT_FILTER_REFUSED"));
  });
  const mutations = [
    ["active MCP", x => { x.metadata.configs[0].config.mcp_servers["one.with space"].enabled = true; }, "PROFILE_INTEGRATION_ACTIVE_OR_CHANGED"],
    ["new integration", x => { x.metadata.configs[0].config.plugins.unknown = { enabled: false }; }, "PROFILE_INTEGRATION_ACTIVE_OR_CHANGED"],
    ["provider override", x => { x.metadata.configs[0].config.model_providers = { openai: { env_key: "FAKE" } }; }, "PROFILE_PROVIDER_OVERRIDE_REFUSED"],
    ["shell credential override", x => { x.metadata.configs[0].config.shell_environment_policy = { set: { FAKE: "synthetic" } }; }, "PROFILE_ENVIRONMENT_OVERRIDE_REFUSED"],
    ["new inherited environment name even if blank", x => { x.metadata.configs[0].config.shell_environment_policy.set.NEW_NAME = ""; }, "PROFILE_ENVIRONMENT_OVERRIDE_REFUSED"],
    ["case drift in frozen environment name", x => { const env = x.metadata.configs[0].config.shell_environment_policy.set; delete env.SYNTHETIC_EXTRA; env.synthetic_extra = ""; }, "PROFILE_ENVIRONMENT_OVERRIDE_REFUSED"],
    ["inherited filter broadening", x => { x.metadata.configs[0].config.shell_environment_policy.filters["*"] = "include"; }, "PROFILE_ENVIRONMENT_FILTER_REFUSED"],
    ["inherited filter admits blank override", x => { x.metadata.configs[0].config.shell_environment_policy.filters.SYNTHETIC_EXTRA = "include"; }, "PROFILE_ENVIRONMENT_FILTER_REFUSED"],
    ["filter removes required path", x => { x.metadata.configs[0].config.shell_environment_policy.filters.PATH = "exclude"; }, "PROFILE_ENVIRONMENT_FILTER_REFUSED"],
    ["environment inheritance changed", x => { x.metadata.configs[0].config.shell_environment_policy.inherit = "core"; }, "PROFILE_ENVIRONMENT_FILTER_REFUSED"],
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
  for (const managed of [false, true]) for (const [name, mutate, expected] of mutations) await check((managed ? "v2: " : "") + name, () => {
    const value = fixture({ managed }); mutate(value); assert.throws(() => validate(value), code(expected));
  });
  await check("v2 effect policy is explicit and excludes immutable setup assertions without profile IO", () => {
    const effects = readCodexNativeProfileSharedEffects(undefined, "codex-native-profile-policy.v2");
    assert.deepEqual(effects, CODEX_NATIVE_PROFILE_SHARED_EFFECTS_V2);
    assert.notEqual(fingerprint(effects), fingerprint(CODEX_NATIVE_PROFILE_SHARED_EFFECTS));
    assert.equal(Object.hasOwn(effects, "immutable_setup_sha256"), false);
    assert.match(effects.evidence_limit, /do not establish unchanged Windows/u);
    assert.throws(() => readCodexNativeProfileSharedEffects(undefined, "unknown"), code("CODEX_NATIVE_PROFILE_POLICY_INVALID"));
  });
  await check("v2 requires explicit maintenance consent and its exact effect hash before observation", () => {
    const x = fixture({ managed: true }); assert.deepEqual(assertNativeQualificationProfileReview(x).consent, x.consent);
    for (const mutate of [
      value => { delete value.consent.sandbox_maintenance; },
      value => { value.consent.sandbox_maintenance = "existing-only"; },
      value => { value.consent.extra = true; },
      value => { value.policy.effects.shared_effects_sha256 = H("f"); value.consent.shared_effects_sha256 = H("f");
        value.review.native_profile.policy_sha256 = profile.fingerprintCodexNativeProfilePolicy(value.policy); },
    ]) {
      const value = fixture({ managed: true }); mutate(value); let calls = 0;
      assert.throws(() => createCodexNativeProfileVerifier({ ...value, observer: async () => { calls++; } }), code("PROFILE_EXPLICIT_CONSENT_REQUIRED"));
      assert.throws(() => assertNativeQualificationProfileReview(value), code("QUALIFICATION_NATIVE_PROFILE_EFFECT_CONSENT_REQUIRED")); assert.equal(calls, 0);
    }
    const legacy = fixture(); legacy.consent.sandbox_maintenance = "codex-managed";
    assert.throws(() => createCodexNativeProfileVerifier(legacy), code("PROFILE_EXPLICIT_CONSENT_REQUIRED"));
  });
  await check("v2 metadata proposal rejects old consent without accessing the profile or collector", async () => {
    const x = fixture({ managed: true }); let calls = 0;
    await assert.rejects(discoverCodexNativeProfileMetadata({ ...x, policyTemplate: x.policy,
      consent: { approved: true, metadata_only: true, state_root: x.policy.effects.state_root }, collect: async () => { calls++; } }),
    code("PROFILE_EXPLICIT_CONSENT_REQUIRED")); assert.equal(calls, 0);
  });
  await check("v2 internal sandbox files may change while protected observations and bootstrap remain exact", async () => {
    const x = fixture({ managed: true }); let count = 0;
    const verifier = createCodexNativeProfileVerifier({ ...x, observer: async options => ({
      ...clone(x.observation), setup_sha256: H(String(++count)), process: { ...x.observation.process, budget_ms: options.timeoutMs },
    }) });
    const bootstrap = await verifier.bootstrap(x.request);
    assert.equal(bootstrap.protocol_version, 2); assert.equal(bootstrap.authorization, "NOT_GRANTED");
    assert.equal(bootstrap.sandbox_maintenance, "codex-managed"); assert.equal(bootstrap.protected_resources_preserved, true);
    assert.equal(Object.hasOwn(bootstrap, "provisioning_performed"), false);
    const context = { phase: "before_create", challenge: "11111111-1111-1111-1111-111111111111" };
    const decision = await verifier(x.request, context);
    assert.equal(profile.assertCodexNativeProfileVerification(decision, { ...context, policy: x.policy, request: x.request }), true);
    const final = await verifier.finalize({}); assert.equal(final.setup_sha256, H("3"));
    assert.equal(final.protected_resources_preserved, true); assert.equal(Object.hasOwn(final, "provisioning_performed"), false);
    assert.match(final.evidence_limit, /do not establish unchanged Windows/u);
  });
  await check("v1 still rejects changed internal sandbox files between observations", async () => {
    const x = fixture(); let count = 0;
    const verifier = createCodexNativeProfileVerifier({ ...x, observer: async () => ({ ...clone(x.observation), setup_sha256: H(String(++count)) }) });
    await verifier(x.request, { phase: "before_create", challenge: "11111111-1111-1111-1111-111111111111" });
    await assert.rejects(verifier.finalize({}), code("PROFILE_PRESERVATION_FAILED"));
  });
  for (const mutate of [
    value => { value.protocol_version = 1; }, value => { value.provisioning_performed = false; },
    value => { value.protected_resources_preserved = false; }, value => { value.sources_sha256 = H("0"); },
    value => { value.hooks_sha256 = H("0"); }, value => { value.environment_restricted = false; },
  ]) await check("v2 refuses legacy or changed protected evidence", async () => {
    const x = fixture({ managed: true }); mutate(x.observation);
    const verifier = createCodexNativeProfileVerifier({ ...x, observer: async () => x.observation });
    await assert.rejects(verifier(x.request, { phase: "before_create", challenge: "11111111-1111-1111-1111-111111111111" }), code("PROFILE_OBSERVATION_INCOMPLETE"));
  });

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
  await check("bootstrap prepares exact request state but cannot substitute verification", async () => {
    const x = fixture(), calls = [];
    const verifier = createCodexNativeProfileVerifier({ ...x, observer: async options => {
      calls.push({ request: options.request, metadataBootstrap: options.metadataBootstrap, timeoutMs: options.timeoutMs });
      return { ...clone(x.observation), process: { ...x.observation.process, budget_ms: options.timeoutMs } };
    } });
    const result = await verifier.bootstrap(x.request, {});
    assert.equal(assertCodexNativeProfileBootstrap(result, x), true);
    assert.equal(result.authorization, "NOT_GRANTED"); assert.equal(result.native_execution, "NOT_RUN");
    assert.equal(Object.hasOwn(result, "ok"), false); assert.equal(Object.hasOwn(result, "challenge"), false);
    assert.equal(result.state_root, profile.resolveCodexNativeProfileStatePaths(x.policy, x.request).root);
    await assert.rejects(verifier.finalize({ request: x.request }), code("PROFILE_INITIAL_OBSERVATION_REQUIRED"));
    assert.throws(() => profile.assertCodexNativeProfileVerification(result, { policy: x.policy, request: x.request, phase: "before_create", challenge: "11111111-1111-1111-1111-111111111111" }), code("CODEX_NATIVE_PROFILE_VERIFICATION_REFUSED"));
    await verifier(x.request, { phase: "before_create", challenge: "11111111-1111-1111-1111-111111111111", timeoutMs: 60000 });
    assert.deepEqual(calls.map(call => [call.metadataBootstrap, call.timeoutMs]), [[true, 60000], [false, 10000]]);
    assert.deepEqual(calls[0].request, calls[1].request);
  });
  await check("bootstrap evidence cannot transfer between attempts or changed requests", async () => {
    const x = fixture(), verifier = createCodexNativeProfileVerifier({ ...x, observer: async options => ({ ...clone(x.observation), process: { ...x.observation.process, budget_ms: options.timeoutMs } }) });
    const result = await verifier.bootstrap(x.request);
    for (const mutate of [request => { request.attempt_id = "attempt-2"; }, request => { request.cwd = x.manifest.roots[2].root; }, request => { request.instruction = "changed"; }]) {
      const changed = clone(x.request); mutate(changed);
      assert.throws(() => assertCodexNativeProfileBootstrap(result, { policy: x.policy, request: changed }), code("PROFILE_BOOTSTRAP_REFUSED"));
    }
    for (const mutate of [proof => { proof.process.pid_absent = false; }, proof => { proof.budget_ms = 60001; }, proof => { proof.authorization = "GRANTED"; }, proof => { proof.state_root = x.policy.effects.state_root; }]) {
      const changed = clone(result); mutate(changed); assert.throws(() => assertCodexNativeProfileBootstrap(changed, x), code("PROFILE_BOOTSTRAP_REFUSED"));
    }
  });
  await check("successful bootstrap does not conceal fresh verification failure", async () => {
    const x = fixture(); let calls = 0;
    const verifier = createCodexNativeProfileVerifier({ ...x, observer: async options => {
      calls++; if (!options.metadataBootstrap) throw Object.assign(new Error("PROFILE_POLICY_OBSERVATION_CHANGED"), { code: "PROFILE_POLICY_OBSERVATION_CHANGED" });
      return { ...clone(x.observation), process: { ...x.observation.process, budget_ms: options.timeoutMs } };
    } });
    await verifier.bootstrap(x.request);
    await assert.rejects(verifier(x.request, { phase: "before_create", challenge: "11111111-1111-1111-1111-111111111111" }), code("PROFILE_POLICY_OBSERVATION_CHANGED"));
    assert.equal(calls, 2);
  });
  await check("bootstrap failure and timeout stop without retry or initial observation", async () => {
    for (const expected of ["PROFILE_METADATA_TIMEOUT", "PROFILE_METADATA_TERMINATION_UNCONFIRMED"]) {
      const x = fixture(); let calls = 0;
      const verifier = createCodexNativeProfileVerifier({ ...x, observer: async () => { calls++; throw Object.assign(new Error(expected), { code: expected }); } });
      await assert.rejects(verifier.bootstrap(x.request), code(expected)); assert.equal(calls, 1);
      await assert.rejects(verifier.finalize({ request: x.request }), code("PROFILE_INITIAL_OBSERVATION_REQUIRED"));
    }
  });
  await check("bootstrap cancellation and invalid budget refuse before observation", async () => {
    const x = fixture(); let calls = 0; const verifier = createCodexNativeProfileVerifier({ ...x, observer: async () => { calls++; } });
    await assert.rejects(verifier.bootstrap(x.request, { signal: AbortSignal.abort() }), code("PROFILE_METADATA_CANCELLED"));
    for (const timeoutMs of [0, -1, 60001, 1.5]) await assert.rejects(verifier.bootstrap(x.request, { timeoutMs }), code("PROFILE_METADATA_TIMEOUT_INVALID"));
    assert.equal(calls, 0);
  });
  await check("ordinary observer cannot select extended preparation budget", async () => {
    let calls = 0; const observer = createCodexNativeProfileObserver({ collect: async () => { calls++; } });
    await assert.rejects(observer({ timeoutMs: 60000 }), code("PROFILE_METADATA_TIMEOUT_INVALID")); assert.equal(calls, 0);
  });
  await check("late bootstrap cancellation retains closure evidence and never prepares verification", async () => {
    const x = fixture(), stop = new AbortController();
    const verifier = createCodexNativeProfileVerifier({ ...x, observer: async options => {
      stop.abort(); return { ...clone(x.observation), process: { ...x.observation.process, budget_ms: options.timeoutMs } };
    } });
    await assert.rejects(verifier.bootstrap(x.request, { signal: stop.signal }), error => error.code === "PROFILE_METADATA_CANCELLED" && error.process.closed && error.process.pid_absent);
    await assert.rejects(verifier.finalize({ request: x.request }), code("PROFILE_INITIAL_OBSERVATION_REQUIRED"));
  });
  await check("discovery bootstrap rejects invalid intent and cancellation before profile access", async () => {
    let calls = 0; const collect = async () => { calls++; };
    await assert.rejects(discoverCodexNativeProfileMetadata({ bootstrapMetadata: "yes", collect }), code("PROFILE_METADATA_TIMEOUT_INVALID"));
    await assert.rejects(discoverCodexNativeProfileMetadata({ bootstrapMetadata: true, bootstrapTimeoutMs: 60001, collect }), code("PROFILE_METADATA_TIMEOUT_INVALID"));
    await assert.rejects(discoverCodexNativeProfileMetadata({ bootstrapMetadata: true, signal: AbortSignal.abort(), collect }), code("PROFILE_METADATA_CANCELLED"));
    assert.equal(calls, 0);
  });
  await check("historical metadata copying is material to effect consent", () => {
    const current = clone(CODEX_NATIVE_PROFILE_SHARED_EFFECTS), previous = clone(current);
    assert.equal(current.allowed_effects.some(effect => effect.includes("titles, first user messages and previews")), true);
    previous.allowed_effects = previous.allowed_effects.filter(effect => !effect.includes("historical metadata"));
    assert.notEqual(fingerprint(previous), fingerprint(current));
    const x = fixture(); x.policy.effects.shared_effects_sha256 = fingerprint(current); x.consent.shared_effects_sha256 = fingerprint(previous);
    assert.throws(() => createCodexNativeProfileVerifier(x), code("PROFILE_EXPLICIT_CONSENT_REQUIRED"));
  });
  await check("metadata transport uses only five permitted requests and initialized", async () => {
    const transport = doubleTransport({ chunked: true }), x = fixture();
    const result = await collectCodexNativeProfileMetadata({ executable: "never-executed", args: [], cwd: x.request.cwd, env: {}, roots: x.manifest.roots.slice(1) }, transport);
    assert.equal(result.process.budget_ms, 10000);
    assert.equal(result.process.pid_absent, true); assert.deepEqual(transport.calls.map(x => x.method), ["initialize", "initialized", "config/read", "config/read", "hooks/list", "windowsSandbox/readiness"]);
    assert.equal(result.configs[0].marker, "été");
  });
  await check("historical one-root metadata preserves four responses and no requirements field", async () => {
    const x = fixture(), transport = doubleTransport();
    const result = await collectCodexNativeProfileMetadata({ roots: x.manifest.roots.slice(1, 2) }, transport);
    assert.equal(result.process.response_count, 4); assert.equal(Object.hasOwn(result, "requirements"), false);
    assert(!transport.calls.some(row => row.method === "configRequirements/read"));
  });
  for (const invalid of [undefined, null, false, "managed-setup.v1", "managed-setup.v2", "", {}]) await check("explicit metadata profile refused before spawn " + String(invalid), async () => {
    const x = fixture(); let calls = 0;
    await assert.rejects(collectCodexNativeProfileMetadata({ roots: x.manifest.roots.slice(1, 2), metadataProfile: invalid }, { spawnProcess() { calls++; } }), code("PROFILE_METADATA_PROFILE_INVALID"));
    assert.equal(calls, 0);
  });
  await check("readiness remains an observation without execution authority", async () => {
    const x = fixture(), transport = doubleTransport({ alter: message => ({ id: message.id,
      result: message.method === "windowsSandbox/readiness" ? { status: "updateRequired" } : {} }) });
    const result = await collectCodexNativeProfileMetadata({ roots: x.manifest.roots.slice(1, 2) }, transport);
    assert.equal(result.readiness.status, "updateRequired"); assert.equal(Object.hasOwn(result, "authorized"), false);
    assert.equal(transport.calls.length, 5);
  });
  await check("extended transport budget must be explicit and is capped at sixty seconds", async () => {
    const x = fixture(), transport = doubleTransport();
    const result = await collectCodexNativeProfileMetadata({ roots: x.manifest.roots.slice(1) }, { ...transport, timeoutMs: 60000 });
    assert.equal(result.process.budget_ms, 60000); assert.equal(result.process.closed, true);
    let calls = 0;
    await assert.rejects(collectCodexNativeProfileMetadata({ roots: x.manifest.roots.slice(1) }, { timeoutMs: 60001, spawnProcess() { calls++; } }), code("PROFILE_METADATA_TIMEOUT_INVALID"));
    assert.equal(calls, 0);
  });
  await check("first unexpected RPC stops all protocol writes in the same chunk", async () => {
    const transport = doubleTransport({ alter: () => ({ id: "synthetic-private-id", method: "item/tool/call", params: { secret: "synthetic-private-param" } }),
      append: request => [{ id: request.id, result: { secret: "synthetic-private-result" } }, { method: "thread/started" }] });
    const error = await collectCodexNativeProfileMetadata({ roots: fixture().manifest.roots.slice(1) }, transport).catch(error => error);
    assert.equal(error.code, "PROFILE_METADATA_UNEXPECTED_RPC");
    assert.deepEqual(transport.writes.map(row => row.method), ["initialize"]);
    assert.deepEqual(error.details?.metadata_rpc, { version: 1, kind: "server_request", method_type: "string", method: "item/tool/call",
      method_sha256: null, id_type: "string", phase: "awaiting_response", expected_method: "initialize", request_index: 1 });
    assert.equal(error.process.closed, true); assert.equal(error.process.pid_absent, true);
    assert(!JSON.stringify(error.details).includes("synthetic-private"));
  });
  await check("unknown RPC diagnostic hashes only its method and never retains payload or id", async () => {
    const method = "unknown/synthetic-private-method", transport = doubleTransport({ alter: () => ({ method, id: { secret: "synthetic-private-id" },
      params: { secret: "synthetic-private-param" }, result: "synthetic-private-result" }) });
    const error = await collectCodexNativeProfileMetadata({ roots: fixture().manifest.roots.slice(1) }, transport).catch(error => error);
    assert.equal(error.code, "PROFILE_METADATA_UNEXPECTED_RPC");
    const diagnostic = error.details?.metadata_rpc;
    assert(diagnostic); assert.equal(diagnostic.method, null); assert.equal(diagnostic.method_type, "string");
    assert.equal(diagnostic.method_sha256, createHash("sha256").update(method).digest("hex")); assert.equal(diagnostic.id_type, "object");
    assert(!JSON.stringify(diagnostic).includes("synthetic-private")); assert(Buffer.byteLength(JSON.stringify(diagnostic)) < 1024);
  });
  await check("RPC after the final response retains a complete phase without dispatch", async () => {
    const transport = doubleTransport({ append: request => request.method === "windowsSandbox/readiness"
      ? [{ method: "thread/started", params: { secret: "synthetic-private-param" } }] : [] });
    const error = await collectCodexNativeProfileMetadata({ roots: fixture().manifest.roots.slice(1) }, transport).catch(error => error);
    assert.equal(error.code, "PROFILE_METADATA_UNEXPECTED_RPC");
    assert.deepEqual(error.details?.metadata_rpc, { version: 1, kind: "notification", method_type: "string", method: "thread/started",
      method_sha256: null, id_type: "absent", phase: "after_responses", expected_method: "complete", request_index: 5 });
    assert.equal(error.process.response_count, 5);
    assert.deepEqual(transport.writes.map(row => row.method), ["initialize", "initialized", "config/read", "config/read", "hooks/list", "windowsSandbox/readiness"]);
  });
  await check("RPC diagnostics reject raw fields and accessors without hiding the refusal", () => {
    const value = createCodexMetadataRpcDiagnostic({ message: { id: null, method: "configWarning" },
      expectedMethod: "initialize", requestIndex: 1, phase: "awaiting_response" });
    assert.equal(value.kind, "server_request"); assert.equal(value.id_type, "null");
    assert.deepEqual(sanitizeCodexMetadataRpcDiagnostic(value), value);
    for (const invalid of [{ ...value, params: "synthetic-private-param" }, { ...value, id: "synthetic-private-id" },
      { ...value, method: "synthetic-private-method" }, { ...value, request_index: 8 },
      { ...value, phase: "after_responses" }, { ...value, method_sha256: H("a") }]) {
      assert.equal(sanitizeCodexMetadataRpcDiagnostic(invalid), null);
    }
    let accessed = false;
    const accessor = { ...value }; Object.defineProperty(accessor, "method", { enumerable: true, get() { accessed = true; throw Error("must not read"); } });
    assert.equal(sanitizeCodexMetadataRpcDiagnostic(accessor), null); assert.equal(accessed, false);
    const malformed = createCodexMetadataRpcDiagnostic({ message: { method: { private: "synthetic-private-method" } },
      expectedMethod: "hooks/list", requestIndex: 4, phase: "awaiting_response" });
    assert.equal(malformed.method_type, "object"); assert.equal(malformed.method, null); assert.equal(malformed.method_sha256, null);
    assert(!JSON.stringify(malformed).includes("synthetic-private"));
  });
  await check("known notification name with null server id remains refused", async () => {
    const transport = doubleTransport({ alter: () => ({ id: null, method: "configWarning", params: {} }) });
    const error = await collectCodexNativeProfileMetadata({ roots: fixture().manifest.roots.slice(1) }, transport).catch(error => error);
    assert.equal(error.code, "PROFILE_METADATA_UNEXPECTED_RPC"); assert.equal(error.details.metadata_rpc.id_type, "null");
    assert.equal(error.details.metadata_rpc.kind, "server_request"); assert.deepEqual(transport.writes.map(row => row.method), ["initialize"]);
  });
  await check("unknown termination remains primary while the first RPC diagnostic survives", async () => {
    const transport = doubleTransport({ leaveAlive: true, alter: () => ({ method: "thread/started", params: {} }) });
    const error = await collectCodexNativeProfileMetadata({ roots: fixture().manifest.roots.slice(1) }, transport).catch(error => error);
    assert.equal(error.code, "PROFILE_METADATA_TERMINATION_UNCONFIRMED");
    assert.equal(error.process.closed, false); assert.equal(error.process.pid_absent, false);
    assert.equal(error.details.metadata_rpc.method, "thread/started");
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
