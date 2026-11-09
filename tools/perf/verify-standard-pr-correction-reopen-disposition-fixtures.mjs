#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPrCorrectionReopenFixture } from "./standard-pr-correction-fixture-lib.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardPrCorrectionReopen } from "../../src/application/runtime/standard-pr-correction-reopen.mjs";
import { createStandardOperationDisposition } from "../../src/application/runtime/standard-operation-disposition.mjs";
import { createStandardReconciliationInventory } from "../../src/application/runtime/standard-reconciliation-inventory.mjs";
import { runStandardWorkflowAction } from "../../src/application/runtime/standard-workflow-entry.mjs";
import { createStandardHostAuthority } from "../../src/adapters/runtime/standard-host-authority.mjs";
import { createOperationJournalSigner, operationJournalId, operationOutputRef } from "../../src/core/workflow/process-operation-journal.mjs";
import { createProcessOperationJournalStore } from "../../src/adapters/runtime/process-operation-journal-store.mjs";
import { createAgenticProcessStore } from "../../src/adapters/runtime/agentic-process-store.mjs";
import { createAgenticProcessService } from "../../src/application/runtime/agentic-process-service.mjs";
import { observeLocalProcessOwner } from "../../src/adapters/runtime/local-process-identity.mjs";
import { inspectAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const H = "a".repeat(64), instanceId = "reopen_disposition", occurrenceId = "root/0";
const opBinding = "session_pr_correction_reopen", checkpointBinding = "session_pr_correction_checkpoint";
const body = ({ authentication, key_id, ...value }) => value;
const sha = shadowHash;
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim();
const binding = id => standardWorkflowOperationBindings().find(row => row.id === id);
const here = fileURLToPath(import.meta.url);
const temp = fs.realpathSync(os.tmpdir());
const protocolError = code => Object.assign(Error(code), { code });

function open(config, boundary = null, entryDispositionSource = null) {
  const { root, source, names } = config;
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: root }), reopen = binding(opBinding), checkpoint = binding(checkpointBinding);
  const signer = createOperationJournalSigner(() => Buffer.alloc(32, 68));
  const model = { contract_version: "agentic-process-model.v2", model_id: "correction-disposition-fixture", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [], entry: "start",
    operation_pins: { [opBinding]: sha(reopen), [checkpointBinding]: sha(checkpoint) },
    nodes: [{ id: "start", kind: "sequence", participant_ref: "project", children: ["reopen", "checkpoint"] },
      { id: "reopen", kind: "operation", participant_ref: "project", binding_ref: opBinding },
      { id: "checkpoint", kind: "operation", participant_ref: "project", binding_ref: checkpointBinding }] };
  const instances = createAgenticProcessStore({ targetRoot: root, stateMode: "files" });
  const journal = createProcessOperationJournalStore({ targetRoot: root, stateMode: "files" });
  const readInstance = id => instances.read(id).record;
  const readOperation = id => { const row = journal.read(id); signer.verify(row.record); signer.verify(row.record.preview); return row; };
  const persist = (row, expected) => {
    const signed = signer.seal(row), result = journal.compareAndSwap(signed, expected);
    assert.notEqual(result.projection, "pending");
    return signed;
  };
  const readAuthority = () => ({ scope_id: "fixture:" + sha(artifacts.root), model_sha256: sha(model), policy_pins: {} });
  const readContext = () => ({ head: git(root, "rev-parse", "HEAD"), documents: names.map(name => artifacts.read(name).sha256) });
  const inventory = createStandardReconciliationInventory({ targetRoot: root, signer, readInstance, readAuthority, readContext });
  let clock = config.prepared?.plan.prepared_at_ms ?? Date.now(), requests = 0;
  const faults = { provider: false, grant: null, revokeAfterRecord: false };
  const authority = {
    readSource: async () => structuredClone(source),
    async verifySource(_instance, expected) {
      await new Promise(resolve => setImmediate(resolve));
      if (faults.provider) throw protocolError("FIXTURE_PROVIDER_CHANGED");
      assert.equal(sha(expected), sha(source));
      return { origin_source_sha256: sha(source), event_sha256: H, git_before_sha256: H, git_after_sha256: H,
        canonical_transition: "verified-separately-by-exact-plan-postimages", fresh_observation_sha256: sha({ generation: randomUUID() }) };
    },
  };
  const writer = createStandardPrCorrectionReopen({ targetRoot: root, readCurrent: readInstance, authority, now: () => clock });
  const makeReceipt = (record, output) => {
    const index = record.results.length, receipt_id = "receipt_" + record.operation_id.slice(3) + "_" + index;
    return { contract_version: "process-operation-receipt.v1", receipt_id, operation_id: record.operation_id,
      intent_sha256: sha(record.intent), authority_id: record.intent.authority_id, outcome: output.outcome, effect_status: output.effect_status,
      output_sha256: sha(output), facts: output.facts, evidence_refs: [{ ref: operationOutputRef(record.operation_id, index), sha256: sha(output) }] };
  };
  const appendResult = (record, output) => {
    const current = readOperation(record.operation_id);
    assert.equal(sha(current.record), sha(record));
    const receipt = makeReceipt(record, output);
    persist({ ...body(record), phase: "receipted", revision: record.revision + 1, results: [...record.results, { output, receipt }] }, current.content_sha256);
    return receipt;
  };
  const stop = phase => {
    if (phase !== boundary) return;
    const fence = artifacts.resourceFence().read().record;
    assert.equal(fence.process_identity.pid, process.pid);
    fs.writeFileSync(config.stopFile, JSON.stringify({ phase, fence, pid: process.pid }), { flag: "wx", flush: true });
    process.exit(42);
  };
  const disposition = createStandardOperationDisposition({ targetRoot: root, stateMode: "files", signer, artifacts, readOperation, readInstance,
    readAuthority, readContext, inventory, appendResult, makeReceipt, onLocalResource: stop,
    async onBoundary(phase) { if (phase === "disposition_recorded" && faults.revokeAfterRecord) faults.grant = "operation_disposition"; stop(phase); },
    async confirmInterruptedReopen(instance, record, original, options) {
      const frame = inspectAgenticProcess(instance).occurrences.find(row => row.occurrence_id === occurrenceId);
      assert.equal(sha(frame.operation.receipt), sha(original.receipt));
      return (await writer.observeInterrupted(instance, record.preview.prepared, original.output, options)).confirmation;
    },
    dispositionSource: entryDispositionSource ?? {
      async authorize({ request }) {
        requests++;
        const now = Date.now();
        return { contract_version: "process-disposition-authorization-grant.v1", authority_id: "fixture_operator",
          authorized: request.action !== faults.grant, request_sha256: sha(request), principal_sha256: H,
          grant_sha256: sha({ request, issuer: "fixture" }), observed_at_ms: now, expires_at_ms: now + 60000,
          evidence_refs: [{ ref: "fixture:reopen-disposition", sha256: sha(request) }] };
      },
      async verify({ request, grant }) {
        if (request.action === faults.grant) throw protocolError("FIXTURE_REVOKED_GRANT");
        return { outcome: "verified", authority_id: grant.authority_id, request_sha256: sha(request), grant_sha256: sha(grant) };
      },
    },
  });
  const service = createAgenticProcessService({ store: instances, readAuthority, operationAuthority: {
    prepare({ instance }) { const record = readOperation(operationJournalId(instance, occurrenceId)).record; return { binding: reopen, intent: record.intent }; },
    verifyIntent({ intent }) { return { outcome: "verified", authority_id: intent.authority_id, intent_sha256: sha(intent), binding_sha256: sha(reopen) }; },
    readReceipt({ intent, receipt_id }) { return readOperation(intent.operation_id).record.results.find(row => row.receipt.receipt_id === receipt_id).receipt; },
    async verifyReceipt({ intent, receipt, signal }) {
      const record = readOperation(intent.operation_id).record;
      if (receipt.effect_status !== "unknown") assert.equal(await disposition.verifyReceipt(record, receipt, signal), true);
      return { outcome: "verified", authority_id: intent.authority_id, intent_sha256: sha(intent), receipt_sha256: sha(receipt) };
    },
  } });
  const accept = receipt => service.acceptOperation({ instanceId, expectedSha256: readInstance(instanceId).instance_sha256, occurrenceId,
    eventId: receipt.effect_status === "unknown" ? "original_unknown" : "confirmed_disposition", receiptId: receipt.receipt_id, write: true });
  return { artifacts, disposition, model, service, writer, reopen, signer, readOperation, readInstance, readContext, persist, appendResult, accept, faults,
    requests: () => requests, expire: () => { clock += 300001; } };
}

if (process.argv[2] === "--reopen-disposition-worker") {
  const config = JSON.parse(fs.readFileSync(process.argv[3], "utf8")), h = open(config, config.boundary);
  if (config.boundary) {
    await h.disposition.apply(config.dispositionPlan, { write: true, expectedPlanSha256: sha(config.dispositionPlan) });
    assert.fail("boundary not reached");
  }
  const before = h.readOperation(config.id), record = h.persist({ ...body(before.record), phase: "dispatching", revision: before.record.revision + 1,
    owner: { generation: randomUUID(), pid: process.pid } }, before.content_sha256);
  let grants = 0;
  const output = await h.disposition.run(record, () => h.writer.apply(h.readInstance(instanceId), config.prepared,
    { write: true, expectPlan: config.prepared.plan_sha256, assertAuthorized() { if (++grants === 8) h.expire(); } }));
  assert.equal(output.effect_status, "unknown");
  assert.equal(output.observations.reason_code, "STANDARD_PLAN_EXPIRED");
  assert.equal(output.observations.committed.length, 3);
  await h.accept(h.appendResult(record, output));
}
export async function verifyReopenDisposition() {
  const roots = [], evidence = fs.mkdtempSync(path.join(temp, "aidn-reopen-disposition-evidence-"));
  try {
    const f = await createPrCorrectionReopenFixture("files", roots);
    const scaffold = fs.readFileSync(new URL("../../scaffold/root/.gitignore.append", import.meta.url), "utf8");
    const ignore = scaffold.split(/\r?\n/).filter(row => /^(?:\/)?docs\/audit\/workflows\/(?:process-instances|operation-records|dispatch-records|operation-control-intents|operation-dispositions|resource-fences)\//.test(row));
    assert.equal(ignore.length, 6);
    fs.appendFileSync(path.join(f.root, ".git/info/exclude"), "\n" + ignore.join("\n") + "\n");
    const config = { root: f.root, source: f.source, names: f.names };
    const h = open(config), initial = h.service.initialize({ instanceId, model: h.model, write: true }).record;
    const prepared = await h.writer.prepare(initial, f.input); assert.equal(prepared.can_apply, true);
    const id = operationJournalId(initial, occurrenceId);
    Object.assign(config, { id, prepared });
    const preview = h.signer.seal({ contract_version: "standard-operation-preview.v1", instance_id: instanceId, instance_sha256: initial.instance_sha256,
      scope_id: initial.scope_id, model_sha256: initial.model_sha256, occurrence_id: occurrenceId, binding: h.reopen, input: f.input,
      prepared, snapshot: h.readContext(), prepared_at_ms: Date.now() });
    const grant = { fixture: "explicit-original-admission" };
    const intent = { contract_version: "process-operation-intent.v1", operation_id: id, binding_ref: opBinding, binding_sha256: sha(h.reopen),
      input_sha256: sha(f.input), preconditions_sha256: sha({ snapshot: preview.snapshot, prepared }), authorization_sha256: sha(grant),
      authority_id: "fixture_host", scope_id: initial.scope_id, instance_id: instanceId, instance_sha256: initial.instance_sha256,
      model_sha256: initial.model_sha256, occurrence_id: occurrenceId, instance_revision: initial.revision };
    h.persist({ contract_version: "process-operation-journal.v1", operation_id: id, revision: 1, phase: "staged", preview, intent, grant, owner: null, results: [] }, null);
    await h.service.prepareOperation({ instanceId, expectedSha256: initial.instance_sha256, occurrenceId, eventId: "original_intent", write: true });
    function worker(label, extra, expectedExit) {
      const file = path.join(evidence, label + ".json");
      fs.writeFileSync(file, JSON.stringify({ ...config, ...extra }), { flag: "wx" });
      const result = spawnSync(process.execPath, [here, "--reopen-disposition-worker", file], { encoding: "utf8", windowsHide: true, timeout: 120000 });
      assert.equal(result.error, undefined);
      assert.equal(result.status, expectedExit, result.stderr);
    }
    worker("original", {}, 0);
    const original = h.readOperation(id).record, instance = h.readInstance(instanceId);
    const dispatchFile = path.join(f.root, "docs/audit/workflows/dispatch-records", id + ".json");
    const dispatchBytes = fs.readFileSync(dispatchFile), business = () => f.names.map(name => f.artifacts.read(name).sha256);
    const postimages = business(), archived = path.join(f.root, ".aidn/runtime/standard-workflow", "retired-" + id + ".lock");
    const lock = path.join(path.dirname(archived), "effects.lock"), originalLock = fs.readFileSync(lock);
    const prepare = host => host.disposition.prepare(id, { expectedSha256: instance.instance_sha256 });
    const apply = (host, plan) => host.disposition.apply(plan, { write: true, expectedPlanSha256: sha(plan) });
    const plan = await prepare(h);
    assert.equal(plan.assessment, "confirmed_reopen");
    assert.equal(h.requests(), 0);
    assert.equal(sha(h.readOperation(id).record), sha(original));
    await assert.rejects(h.disposition.apply(plan, { write: false, expectedPlanSha256: sha(plan) }), { code: "STANDARD_HOST_EXPLICIT_WRITE_REQUIRED" });
    h.faults.provider = true;
    await assert.rejects(apply(h, plan), { code: "FIXTURE_PROVIDER_CHANGED" });
    h.faults.provider = false;
    assert.deepEqual(fs.readFileSync(lock), originalLock);
    assert.equal(sha(h.readOperation(id).record), sha(original));
    const stopAt = async (host, at) => {
      const dispositionPlan = await prepare(host), stopFile = path.join(evidence, at + "-stopped.json");
      worker(at, { boundary: at, dispositionPlan, stopFile }, 42);
      const stopped = JSON.parse(fs.readFileSync(stopFile, "utf8"));
      assert.equal(stopped.phase, at);
      assert.equal(observeLocalProcessOwner(stopped.fence.process_identity), "terminated");
      assert.deepEqual(host.artifacts.resourceFence().read().record, stopped.fence);
      return stopped;
    };
    const transferred = await stopAt(h, "disposition_fence_acquired");
    assert.deepEqual(fs.readFileSync(lock), originalLock);
    assert.equal(sha(h.readOperation(id).record), sha(original));
    const revoked = open(config);
    revoked.faults.revokeAfterRecord = true;
    await assert.rejects(apply(revoked, await prepare(revoked)), { code: "FIXTURE_REVOKED_GRANT" });
    assert.deepEqual(fs.readFileSync(lock), originalLock);
    assert.equal(sha(h.readOperation(id).record), sha(original));
    assert.equal(revoked.artifacts.resourceFence().read().record.state, "released");
    const retired = await stopAt(open(config), "disposition_owner_retired");
    assert.notEqual(transferred.pid, retired.pid);
    assert.equal(fs.existsSync(lock), false);
    assert.deepEqual(fs.readFileSync(archived), originalLock);
    assert.equal(sha(h.readOperation(id).record), sha(original));
    const authorityRoot = path.join(evidence, "protected-host");
    const control = path.join(evidence, "control"), review = path.join(evidence, "review"), nativeHome = path.join(evidence, "native");
    for (const folder of [authorityRoot, control, review, nativeHome]) fs.mkdirSync(folder);
    const configuration = { target_root: f.root, control_root: control, review_root: review, instance_id: instanceId,
      native: { home: nativeHome, tool_roots: [], protected_roots: [authorityRoot] } };
    const operator = createStandardHostAuthority({ configuration, environment: { AIDN_STANDARD_HOST_HOME: authorityRoot } }, { useProvider: false });
    operator.ensureKey();
    const compose = (_authorize, source) => {
      const host = open(config, null, source);
      return {
        inspect() { const record = host.readInstance(instanceId); return { record, cursor: inspectAgenticProcess(record) }; },
        previewNative: () => ({ native_started: false }),
        step: async () => ({ kind: "reconciliation", status: "WAITING" }),
        readOperation: id => host.readOperation(id).record,
        prepareOperationDisposition: (id, options) => host.disposition.prepare(id, options),
        applyOperationDisposition: (plan, options) => host.disposition.apply(plan, options),
        acceptOperation(id, options) {
          assert.equal(options.write, true);
          const receipt = host.readOperation(id).record.results.find(row => row.receipt.receipt_id === options.receiptId).receipt;
          return host.disposition.withReceiptAcceptance(id, () => host.accept(receipt), { signal: options.signal });
        },
      };
    };
    const entry = options => runStandardWorkflowAction({ request: {}, configuration, parameters: {}, modelSource: {}, ...options },
      { authority: operator, compose });
    const execute = preview => entry({ preparedAction: preview.preview, execute: true, expectPlan: preview.action_sha256 });
    const cold = open(config), entryPreview = await entry();
    assert.equal(entryPreview.preview.kind, "operation_disposition");
    assert.equal(entryPreview.written, false);
    const recovered = entryPreview.preview.payload.disposition_plan;
    const result = await execute(entryPreview), applied = result.result.details, record = cold.readOperation(id).record;
    assert.equal(applied.status, "receipted");
    assert.equal(result.result.process_status, "WAITING");
    assert.equal(cold.readInstance(instanceId).instance_sha256, instance.instance_sha256);
    assert.equal(record.results.length, 2);
    assert.deepEqual(record.results[0], original.results[0]);
    assert.deepEqual(record.results[1].output, recovered.reopen.output);
    assert.equal(record.results[1].receipt.effect_status, "confirmed");
    assert.equal((await apply(cold, recovered)).written, false);
    assert.equal(cold.artifacts.ownerPending(), false);
    cold.faults.grant = "operation_disposition_accept";
    await assert.rejects(cold.disposition.withReceiptAcceptance(id, () => cold.accept(applied.receipt)), { code: "PROCESS_DISPOSITION_AUTHORIZATION_REQUIRED" });
    assert.equal(cold.readInstance(instanceId).instance_sha256, instance.instance_sha256);
    cold.faults.grant = null;
    const acceptPreview = await entry();
    assert.equal(acceptPreview.preview.kind, "operation_disposition_accept");
    assert.equal(acceptPreview.written, false);
    const acceptedResult = await execute(acceptPreview), accepted = acceptedResult.result.details.accepted;
    assert.equal(acceptedResult.result.process_status, "RUNNING");
    assert.deepEqual(accepted.record.events.slice(0, -1), instance.events);
    assert.deepEqual(accepted.record.events.at(-1).receipt, applied.receipt);
    const cursor = inspectAgenticProcess(accepted.record);
    assert.equal(cursor.occurrences.find(row => row.node_id === "checkpoint").status, "READY");
    assert.equal(cold.artifacts.ownerPending(), false);
    assert.deepEqual(business(), postimages);
    assert.deepEqual(fs.readFileSync(dispatchFile), dispatchBytes);
    console.log(JSON.stringify({ status: "PASS", scope: "STANDARD exact entry, canonical FILES disposition and reducer with fixture provider",
      separate_protected_operator_actions: true,
      boundaries: [transferred.phase, retired.phase], original_receipt: sha(original.results[0].receipt), confirmed_receipt: sha(applied.receipt),
      next_node: "checkpoint", evidence, full_standard: "NOT_RUN", ordinary_provider: "FIXTURE" }));
  } finally {
    // Fixture cleanup is limited to roots created by this invocation.
    for (const root of roots) {
      const real = fs.realpathSync(root);
      assert.equal(path.dirname(real), temp); assert.ok(path.basename(real).startsWith("aidn-standard-fresh-"));
      fs.rmSync(real, { recursive: true, force: true });
    }
  }
}
if (process.argv[2] !== "--reopen-disposition-worker" && process.argv[1] && path.resolve(process.argv[1]) === here)
  await verifyReopenDisposition();