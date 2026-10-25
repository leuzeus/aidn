#!/usr/bin/env node
import assert from "node:assert/strict";
import "./verify-local-clm-fixtures.mjs";
import "./verify-local-pilot-fixtures.mjs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contextBenchmarkCases, resolveContextCapabilities } from "../../src/core/context/context-capability-policy.mjs";
import { createContextLifecycleService } from "../../src/application/codex/context-lifecycle-service.mjs";
import { contextTelemetryFromNativeUsage } from "../../src/adapters/codex/context-native-telemetry.mjs";
import { assessNativeContextRound, assessNativeHookLifecycle } from "../verify/context-native-evidence-lib.mjs";
import { nativeProbeRootSettings, nativeProbeThreadParams, nativeProbeToolResponse, nativeProbeSchedulingInstructions, NATIVE_TOOL_SCHEDULING_POLICY, NATIVE_CONTEXT_OUTPUT_POLICY, isNativeTurnCompletion } from "../verify/context-native-rpc-lib.mjs";

const identity = { provider: "fixture", model: "fixture", model_revision: "fixture-r1", client: "fixture", client_version: "1" };
// Injected qualification exercises policy decisions; it is not native proof.
const qualified = { ...identity, proof_class: "native", mode: "model-owned", invariants: "pass", task_success: "pass",
  continuation: "pass", evidence_sha256: "a".repeat(64), new_context: "native-qualified",
  context_bench: Object.fromEntries(contextBenchmarkCases().map(name => [name, "pass"])),
  native_events: ["PreCompact", "PostCompact", "SessionStart", "SubagentStop"],
  valid_until: new Date(Date.now() + 3600000).toISOString() };
const calls = [];
const captured = { ok: true, working_memory: { status: "captured", requires_fresh_admission: true, capsule_file: "fixture" } };
const current = { status: "current", requires_fresh_admission: true, capsule: { execution_handoff: { attempt_id: "fixture" } } };
let checks = 0;
async function check(name, action) { await action(); checks += 1; console.log(`PASS ${name}`); }
try {
  await check("explicit continuation prepares only a freshly validated capsule without native qualification", async () => {
    const order = [];
    const service = createContextLifecycleService({ identity,
      checkpoint: async () => { order.push("checkpoint"); return captured; },
      resume: async (...args) => { assert.deepEqual(args, []); order.push("resume"); return current; },
      newContext: () => { throw new Error("manual continuation must not dispatch"); } });
    assert.equal((await service.prepareContinuation()).reason, "explicit_checkpoint_write_required");
    assert.deepEqual(order, []);
    const prepared = await service.prepareContinuation({ write: true });
    assert.equal(prepared.status, "continuation_prepared"); assert.equal(prepared.native_rollover, false);
    assert.equal(prepared.requires_fresh_admission, true); assert.equal(prepared.write_authorization, false);
    assert.deepEqual(prepared.resume, current); assert.deepEqual(order, ["checkpoint", "resume"]);
    assert.equal(service.capabilities.can_request_new_context, false);
  });
  await check("explicit continuation refuses stale, invalid or absent capsule and missing resume before effects", async () => {
    for (const result of [{ status: "stale", requires_fresh_admission: true },
      { status: "invalid", requires_fresh_admission: true }, { status: "current", requires_fresh_admission: true },
      { ...current, requires_fresh_admission: false }]) {
      const service = createContextLifecycleService({ identity, checkpoint: async () => captured, resume: async () => result });
      const refused = await service.prepareContinuation({ write: true });
      assert.equal(refused.reason, "fresh_capsule_unavailable"); assert.equal(refused.write_authorization, false);
      assert.equal(refused.resume, undefined);
    }
    const missing = createContextLifecycleService({ identity, checkpoint: () => { throw new Error("must not capture"); } });
    assert.equal((await missing.prepareContinuation({ write: true })).reason, "resume_port_unavailable");
  });
  await check("unknown, ambiguous and fixture-only models retain harness fallback", async () => {
    for (const profiles of [[], [{ ...qualified, proof_class: "fixture" }], [qualified, qualified],
      [{ ...qualified, context_bench: {} }], [{ ...qualified, mode: "clm" }],
      [{ ...qualified, valid_until: "2020-01-01T00:00:00Z" }]]) {
      const value = resolveContextCapabilities(identity, profiles);
      assert.equal(value.mode, "harness"); assert.equal(value.can_request_new_context, false);
    }
    assert.equal(resolveContextCapabilities({ ...identity, client_version: "2" }, [qualified]).mode, "harness");
  });
  await check("unqualified events and rollover have no effects", async () => {
    const service = createContextLifecycleService({ identity, checkpoint: () => { throw new Error("must not execute"); } });
    assert.equal((await service.handleEvent("PreCompact", { write: true })).status, "unavailable");
    assert.equal((await service.requestRollover({ write: true })).status, "unavailable");
  });
  await check("checkpoint and confirmed persistence precede a single native request", async () => {
    const service = createContextLifecycleService({ identity, qualifications: [qualified],
      checkpoint: async () => { calls.push("checkpoint"); return captured; },
      newContext: async () => { calls.push("new_context"); } });
    assert.equal((await service.requestRollover({ write: true })).status, "rollover_requested");
    assert.deepEqual(calls, ["checkpoint", "new_context"]);
    assert.equal((await service.requestRollover({ write: true })).reason, "rollover_requires_reconciliation");
    assert.deepEqual(calls, ["checkpoint", "new_context"]);
  });
  await check("failed checkpoint or missing intent never changes windows", async () => {
    const service = createContextLifecycleService({ identity, qualifications: [qualified], checkpoint: async () => ({ ok: false }),
      newContext: async () => { throw new Error("must not request"); } });
    assert.equal((await service.requestRollover({ write: true })).reason, "checkpoint_not_captured");
    assert.equal((await service.requestRollover()).reason, "explicit_checkpoint_write_required");
  });
  await check("restore is read-only, current and typed for subagent handoff", async () => {
    const service = createContextLifecycleService({ identity, qualifications: [qualified], resume: async (...args) => {
      assert.deepEqual(args, []); return current;
    } });
    assert.equal((await service.handleEvent("PostCompact", { write: true })).status, "resumed");
    assert.equal((await service.handleEvent("SubagentStop")).status, "handoff_prepared");
    const stale = createContextLifecycleService({ identity, qualifications: [qualified], resume: async () => ({ status: "stale" }) });
    assert.equal((await stale.handleEvent("SessionStart")).reason, "fresh_capsule_unavailable");
  });
  await check("uncertain native dispatch never retries automatically", async () => {
    let requests = 0;
    const service = createContextLifecycleService({ identity, qualifications: [qualified], checkpoint: async () => captured,
      newContext: async () => { requests += 1; throw new Error("acknowledgement_lost"); } });
    await assert.rejects(() => service.requestRollover({ write: true }), /acknowledgement_lost/);
    assert.equal((await service.requestRollover({ write: true })).reason, "rollover_requires_reconciliation");
    assert.equal(requests, 1);
  });
  await check("capabilities are immutable and expiry is rechecked before dispatch", async () => {
    const start = Date.now(); let time = start;
    const profile = { ...qualified, valid_until: new Date(start + 10000).toISOString() };
    const service = createContextLifecycleService({ identity, qualifications: [profile], now: () => time,
      checkpoint: async () => { time = start + 10001; return captured; },
      newContext: async () => { throw new Error("expired qualification must not dispatch"); } });
    assert.throws(() => { service.capabilities.can_request_new_context = false; }, TypeError);
    assert.throws(() => service.capabilities.native_events.push("arbitrary"), TypeError);
    assert.equal((await service.requestRollover({ write: true })).reason, "qualification_changed_before_dispatch");
    assert.equal(service.capabilities.mode, "harness");
  });
  await import("./verify-editable-context-experiment-fixtures.mjs");
  await check("native collector requires fresh window identity and uses last usage instead of cumulative totals", async () => {
    const now = Date.now(); const input = { event: { method: "thread/tokenUsage/updated", emittedAtMs: now,
      params: { tokenUsage: { last: { totalTokens: 120 }, total: { totalTokens: 1000000 }, modelContextWindow: 1000 } } },
      windowId: "native-window", model: "fixture", provider: "fixture", client: "fixture", clientVersion: "1", now };
    assert.equal(contextTelemetryFromNativeUsage(input).used_tokens, 120);
    assert.equal(contextTelemetryFromNativeUsage({ ...input, windowId: null }), null);
    assert.equal(contextTelemetryFromNativeUsage({ ...input, now: now + 300001 }), null);
    const invalid = structuredClone(input); invalid.event.params.tokenUsage.last.totalTokens = 1001;
    assert.equal(contextTelemetryFromNativeUsage(invalid), null);
  });
  await check("native evidence refuses missing acknowledgements, reordered capture and duplicate rollovers", async () => {
    const done = tool => ({ method: "item/completed", params: { threadId: "test", item: { type: "dynamicToolCall", tool, success: true } } });
    const call = { method: "rawResponseItem/completed", params: { threadId: "test", item: { type: "function_call", name: "new_context", call_id: "call-1" } } };
    const ack = { method: "rawResponseItem/completed", params: { threadId: "test", item: { type: "function_call_output", call_id: "call-1", output: "A new context window will start without summarizing conversation history." } } };
    const rows = [done("aidn_checkpoint"), call, ack, done("aidn_resume"), done("aidn_fetch"), done("aidn_submit")];
    assert.equal(assessNativeContextRound(rows, "test").status, "PASS");
    assert.equal(assessNativeContextRound(rows.filter(row => row !== ack), "test").status, "FAIL");
    assert.equal(assessNativeContextRound([call, rows[0], ...rows.slice(2)], "test").status, "FAIL");
    assert.equal(assessNativeContextRound([...rows, call], "test").status, "FAIL");
    assert.equal(assessNativeContextRound(rows, "other-thread").status, "FAIL");
  });
  await check("manual native qualifier preserves the root model and refuses unsupported provider/profile configuration", async () => {
    const config = 'model = "fixture-model"\nmodel_provider = "openai"\nservice_tier = "default"\n[profiles.other]\nmodel = "other"';
    assert.equal(nativeProbeRootSettings(config), 'model = "fixture-model"\nservice_tier = "default"');
    assert.throws(() => nativeProbeRootSettings('model_provider = "custom"'), /NOT_SUPPORTED/);
    assert.throws(() => nativeProbeRootSettings('profile = "other"'), /NOT_SUPPORTED/);
  });
  await check("native context transport negotiates history capacity without changing permissions", async () => {
    const original = { cwd: "fixture", model: "fixture-model", approvalPolicy: "never", sandbox: "read-only",
      config: { features: { hooks: true } }, allowProviderModelFallback: false, developerInstructions: "Keep canonical source and admission rules." };
    const before = structuredClone(original), value = nativeProbeThreadParams(original);
    assert.equal(value.config.tool_output_token_limit, 60000);
    assert.equal(value.approvalPolicy, "never"); assert.equal(value.sandbox, "read-only");
    assert.equal(value.allowProviderModelFallback, false); assert.equal(value.model, "fixture-model");
    assert.equal(value.config.bypass_hook_trust, undefined); assert.deepEqual(original, before);
    assert(value.developerInstructions.startsWith(original.developerInstructions));
    assert(value.developerInstructions.includes('"max_output_tokens":60000'));
    assert.equal(nativeProbeThreadParams(value).developerInstructions, value.developerInstructions);
    assert.equal(nativeProbeThreadParams({ config: {} }).developerInstructions, undefined);
    assert.deepEqual(nativeProbeThreadParams(original, false, null), before);
    assert.throws(() => nativeProbeThreadParams(original, false, "unknown"), /OUTPUT_PROFILE_UNSUPPORTED/);
    assert.throws(() => nativeProbeThreadParams({ ...original, config: { tool_output_token_limit: 1000 } }), /OUTPUT_PROFILE_CONFLICT/);
    assert.throws(() => nativeProbeThreadParams({ ...original, config: [] }), /OUTPUT_CONFIG_INVALID/);
    assert.equal(nativeProbeThreadParams({ ...original, config: { tool_output_token_limit: 60000 } }).config.tool_output_token_limit, 60000);
  });
  await check("opt-in bounded waits preserve all non-instruction thread controls and caller data", async () => {
    const original = { cwd: "fixture", model: "fixture-model", approvalPolicy: "never", permissions: "benchmark",
      allowProviderModelFallback: false, config: { features: { hooks: true } }, developerInstructions: "Keep canonical admission and the original deadline." };
    const before = structuredClone(original), ordinary = nativeProbeThreadParams(original);
    const value = nativeProbeThreadParams(original, false, NATIVE_CONTEXT_OUTPUT_POLICY.id, NATIVE_TOOL_SCHEDULING_POLICY.id);
    const { developerInstructions, ...controls } = value;
    const { developerInstructions: oldInstructions, ...oldControls } = ordinary;
    assert.deepEqual(controls, oldControls); assert.deepEqual(original, before);
    assert(developerInstructions.startsWith(original.developerInstructions));
    assert(developerInstructions.includes('{"max_output_tokens":60000,"yield_time_ms":60000}'));
    assert(developerInstructions.includes("abort dependent work immediately on refusal"));
    assert(developerInstructions.includes("original invocation deadline, cancellation and owned-process cleanup"));
    assert(!oldInstructions.includes("bounded-wait.v1"));
    assert.equal(nativeProbeThreadParams(value, false, NATIVE_CONTEXT_OUTPUT_POLICY.id, NATIVE_TOOL_SCHEDULING_POLICY.id).developerInstructions, developerInstructions);
    assert.equal(nativeProbeThreadParams({ config: {} }, false, NATIVE_CONTEXT_OUTPUT_POLICY.id, NATIVE_TOOL_SCHEDULING_POLICY.id).developerInstructions, undefined);
    assert.equal(nativeProbeSchedulingInstructions(), "");
    assert.throws(() => nativeProbeThreadParams(original, false, NATIVE_CONTEXT_OUTPUT_POLICY.id, "unknown"), /SCHEDULING_PROFILE_UNSUPPORTED/);
    assert.throws(() => nativeProbeThreadParams(original, false, null, NATIVE_TOOL_SCHEDULING_POLICY.id), /SCHEDULING_REQUIRES_OUTPUT_PROFILE/);
    assert.equal(value.config.bypass_hook_trust, undefined);
  });
  await check("native transport rejects oversized complete JSON before sending body fragments", async () => {
    const max = NATIVE_CONTEXT_OUTPUT_POLICY.max_dynamic_tool_json_bytes;
    const exact = { body: "a".repeat(max - Buffer.byteLength(JSON.stringify({ body: "" }))) };
    const accepted = nativeProbeToolResponse(exact);
    assert.equal(accepted.observation.json_bytes, max); assert.equal(accepted.response.success, true);
    assert.deepEqual(JSON.parse(accepted.response.contentItems[0].text), exact);
    for (const result of [{ body: exact.body + "x" }, { body: "é".repeat(max / 2) }]) {
      const denied = nativeProbeToolResponse(result), diagnostic = JSON.parse(denied.response.contentItems[0].text);
      assert.equal(denied.response.success, false); assert.equal(denied.observation.status, "refused");
      assert(denied.observation.json_bytes > max); assert.equal(diagnostic.error, "NATIVE_PROBE_TOOL_OUTPUT_BYTES_EXCEEDED");
      assert.equal(diagnostic.action_may_have_executed, true); assert.equal(diagnostic.retry_authorized, false);
      assert.equal(diagnostic.write_authorization, false); assert(!("body" in diagnostic));
    }
    assert.equal(nativeProbeToolResponse({ body: exact.body + "x" }, null).response.success, true);
    assert.throws(() => nativeProbeToolResponse({}, { history_token_limit: 999999 }), /OUTPUT_PROFILE_UNSUPPORTED/);
  });
  await check("unserializable native output fails without exposing source data or granting retries", async () => {
    const circular = {}; circular.self = circular;
    for (const result of [undefined, { value: 1n }, circular]) {
      const denied = nativeProbeToolResponse(result), diagnostic = JSON.parse(denied.response.contentItems[0].text);
      assert.equal(denied.response.success, false); assert.equal(denied.observation.json_bytes, null);
      assert.equal(diagnostic.error, "NATIVE_PROBE_TOOL_OUTPUT_UNSERIALIZABLE"); assert.equal(diagnostic.retry_authorized, false);
    }
  });
  await check("reviewed hook intent crosses the native per-thread port without granting persistent trust", async () => {
    const original = { cwd: "fixture", approvalPolicy: "never", sandbox: "read-only", config: { features: { hooks: true } } };
    const before = structuredClone(original);
    assert.deepEqual(nativeProbeThreadParams(original, false, null), before);
    const reviewed = nativeProbeThreadParams(original, true);
    assert.equal(reviewed.config.bypass_hook_trust, true);
    assert.equal(reviewed.approvalPolicy, "never"); assert.equal(reviewed.sandbox, "read-only");
    assert.deepEqual(original, before);
    assert.throws(() => nativeProbeThreadParams({ ...original, config: { bypass_hook_trust: true } }), /REVIEWED_HOOK_INTENT_REQUIRED/);
    assert.throws(() => nativeProbeThreadParams(original, "true"), /REVIEWED_HOOK_INTENT_REQUIRED/);
  });
  await check("late compact completion cannot finish a different native turn", async () => {
    const old = { method: "turn/completed", params: { threadId: "thread", turn: { id: "compact-turn" } } };
    assert.equal(isNativeTurnCompletion(old, "thread", "next-turn"), false);
    assert.equal(isNativeTurnCompletion(old, "thread", "compact-turn"), true);
    assert.equal(isNativeTurnCompletion(old, "other-thread", "compact-turn"), false);
    assert.equal(isNativeTurnCompletion(old, "thread", undefined), false);
  });
  await check("native hook evidence requires captured/current outcomes in order for the same session", async () => {
    const rows = [{ event: "SessionStart", source: "startup", status: "current", session_id: "test" },
      { event: "PreCompact", status: "captured", session_id: "test" }, { event: "PostCompact", status: "current", session_id: "test" },
      { event: "SessionStart", source: "compact", status: "current", session_id: "test" }];
    assert.equal(assessNativeHookLifecycle(rows, "test").status, "PASS");
    assert.equal(assessNativeHookLifecycle(rows, "other").status, "FAIL");
    assert.equal(assessNativeHookLifecycle(rows.map(row => row.event === "PreCompact" ? { ...row, status: "refused" } : row), "test").status, "FAIL");
    assert.equal(assessNativeHookLifecycle([rows[0], rows[2], rows[1], rows[3]], "test").status, "FAIL");
  });
  await check("malformed native hook input and unavailable binding always emit a parseable stop response", async () => {
    for (const input of ["not-json", "x".repeat(65537), JSON.stringify({ hook_event_name: "PreCompact", cwd: "fixture" })]) {
      const out = spawnSync(process.execPath, [path.join(import.meta.dirname, "../verify/context-native-hook-probe.mjs")], { input, encoding: "utf8", windowsHide: true, timeout: 10000 });
      assert.equal(out.status, 0, out.stderr); assert.equal(JSON.parse(out.stdout).continue, false);
    }
  });
  console.log(`context-lifecycle: PASS (${checks} scenarios; injected ports only; native execution separate)`);
} catch (error) { console.error(`context-lifecycle: FAIL ${error.message}`); process.exitCode = 1; }
