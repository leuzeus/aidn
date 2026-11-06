import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardSessionCloseRecord } from "../../src/application/runtime/standard-session-close-record.mjs";
import { readStandardSessionClosureContext } from "../../src/application/runtime/standard-session-closure-context.mjs";
import { createStandardOperationDisposition } from "../../src/application/runtime/standard-operation-disposition.mjs";
import { createStandardReconciliationInventory } from "../../src/application/runtime/standard-reconciliation-inventory.mjs";
import { createOperationJournalSigner, operationJournalId, operationOutputRef } from "../../src/core/workflow/process-operation-journal.mjs";
import { createProcessOperationJournalStore } from "../../src/adapters/runtime/process-operation-journal-store.mjs";
import { createProcessDispatchRecordStore } from "../../src/adapters/runtime/process-dispatch-record-store.mjs";
import { createAgenticProcessStore } from "../../src/adapters/runtime/agentic-process-store.mjs";
import { createAgenticProcessService } from "../../src/application/runtime/agentic-process-service.mjs";
import { observeLocalProcess, observeLocalProcessOwner } from "../../src/adapters/runtime/local-process-identity.mjs";
import { sessionClosureChoices } from "../../src/core/workflow/standard-session-closure-decision.mjs";
import { inspectAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { assertProcessDispatchRecord } from "../../src/core/workflow/process-dispatch-record.mjs";

const here = fileURLToPath(import.meta.url), H = "a".repeat(64), body = ({ authentication, key_id, ...row }) => row;
export const WRITE_DISPOSITION_CASES = ["artifact-redelivery", "artifact-disposition-recorded", "artifact-disposition-receipted"];
export const WRITE_OWNER_INTENTION_CASES = ["artifact-owner-reserved", "artifact-owner-fence-acquired", "artifact-owner-declared"];
// Trusted fixture composition, deliberately below the ordinary operation host.
// The closure review/admission is synthetic; the write, ownership, dispatch,
// inventory, stores, disposition and common service/reducer are production.
// This does not establish the complete STANDARD or an actual human approval.
function open(config, boundary = async () => {}, grants = [], localResource = () => {}) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: config.root });
  const operations = createStandardWorkflowOperations({ targetRoot: config.root });
  const binding = standardWorkflowOperationBindings().find(row => row.id === "session_close_record");
  const model = { contract_version: "agentic-process-model.v2", model_id: "artifact-disposition-fixture", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [], operation_pins: { session_close_record: shadowHash(binding) },
    entry: "record", nodes: [{ id: "record", kind: "operation", participant_ref: "project", binding_ref: "session_close_record" }] };
  const signer = createOperationJournalSigner(() => Buffer.from(config.key, "hex"));
  const instances = createAgenticProcessStore({ targetRoot: config.root, stateMode: config.mode });
  const journal = createProcessOperationJournalStore({ targetRoot: config.root, stateMode: config.mode });
  const readInstance = id => instances.read(id).record;
  const readAuthority = () => ({ scope_id: "fixture:" + shadowHash(artifacts.root), model_sha256: shadowHash(model), policy_pins: {} });
  const readContext = () => ({ scope: operations.observeScope(), documents: ["sessions/S001.md", "CURRENT-STATE.md", "snapshots/context-snapshot.md"]
    .map(name => ({ path: name, sha256: artifacts.read(name).sha256, metadata_sha256: artifacts.metadataHash(name) })) });
  const save = (store, row, expected) => { const result = store.compareAndSwap(row, expected);
    if (result.projection === "pending") store.materialize(row.operation_id ?? row.instance_id, { write: true }); return row; };
  const readOperation = id => { const observed = journal.read(id); if (observed.record) signer.verify(observed.record); return observed; };
  const persist = (row, expected) => save(journal, signer.seal(row), expected);
  const makeReceipt = (record, output) => ({ contract_version: "process-operation-receipt.v1", receipt_id: "receipt_" + record.operation_id.slice(3),
    operation_id: record.operation_id, intent_sha256: shadowHash(record.intent), authority_id: record.intent.authority_id,
    outcome: output.outcome, effect_status: output.effect_status, output_sha256: shadowHash(output), facts: output.facts,
    evidence_refs: [{ ref: operationOutputRef(record.operation_id), sha256: shadowHash(output) }] });
  const inventory = createStandardReconciliationInventory({ targetRoot: config.root, signer, readInstance, readAuthority, readContext });
  const disposition = createStandardOperationDisposition({ targetRoot: config.root, stateMode: config.mode, signer, artifacts,
    readOperation, readInstance, readAuthority, readContext, inventory, makeReceipt, onBoundary: boundary, onLocalResource: localResource,
    dispositionSource: {
      async authorize({ request }) { grants.push(request); return { contract_version: "process-disposition-authorization-grant.v1",
        authority_id: "fixture_operator", authorized: true, request_sha256: shadowHash(request), principal_sha256: H,
        grant_sha256: shadowHash({ request, fixture: "fresh-consent" }), observed_at_ms: Date.now(), expires_at_ms: Date.now() + 30000,
        evidence_refs: [{ ref: "fixture:explicit-disposition-consent", sha256: shadowHash(request) }] }; },
      async verify({ request, grant }) { return { outcome: "verified", authority_id: grant.authority_id,
        request_sha256: shadowHash(request), grant_sha256: shadowHash(grant) }; },
    },
    appendResult(record, output) { const before = readOperation(record.operation_id); assert.equal(shadowHash(before.record), shadowHash(record));
      const receipt = makeReceipt(record, output); persist({ ...body(record), phase: "receipted", revision: record.revision + 1,
        results: [...record.results, { output, receipt }] }, before.content_sha256); return receipt; },
  });
  const service = createAgenticProcessService({ store: instances, readAuthority, operationAuthority: {
    prepare({ instance }) { const record = readOperation(operationJournalId(instance, "root")).record; return { binding, intent: record.intent }; },
    verifyIntent({ intent }) { signer.verify(readOperation(intent.operation_id).record); return { outcome: "verified", authority_id: intent.authority_id,
      intent_sha256: shadowHash(intent), binding_sha256: shadowHash(binding) }; },
    readReceipt({ intent }) { return readOperation(intent.operation_id).record.results.at(-1)?.receipt; },
    async verifyReceipt({ receipt, intent }) { const record = readOperation(intent.operation_id).record;
      assert.equal(await disposition.verifyReceipt(record, receipt), true); return { outcome: "verified", authority_id: intent.authority_id,
        intent_sha256: shadowHash(intent), receipt_sha256: shadowHash(receipt) }; },
  } });
  const writer = createStandardSessionCloseRecord({ targetRoot: config.root, readCurrent: readInstance,
    readDecision: async () => { const current = await readStandardSessionClosureContext({ targetRoot: config.root, sessionId: "S001" });
      assert.equal(current.context_sha256, config.material.question.review.context_sha256); return structuredClone(config.material); } });
  return { artifacts, model, binding, signer, instances, journal, readInstance, readOperation, readAuthority, readContext, save, persist, disposition, inventory, service, writer };
}

if (process.argv.includes("--write-disposition-worker")) {
  const file = process.argv.at(-1), config = JSON.parse(fs.readFileSync(file, "utf8"));
  const mark = phase => fs.appendFileSync(file + ".phases.jsonl", JSON.stringify({ phase, at_ms: Date.now(), pid: process.pid }) + "\n");
  mark("worker_entered");
  const h = open(config, async boundary => { if (boundary === config.boundary) {
    mark(boundary);
    const identity = config.plan ? h.artifacts.resourceFence().read().record.process_identity
      : createProcessDispatchRecordStore({ targetRoot: config.root, stateMode: config.mode }).read(config.operation_id).record.process_identity;
    assert.equal(identity.pid, process.pid);
    process.send({ boundary, identity }); await new Promise(() => {}); } }, [], boundary => {
      mark(boundary);
      if (boundary !== config.boundary) return;
      const identity = createProcessDispatchRecordStore({ targetRoot: config.root, stateMode: config.mode }).read(config.operation_id).record.process_identity;
      assert.equal(identity.pid, process.pid);
      // A synchronous observation hook adds no awaited authority boundary.
      // The real parent kills this process while the actual production writer
      // is paused immediately before/after the fence CAS or lock declaration.
      process.send({ boundary, identity }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    });
  mark("host_opened");
  try {
    if (config.plan) await h.disposition.apply(config.plan, { write: true, expectedPlanSha256: shadowHash(config.plan) });
    else {
      const before = h.readOperation(config.operation_id), record = h.persist({ ...body(before.record), phase: "dispatching", revision: before.record.revision + 1,
        owner: { generation: randomUUID(), pid: process.pid } }, before.content_sha256);
      await h.disposition.run(record, () => h.writer.apply(h.readInstance("artifact_disposition"), record.preview.prepared,
        { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: async () => {} }));
    }
    process.send({ unexpected_completion: true });
  } catch (cause) { process.send({ error: cause.code ?? cause.message, stack: cause.stack }); process.exitCode = 1; }
}

export async function verifyStandardOperationWriteDisposition(mode, report, only = null) {
  const owned = [], retained = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-write-disposition-evidence-"));
  let checks = 0;
  const phase = (phase, extra = {}) => fs.appendFileSync(path.join(retained, "phases.jsonl"), JSON.stringify({ phase, at_ms: Date.now(), ...extra }) + "\n");
  async function setup(name) {
    phase("setup", { name });
    const config = { mode, root: createFreshStandardWorkflowFixture(mode, owned), key: randomBytes(32).toString("hex"), name };
    phase("fixture_created", { name });
    const ops = createStandardWorkflowOperations({ targetRoot: config.root });
    let plan = await ops.prepareSession({ session_id: "S001", session_branch: "S001-write-recovery", objective: "Qualify original report recovery" });
    assert.equal((await ops.initializeSession(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
    plan = await ops.prepareMode({ session_id: "S001", mode: "COMMITTING" });
    assert.equal((await ops.applyMode(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
    phase("session_prepared", { name });
    const context = await readStandardSessionClosureContext({ targetRoot: config.root, sessionId: "S001" });
    const { admission_allowed, ...base } = context, op = n => "op_" + String(n).repeat(40);
    const review = { ...base, admission_operation_id: op(1), admission_output_sha256: H, drift_evaluation_operation_id: op(2), drift_evaluation_output_sha256: H,
      drift_finalization_operation_id: op(3), drift_finalization_output_sha256: H };
    const question = { contract_version: "standard-session-closure-question.v1", operation_id: op(4), instance_id: "artifact_disposition", scope_id: "fixture_scope",
      occurrence_id: "root", intent_sha256: H, session_id: "S001", review, choices: sessionClosureChoices(review) };
    config.material = { question, decision: { contract_version: "human-session-closure-decision.v1", source_kind: "human", authority_id: "fixture_operator",
      source_event_id: "fixture:close:1", question_sha256: shadowHash(question), subject_sha256: shadowHash(review), choice: "close", rationale: "Explicit fixture request",
      evidence_refs: [{ ref: "fixture:operator-close", sha256: H }], session_report: { summary: "Retain this original report exactly once", open_loops: [], blockers: [], next_entry_point: "Final hook remains pending" } } };
    const h = open(config), initial = h.service.initialize({ instanceId: "artifact_disposition", model: h.model, write: true });
    const instance = initial.record, input = { decision_operation_id: op(4) }, prepared = await h.writer.prepare(instance, input);
    assert.equal(prepared.can_apply, true); config.operation_id = operationJournalId(instance, "root");
    const preview = h.signer.seal({ contract_version: "standard-operation-preview.v1", instance_id: instance.instance_id, instance_sha256: instance.instance_sha256,
      scope_id: instance.scope_id, model_sha256: instance.model_sha256, occurrence_id: "root", binding: h.binding, input, prepared,
      snapshot: h.readContext(), prepared_at_ms: Date.now() });
    const grant = { fixture: "explicit-initial-write-admission" };
    const intent = { contract_version: "process-operation-intent.v1", operation_id: config.operation_id, binding_ref: h.binding.id, binding_sha256: shadowHash(h.binding),
      input_sha256: shadowHash(input), preconditions_sha256: shadowHash({ snapshot: preview.snapshot, prepared }), authorization_sha256: shadowHash(grant),
      authority_id: "fixture_host", scope_id: instance.scope_id, instance_id: instance.instance_id, instance_sha256: instance.instance_sha256,
      model_sha256: instance.model_sha256, occurrence_id: "root", instance_revision: instance.revision };
    h.persist({ contract_version: "process-operation-journal.v1", operation_id: config.operation_id, revision: 1, phase: "staged", preview, intent, grant, owner: null, results: [] }, null);
    await h.service.prepareOperation({ instanceId: instance.instance_id, expectedSha256: instance.instance_sha256, occurrenceId: "root", eventId: "original_intent", write: true });
    fs.writeFileSync(path.join(retained, name + "-source.json"), JSON.stringify(config)); phase("staged", { name }); return config;
  }
  async function crash(config, boundary, plan = null) {
    const file = path.join(retained, config.name + "-" + boundary + ".json"); fs.writeFileSync(file, JSON.stringify({ ...config, boundary, plan }));
    const child = fork(here, ["--write-disposition-worker", file], { cwd: config.root, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stderr = ""; child.stdout.resume(); child.stderr.on("data", bytes => { stderr += bytes; if (stderr.length > 16384) child.kill(); });
    let timerExpired = false, message, exit;
    const ended = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal }))), timer = setTimeout(() => { timerExpired = true; child.kill(); }, 15000);
    try {
      message = await new Promise((resolve, reject) => { child.once("error", reject); child.once("message", row => row.boundary === boundary ? resolve(row) : reject(Error(JSON.stringify(row))));
        child.once("close", () => reject(Error("WORKER_CLOSED_BEFORE_BOUNDARY:" + stderr.slice(-2048)))); });
      child.kill(); exit = await ended; assert.equal(observeLocalProcessOwner(message.identity), "terminated"); phase(boundary, { name: config.name });
    } finally {
      clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill(); exit ??= await ended;
      fs.writeFileSync(file + ".exit.json", JSON.stringify({ message: message ?? null, exit, stderr, timer_expired: timerExpired,
        original_worker_bound_ms: 15000, actual_process_termination: true, target_boundary_observed: Boolean(message) }));
    }
  }
  const prepare = (h, config) => h.disposition.prepare(config.operation_id, { expectedSha256: h.readInstance("artifact_disposition").instance_sha256 });
  const apply = (h, plan) => h.disposition.apply(plan, { write: true, expectedPlanSha256: shadowHash(plan) });
  try {
    const selected = only === null ? WRITE_DISPOSITION_CASES : [...WRITE_DISPOSITION_CASES, ...WRITE_OWNER_INTENTION_CASES].filter(name => name === only);
    for (const name of selected) {
      const config = await setup(name);
      if (WRITE_OWNER_INTENTION_CASES.includes(name)) {
        const boundary = name === "artifact-owner-reserved" ? "local_owner_reserved"
          : name === "artifact-owner-fence-acquired" ? "local_owner_fence_acquired" : "local_owner_declared";
        const before = open(config), images = before.readOperation(config.operation_id).record.preview.prepared.plan.changes
          .map(row => ({ path: row.path, sha256: before.artifacts.read(row.path).sha256, metadata_sha256: before.artifacts.metadataHash(row.path) }));
        await crash(config, boundary);
        const h = open(config), store = createProcessDispatchRecordStore({ targetRoot: config.root, stateMode: mode });
        const original = store.read(config.operation_id).record; h.signer.verify(original); assertProcessDispatchRecord(original);
        assert.equal(original.contract_version, "process-dispatch-record.v2"); assert.equal(original.phase, "running"); assert.equal(original.output, null);
        assert.equal(original.local_owner_intentions.length, 1); const intention = original.local_owner_intentions[0];
        assert.equal(observeLocalProcessOwner(original.process_identity), "terminated");
        assert.equal(intention.owner.pid, original.process_identity.pid);
        assert.deepEqual(intention.resource_fence.record.process_identity, original.process_identity);
        const lock = path.join(config.root, intention.lock_path), fence = h.artifacts.resourceFence().read();
        if (boundary === "local_owner_reserved") { assert.equal(fence.content_sha256, intention.resource_fence.previous_sha256); assert.equal(fs.existsSync(lock), false); }
        else assert.deepEqual(fence.record, intention.resource_fence.record);
        if (boundary === "local_owner_declared") {
          assert.deepEqual(JSON.parse(fs.readFileSync(lock, "utf8")), intention.owner); assert.equal(original.leases.length, 1);
          assert.equal(original.leases[0].status, "held");
        } else { assert.equal(original.leases.length, 0); assert.equal(fs.existsSync(lock), false); }
        const inventory = h.inventory.observeSubject("artifact_disposition").inventory;
        h.signer.verify(inventory);
        assert.ok(inventory.resources.some(row => row.ref === `local-owner-intention:${config.operation_id}/${intention.owner.token}`));
        assert.equal(inventory.complete_resource_closure, false); assert.equal(inventory.permits_effects, false);
        const prepared = prepare(h, config); assert.equal(prepared.assessment, "unknown");
        assert.equal((await apply(h, prepared)).written, false); assert.equal(h.readOperation(config.operation_id).record.results.length, 0);
        await assert.rejects(h.disposition.run(h.readOperation(config.operation_id).record, () => { throw Error("SECOND_EFFECT_FORBIDDEN"); }), { code: "PROCESS_DISPATCH_ALREADY_DECLARED" });
        assert.deepEqual(store.read(config.operation_id).record, original); assert.deepEqual(h.artifacts.resourceFence().read(), fence);
        assert.deepEqual(images.map(row => ({ path: row.path, sha256: h.artifacts.read(row.path).sha256, metadata_sha256: h.artifacts.metadataHash(row.path) })), images);
        const forged = structuredClone(original); forged.local_owner_intentions[0].resource_fence.record.process_identity.pid++;
        assert.throws(() => assertProcessDispatchRecord(forged), { code: "PROCESS_DISPATCH_RECORD_INVALID" });
        const historical = structuredClone(original); delete historical.local_owner_intentions; historical.contract_version = "process-dispatch-record.v1";
        assertProcessDispatchRecord(historical); // Reader-only shape check, no persisted conversion.
        phase("unknown_retained", { name }); checks++; report(`${mode}: ${name} real writer crash, signed preallocation identity, cold inventory and unchanged artifacts/fence/UNKNOWN; no takeover or second dispatch`);
        continue;
      }
      await crash(config, "dispatch_returned");
      let h = open(config), plan = prepare(h, config); assert.equal(plan.assessment, "confirmed_original");
      const store = createProcessDispatchRecordStore({ targetRoot: config.root, stateMode: mode }), original = store.read(config.operation_id).record;
      h.signer.verify(original); assert.equal(original.output.effect_status, "confirmed"); assert.equal(original.leases.length, 1);
      assert.equal(original.contract_version, "process-dispatch-record.v2"); assert.equal(original.local_owner_intentions.length, 1);
      assert.deepEqual(original.local_owner_intentions[0].owner, original.leases[0].owner);
      assert.deepEqual(original.local_owner_intentions[0].resource_fence.record, original.leases[0].resource_fence);
      assert.equal(original.leases[0].status, "released"); assert.equal(original.operation_owner_sha256, shadowHash(h.readOperation(config.operation_id).record.owner));
      const images = original.output.observations.postimages;
      const witnesses = () => images.map(row => ({ path: row.path, sha256: h.artifacts.read(row.path).sha256, metadata_sha256: h.artifacts.metadataHash(row.path) }));
      assert.deepEqual(witnesses(), images);
      if (name !== "artifact-redelivery") {
        const boundary = name.replace("artifact-", "").replaceAll("-", "_"); await crash(config, boundary, plan); h = open(config);
        if (boundary === "disposition_recorded") { assert.equal(h.readOperation(config.operation_id).record.results.length, 0); plan = prepare(h, config); }
      }
      const grants = []; h = open(config, async () => {}, grants);
      const receipt = (await apply(h, plan)).receipt; assert.equal(receipt.output_sha256, original.output_sha256);
      assert.equal(h.readOperation(config.operation_id).record.results.length, 1); assert.deepEqual(witnesses(), images);
      assert.equal((await apply(open(config), plan)).receipt.receipt_id, receipt.receipt_id);
      h = open(config, async () => {}, grants);
      const before = h.readInstance("artifact_disposition");
      const accepted = await h.disposition.withReceiptAcceptance(config.operation_id, () => h.service.acceptOperation({ instanceId: before.instance_id,
        expectedSha256: before.instance_sha256, occurrenceId: "root", eventId: "original_result", receiptId: receipt.receipt_id, write: true }));
      assert.equal(accepted.cursor.status, "COMPLETED"); assert.equal(accepted.record.events.at(-1).receipt.facts.session_close_completed, false);
      assert.equal(h.readOperation(config.operation_id).record.results.length, 1); assert.deepEqual(store.read(config.operation_id).record, original); assert.deepEqual(witnesses(), images);
      assert.match(h.artifacts.read("sessions/S001.md").content, /^state: OPEN$/m);
      assert.match(h.artifacts.read("sessions/S001.md").content, /^session_closure_status: checkpoint_pending$/m);
      assert.ok(grants.some(row => row.action === "operation_disposition_accept"));
      const simulation = simulateAgenticProcess({ instanceId: before.instance_id, model: before.model, policyPins: before.policy_pins, scopeId: before.scope_id,
        events: accepted.record.events, facts: {} }); assert.deepEqual(simulation.trace.at(-1).cursor, inspectAgenticProcess(accepted.record));
      phase("accepted", { name }); checks++; report(`${mode}: ${name} actual original session report postimages, real crash, cold disposition, one receipt, common-service acceptance/replay/SIM; closure remains pending`);
    }
    console.log(JSON.stringify({ status: "PASS", checks, retained, mode, selected_case: only, fixture_authorities: true,
      scope: "production writer/disposition/inventory/stores/common service; fixture admission and closure decision; below ordinary operation host",
      full_standard: "NOT_RUN", all_resource_disposition: "INCOMPLETE" })); return checks;
  } finally { fs.writeFileSync(path.join(retained, "arenas.json"), JSON.stringify({ owned, checks, mode })); }
}
