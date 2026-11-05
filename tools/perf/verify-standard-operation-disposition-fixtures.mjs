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
import { LOCAL_ARTIFACT_FENCE_PATH } from "../../src/application/runtime/local-artifact-resource-fence.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { observeLocalProcess, observeLocalProcessOwner } from "../../src/adapters/runtime/local-process-identity.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { inspectAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";

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
  const config = JSON.parse(fs.readFileSync(process.argv.at(-1), "utf8"));
  const host = open(config, { dispatchCheckpoint: async boundary => {
    if (boundary === config.boundary) {
      process.send({ boundary, identity: observeLocalProcess(process.pid) });
      await new Promise(() => {});
    }
  } });
  try {
    if (config.plan) await host.applyOperationDisposition(config.plan, { write: true, expectedPlanSha256: shadowHash(config.plan) });
    else await host.dispatch(config.operation_id, { write: true });
    process.send({ unexpected_completion: true });
  } catch (cause) { process.send({ error: cause.code ?? cause.message, stack: cause.stack }); process.exitCode = 1; }
} else if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  await verifyStandardOperationDisposition(process.argv[2] ?? "files");
}
export async function verifyStandardOperationDisposition(mode = "files", report = name => process.stdout.write(JSON.stringify({ pass: name }) + "\n")) {
  if (!["files", "dual", "db-only"].includes(mode)) throw Error("FIXTURE_MODE_INVALID");
  const owned = [], retained = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-disposition-evidence-"));
  let checks = 0;
  const pass = name => { checks++; report(name); };
  async function setup(name) {
    const config = { root: createStandardWorkflowFixture(mode, owned), key: randomBytes(32).toString("hex"), name };
    const host = open(config), preview = host.initialize({ instanceId: "disposition" });
    host.initialize({ instanceId: "disposition", write: true, expectedResultSha256: preview.record.instance_sha256 });
    const prepared = await host.preview({ instanceId: "disposition", expectedSha256: host.inspect("disposition").record.instance_sha256, occurrenceId: "root" });
    config.operation_id = (await host.stage(prepared, { write: true, expectedPreviewSha256: shadowHash(prepared) })).operation_id;
    fs.writeFileSync(path.join(retained, name + "-source.json"), JSON.stringify(config));
    return config;
  }
  async function crash(config, boundary, plan = null) {
    const file = path.join(retained, config.name + "-" + boundary + ".json");
    fs.writeFileSync(file, JSON.stringify({ ...config, boundary, plan }));
    const child = fork(here, ["--worker", file], { cwd: config.root, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stderr = "", message;
    child.stdout.resume(); child.stderr.on("data", bytes => { stderr += bytes; if (stderr.length > 16384) child.kill(); });
    const ended = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
    const timer = setTimeout(() => child.kill(), 15000);
    try {
      message = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("message", row => row.boundary === boundary ? resolve(row) : reject(Error(JSON.stringify(row))));
        child.once("close", () => reject(Error("WORKER_CLOSED_BEFORE_BOUNDARY:" + stderr.slice(-2048))));
      });
      child.kill();
      const exit = await ended;
      assert.equal(observeLocalProcessOwner(message.identity), "terminated");
      fs.writeFileSync(file + ".exit.json", JSON.stringify({ message, exit, stderr, actual_process_termination: true }));
    } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) { child.kill(); await ended; } }
  }
  const prepare = (host, config) => host.prepareOperationDisposition(config.operation_id, { expectedSha256: host.inspect("disposition").record.instance_sha256 });
  const apply = (host, plan) => host.applyOperationDisposition(plan, { write: true, expectedPlanSha256: shadowHash(plan) });
  try {
    for (const boundary of ["dispatch_reserved", "effect_returned"]) {
      const config = await setup(boundary); await crash(config, boundary);
      const calls = [], host = open(config, {}, source(calls)), plan = prepare(host, config);
      assert.equal(plan.assessment, "unknown"); assert.equal((await apply(host, plan)).written, false);
      assert.equal(host.readJournal(config.operation_id).results.length, 0); assert.equal(calls.length, 0);
      pass(`${mode}: real process termination at ${boundary} retains UNKNOWN without rerun or fresh authorization`);
    }
    for (const boundary of [null, "disposition_recorded", "disposition_receipted"]) {
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
        if (boundary === "disposition_recorded") { assert.equal(host.readJournal(config.operation_id).results.length, 0); plan = prepare(host, config); }
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
    {
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
    {
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
    {
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
    process.stdout.write(JSON.stringify({ status: "PASS", checks, retained, mode, scope: "actual public one-operation host/read-only return; real child termination; fixture consent",
      artifact_postimage_profile: "NOT_RUN", full_standard: "NOT_RUN", native_human_provider_closure: "NOT_RUN", all_resource_disposition: "INCOMPLETE" }) + "\n");
    return checks;
  } finally {
    // Preserve every new arena and every failed/crashed original for review.
    fs.writeFileSync(path.join(retained, "arenas.json"), JSON.stringify({ mode, owned, checks }));
  }
}
