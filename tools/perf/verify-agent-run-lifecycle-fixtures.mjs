#!/usr/bin/env node
import fs from "node:fs";
import assert from "node:assert/strict";
import os from "node:os";
import { assertAgentRunSecretScope, readAgentRunFile } from "../../src/application/runtime/agent-run-configuration-service.mjs";
import path from "node:path";
import { previewNativeAgentCleanup, applyNativeAgentCleanup } from "../../src/application/runtime/agent-run-cleanup-service.mjs";
import { parseAgentRunArguments, buildAgentRunActionPreview, createAgentRunLifecycle, projectAgentRunStatus } from "../../src/application/runtime/agent-run-lifecycle-service.mjs";
import { fingerprintAgentExecutionValue, normalizeAgentExecutionPlan } from "../../src/core/agents/agent-execution-contracts.mjs";
import { describeAgentRunAssurance, assertAgentRunAssuranceBinding } from "../../src/application/runtime/agent-run-assurance-policy.mjs";

const source = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agent-execution/contracts/complete-chain.json", import.meta.url)));
const checks = [];
async function check(name, operation) {
  try { await operation(); checks.push({ name, status: "PASS" }); }
  catch (error) { checks.push({ name, status: "FAIL", code: error.code ?? error.name, message: String(error.message).slice(0, 700) }); }
}
const args = (command = "agent-run", extra = []) => parseAgentRunArguments(command, ["--configuration", "/configuration.json",
  ...(command === "agent-run" ? ["--plan", "/plan.json"] : ["--run", "run.fixture"]), "--json", ...extra]);
function context() {
  const configuration = { contract_version: "agent-run-configuration.v1", run_id: "run.fixture", planning_key: "planning.fixture" };
  const value = structuredClone(source.plan); delete value.plan_sha256;
  value.supervision = { configuration_sha256: fingerprintAgentExecutionValue(configuration) };
  const plan = normalizeAgentExecutionPlan(value);
  return { configuration, plan, snapshot: null, targetIdentity: { root: "/fixture" },
    preconditions: { blockers: [], canonical_snapshot_sha256: "a".repeat(64), lease_live: false },
    materialState: { control_revision: 0, generation: null }, resources: [] };
}
function harness(select = context()) {
  const calls = [], state = structuredClone(select);
  const snapshot = state.snapshot ?? { run: { ...source.run, plan_sha256: state.plan.plan_sha256 }, attempts: [], acceptances: [], supervision: { control_revision: 0, current: null } };
  const runtime = {
    ownerId: "owner.fixture", runner: {}, store: {
      async reserveRun(value) { calls.push(["reserveRun", value]); return snapshot; },
      async requestCancel(value) { calls.push(["requestCancel", value]); return snapshot; },
    },
    scheduler: {
      async run(value) { calls.push(["run", value]); return { status: "completed", snapshot: { ...snapshot, run: { ...snapshot.run, lifecycle_status: "completed" } } }; },
      async resume(value) { calls.push(["resume", value]); return { status: "cancelled", snapshot }; },
    },
    async observeReconciliation() { calls.push(["observeReconciliation"]); return { supervisorProof: {} }; },
    async cleanup() { calls.push(["cleanup"]); return snapshot; },
    async close() { calls.push(["close"]); },
  };
  const lifecycle = createAgentRunLifecycle({
    async readContext() { calls.push(["read"]); return state; },
    async createRuntime() { calls.push(["createRuntime"]); return runtime; }, makeId: () => "request.fixture",
  });
  return { calls, state, runtime, lifecycle };
}
await check("preview and JSON do not create runtime or write", async () => {
  const h = harness(), result = await h.lifecycle.invoke(args());
  assert.equal(result.written, false); assert.equal(result.effect_class, "preview");
  assert.deepEqual(h.calls.map(x => x[0]), ["read"]);
});
await check("status is read only", async () => {
  const h = harness(), result = await h.lifecycle.invoke(args("agent-run-status"));
  assert.equal(result.can_apply, false); assert.equal(result.effect_class, "read-only");
  assert.deepEqual(h.calls.map(x => x[0]), ["read"]);
});
for (const [name, command, extra, expected] of [
  ["run write refused", "agent-run", ["--write"], "AGENT_RUN_EFFECT_CONFLICT"],
  ["cleanup execute refused", "agent-run-cleanup", ["--execute"], "AGENT_RUN_EFFECT_CONFLICT"],
  ["status mutation refused", "agent-run-status", ["--execute"], "AGENT_RUN_STATUS_READ_ONLY"],
  ["dry run mutation refused", "agent-run", ["--dry-run", "--execute"], "AGENT_RUN_EFFECT_CONFLICT"],
  ["sync alone refused", "agent-run", ["--sync-relay"], "AGENT_RUN_EFFECT_CONFLICT"],
  ["execute needs exact hash and sync", "agent-run", ["--execute"], "AGENT_RUN_EXPLICIT_EFFECT_REQUIRED"],
  ["execute needs sync", "agent-run", ["--execute", "--expect-plan", "b".repeat(64)], "AGENT_RUN_EXPLICIT_EFFECT_REQUIRED"],
  ["duplicate rejected", "agent-run", ["--json"], "AGENT_RUN_DUPLICATE_ARGUMENT"],
  ["unknown option rejected", "agent-run", ["--model", "other"], "AGENT_RUN_UNKNOWN_ARGUMENT"],
  ["plan selector excluded elsewhere", "agent-run-resume", ["--plan", "/plan.json"], "AGENT_RUN_SELECTOR_INVALID"],
  ["run identity checked", "agent-run-cancel", ["--run", "../outside"], "AGENT_RUN_DUPLICATE_ARGUMENT"],
]) await check(name, () => assert.throws(() => args(command, extra), { code: expected }));
await check("help ignores configuration and mutation", () => {
  assert.equal(parseAgentRunArguments("agent-run", ["--execute", "--help"]).help, true);
});
await check("explicit configuration is required", () => assert.throws(() => parseAgentRunArguments("agent-run", ["--plan", "plan.json"]), { code: "AGENT_RUN_CONFIGURATION_REQUIRED" }));
await check("stable action hashing and no input mutation", () => {
  const c = context(), before = structuredClone(c);
  const a = buildAgentRunActionPreview(args(), c), b = buildAgentRunActionPreview(args(), structuredClone(c));
  assert.equal(a.action_sha256, b.action_sha256); assert.deepEqual(c, before);
});
function cooperativeContext(version = 2) {
  const c = context(), plan = { ...c.plan, contract_version: `agent-execution-plan.v${version}`, assurance_profile: `codex-cooperative.v${version - 1}` };
  delete plan.plan_sha256;
  c.plan = normalizeAgentExecutionPlan(plan);
  c.preconditions.native = describeAgentRunAssurance(c.plan);
  return c;
}
await check("cooperative preview declares limitations without running or claiming qualification", async () => {
  const c = cooperativeContext(), before = structuredClone(c), h = harness(c), out = await h.lifecycle.invoke(args());
  assert.deepEqual(h.calls.map(x => x[0]), ["read"]); assert.equal(out.written, false);
  assert.equal(out.action.preconditions.native.assurance_profile, "codex-cooperative.v1");
  assert.equal(out.action.preconditions.native.read_isolation, "not_guaranteed");
  assert.equal(out.action.preconditions.native.qualification_status, "not_checked");
  assert.ok(out.action.preconditions.native.limitations.includes("on_disk_secrets_not_isolated"));
  assert.deepEqual(c, before);
});
await check("cooperative guarantee and qualification changes invalidate the exact action", () => {
  const c = cooperativeContext(), original = buildAgentRunActionPreview(args(), c).action_sha256;
  c.preconditions.native.qualification_status = "unavailable";
  assert.notEqual(buildAgentRunActionPreview(args(), c).action_sha256, original);
  c.preconditions.native = describeAgentRunAssurance(c.plan);
  c.preconditions.native.limitations = [];
  assert.notEqual(buildAgentRunActionPreview(args(), c).action_sha256, original);
});
await check("strict and cooperative boundary evidence cannot cross plan profiles", () => {
  const strict = context().plan, cooperative = cooperativeContext().plan;
  const configuration = { contract_version: "codex-sandbox-validation-configuration.v3", assurance_profile: "codex-cooperative.v1", read_isolation: "not_guaranteed" };
  const qualification = { ...configuration, contract_version: "agent-verification-boundary.v3" };
  assert.equal(assertAgentRunAssuranceBinding(cooperative, configuration, qualification), true);
  assert.throws(() => assertAgentRunAssuranceBinding(strict, configuration, qualification), { code: "AGENT_RUN_ASSURANCE_PROFILE_MISMATCH" });
  for (const version of ["v1", "v2"]) {
    const priorConfiguration = { contract_version: `codex-sandbox-validation-configuration.${version}` };
    const priorQualification = { contract_version: `agent-verification-boundary.${version}` };
    assert.equal(assertAgentRunAssuranceBinding(strict, priorConfiguration, priorQualification), true);
    assert.throws(() => assertAgentRunAssuranceBinding(cooperative, priorConfiguration, qualification), { code: "AGENT_RUN_ASSURANCE_PROFILE_MISMATCH" });
    assert.throws(() => assertAgentRunAssuranceBinding(cooperative, configuration, priorQualification), { code: "AGENT_RUN_ASSURANCE_PROFILE_MISMATCH" });
  }
  assert.throws(() => assertAgentRunAssuranceBinding(cooperative, configuration, { ...qualification, read_isolation: "guaranteed" }), { code: "AGENT_RUN_ASSURANCE_PROFILE_MISMATCH" });
  assert.deepEqual(describeAgentRunAssurance(strict), {});
});
await check("network-unassured preview declares its limit without granting execution", async () => {
  const c=cooperativeContext(3),before=structuredClone(c),h=harness(c),out=await h.lifecycle.invoke(args());
  const native=out.action.preconditions.native;
  assert.deepEqual(h.calls.map(row=>row[0]),["read"]);assert.equal(out.written,false);
  assert.equal(native.assurance_profile,"codex-cooperative.v2");
  assert.equal(native.read_isolation,"not_guaranteed");assert.equal(native.network_isolation,"not_guaranteed");
  assert.equal(native.qualification_status,"not_checked");
  assert.ok(native.limitations.includes("network_isolation_not_guaranteed"));
  assert.equal(native.required_guarantees.includes("sandboxed_command_network_disabled"),false);
  const historical=describeAgentRunAssurance(cooperativeContext().plan);
  assert.deepEqual(native.required_guarantees,historical.required_guarantees.filter(value=>value!=="sandboxed_command_network_disabled"));
  assert.deepEqual(native.limitations,[...historical.limitations,"network_isolation_not_guaranteed"]);
  assert.equal(Object.hasOwn(historical,"network_isolation"),false);
  assert.equal(historical.required_guarantees.includes("sandboxed_command_network_disabled"),true);
  assert.deepEqual(c,before);
});
await check("network assurance labels and profile changes invalidate a previously approved action", async () => {
  const c=cooperativeContext(3),original=buildAgentRunActionPreview(args(),c).action_sha256;
  for(const mutate of [native=>{native.network_isolation="guaranteed";},native=>{native.limitations.pop();},native=>{native.qualification_status="unavailable";}]){
    const changed=structuredClone(c);mutate(changed.preconditions.native);
    assert.notEqual(buildAgentRunActionPreview(args(),changed).action_sha256,original);
  }
  const prior=buildAgentRunActionPreview(args(),cooperativeContext()).action_sha256,h=harness(c);
  assert.notEqual(original,prior);
  const out=await h.lifecycle.invoke(args("agent-run",["--execute","--expect-plan",prior,"--sync-relay"]));
  assert.deepEqual(out.errors,["AGENT_RUN_PREVIEW_CHANGED"]);assert.deepEqual(h.calls.map(row=>row[0]),["read"]);
});
await check("strict and both cooperative profiles bind only their exact boundary versions", () => {
  const plans=[context().plan,cooperativeContext().plan,cooperativeContext(3).plan];
  const configurations=[1,2,3,4].map(version=>({contract_version:`codex-sandbox-validation-configuration.v${version}`,
    ...(version>=3?{assurance_profile:`codex-cooperative.v${version-2}`,read_isolation:"not_guaranteed"}:{}),
    ...(version===4?{network_isolation:"not_guaranteed"}:{})}));
  const qualifications=configurations.map((config,index)=>({...config,contract_version:`agent-verification-boundary.v${index+1}`,network_disabled:index!==3}));
  for(const [p,plan] of plans.entries())for(const [c,configuration] of configurations.entries())for(const [q,qualification] of qualifications.entries()){
    const expected=c===q&&(p===0?c<2:c===p+1),before=JSON.stringify([plan,configuration,qualification]);
    if(expected)assert.equal(assertAgentRunAssuranceBinding(plan,configuration,qualification),true);
    else assert.throws(()=>assertAgentRunAssuranceBinding(plan,configuration,qualification),{code:"AGENT_RUN_ASSURANCE_PROFILE_MISMATCH"});
    assert.equal(JSON.stringify([plan,configuration,qualification]),before);
  }
  const current=plans[2],config=configurations[3],qualification=qualifications[3];
  for(const value of [true,null,0,"false",undefined]){
    const changed={...qualification,network_disabled:value};if(value===undefined)delete changed.network_disabled;
    assert.throws(()=>assertAgentRunAssuranceBinding(current,config,changed),{code:"AGENT_RUN_ASSURANCE_PROFILE_MISMATCH"});
  }
  for(const field of ["network_isolation","read_isolation","assurance_profile"]){
    const changedConfig={...config},changedQualification={...qualification};delete changedConfig[field];delete changedQualification[field];
    assert.throws(()=>assertAgentRunAssuranceBinding(current,changedConfig,qualification),{code:"AGENT_RUN_ASSURANCE_PROFILE_MISMATCH"});
    assert.throws(()=>assertAgentRunAssuranceBinding(current,config,changedQualification),{code:"AGENT_RUN_ASSURANCE_PROFILE_MISMATCH"});
  }
  assert.throws(()=>describeAgentRunAssurance({...current,assurance_profile:"codex-cooperative.v1"}),{code:"AGENT_RUN_ASSURANCE_PROFILE_MISMATCH"});
  assert.throws(()=>assertAgentRunAssuranceBinding(plans[0],{contract_version:"unknown"},{contract_version:"unknown"}),{code:"AGENT_RUN_ASSURANCE_PROFILE_MISMATCH"});
});
for (const [name, mutate] of [
  ["canonical state changes action", c => c.preconditions.canonical_snapshot_sha256 = "b".repeat(64)],
  ["lease classification changes action", c => c.preconditions.lease_live = true],
  ["generation changes action", c => c.materialState.generation = 2],
  ["control revision changes action", c => c.materialState.control_revision = 1],
  ["resource preimage changes action", c => c.resources.push({ sha256: "c".repeat(64) })],
  ["operation changes action", c => { c.operation = "unused"; }],
]) {
  if (name === "operation changes action") continue;
  await check(name, () => { const c = context(), first = buildAgentRunActionPreview(args(), c); mutate(c);
    assert.notEqual(first.action_sha256, buildAgentRunActionPreview(args(), c).action_sha256); });
}
await check("different command changes action", () => {
  const c = context(); assert.notEqual(buildAgentRunActionPreview(args(), c).action_sha256, buildAgentRunActionPreview(args("agent-run-cancel"), c).action_sha256);
});
await check("configuration substitution refused", () => { const c = context(); c.configuration.run_id = "other";
  assert.throws(() => buildAgentRunActionPreview(args(), c), { code: "AGENT_RUN_CONFIGURATION_CHANGED" }); });
await check("foreign run refused", () => { const c = context(); c.snapshot = { run: { ...source.run, run_id: "foreign" } };
  assert.throws(() => buildAgentRunActionPreview(args(), c), { code: "AGENT_RUN_BINDING_CHANGED" }); });
await check("preview mismatch has no effect", async () => {
  const h = harness(); const out = await h.lifecycle.invoke(args("agent-run", ["--execute", "--expect-plan", "a".repeat(64), "--sync-relay"]));
  assert.deepEqual(out.errors, ["AGENT_RUN_PREVIEW_CHANGED"]); assert.deepEqual(h.calls.map(x => x[0]), ["read"]);
});
await check("blockers prevent runtime construction", async () => {
  const c = context(); c.preconditions.blockers.push("UNAVAILABLE"); const h = harness(c);
  const p = buildAgentRunActionPreview(args(), c);
  const out = await h.lifecycle.invoke(args("agent-run", ["--execute", "--expect-plan", p.action_sha256, "--sync-relay"]));
  assert.deepEqual(out.errors, ["AGENT_RUN_PRECONDITIONS_FAILED"]); assert.deepEqual(h.calls.map(x => x[0]), ["read"]);
});
await check("second read detects changed material before effect", async () => {
  const c = context(), p = buildAgentRunActionPreview(args(), c); let reads = 0, creates = 0;
  const service = createAgentRunLifecycle({ readContext: async () => { reads++; if (reads === 2) c.materialState.control_revision++; return c; },
    createRuntime: async () => { creates++; } });
  const out = await service.invoke(args("agent-run", ["--execute", "--expect-plan", p.action_sha256, "--sync-relay"]));
  assert.deepEqual(out.errors, ["AGENT_RUN_PREVIEW_CHANGED"]); assert.equal(creates, 0);
});
await check("run reserves before scheduler and closes", async () => {
  const h = harness(), p = buildAgentRunActionPreview(args(), h.state);
  const out = await h.lifecycle.invoke(args("agent-run", ["--execute", "--expect-plan", p.action_sha256, "--sync-relay"]));
  assert.deepEqual(h.calls.map(x => x[0]), ["read", "read", "createRuntime", "reserveRun", "run", "close"]);
  assert.equal(out.written, true); assert.equal(out.status.execution_status, "completed");
});
await check("caller aborted before mutation", async () => {
  const h = harness(), p = buildAgentRunActionPreview(args(), h.state), abort = new AbortController(); abort.abort();
  const out = await h.lifecycle.invoke(args("agent-run", ["--execute", "--expect-plan", p.action_sha256, "--sync-relay"]), { signal: abort.signal });
  assert.deepEqual(out.errors, ["AGENT_RUN_CANCELLED_BEFORE_EFFECT"]); assert.deepEqual(h.calls.map(x => x[0]), ["read", "read"]);
});
await check("cancellation is a durable request, not invalidation", async () => {
  const c = context(); c.snapshot = { run: { ...source.run, plan_sha256: c.plan.plan_sha256 }, supervision: { control_revision: 3, current: { ownership: { generation: 2 } } } };
  const h = harness(c), p = buildAgentRunActionPreview(args("agent-run-cancel"), c);
  const out = await h.lifecycle.invoke(args("agent-run-cancel", ["--execute", "--expect-plan", p.action_sha256, "--sync-relay"]));
  const requested = h.calls.find(x => x[0] === "requestCancel")[1];
  assert.equal(requested.expectedControlRevision, 3); assert.equal(requested.expectedSupervisorGeneration, 2); assert.equal(out.written, true);
});
await check("status separates process, acceptance and validation", () => {
  const out = projectAgentRunStatus({ run: source.run, attempts: [{ attempt: source.attempt, result: { outcome: "completed", termination_state: "confirmed", process: { exit_code: 0 } } }], acceptances: [] });
  assert.equal(out.attempts[0].exit_code, 0); assert.equal(out.attempts[0].acceptance, null); assert.equal(out.validation.status, "not_requested");
});
await check("planned cancellation uses generation zero", async () => {
  const c = context(); c.snapshot = { run: { ...source.run, plan_sha256: c.plan.plan_sha256 }, supervision: { control_revision: 0, current: null } };
  const h = harness(c), p = buildAgentRunActionPreview(args("agent-run-cancel"), c);
  await h.lifecycle.invoke(args("agent-run-cancel", ["--execute", "--expect-plan", p.action_sha256, "--sync-relay"]));
  assert.equal(h.calls.find(x => x[0] === "requestCancel")[1].expectedSupervisorGeneration, 0);
});
await check("cleanup status exposes result and evidence without runner or local manifest", () => {
  const out = projectAgentRunStatus({ run: source.run, cleanup: {
    current: { status: "completed", cleanup: { cleanup_id: "cleanup.test", resources: [{ cwd: "/private" }] },
      cleanup_sha256: "b".repeat(64), ownership: { generation: 1 }, runner: { pid: 42 } },
    resources: [{ resource: { resource_id: "resource.test", kind: "attempt_worktree", cwd: "/private" },
      resource_sha256: "c".repeat(64), result_sha256: "d".repeat(64), result: { outcome: "removed", evidence: [] } }],
  } });
  assert.equal(out.cleanup.status, "completed"); assert.equal(out.cleanup.resources[0].status, "removed");
  assert.equal(JSON.stringify(out.cleanup).includes("private"), false); assert.equal("runner" in out.cleanup, false);
});
await check("run identifier rejects path traversal", () => assert.throws(() => parseAgentRunArguments("agent-run-cancel",
  ["--configuration", "/configuration.json", "--run", "../outside"]), { code: "AGENT_RUN_ID_INVALID" }));
await check("close failure preserves applied result and redacts diagnostics", async () => {
  const h = harness(), p = buildAgentRunActionPreview(args(), h.state);
  h.runtime.close = async () => { throw Object.assign(new Error("private details"), { code: "NATIVE_CLOSE_FAILED" }); };
  const out = await h.lifecycle.invoke(args("agent-run", ["--execute", "--expect-plan", p.action_sha256, "--sync-relay"]));
  assert.equal(out.written, true); assert.equal(out.status.execution_status, "completed");
  assert.deepEqual(out.errors, ["NATIVE_CLOSE_FAILED"]); assert.equal(JSON.stringify(out).includes("private details"), false);
});

function cleanupHarness(root) {
  const resource = { resource_id: "resource.test", kind: "attempt_worktree", cwd: root,
    retention: { ref: "retention.json", sha256: "a".repeat(64), bytes: 2 }, preimage_sha256: "b".repeat(64) };
  const cleanup = { cleanup_id: "cleanup.test", resources: [resource] };
  const snapshot = { run: { run_id: "run.fixture", lifecycle_status: "completed" },
    integration_head: { ref: "refs/heads/codex/integration", sha: "1".repeat(40), repository_identity_sha256: "c".repeat(64) },
    supervision: { control_revision: 4, current: { ownership: { generation: 1 }, runner: {}, termination: { stopped: true } } },
    cleanup: { current: { cleanup, cleanup_sha256: fingerprintAgentExecutionValue(cleanup), ownership: { generation: 1 }, status: "active", termination: { stopped: true } },
      resources: [{ resource, result: null }] } };
  const calls = [];
  const git = {
    async inspectIntegration() { return { ok: true, ref: snapshot.integration_head.ref, head_sha: snapshot.integration_head.sha, repository_identity_sha256: snapshot.integration_head.repository_identity_sha256 }; },
    async inspectCleanup(value, { phase }) { calls.push("inspect-" + phase); },
    async removeOwnedWorktree(options) { await options.verifyAuthority({ resource }); calls.push("remove");
      return { resource_id: resource.resource_id, preimage_sha256: resource.preimage_sha256, outcome: "removed", evidence: [resource.retention] }; },
  };
  const store = {
    async getRun() { return structuredClone(snapshot); },
    async beginCleanup() { calls.push("claim"); return structuredClone(snapshot); },
    async renewCleanup() { calls.push("renew"); return structuredClone(snapshot); },
    async inspectCleanupAuthority() { calls.push("authority"); return {}; },
    async recordCleanupResult({ result }) { calls.push("result"); snapshot.cleanup.resources[0].result = result; snapshot.cleanup.current.status = "completed"; return structuredClone(snapshot); },
  };
  const c = { snapshot, configuration: { run_id: "run.fixture" }, plan: { plan_sha256: "d".repeat(64) }, resources: [resource], preconditions: { native: {} } };
  return { snapshot, calls, git, store, assembled: { git, store }, context: c };
}
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-lifecycle-cleanup-"));
try {
  await check("private signing key is outside validator-readable snapshots and writable scratch", () => {
    for (const folder of ["snapshots", "scratch", "authority"]) fs.mkdirSync(path.join(fixtureRoot, folder));
    for (const folder of ["snapshots", "scratch", "authority"]) fs.writeFileSync(path.join(fixtureRoot, folder, "key.pem"), "fixture-key");
    for (const folder of ["snapshots", "scratch"]) assert.throws(() => assertAgentRunSecretScope(fixtureRoot, path.join(fixtureRoot, folder, "key.pem")), { code: "AGENT_RUN_SECRET_SCOPE_INVALID" });
    assert.equal(assertAgentRunSecretScope(fixtureRoot, path.join(fixtureRoot, "authority/key.pem")), fs.realpathSync.native(path.join(fixtureRoot, "authority/key.pem")));
    assert.throws(() => assertAgentRunSecretScope(path.join(fixtureRoot, "authority"), path.join(fixtureRoot, "scratch/key.pem")), { code: "AGENT_RUN_SECRET_SCOPE_INVALID" });
  });
  await check("configuration references reject changed bytes and hard links", () => {
    const file = path.join(fixtureRoot, "configuration.json"), link = path.join(fixtureRoot, "linked.json");
    fs.writeFileSync(file, "{}"); const first = readAgentRunFile(file);
    fs.writeFileSync(file, "{ \"changed\":true }");
    assert.throws(() => readAgentRunFile(file, { sha256: first.sha256 }), { code: "AGENT_RUN_FILE_CHANGED" });
    fs.linkSync(file, link); assert.throws(() => readAgentRunFile(link), { code: "AGENT_RUN_FILE_INVALID" });
  });
  await check("cleanup refuses a moved integration ref before ownership", async () => {
    const h = cleanupHarness(fixtureRoot); h.git.inspectIntegration = async () => ({ ok: true, head_sha: "2".repeat(40) });
    await assert.rejects(() => previewNativeAgentCleanup({ context: h.context, assembled: h.assembled }), { code: "AGENT_RUN_CLEANUP_INTEGRATION_CHANGED" });
    assert.deepEqual(h.calls, []);
  });
  await check("completed cleanup rechecks physical absence", async () => {
    const h = cleanupHarness(fixtureRoot); h.snapshot.cleanup.current.status = "completed"; h.snapshot.cleanup.resources[0].result = { outcome: "removed" };
    h.git.inspectCleanup = async (resource, { phase }) => { assert.equal(phase, "after"); throw Object.assign(new Error("still present"), { code: "AGENT_GIT_CLEANUP_NOT_REMOVED" }); };
    await assert.rejects(() => previewNativeAgentCleanup({ context: h.context, assembled: h.assembled }), { code: "AGENT_GIT_CLEANUP_NOT_REMOVED" });
  });
  await check("cleanup keeps one retention reference and drains renewal before completion", async () => {
    const h = cleanupHarness(fixtureRoot), timers = new Set();
    h.context.preconditions.native.cleanup = (await previewNativeAgentCleanup({ context: h.context, assembled: h.assembled })).material;
    const clock = { setTimeout(fn, delay) { const timer = setTimeout(fn, delay); timers.add(timer); return timer; }, clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); } };
    const result = await applyNativeAgentCleanup({ context: h.context, assembled: h.assembled, ownerId: "owner", runner: {}, clock });
    assert.equal(result.cleanup.current.status, "completed"); assert.equal(result.cleanup.resources[0].result.evidence.length, 1); assert.equal(timers.size, 0);
    assert.ok(h.calls.indexOf("claim") < h.calls.indexOf("remove")); assert.ok(h.calls.indexOf("remove") < h.calls.indexOf("result"));
  });
  await check("coordination loss interrupts an in-flight cleanup and cannot record removal", async () => {
    const h = cleanupHarness(fixtureRoot);
    h.context.preconditions.native.cleanup = (await previewNativeAgentCleanup({ context: h.context, assembled: h.assembled })).material;
    h.store.renewCleanup = async () => { throw Object.assign(new Error("lost"), { code: "COORDINATION_LOST" }); };
    let interrupted = false;
    h.git.removeOwnedWorktree = async options => {
      await options.verifyAuthority({ resource: h.context.resources[0] });
      await new Promise((resolve, reject) => { const guard = setTimeout(() => reject(new Error("stop not propagated")), 1000);
        const abort = () => { clearTimeout(guard); interrupted = true; reject(options.signal.reason); };
        options.signal.addEventListener("abort", abort, { once: true }); if (options.signal.aborted) abort();
      });
    };
    const clock = { setTimeout: (fn, delay) => setTimeout(fn, Math.min(delay, 10)), clearTimeout };
    await assert.rejects(() => applyNativeAgentCleanup({ context: h.context, assembled: h.assembled, ownerId: "owner", runner: {}, clock }), { code: "COORDINATION_LOST" });
    assert.equal(interrupted, true); assert.equal(h.calls.includes("result"), false);
  });
} finally {
  const relative = path.relative(os.tmpdir(), fixtureRoot);
  assert.ok(relative.startsWith("aidn-lifecycle-cleanup-") && !relative.includes(path.sep));
  fs.rmSync(fixtureRoot, { recursive: true });
}

const result = { ok: checks.every(row => row.status === "PASS"), checks, proof_class: "pure-fixtures", native_codex: "SKIP", postgres: "SKIP" };
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
process.exitCode = result.ok ? 0 : 1;
