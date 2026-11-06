import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createProcessDispatchRecordStore } from "../../src/adapters/runtime/process-dispatch-record-store.mjs";
import { createWorkflowRecordStore } from "../../src/adapters/runtime/workflow-record-store.mjs";
import { createAgenticProcessStore } from "../../src/adapters/runtime/agentic-process-store.mjs";
import { LOCAL_ARTIFACT_FENCE_PATH } from "../../src/application/runtime/local-artifact-resource-fence.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { observeLocalProcess, observeLocalProcessOwner } from "../../src/adapters/runtime/local-process-identity.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { inspectAgenticProcess, advanceAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { WRITE_DISPOSITION_CASES, WRITE_OWNER_INTENTION_CASES, verifyStandardOperationWriteDisposition } from "./standard-operation-write-disposition-fixture-lib.mjs";

const here = fileURLToPath(import.meta.url), H = "a".repeat(64);
function source(calls = []) {
  return {
    async authorize({ request }) {
      calls.push(request);
      assert.ok(["operation_disposition", "operation_disposition_accept"].includes(request.action));
      return { contract_version: "process-disposition-authorization-grant.v1", authority_id: "fixture_operator", authorized: true, request_sha256: shadowHash(request), principal_sha256: H,
        grant_sha256: shadowHash({ request, fixture: "new-consent" }), observed_at_ms: Date.now(), expires_at_ms: Date.now() + 30000,
        evidence_refs: [{ ref: "fixture:new-explicit-disposition-consent", sha256: shadowHash(request) }] };
    },
    async verify({ request, grant }) {
      return { outcome: "verified", authority_id: grant.authority_id, request_sha256: shadowHash(request), grant_sha256: shadowHash(grant) };
    },
  };
}
function model() {
  const binding = standardWorkflowOperationBindings().find(row => row.id === "context_reload");
  return { contract_version: "agentic-process-model.v2", model_id: "disposition-fixture", revision: 1, participants: [{ id: "project" }],
    roles: [], policies: [], operation_pins: { context_reload: shadowHash(binding) }, entry: "reload",
    nodes: [{ id: "reload", kind: "operation", participant_ref: "project", binding_ref: "context_reload" }] };
}
const open = (config, options = {}, authority = source()) => createStandardWorkflowOperationHost({ targetRoot: config.root, model: model(),
  readSigningKey: () => Buffer.from(config.key, "hex"), authorize: async () => { throw Error("OLD_EFFECT_AUTHORITY_MUST_NOT_BE_USED"); },
  dispositionSource: authority }, options);

if (process.argv.includes("--worker")) {
  const configFile = process.argv.at(-1), config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  const mark = phase => fs.appendFileSync(configFile + ".phases.jsonl", JSON.stringify({ phase, at_ms: Date.now(), pid: process.pid }) + "\n");
  mark("worker_entered");
  const host = open(config, { dispatchCheckpoint: async boundary => {
    mark(boundary);
    if (boundary === config.boundary) {
      // Reuse this process's already OS-observed creation identity from its
      // durable dispatch/fence. A second PowerShell query before termination
      // adds no identity evidence; the parent still freshly verifies death.
      const identity = config.plan
        ? config.boundary === "disposition_control_reserved"
          ? JSON.parse(createStandardWorkflowArtifacts({ targetRoot: config.root }).read(`workflows/operation-control-intents/${config.operation_id}.json`, { required: true }).content).attempts.at(-1).resource_fence.record.process_identity
          : createStandardWorkflowArtifacts({ targetRoot: config.root }).resourceFence().read().record.process_identity
        : createProcessDispatchRecordStore({ targetRoot: config.root, stateMode: config.mode }).read(config.operation_id).record.process_identity;
      assert.equal(identity.pid, process.pid);
      process.send({ boundary, identity });
      await new Promise(() => {});
    }
  } });
  mark("host_opened");
  try {
    if (config.plan) await host.applyOperationDisposition(config.plan, { write: true, expectedPlanSha256: shadowHash(config.plan) });
    else await host.dispatch(config.operation_id, { write: true });
    process.send({ unexpected_completion: true });
  } catch (cause) { process.send({ error: cause.code ?? cause.message, stack: cause.stack }); process.exitCode = 1; }
} else if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  await verifyStandardOperationDisposition(process.argv[2] ?? "files", undefined, process.argv.find(arg => arg.startsWith("--case="))?.slice(7) ?? null);
}
export async function verifyStandardOperationDisposition(mode = "files", report = name => process.stdout.write(JSON.stringify({ pass: name }) + "\n"), only = null) {
  if (!["files", "dual", "db-only"].includes(mode)) throw Error("FIXTURE_MODE_INVALID");
  const cases = ["dispatch_reserved", "effect_returned", "redelivery", "disposition_recorded", "disposition_receipted", "concurrency", "foreign-fence", "fence-lost-after-write", ...WRITE_DISPOSITION_CASES, "prefix-change-during-grant", "disposition_control_reserved", "disposition_fence_acquired", "control-expired", "control-revoked", "acquired-revoked", "audit-revoked", ...WRITE_OWNER_INTENTION_CASES];
  if (only !== null && !cases.includes(only)) throw Error("FIXTURE_CASE_INVALID");
  const selected = name => only === null || only === name;
  const owned = [], retained = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-disposition-evidence-"));
  let checks = 0;
  const pass = name => { checks++; report(name); };
  async function setup(name) {
    const times = { setup_started_ms: Date.now() };
    const config = { root: createStandardWorkflowFixture(mode, owned), mode, key: randomBytes(32).toString("hex"), name };
    times.fixture_created_ms = Date.now();
    const host = open(config), preview = host.initialize({ instanceId: "disposition" });
    host.initialize({ instanceId: "disposition", write: true, expectedResultSha256: preview.record.instance_sha256 });
    const prepared = await host.preview({ instanceId: "disposition", expectedSha256: host.inspect("disposition").record.instance_sha256, occurrenceId: "root" });
    config.operation_id = (await host.stage(prepared, { write: true, expectedPreviewSha256: shadowHash(prepared) })).operation_id;
    times.operation_staged_ms = Date.now(); fs.writeFileSync(path.join(retained, name + "-phases.json"), JSON.stringify(times));
    fs.writeFileSync(path.join(retained, name + "-source.json"), JSON.stringify(config));
    return config;
  }
  async function crash(config, boundary, plan = null) {
    const file = path.join(retained, config.name + "-" + boundary + ".json");
    fs.writeFileSync(file, JSON.stringify({ ...config, boundary, plan }));
    const child = fork(here, ["--worker", file], { cwd: config.root, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stderr = "", message, timerExpired = false, exit;
    child.stdout.resume(); child.stderr.on("data", bytes => { stderr += bytes; if (stderr.length > 16384) child.kill(); });
    const ended = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
    const timer = setTimeout(() => { timerExpired = true; child.kill(); }, 15000);
    try {
      message = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("message", row => row.boundary === boundary ? resolve(row) : reject(Error(JSON.stringify(row))));
        child.once("close", () => reject(Error("WORKER_CLOSED_BEFORE_BOUNDARY:" + stderr.slice(-2048))));
      });
      child.kill();
      exit = await ended;
      assert.equal(observeLocalProcessOwner(message.identity), "terminated");
    } finally {
      clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill();
      exit ??= await ended;
      fs.writeFileSync(file + ".exit.json", JSON.stringify({ message: message ?? null, exit, stderr, timer_expired: timerExpired,
        original_worker_bound_ms: 15000, actual_process_termination: true, target_boundary_observed: Boolean(message) }));
    }
  }
  const prepare = (host, config) => host.prepareOperationDisposition(config.operation_id, { expectedSha256: host.inspect("disposition").record.instance_sha256 });
  const apply = (host, plan) => host.applyOperationDisposition(plan, { write: true, expectedPlanSha256: shadowHash(plan) });
  try {
    for (const boundary of ["dispatch_reserved", "effect_returned"]) {
      if (!selected(boundary)) continue;
      const config = await setup(boundary); await crash(config, boundary);
      const calls = [], host = open(config, {}, source(calls)), plan = prepare(host, config);
      assert.equal(plan.assessment, "unknown"); assert.equal((await apply(host, plan)).written, false);
      assert.equal(host.readJournal(config.operation_id).results.length, 0); assert.equal(calls.length, 0);
      pass(`${mode}: real process termination at ${boundary} retains UNKNOWN without rerun or fresh authorization`);
    }
    async function returnedCase(boundary) {
      const config = await setup(boundary ?? "redelivery"); await crash(config, "dispatch_returned");
      let host = open(config), plan = prepare(host, config);
      assert.equal(plan.assessment, "no_effect_original");
      const capsuleStore = createProcessDispatchRecordStore({ targetRoot: config.root, stateMode: mode });
      const original = capsuleStore.read(config.operation_id).record;
      createOperationJournalSigner(() => Buffer.from(config.key, "hex")).verify(original);
      assert.equal(original.process_identity.pid, host.readJournal(config.operation_id).owner.pid);
      assert.equal(original.operation_owner_sha256, shadowHash(host.readJournal(config.operation_id).owner));
      if (boundary) {
        await crash(config, boundary, plan);
        host = open(config);
        if (["disposition_control_reserved", "disposition_fence_acquired"].includes(boundary)) {
          const artifacts = createStandardWorkflowArtifacts({ targetRoot: config.root });
          const control = JSON.parse(artifacts.read(`workflows/operation-control-intents/${config.operation_id}.json`, { required: true }).content);
          createOperationJournalSigner(() => Buffer.from(config.key, "hex")).verify(control);
          assert.equal(control.attempts.length, 1);
          assert.equal(control.attempts[0].action, "disposition");
          assert.equal(control.attempts[0].plan.operation_id, config.operation_id);
          assert.equal(artifacts.read(`workflows/operation-dispositions/${config.operation_id}.json`).sha256, null);
          const held = artifacts.resourceFence().read().record;
          if (boundary === "disposition_fence_acquired") assert.deepEqual(held, control.attempts[0].resource_fence.record);
          else assert.notDeepEqual(held, control.attempts[0].resource_fence.record);
        }
        if (["disposition_recorded", "disposition_control_reserved", "disposition_fence_acquired"].includes(boundary)) { assert.equal(host.readJournal(config.operation_id).results.length, 0); plan = prepare(host, config); }
      }
      const receipt = (await apply(host, plan)).receipt;
      assert.equal(receipt.output_sha256, original.output_sha256);
      assert.equal(host.readJournal(config.operation_id).results.length, 1);
      assert.equal((await apply(open(config), plan)).receipt.receipt_id, receipt.receipt_id);
      host = open(config); const accepted = await host.accept(config.operation_id, { write: true });
      assert.equal(accepted.cursor.status, "COMPLETED");
      assert.equal(host.readJournal(config.operation_id).results.length, 1);
      assert.equal(capsuleStore.read(config.operation_id).record.output_sha256, original.output_sha256);
      const simulation = simulateAgenticProcess({ instanceId: accepted.record.instance_id, model: accepted.record.model,
        policyPins: accepted.record.policy_pins, scopeId: accepted.record.scope_id, events: accepted.record.events, facts: {} });
      assert.deepEqual(simulation.trace.at(-1).cursor, inspectAgenticProcess(accepted.record));
      pass(`${mode}: ${boundary ?? "original return"} cold recovery, durable fresh consent, one receipt, no re-evaluation and exact common-reducer SIM`);
    }
    for (const boundary of [null, "disposition_recorded", "disposition_receipted"]) {
      if (selected(boundary ?? "redelivery")) await returnedCase(boundary);
    }
    if (selected("concurrency")) {
      const config = await setup("concurrency"); await crash(config, "dispatch_returned");
      const host = open(config), plan = prepare(host, config), invalid = structuredClone(plan); invalid.scope_id = "foreign";
      await assert.rejects(() => apply(host, invalid), { code: "PROCESS_JOURNAL_NOT_AUTHENTICATED" });
      let waiting = 0, release; const both = new Promise(resolve => { release = resolve; });
      const authority = source(), simultaneous = { ...authority, async authorize(arg) { if (++waiting === 2) release(); await both; return authority.authorize(arg); } };
      const attempts = await Promise.allSettled([apply(open(config, {}, simultaneous), plan), apply(open(config, {}, simultaneous), plan)]);
      assert.equal(attempts.filter(row => row.status === "fulfilled").length, 1);
      assert.equal(open(config).readJournal(config.operation_id).results.length, 1);
      pass(`${mode}: forged scope refused and two concurrent repreneurs append exactly one original result`);
    }
    if (selected("foreign-fence")) {
      const config = await setup("foreign-fence"); await crash(config, "dispatch_returned");
      const host = open(config), plan = prepare(host, config), artifacts = createStandardWorkflowArtifacts({ targetRoot: config.root });
      const lease = artifacts.resourceFence().acquire();
      await assert.rejects(() => apply(host, plan));
      assert.equal(artifacts.resourceFence().read().content_sha256, lease.content_sha256);
      artifacts.resourceFence().release(lease);
      const changed = prepare(host, config); assert.notEqual(changed.fence_sha256, plan.fence_sha256);
      await assert.rejects(() => apply(host, plan));
      pass(`${mode}: foreign live fence is retained; release/reacquire ABA invalidates the old disposition`);
    }
    if (selected("fence-lost-after-write")) {
      const config = await setup("fence-lost-after-write"), artifacts = createStandardWorkflowArtifacts({ targetRoot: config.root });
      const before = artifacts.read("CURRENT-STATE.md", { required: true });
      const malicious = createWorkflowRecordStore({ targetRoot: config.root, stateMode: mode, descriptor: { pathForId: () => LOCAL_ARTIFACT_FENCE_PATH,
        validate: value => value, idOf: () => "local_artifacts", hashOf: shadowHash, kind: "process_operation_journal" } });
      let replacement;
      await assert.rejects(() => artifacts.withLocalEffectOwner(H, async () => {
        artifacts.compareAndSwap({ path: before.path, before_sha256: before.sha256, after: before.content + "\nfixture-written-before-fence-loss: true\n" });
        const lease = malicious.read("local_artifacts"); replacement = { ...lease.record, token: "00000000-0000-0000-0000-000000000000", revision: lease.record.revision + 1 };
        malicious.compareAndSwap(replacement, lease.content_sha256);
        return { effect_status: "confirmed" };
      }), cause => cause.code === "STANDARD_RESOURCE_FENCE_CHANGED" && cause.effect_status !== "no_effect");
      assert.notEqual(artifacts.read(before.path).sha256, before.sha256);
      assert.deepEqual(malicious.read("local_artifacts").record, replacement);
      pass(`${mode}: actual artifact mutation followed by lost release fence never becomes no_effect; substituted owner is retained`);
    }
    if (only === null || WRITE_DISPOSITION_CASES.includes(only)) checks += await verifyStandardOperationWriteDisposition(mode, report, only);
    if (selected("prefix-change-during-grant")) {
      const config = await setup("prefix-change-during-grant"); await crash(config, "dispatch_returned");
      const initial = open(config), plan = prepare(initial, config), base = source();
      const authority = { ...base, async authorize(arg) {
        const store = createAgenticProcessStore({ targetRoot: config.root, stateMode: mode }), before = store.read("disposition");
        const changed = advanceAgenticProcess(before.record, { event_id: "fixture_concurrent_cancel", kind: "cancel" });
        const result = store.compareAndSwap(changed, before.content_sha256);
        if (result.projection === "pending") store.materialize("disposition", { write: true });
        return base.authorize(arg);
      } };
      await assert.rejects(() => apply(open(config, {}, authority), plan), { code: "PROCESS_DISPOSITION_OBSERVATION_CHANGED" });
      assert.equal(initial.readJournal(config.operation_id).results.length, 0);
      assert.equal(createStandardWorkflowArtifacts({ targetRoot: config.root }).read(`workflows/operation-dispositions/${config.operation_id}.json`).sha256, null);
      assert.equal(initial.inspect("disposition").cursor.status, "CANCELLED");
      assert.equal(createStandardWorkflowArtifacts({ targetRoot: config.root }).resourceFence().read().record.state, "released");
      pass(`${mode}: actual prefix CAS during awaited grant refuses under the newly acquired fence without audit/result; cancellation retained`);
    }
    for (const boundary of ["disposition_control_reserved", "disposition_fence_acquired"]) {
      if (selected(boundary)) await returnedCase(boundary);
    }
    for (const name of ["control-expired", "control-revoked", "acquired-revoked", "audit-revoked"]) {
      if (!selected(name)) continue;
      const config = await setup(name); await crash(config, "dispatch_returned");
      let revoked = false;
      const base = source(), authority = { ...base,
        async authorize(arg) {
          const grant = await base.authorize(arg);
          if (name === "control-expired") grant.expires_at_ms = grant.observed_at_ms + 5000;
          return grant;
        },
        async verify(arg) { return revoked ? { outcome: "revoked" } : base.verify(arg); },
      };
      const target = name.startsWith("control-") ? "disposition_control_reserved"
        : name === "acquired-revoked" ? "disposition_fence_acquired" : "disposition_recorded";
      const host = open(config, { dispatchCheckpoint: async boundary => {
        if (boundary !== target) return;
        if (name === "control-expired") await new Promise(resolve => setTimeout(resolve, 5200));
        else revoked = true;
      } }, authority);
      const plan = prepare(host, config), artifacts = createStandardWorkflowArtifacts({ targetRoot: config.root });
      const beforeFence = artifacts.resourceFence().read();
      await assert.rejects(() => apply(host, plan), { code: name === "control-expired"
        ? "PROCESS_DISPOSITION_AUTHORIZATION_REQUIRED" : "PROCESS_DISPOSITION_AUTHORIZATION_NOT_AUTHENTICATED" });
      assert.equal(host.readJournal(config.operation_id).results.length, 0);
      const audit = artifacts.read(`workflows/operation-dispositions/${config.operation_id}.json`);
      if (name === "audit-revoked") assert.notEqual(audit.sha256, null);
      else assert.equal(audit.sha256, null);
      if (name.startsWith("control-")) assert.equal(artifacts.resourceFence().read().content_sha256, beforeFence.content_sha256);
      else assert.equal(artifacts.resourceFence().read().record.state, "released");
      const control = JSON.parse(artifacts.read(`workflows/operation-control-intents/${config.operation_id}.json`, { required: true }).content);
      createOperationJournalSigner(() => Buffer.from(config.key, "hex")).verify(control);
      assert.equal(control.attempts.length, 1);
      assert.equal(control.attempts[0].grant.grant.authorized, true);
      pass(`${mode}: ${name} retains signed original consent/control history and refuses before a new acquisition or receipt`);
    }
    for (const name of WRITE_OWNER_INTENTION_CASES) {
      if (selected(name)) checks += await verifyStandardOperationWriteDisposition(mode, report, name);
    }
    process.stdout.write(JSON.stringify({ status: "PASS", checks, retained, mode, selected_case: only, full_selector: only === null, scope: "actual public one-operation host/read-only return; production artifact writer component; real child termination; fixture consent",
      artifact_postimage_profile: only === null || WRITE_DISPOSITION_CASES.includes(only) ? "PASS_COMPONENT" : "NOT_RUN", full_standard: "NOT_RUN", native_human_provider_closure: "NOT_RUN", all_resource_disposition: "INCOMPLETE" }) + "\n");
    return checks;
  } finally {
    // Preserve every new arena and every failed/crashed original for review.
    fs.writeFileSync(path.join(retained, "arenas.json"), JSON.stringify({ mode, owned, checks }));
  }
}
