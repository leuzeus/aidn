#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createProcessControlInboxStore } from "../../src/adapters/runtime/process-control-inbox-store.mjs";
import { createAgenticProcessStore } from "../../src/adapters/runtime/agentic-process-store.mjs";
import { controlInboxPath } from "../../src/core/workflow/process-control-inbox.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { createAgenticProcess, advanceAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { createStandardControlInbox } from "../../src/application/runtime/standard-workflow-control-inbox.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { controlDelivery, controlInboxId } from "../../src/core/workflow/process-control-inbox.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";

const H = "a".repeat(64), grant = { authorized: true, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: H };
const here = fileURLToPath(import.meta.url), temporary = fs.realpathSync(os.tmpdir()), owned = [];
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();
const op = (id, binding_ref) => ({ id, kind: "operation", participant_ref: "project", binding_ref });
function model(eventOnly = false) {
  const nodes = [...(eventOnly ? [] : [{ id: "root", kind: "sequence", participant_ref: "project", children: ["reload", "admit", "initialize", "wait"] },
    op("reload", "context_reload"), op("admit", "session_admit"), op("initialize", "session_initialize")]),
    { id: "wait", kind: "event", participant_ref: "project", branches: [
      { flow_id: "review", node_id: "after_review", event_key: "review_snapshot" },
      { flow_id: "checks", node_id: "after_checks", event_key: "checks_snapshot" }] },
    op("after_review", "context_reload"), op("after_checks", "session_admit")];
  const refs = new Set(nodes.filter(n => n.kind === "operation").map(n => n.binding_ref));
  return { contract_version: "agentic-process-model.v2", model_id: eventOnly ? "control-wait-fixture" : "control-resume-fixture", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [], entry: eventOnly ? "wait" : "root", nodes,
    operation_pins: Object.fromEntries(standardWorkflowOperationBindings().filter(b => refs.has(b.id)).map(b => [b.id, shadowHash(b)])) };
}
function source(privateRoot, verified = true) {
  const read = ref => {
    if (!/^[a-z][a-z0-9_-]*$/.test(ref)) throw Error("FIXTURE_SOURCE_REF_INVALID");
    const file = path.join(privateRoot, ref + ".json"); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  };
  return { read: async ({ sourceRef }) => read(sourceRef), verify: async ({ source: claim, sourceRef, request }) => ({
    outcome: verified && claim.authority_id === "fixture_provider" && shadowHash(read(sourceRef)) === shadowHash(claim)
      && claim.request_sha256 === shadowHash(request) ? "verified" : "denied", authority_id: claim.authority_id, source_sha256: shadowHash(claim) }) };
}
const open = (root, privateRoot, eventOnly = false, verified = true) => createStandardWorkflowOperationHost({ targetRoot: root, model: model(eventOnly),
  readSigningKey: () => fs.readFileSync(path.join(privateRoot, "host.key")), authorize: async () => grant, controlSource: source(privateRoot, verified) });
const publish = (privateRoot, ref, claim) => fs.writeFileSync(path.join(privateRoot, ref + ".json"), JSON.stringify(claim));
function claimFor(request, id, kind = "external") { return { contract_version: "process-control-source.v1", source_kind: kind,
  authority_id: "fixture_provider", source_event_id: id, subject_sha256: H, request_sha256: shadowHash(request), event_key: "review_snapshot",
  payload_sha256: H, evidence_refs: [{ ref: "fixture:provider/event", sha256: H }] }; }
let checks = 0;
const pass = name => { checks++; console.log("PASS " + name); };
async function safety() {
  const request = { contract_version: "process-control-request.v1", scope_id: "fixture", instance_id: "safety", instance_sha256: H,
    model_sha256: H, instance_revision: 1, occurrence_id: "root", correlation_id: "fixture:root", event_keys: ["review_snapshot", "checks_snapshot"],
    context_sha256: H, branch: "dev", head: "a".repeat(40) }, claim = claimFor(request, "bounded");
  const signer = createOperationJournalSigner(() => Buffer.alloc(32, 7));
  let writes = 0, observedSignal;
  const never = createStandardControlInbox({ signer, projectionRequired: false, store: { read() { throw Error("UNEXPECTED_STORE_READ"); },
    compareAndSwap() { writes++; } }, source: { read({ signal }) { observedSignal = signal; return new Promise(() => {}); } } });
  const started = Date.now();
  await assert.rejects(never.reserve(request, "hang"), { code: "PROCESS_CONTROL_AUTHORITY_TIMEOUT" });
  assert.equal(observedSignal.aborted, true); assert.equal(writes, 0); assert.ok(Date.now() - started < 7000);
  pass("bounded source read times out and aborts without any canonical reservation");
  const id = controlInboxId(claim), retained = signer.seal({ contract_version: "process-control-inbox.v1", inbox_id: id, source_ref: "bounded",
    request, source: claim, delivery: controlDelivery(request, claim), phase: "reserved", delivered_instance_sha256: null });
  const abort = new AbortController(), pending = createStandardControlInbox({ signer, projectionRequired: false,
    store: { read: () => ({ record: retained }), compareAndSwap() { writes++; } }, source: { verify({ signal }) { observedSignal = signal; return new Promise(() => {}); } } });
  const result = pending.verifyDelivery(id, abort.signal); setTimeout(() => abort.abort(), 20);
  await assert.rejects(result, { code: "PROCESS_CONTROL_AUTHORITY_ABORTED" });
  assert.equal(observedSignal.aborted, true); assert.equal(writes, 0);
  pass("authority verification observes cancellation without delivery or writes");

  const root = createStandardWorkflowFixture("dual", owned), privateRoot = fs.mkdtempSync(path.join(temporary, "aidn-standard-control-")); owned.push(privateRoot);
  fs.writeFileSync(path.join(privateRoot, "host.key"), randomBytes(32));
  const host = open(root, privateRoot, true), initial = host.initialize({ instanceId: "safety" });
  host.initialize({ instanceId: "safety", write: true, expectedResultSha256: initial.record.instance_sha256 });
  const state = host.inspect("safety"), frame = state.cursor.occurrences.find(row => row.wait_reason === "event");
  const input = { instanceId: "safety", expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id };
  const actualRequest = host.prepareControl(input); publish(privateRoot, "repair", claimFor(actualRequest, "projection-repair"));
  const capture = await host.captureControl({ ...input, sourceRef: "repair", write: true });
  const projection = path.join(root, "docs/audit/workflows/process-instances/safety.json");
  fs.unlinkSync(projection); fs.mkdirSync(projection);
  const delivered = await host.deliverControl(capture.inbox_id, { write: true });
  assert.equal(delivered.projection, "reconciliation_required");
  assert.equal(host.readControl(capture.inbox_id).phase, "delivered");
  fs.rmdirSync(projection); fs.unlinkSync(path.join(privateRoot, "repair.json"));
  const reopened = open(root, privateRoot, true), repaired = await reopened.deliverControl(capture.inbox_id, { write: true });
  assert.equal(repaired.retained, true); assert.equal(repaired.projection, "materialized");
  assert.equal(repaired.record.instance_sha256, delivered.record.instance_sha256);
  assert.equal(JSON.parse(fs.readFileSync(projection, "utf8")).instance_sha256, delivered.record.instance_sha256);
  pass("dual: explicit retained delivery repairs required projection without provider or duplicate canonical event");

  const store = createAgenticProcessStore({ targetRoot: root, stateMode: "dual" }), canonical = store.read("safety");
  let fake = createAgenticProcess({ instanceId: "safety", model: canonical.record.model, policyPins: canonical.record.policy_pins,
    scopeId: canonical.record.scope_id, facts: canonical.record.initial_facts });
  for (const event of canonical.record.events) {
    const substituted = structuredClone(event); substituted.delivery.payload_sha256 = "b".repeat(64);
    fake = advanceAgenticProcess(fake, substituted);
  }
  store.compareAndSwap(fake, canonical.content_sha256);
  assert.throws(() => open(root, privateRoot, true).inspect("safety"), { code: "STANDARD_HOST_CONTROL_HISTORY_NOT_AUTHENTICATED" });
  store.compareAndSwap(canonical.record, store.read("safety").content_sha256);
  assert.equal(open(root, privateRoot, true).inspect("safety").record.instance_sha256, canonical.record.instance_sha256);
  pass("self-hashed canonical event history cannot substitute the authenticated captured delivery");
}
if (process.argv[2] === "--deliver") {
  const [, , , root, privateRoot, id, eventOnly] = process.argv;
  const state = await open(root, privateRoot, eventOnly === "yes").deliverControl(id, { write: true });
  console.log(JSON.stringify({ instance_sha256: state.record.instance_sha256 }));
} else try {
  for (const mode of process.argv[2] === "--safety-only" ? [] : process.argv[2] === "--files-only" ? ["files"] : ["files", "dual", "db-only"]) {
    const root = createStandardWorkflowFixture(mode, owned), privateRoot = fs.mkdtempSync(path.join(temporary, "aidn-standard-control-")); owned.push(privateRoot);
    fs.writeFileSync(path.join(privateRoot, "host.key"), randomBytes(32));
    const business = createStandardWorkflowArtifacts({ targetRoot: root }); let host = open(root, privateRoot);
    const initialize = (h, id) => { const p = h.initialize({ instanceId: id }); h.initialize({ instanceId: id, write: true, expectedResultSha256: p.record.instance_sha256 }); };
    initialize(host, "resume");
    async function operation(id, instanceId = "resume", h = host) {
      const state = h.inspect(instanceId), frame = state.cursor.occurrences.find(row => row.node_id === id && row.status === "READY"); assert.ok(frame);
      const p = await h.preview({ instanceId, expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id,
        input: id === "initialize" ? { session_id: "S001", session_branch: "S001-control", objective: "Resume authenticated control after actual session effects" } : {} });
      const staged = await h.stage(p, { write: true, expectedPreviewSha256: shadowHash(p) });
      assert.equal((await h.dispatch(staged.operation_id, { write: true })).receipt.outcome, "completed");
      return h.accept(staged.operation_id, { write: true });
    }
    for (const id of ["reload", "admit", "initialize"]) await operation(id);
    const requestInput = (h, id = "resume") => { const state = h.inspect(id), frame = state.cursor.occurrences.find(row => row.wait_reason === "event");
      assert.ok(frame); return { instanceId: id, expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id }; };
    const before = [business.read("CURRENT-STATE.md").sha256, business.read("sessions/S001.md").sha256, git(root, "branch", "--show-current")];
    const input = requestInput(host), request = host.prepareControl(input), initialHash = host.inspect("resume").record.instance_sha256;
    await assert.rejects(host.captureControl({ ...input, sourceRef: "absent" }), { code: "STANDARD_HOST_EXPLICIT_WRITE_REQUIRED" });
    assert.equal((await host.captureControl({ ...input, sourceRef: "absent", write: true })).status, "waiting_for_control");
    assert.equal(host.inspect("resume").record.instance_sha256, initialHash);
    pass(`${mode}: absent source waits without implicit writes or model allocation`);
    publish(privateRoot, "raw", { approved: true });
    await assert.rejects(host.captureControl({ ...input, sourceRef: "raw", write: true }), { code: "PROCESS_CONTROL_SOURCE_INVALID" });
    publish(privateRoot, "wrong", { ...claimFor(request, "wrong"), request_sha256: H });
    await assert.rejects(host.captureControl({ ...input, sourceRef: "wrong", write: true }), { code: "PROCESS_CONTROL_SOURCE_BINDING_CHANGED" });
    publish(privateRoot, "unauthenticated", claimFor(request, "unauthenticated"));
    await assert.rejects(open(root, privateRoot, false, false).captureControl({ ...input, sourceRef: "unauthenticated", write: true }), { code: "PROCESS_CONTROL_NOT_AUTHENTICATED" });
    assert.equal(host.inspect("resume").record.instance_sha256, initialHash);
    pass(`${mode}: raw approval, wrong request and unauthenticated source cannot wake the process`);
    publish(privateRoot, "valid", claimFor(request, "one-source"));
    const capture = await host.captureControl({ ...input, sourceRef: "valid", write: true });
    assert.equal(capture.status, "reserved"); assert.equal(host.inspect("resume").cursor.status, "WAITING");
    host = open(root, privateRoot); assert.equal(host.readControl(capture.inbox_id).phase, "reserved");
    await assert.rejects(host.deliverControl(capture.inbox_id), { code: "STANDARD_HOST_EXPLICIT_WRITE_REQUIRED" });
    const child = JSON.parse(execFileSync(process.execPath, [here, "--deliver", root, privateRoot, capture.inbox_id, "no"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000, windowsHide: true }));
    host = open(root, privateRoot); assert.equal(host.inspect("resume").record.instance_sha256, child.instance_sha256);
    assert.equal(host.readControl(capture.inbox_id).phase, "delivered");
    assert.deepEqual([business.read("CURRENT-STATE.md").sha256, business.read("sessions/S001.md").sha256, git(root, "branch", "--show-current")], before);
    pass(`${mode}: new Node host authenticates prior operation/control history and delivers without repeating session effects`);
    await operation("after_review", "resume", host);
    const final = host.inspect("resume"); assert.equal(final.cursor.status, "COMPLETED");
    fs.unlinkSync(path.join(privateRoot, "valid.json"));
    assert.equal((await host.deliverControl(capture.inbox_id, { write: true })).retained, true);
    assert.equal(host.inspect("resume").record.instance_sha256, final.record.instance_sha256);
    const simulation = simulateAgenticProcess({ instanceId: final.record.instance_id, model: final.record.model,
      policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256);
    pass(`${mode}: duplicate delivery after later operations is idempotent even with provider unavailable; exact replay/simulation`);

    // A second instance can wait on the same model but cannot reuse the first source event.
    const protocol = open(root, privateRoot, true); initialize(protocol, "second");
    const secondInput = requestInput(protocol, "second"), secondRequest = protocol.prepareControl(secondInput);
    publish(privateRoot, "duplicate", claimFor(secondRequest, "one-source"));
    await assert.rejects(protocol.captureControl({ ...secondInput, sourceRef: "duplicate", write: true }), { code: "PROCESS_CONTROL_SOURCE_ALREADY_USED" });
    pass(`${mode}: source event identity cannot authorize another occurrence/instance`);
    publish(privateRoot, "stale", claimFor(secondRequest, "stale-context"));
    const stale = await protocol.captureControl({ ...secondInput, sourceRef: "stale", write: true });
    git(root, "-c", "core.hooksPath=NUL", "commit", "--allow-empty", "-m", "fixture changed provider head");
    await assert.rejects(protocol.deliverControl(stale.inbox_id, { write: true }), { code: "PROCESS_CONTROL_CONTEXT_CHANGED" });
    assert.equal(protocol.inspect("second").cursor.status, "WAITING");
    pass(`${mode}: changed Git head blocks a captured event until explicit reconciliation`);

    // A valid shape/hash cannot substitute a host-authenticated historical control receipt.
    const inbox = createProcessControlInboxStore({ targetRoot: root, stateMode: mode }), canonical = inbox.read(capture.inbox_id);
    const forged = structuredClone(canonical.record); forged.source.payload_sha256 = "b".repeat(64); forged.delivery.payload_sha256 = "b".repeat(64);
    inbox.compareAndSwap(forged, canonical.content_sha256);
    assert.throws(() => open(root, privateRoot).inspect("resume"), { code: "PROCESS_JOURNAL_NOT_AUTHENTICATED" });
    inbox.compareAndSwap(canonical.record, inbox.read(capture.inbox_id).content_sha256);
    assert.equal(open(root, privateRoot).inspect("resume").record.instance_sha256, final.record.instance_sha256);
    pass(`${mode}: self-hashed canonical control tampering is rejected; retained historical read survives restoration`);

    if (mode === "db-only") {
      initialize(protocol, "ack_crash"); const ackInput = requestInput(protocol, "ack_crash"), ackRequest = protocol.prepareControl(ackInput);
      publish(privateRoot, "ack", claimFor(ackRequest, "ack-crash", "human"));
      const ack = await protocol.captureControl({ ...ackInput, sourceRef: "ack", write: true });
      const DatabaseSync = getDatabaseSync(), database = new DatabaseSync(resolveRuntimeSqliteFile({ targetRoot: root }));
      try { database.exec(`CREATE TRIGGER fixture_abort_ack BEFORE INSERT ON artifacts WHEN NEW.path = '${controlInboxPath(ack.inbox_id)}' AND json_extract(NEW.content, '$.phase') = 'delivered' BEGIN SELECT RAISE(ABORT, 'fixture acknowledgement failure'); END`); }
      finally { database.close(); }
      await assert.rejects(protocol.deliverControl(ack.inbox_id, { write: true }));
      const canonicalEvent = protocol.inspect("ack_crash"); assert.equal(canonicalEvent.record.events.filter(e => e.kind === "control").length, 1);
      assert.equal(protocol.readControl(ack.inbox_id).phase, "reserved");
      const repair = new DatabaseSync(resolveRuntimeSqliteFile({ targetRoot: root })); try { repair.exec("DROP TRIGGER fixture_abort_ack"); } finally { repair.close(); }
      fs.unlinkSync(path.join(privateRoot, "ack.json"));
      const reopened = open(root, privateRoot, true); const accepted = await reopened.deliverControl(ack.inbox_id, { write: true });
      assert.equal(accepted.retained, true); assert.equal(accepted.record.instance_sha256, canonicalEvent.record.instance_sha256);
      assert.equal(reopened.readControl(ack.inbox_id).phase, "delivered");
      pass("db-only: canonical delivery survives failed acknowledgement; reopen repairs acknowledgement without provider or repeated event");
    }
  }
  await safety();
  console.log(JSON.stringify({ status: "PASS", checks, proof: "offline-real-canonical-operations-and-authenticated-control-resume",
    source_authority: "fixture-capability", native: "NOT_RUN", live_provider: "NOT_RUN", mixed_native_resume: "NOT_YET_DELIVERED", full_standard_workflow: "NOT_YET_DELIVERED" }));
} finally {
  for (const root of owned) {
    const actual = fs.realpathSync(root);
    if (path.dirname(actual) !== temporary || !path.basename(actual).startsWith("aidn-standard-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
    fs.rmSync(actual, { recursive: true, force: true });
  }
}
