import assert from "node:assert/strict";
import path from "node:path";
import { fingerprintAgentExecutionValue } from "../../src/core/agents/agent-execution-contracts.mjs";
import { buildCodexTaskArguments } from "../../src/adapters/agents/codex-cli-task-executor.mjs";
import { assertCodexNativeProfilePolicy, fingerprintCodexNativeProfilePolicy, assertCodexNativeProfileBinding,
  resolveCodexNativeProfileStatePaths } from "../../src/adapters/agents/codex-native-profile-policy.mjs";

// Contract doubles only: these responses never qualify a native profile.
export function nativeProfileFixturePolicy(runtime, stateRoot) {
  return { contract_version: "codex-native-profile-policy.v1", mode: "preexisting",
    home: { physical_path: runtime.codexHome, identity_sha256: "1".repeat(64) }, client_sha256: runtime.sha256,
    backend: { platform: "win32", architecture: "x64", sandbox: "elevated", provisioning: "existing-only" },
    configuration: { sources_sha256: "2".repeat(64), effective_settings_sha256: "3".repeat(64),
      mcp_server_ids: ["server.with.dot space"], plugin_ids: ['plugin"quoted@local'], app_ids: ["synthetic.app"] },
    hooks_sha256: "4".repeat(64), effects: { state_root: stateRoot, shared_effects_sha256: "5".repeat(64) } };
}

export function nativeProfileFixtureDecision(request, { policy, phase, challenge }) {
  return { protocol_version: 1, ok: true, phase, challenge, policy_sha256: fingerprintCodexNativeProfilePolicy(policy),
    attempt_id: request.attempt_id, request_sha256: fingerprintAgentExecutionValue(request), home_identity_sha256: policy.home.identity_sha256,
    client_sha256: policy.client_sha256, backend: policy.backend.sandbox,
    sources_sha256: policy.configuration.sources_sha256, effective_settings_sha256: policy.configuration.effective_settings_sha256,
    hooks_sha256: policy.hooks_sha256, shared_effects_sha256: policy.effects.shared_effects_sha256,
    unexpected_hooks: 0, integrations_disabled: true, environment_restricted: true, provisioning_performed: false };
}

export async function verifyNativeProfileFixtures({ check, setup, cwd }) {
  await check("native profile policy is strict pure canonical JSON", () => {
    const { runtime } = setup({ nativeProfile: true }), policy = runtime.nativeProfilePolicy;
    const original = structuredClone(policy), reversed = Object.fromEntries(Object.entries(policy).reverse());
    assertCodexNativeProfilePolicy(policy);
    assert.equal(fingerprintCodexNativeProfilePolicy(policy), fingerprintCodexNativeProfilePolicy(reversed));
    assert.deepEqual(policy, original);
    for (const mutate of [p => { p.unknown = true; }, p => { p.backend.provisioning = "repair"; },
      p => { p.configuration.plugin_ids.push(p.configuration.plugin_ids[0]); }, p => { p.configuration.mcp_server_ids = ["unsafe\nname"]; },
      p => { p.home.identity_sha256 = "bad"; }, p => { p.effects.state_root = p.home.physical_path; },
      p => { Object.defineProperty(p, "mode", { get() { throw new Error("getter invoked"); }, enumerable: true }); }]) {
      const invalid = structuredClone(policy); mutate(invalid);
      assert.throws(() => assertCodexNativeProfilePolicy(invalid), /CODEX_NATIVE_PROFILE_POLICY_INVALID/);
    }
    for (const mutate of [p => { p.configuration.sources_sha256 = "6".repeat(64); }, p => { p.effects.shared_effects_sha256 = "6".repeat(64); }]) {
      const changed = structuredClone(policy); mutate(changed);
      assert.notEqual(fingerprintCodexNativeProfilePolicy(changed), fingerprintCodexNativeProfilePolicy(policy));
    }
  });
  await check("native profile requires explicit policy verifier and finite budget without probes", () => {
    const { executor, calls } = setup({ nativeProfile: true }); executor.getDescriptor(); assert.deepEqual(calls, []);
    assert.throws(() => setup({ nativeProfile: true, omitProfileVerifier: true }), /VERIFIER_REQUIRED/);
    for (const value of [0, 10001, Infinity, 1.5]) assert.throws(() => setup({ nativeProfileTimeoutMs: value }), /PROFILE_LIMIT_INVALID/);
    assert.throws(() => setup({ nativeProfile: true, mutatePolicy: policy => { policy.client_sha256 = "0".repeat(64); } }), /BINDING_MISMATCH/);
    assert.throws(() => setup({ nativeProfile: true, mutatePolicy: policy => { policy.home.physical_path = path.join(cwd, "profile"); } }), /BINDING_MISMATCH/);
  });
  await check("profile reference never silently selects or drops a runtime policy", async () => {
    const explicit = setup({ nativeProfile: true }), legacy = setup();
    await assert.rejects(legacy.executor.runTask(explicit.request), /POLICY_REQUIRED/);
    await assert.rejects(explicit.executor.runTask(legacy.request), /POLICY_REQUIRED/);
    const foreign = structuredClone(explicit.request); foreign.execution.native_profile.policy_sha256 = "0".repeat(64);
    await assert.rejects(explicit.executor.runTask(foreign), /BINDING_MISMATCH/);
    assert.deepEqual(explicit.calls, []); assert.deepEqual(legacy.calls, []);
    assert.throws(() => buildCodexTaskArguments(explicit.request), /POLICY_REQUIRED/);
    const overlapping = structuredClone(explicit.request); overlapping.cwd = explicit.runtime.nativeProfilePolicy.effects.state_root;
    assert.throws(() => assertCodexNativeProfileBinding(explicit.runtime.nativeProfilePolicy, overlapping), /PATH_OVERLAP/);
  });
  await check("known inherited integrations get exact TOML keys and native hooks remain observable", () => {
    const { runtime, request } = setup({ nativeProfile: true }), policy = runtime.nativeProfilePolicy;
    const args = buildCodexTaskArguments(request, { nativeProfilePolicy: policy });
    assert(args.includes('mcp_servers={"server.with.dot space"={enabled=false}}'));
    assert(args.includes('plugins={"plugin\\"quoted@local"={enabled=false}}'));
    assert(args.includes('apps={"_default"={enabled=false},"synthetic.app"={enabled=false}}'));
    for (const setting of ["features.plugins=false", "features.apps=false", "notify=[]", 'model_provider="openai"',
      'history.persistence="none"', "memories.generate_memories=false", "memories.use_memories=false", "features.memories=false",
      'developer_instructions=""', 'instructions=""', "sandbox_workspace_write.network_access=false"]) assert(args.includes(setting));
    assert(!args.some(arg => arg.startsWith("hooks="))); assert(!args.includes("--ignore-user-config"));
    assert.equal(args.at(-1), "-");
    const state = resolveCodexNativeProfileStatePaths(policy, request);
    assert(args.includes(`log_dir=${JSON.stringify(state.logs)}`)); assert(args.includes(`sqlite_home=${JSON.stringify(state.sqlite)}`));
    const another = structuredClone(request); another.attempt_id += ".next";
    assert.notEqual(resolveCodexNativeProfileStatePaths(policy, another).root, state.root);
    assert.equal(path.dirname(state.root), policy.effects.state_root);
  });
  await check("profile and canonical admission are independently rechecked before create and resume", async () => {
    const { executor, request, calls } = setup({ nativeProfile: true });
    assert.equal((await executor.runTask(request)).outcome, "completed");
    assert.deepEqual(calls.filter(call => /^(intent|profile:|admission:|run$|observed|resumed)/.test(call)),
      ["intent", "profile:before_create", "admission:before_create", "run", "observed", "profile:before_resume", "admission:before_resume", "resumed"]);
  });
  await check("native profile decision rejects drift extra hooks inherited integrations and foreign evidence", async () => {
    for (const changed of [{ ok: false }, { attempt_id: "foreign" }, { request_sha256: "0".repeat(64) }, { policy_sha256: "0".repeat(64) },
      { home_identity_sha256: "0".repeat(64) }, { client_sha256: "0".repeat(64) }, { backend: "unelevated" }, { sources_sha256: "0".repeat(64) },
      { effective_settings_sha256: "0".repeat(64) }, { hooks_sha256: "0".repeat(64) }, { shared_effects_sha256: "0".repeat(64) },
      { unexpected_hooks: 1 }, { integrations_disabled: false }, { environment_restricted: false }, { provisioning_performed: true },
      { phase: "before_resume" }, { challenge: "00000000-0000-0000-0000-000000000000" }, { unknown: true }]) {
      const { executor, request, calls } = setup({ nativeProfile: true, profileVerification: async (_req, _opts, decision) => ({ ...decision, ...changed }) });
      const result = await executor.runTask(request);
      assert.equal(result.reason_code, "CODEX_NATIVE_PROFILE_VERIFICATION_REFUSED"); assert.equal(result.termination_state, "not_started");
      assert(!calls.includes("run")); assert(!calls.includes("admission:before_create"));
    }
  });
  await check("profile evidence from before_create cannot authorize the suspended process", async () => {
    let previous;
    const { executor, request, calls } = setup({ nativeProfile: true, profileVerification: async (_req, _opts, decision) => previous ??= decision });
    const result = await executor.runTask(request);
    assert.equal(result.reason_code, "CODEX_NATIVE_PROFILE_VERIFICATION_REFUSED"); assert(calls.includes("stop")); assert(!calls.includes("resumed"));
  });
  await check("profile verifier cannot mutate the frozen request policy or preparation bindings", async () => {
    const { executor, request } = setup({ nativeProfile: true, profileVerification: async (req, opts, decision) => {
      req.execution.model = "foreign"; opts.policy.configuration.plugin_ids.length = 0; return decision;
    } });
    assert.equal((await executor.runTask(request)).outcome, "completed");
  });
  await check("profile verification has its own budget without extending event callbacks", async () => {
    const { executor, request } = setup({ nativeProfile: true, callbackTimeoutMs: 250, nativeProfileTimeoutMs: 750,
      profileVerification: async (_req, _opts, decision) => { await new Promise(resolve => setTimeout(resolve, 300)); return decision; } });
    assert.equal((await executor.runTask(request)).outcome, "completed");
  });
  await check("late profile verification after its deadline never resumes", async () => {
    let finish, signal;
    const { executor, request, calls } = setup({ nativeProfile: true, nativeProfileTimeoutMs: 40,
      profileVerification: async (_req, options, decision) => {
        if (options.phase === "before_create") return decision;
        signal = options.signal; return new Promise(resolve => { finish = () => resolve(decision); });
      } });
    const result = await executor.runTask(request);
    assert.equal(result.reason_code, "CODEX_NATIVE_PROFILE_TIMEOUT"); assert(signal.aborted); assert(!calls.includes("resumed"));
    finish(); await new Promise(resolve => setImmediate(resolve)); assert(!calls.includes("resumed"));
  });
  await check("synchronous native profile work cannot outrun its deadline", async () => {
    const { executor, request, calls } = setup({ nativeProfile: true, nativeProfileTimeoutMs: 40,
      profileVerification: async (_req, _opts, decision) => { const until = performance.now() + 60; while (performance.now() < until) {} return decision; } });
    assert.equal((await executor.runTask(request)).reason_code, "CODEX_NATIVE_PROFILE_TIMEOUT"); assert(!calls.includes("run"));
  });
  await check("cancellation during suspended profile verification ignores a late successful observation", async () => {
    let finish, signal; const abort = new AbortController();
    const { executor, request, calls } = setup({ nativeProfile: true, profileVerification: async (_req, options, decision) => {
      if (options.phase === "before_create") return decision;
      signal = options.signal; queueMicrotask(() => abort.abort()); return new Promise(resolve => { finish = () => resolve(decision); });
    } });
    const result = await executor.runTask(request, { signal: abort.signal });
    assert.equal(result.outcome, "cancelled"); assert(signal.aborted); assert(!calls.includes("resumed"));
    finish(); await new Promise(resolve => setImmediate(resolve)); assert(!calls.includes("resumed"));
  });
  await check("task deadline bounds the native profile verification budget", async () => {
    let signal;
    const { executor, request, calls } = setup({ nativeProfile: true, profileVerification: async (_req, options) => { signal = options.signal; return new Promise(() => {}); } });
    request.limits.max_duration_ms = 500;
    assert.equal((await executor.runTask(request)).outcome, "timed_out"); assert(signal.aborted); assert(!calls.includes("run"));
  });
}
