import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createProcessOperationJournalStore } from "../../src/adapters/runtime/process-operation-journal-store.mjs";
import { createNativeAllocationJournalStore } from "../../src/adapters/runtime/native-allocation-journal-store.mjs";
import { createAgenticProcessStore } from "../../src/adapters/runtime/agentic-process-store.mjs";
import { createOperationJournalSigner, operationOutputRef } from "../../src/core/workflow/process-operation-journal.mjs";
import { nativeJournalId } from "../../src/core/workflow/native-allocation-journal.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { assertProcessOwnerObservation, assertProcessReconciliationInventory } from "../../src/core/workflow/process-reconciliation-inventory.mjs";
import { createProcessDispatchRecordStore } from "../../src/adapters/runtime/process-dispatch-record-store.mjs";
import { observeLocalProcess } from "../../src/adapters/runtime/local-process-identity.mjs";
import { exactFileIdentity } from "../../src/lib/fs/exact-file-identity.mjs";
import { processModelIdentity } from "../../src/core/workflow/process-call-model.mjs";
import { createProcessControlInboxStore } from "../../src/adapters/runtime/process-control-inbox-store.mjs";
import { controlInboxId, controlReservationId } from "../../src/core/workflow/process-control-inbox.mjs";
import { externalMergeEventKey } from "../../src/core/workflow/standard-pr-external-merge.mjs";
import { createProcessDecisionInboxStore } from "../../src/adapters/runtime/process-decision-inbox-store.mjs";

// Fault-injected journal states below qualify discovery/authentication only.
// They are not real process-death, external closure or disposition evidence.
export async function verifyStandardReconciliationInventory(mode, pass, { processOwnerObservation = false } = {}) {
  const owned = [], root = createStandardWorkflowFixture(mode, owned), key = randomBytes(32);
  const signer = createOperationJournalSigner(() => key), H = "a".repeat(64), id = "inventory";
  const binding = standardWorkflowOperationBindings().find(row => row.id === "context_reload");
  const model = { contract_version: "agentic-process-model.v2", model_id: "inventory-fixture", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [], operation_pins: { context_reload: shadowHash(binding) }, entry: "reload",
    nodes: [{ id: "reload", kind: "operation", participant_ref: "project", binding_ref: "context_reload" }] };
  let authorizations = 0;
  const open = () => createStandardWorkflowOperationHost({ targetRoot: root, model, readSigningKey: () => key,
    authorize: async () => { authorizations++; throw Error("UNEXPECTED_AUTHORIZATION"); } });
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  const journals = createProcessOperationJournalStore({ targetRoot: root, stateMode: mode });
  const instances = createAgenticProcessStore({ targetRoot: root, stateMode: mode });
  let child = null, childClosed;
  try {
    const stat = { dev: 1n, ino: 9007199254740992n, size: 0n, nlink: 1n, mode: 33188n, mtimeNs: 1n, ctimeNs: 1n };
    const adjacent = { ...stat, ino: stat.ino + 1n };
    assert.equal(Number(stat.ino), Number(adjacent.ino));
    assert.notDeepEqual(exactFileIdentity(stat), exactFileIdentity(adjacent));
    assert.deepEqual(JSON.parse(JSON.stringify(exactFileIdentity(adjacent))), exactFileIdentity(adjacent));
    assert.throws(() => exactFileIdentity({ ...stat, ino: Number(stat.ino) }), { code: "EXACT_FILE_IDENTITY_REQUIRED" });
    pass(`${mode}: exact bigint identities distinguish adjacent inodes above 2**53 and survive JSON`);
    let host = open(), initial = host.initialize({ instanceId: id });
    host.initialize({ instanceId: id, write: true, expectedResultSha256: initial.record.instance_sha256 });
    const before = instances.read(id), preview = await host.preview({ instanceId: id, expectedSha256: before.record.instance_sha256, occurrenceId: "root" });
    const staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
    const stagedRecord = journals.read(staged.operation_id);
    // Reproduce the durable orphan shape by fault injection at the canonical
    // event boundary. Its retained signed preview/intent came from the real host.
    instances.compareAndSwap(before.record, instances.read(id).content_sha256);
    host = open();
    const inventory = host.prepareReconciliationInventory(id, { expectedSha256: before.record.instance_sha256 });
    signer.verify(inventory); assertProcessReconciliationInventory(inventory);
    assert.equal(inventory.operations.length, 1); assert.equal(inventory.operations[0].operation_id, staged.operation_id);
    assert.equal(inventory.operations[0].phase, "staged"); assert.equal(host.inspect(id).record.events.length, 0);
    assert.equal(inventory.complete_resource_closure, false); assert.equal(inventory.permits_effects, false);
    assert.equal(inventory.written, false); assert.equal(authorizations, 0);
    assert.equal(inventory.discovery.length, 7);
    assert.ok(inventory.discovery.every(row => row.status === "independent_observation_required"));
    assert.throws(() => host.prepareReconciliationInventory(id, { expectedSha256: H }), { code: "PROCESS_REVISION_CONFLICT" });
    const forged = structuredClone(inventory); forged.resources = [];
    assert.throws(() => signer.verify(forged), { code: "PROCESS_JOURNAL_NOT_AUTHENTICATED" });
    pass(`${mode}: signed canonical discovery includes a journal absent from all instance events; no effects/closure/authority`);

    // The same open host must see a real external Git change on its next call.
    // A compound synchronous observation cannot become a retained admission.
    execFileSync("git", ["-C", root, "-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
      "commit", "--allow-empty", "-m", "fixture context boundary"], { windowsHide: true, stdio: "pipe", timeout: 10000 });
    const changedContext = host.prepareReconciliationInventory(id, { expectedSha256: before.record.instance_sha256 });
    signer.verify(changedContext);
    assert.notEqual(changedContext.context_sha256, inventory.context_sha256);
    assert.equal(changedContext.authority_sha256, inventory.authority_sha256);
    assert.equal(changedContext.instance_sha256, inventory.instance_sha256);
    assert.equal(changedContext.permits_effects, false); assert.equal(authorizations, 0);
    pass(`${mode}: an already open host freshly observes changed Git context without renewing authority or writing an inventory`);

    const emptyInputs = { contract_version: "process-data-bindings.v4", parameter_keys: [], inputs: [{ node_id: "reload", fields: {} }] };
    const target = { ...model, model_id: "inventory-call-target", data_bindings: emptyInputs,
      call_interface: { parameters: {}, returns: {} } };
    const identity = processModelIdentity(target), nestedId = "nested-inventory";
    const nestedModel = { ...model, model_id: "inventory-with-call", operation_pins: {}, data_bindings: emptyInputs,
      nodes: [{ id: "reload", kind: "call", participant_ref: "project", target: identity }],
      call_targets: [{ ...identity, model: target }] };
    const openNested = () => createStandardWorkflowOperationHost({ targetRoot: root, model: nestedModel,
      readSigningKey: () => key, authorize: async () => { authorizations++; throw Error("UNEXPECTED_AUTHORIZATION"); } });
    const nestedHost = openNested(), nestedInitial = nestedHost.initialize({ instanceId: nestedId });
    nestedHost.initialize({ instanceId: nestedId, write: true, expectedResultSha256: nestedInitial.record.instance_sha256 });
    const entered = await nestedHost.enterCall({ instanceId: nestedId, expectedSha256: nestedInitial.record.instance_sha256,
      occurrenceId: "root", eventId: "enter_inventory_call", write: true });
    const nestedPreview = await nestedHost.preview({ instanceId: nestedId, expectedSha256: entered.record.instance_sha256,
      occurrenceId: entered.cursor.ready[0] });
    const nestedStaged = await nestedHost.stage(nestedPreview, { write: true, expectedPreviewSha256: shadowHash(nestedPreview) });
    const nestedBefore = instances.read(nestedId).record;
    const nestedInventory = openNested().prepareReconciliationInventory(nestedId, { expectedSha256: nestedBefore.instance_sha256 });
    signer.verify(nestedInventory);
    assert.equal(nestedInventory.operations.length, 1);
    assert.equal(nestedInventory.operations[0].operation_id, nestedStaged.operation_id);
    assert.equal(nestedInventory.operations[0].binding_sha256, target.operation_pins.context_reload);
    assert.equal(nestedInventory.operations[0].effect_status, "not_dispatched");
    assert.equal(nestedInventory.permits_effects, false);
    assert.equal(nestedInventory.written, false);
    assert.deepEqual(instances.read(nestedId).record, nestedBefore);
    assert.equal(authorizations, 0);
    pass(`${mode}: an embedded operation uses its target model pin even when its node ID matches the root call`);

    // The same immutable intent is discoverable both before a receipt and after
    // an UNKNOWN receipt. Preserve the original owner and every result identity.
    if (processOwnerObservation) {
      // The child owns no product resources. Its real OS identity is linked
      // to the retained fault-injected operation for this observation fixture.
      child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 90000)"], { windowsHide: true, stdio: "ignore" });
      childClosed = once(child, "close");
      await once(child, "spawn");
    }
    const owner = { generation: randomUUID(), pid: child?.pid ?? process.pid };
    let record = signer.seal({ ...stagedRecord.record, phase: "dispatching", revision: 2, owner });
    journals.compareAndSwap(record, journals.read(record.operation_id).content_sha256);
    let observed = open().prepareReconciliationInventory(id, { expectedSha256: before.record.instance_sha256 });
    assert.equal(observed.accounting.unknown_operations, 1); assert.deepEqual(observed.operations[0].owner, owner);
    assert.equal(observed.operations[0].effect_status, "unknown");
    const output = { contract_version: "standard-operation-output.v1", operation_ref: "context_reload", outcome: "reconciliation_required",
      effect_status: "unknown", facts: {}, observations: { reason_code: "FIXTURE_INTERRUPTED" }, evidence_refs: [] };
    const receipt = { contract_version: "process-operation-receipt.v1", receipt_id: "fixture_unknown", operation_id: record.operation_id,
      intent_sha256: shadowHash(record.intent), authority_id: record.intent.authority_id, outcome: output.outcome, effect_status: output.effect_status,
      output_sha256: shadowHash(output), facts: {}, evidence_refs: [{ ref: operationOutputRef(record.operation_id), sha256: shadowHash(output) }] };
    record = signer.seal({ ...record, phase: "receipted", revision: 3, results: [{ output, receipt }] });
    journals.compareAndSwap(record, journals.read(record.operation_id).content_sha256);
    observed = open().prepareReconciliationInventory(id, { expectedSha256: before.record.instance_sha256 });
    assert.equal(observed.accounting.unknown_operations, 1); assert.equal(observed.operations[0].results[0].receipt_sha256, shadowHash(receipt));
    assert.deepEqual(observed.operations[0].owner, owner);
    assert.equal(shadowHash(journals.read(record.operation_id).record), shadowHash(record));
    pass(`${mode}: dispatching/no-receipt and receipted/UNKNOWN retain exact owners/results and do not become completed`);

    if (processOwnerObservation) {
      const subject = { expectedSha256: before.record.instance_sha256, operationId: record.operation_id };
      const readOwner = () => open().prepareProcessOwnerObservation(id, subject);
      const check = result => {
        signer.verify(result.inventory);
        signer.verify(result.observation);
        assertProcessOwnerObservation(result.observation, result.inventory);
        assert.equal(result.observation.operation_record_sha256, shadowHash(record));
        assert.equal(result.observation.business_effect, "unknown");
        assert.equal(result.observation.process_tree_closure, "not_observed");
        assert.equal(result.observation.complete_resource_closure, false);
        assert.equal(result.observation.permits_effects, false);
        assert.equal(result.observation.written, false);
        return result.observation;
      };
      const unavailable = check(readOwner());
      assert.equal(unavailable.owner_status, "unresolved");
      assert.equal(unavailable.dispatch_sha256, null);
      assert.equal(unavailable.process_identity_sha256, null);
      pass(`${mode}: a retained PID without an authenticated dispatch identity stays unresolved`);

      const identity = observeLocalProcess(child.pid);
      assert.ok(identity);
      const dispatchStore = createProcessDispatchRecordStore({ targetRoot: root, stateMode: mode });
      const dispatch = signer.seal({ contract_version: "process-dispatch-record.v1", operation_id: record.operation_id,
        revision: 1, phase: "running", instance_id: id, scope_id: before.record.scope_id, model_sha256: before.record.model_sha256,
        intent_sha256: shadowHash(record.intent), preview_sha256: shadowHash(record.preview), authority_sha256: observed.authority_sha256,
        runtime_sha256: shadowHash(artifacts.describe()), physical_root_sha256: shadowHash(artifacts.root),
        operation_owner_sha256: shadowHash(owner), process_identity: identity, context_before_sha256: observed.context_sha256,
        context_after_sha256: null, leases: [], output: null, output_sha256: null });
      dispatchStore.compareAndSwap(dispatch, null);
      const unchanged = artifacts.observeInventory();
      const active = readOwner(), activeObservation = check(active);
      assert.equal(activeObservation.owner_status, "original_process_active");
      assert.equal(activeObservation.process_identity_sha256, shadowHash(identity));
      assert.equal(activeObservation.dispatch_sha256, shadowHash(dispatch));
      assert.throws(() => assertProcessOwnerObservation({ ...activeObservation, inventory_sha256: H }, active.inventory),
        { code: "PROCESS_OWNER_OBSERVATION_SUBJECT_CHANGED" });
      assert.throws(() => assertProcessOwnerObservation({ ...activeObservation, complete_resource_closure: true }, active.inventory),
        { code: "PROCESS_OWNER_OBSERVATION_INVALID" });
      assert.deepEqual(artifacts.observeInventory(), unchanged);
      pass(`${mode}: two real OS observations bind the live original process to the signed inventory`);

      assert.ok(child.kill());
      await childClosed;
      const absent = check(readOwner());
      assert.equal(absent.owner_status, "original_process_absent");
      assert.equal(absent.dispatch_sha256, activeObservation.dispatch_sha256);
      assert.equal(absent.process_identity_sha256, activeObservation.process_identity_sha256);
      assert.deepEqual(artifacts.observeInventory(), unchanged);
      assert.deepEqual(journals.read(record.operation_id).record, record);
      assert.equal(authorizations, 0);
      pass(`${mode}: after real direct-child exit the same original identity is absent and the effect stays unknown`);
    }

    const controlId = "control-inventory", sourceRef = "fixture_review";
    const controlModel = { ...model, model_id: "inventory-control-fixture", entry: "wait",
      nodes: [{ id: "wait", kind: "event", participant_ref: "project", branches: [
        { flow_id: "review", node_id: "reload", event_key: "review_snapshot" },
        { flow_id: "external", node_id: "merge", event_key: externalMergeEventKey }] },
      ...model.nodes, { ...model.nodes[0], id: "merge" }] };
    let sourceCalls = 0;
    const claimFor = request => ({ contract_version: "process-control-source.v1", source_kind: "external",
      authority_id: "fixture_provider", source_event_id: "fixture_review_event", request_sha256: shadowHash(request),
      subject_sha256: H, event_key: "review_snapshot", payload_sha256: H, evidence_refs: [{ ref: "fixture:provider/event", sha256: H }] });
    const openControl = () => createStandardWorkflowOperationHost({ targetRoot: root, model: controlModel,
      readSigningKey: () => key, authorize: () => { authorizations++; throw Error("UNEXPECTED_AUTHORIZATION"); },
      controlSource: {
        read: ({ request }) => { sourceCalls++; return claimFor(request); },
        verify: ({ source }) => { sourceCalls++; return { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) }; },
      } });
    const control = openControl(), controlInitial = control.initialize({ instanceId: controlId });
    control.initialize({ instanceId: controlId, write: true, expectedResultSha256: controlInitial.record.instance_sha256 });
    const input = { instanceId: controlId, expectedSha256: controlInitial.record.instance_sha256, occurrenceId: "root" };
    const request = control.prepareControl(input), claim = claimFor(request), captureId = controlInboxId(claim);
    const reservationId = controlReservationId(request), reservationRef = "control-reservation:" + reservationId;
    const inbox = createProcessControlInboxStore({ targetRoot: root, stateMode: mode });
    const reservation = signer.seal({ contract_version: "process-control-reservation.v1", inbox_id: reservationId,
      request, source_ref: sourceRef, capture_id: captureId, selection_sha256: shadowHash(claim) });
    // The reservation can be durable before the capture is stored.
    inbox.compareAndSwap(reservation, null);
    const controlInventory = instanceSha256 => {
      const canonical = artifacts.observeInventory(), calls = sourceCalls;
      try {
        const result = openControl().prepareReconciliationInventory(controlId, { expectedSha256: instanceSha256 });
        assertProcessReconciliationInventory(signer.verify(result));
        return result;
      } finally {
        assert.deepEqual(artifacts.observeInventory(), canonical);
        assert.equal(sourceCalls, calls);
        assert.equal(authorizations, 0);
      }
    };
    const priorCapture = controlInventory(controlInitial.record.instance_sha256);
    assert.equal(priorCapture.resources.find(row => row.ref === reservationRef).sha256, shadowHash(reservation));
    assert.ok(!priorCapture.resources.some(row => row.ref === "control:" + captureId));
    const captured = await control.captureControl({ ...input, sourceRef, write: true });
    assert.equal(captured.inbox_id, captureId);
    const reservedCapture = inbox.read(captureId).record;
    const acceptedControl = await control.deliverControl(captureId, { write: true });
    const controlSha = acceptedControl.record.instance_sha256;
    // Fault injection after canonical event acceptance and before acknowledgement.
    inbox.compareAndSwap(reservedCapture, inbox.read(captureId).content_sha256);
    const acceptedBeforeAck = controlInventory(controlSha);
    assert.equal(acceptedBeforeAck.resources.find(row => row.ref === "control:" + captureId).details.phase, "reserved");
    const repairedAck = await openControl().deliverControl(captureId, { write: true });
    assert.equal(repairedAck.retained, true);
    assert.equal(repairedAck.record.instance_sha256, controlSha);
    const afterAck = controlInventory(controlSha);
    assert.equal(afterAck.resources.find(row => row.ref === "control:" + captureId).details.phase, "delivered");
    pass(mode + ": the signed control reservation and capture remain distinct across acceptance and acknowledgement");

    const substitutedReservation = signer.seal({ ...reservation, selection_sha256: "b".repeat(64) });
    inbox.compareAndSwap(substitutedReservation, inbox.read(reservationId).content_sha256);
    assert.throws(() => controlInventory(controlSha), { code: "PROCESS_RECONCILIATION_HISTORY_UNAVAILABLE" });
    pass(mode + ": a validly signed reservation for another selection cannot authenticate the accepted control");

    {
      const humanId = "human-inventory", humanBinding = standardWorkflowOperationBindings().find(row => row.id === "mode_decision");
      const humanModel = { ...model, model_id: "inventory-human-fixture", operation_pins: { mode_decision: shadowHash(humanBinding) },
        nodes: [{ ...model.nodes[0], binding_ref: "mode_decision" }] };
      let reads = 0;
      const humanSource = {
        read({ question }) { reads++; return { contract_version: "human-mode-decision.v1", source_kind: "human",
          authority_id: "fixture_human", source_event_id: "fixture_mode_event", subject_sha256: H, question_sha256: shadowHash(question),
          choice: "THINKING", evidence_refs: [{ ref: "fixture:operator/mode", sha256: H }] }; },
        verify({ source }) { reads++; return { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) }; },
      };
      const openHuman = () => createStandardWorkflowOperationHost({ targetRoot: root, model: humanModel, humanSource,
        readSigningKey: () => key, authorize: async () => { authorizations++; throw Error("UNEXPECTED_AUTHORIZATION"); } });
      const human = openHuman(), humanInitial = human.initialize({ instanceId: humanId });
      human.initialize({ instanceId: humanId, write: true, expectedResultSha256: humanInitial.record.instance_sha256 });
      const humanPreview = await human.preview({ instanceId: humanId, expectedSha256: humanInitial.record.instance_sha256,
        occurrenceId: "root", input: { session_id: "S001" } });
      const humanStage = await human.stage(humanPreview, { write: true, expectedPreviewSha256: shadowHash(humanPreview) });
      assert.equal((await human.dispatch(humanStage.operation_id, { write: true })).status, "waiting_for_human");
      const stagedHumanRecord = journals.read(humanStage.operation_id).record, stagedHumanInstance = human.inspect(humanId).record;
      const selected = await human.receiveDecision(humanStage.operation_id, { write: true, sourceRef: "mode" });
      const humanAccepted = await human.accept(humanStage.operation_id, { write: true });
      const receipt = selected.receipt, output = human.readOutput(receipt.evidence_refs[0].ref);
      const capture = output.observations.inbox_id, decisions = createProcessDecisionInboxStore({ targetRoot: root, stateMode: mode });
      const retainedDecision = decisions.read(capture).record;
      const readHuman = (expectedSha256 = humanAccepted.record.instance_sha256) => {
        const beforeRead = artifacts.observeInventory(), beforeCalls = reads;
        try { return openHuman().prepareReconciliationInventory(humanId, { expectedSha256 }); }
        finally {
          assert.deepEqual(artifacts.observeInventory(), beforeRead);
          assert.equal(reads, beforeCalls);
          assert.equal(authorizations, 0);
        }
      };
      const inventoryDecision = readHuman();
      assert.equal(inventoryDecision.resources.find(row => row.ref === "decision:" + capture).sha256, shadowHash(retainedDecision));
      assert.equal(retainedDecision.receipt_sha256, shadowHash(receipt));
      const reservedDecision = signer.seal({ ...retainedDecision, phase: "reserved", receipt_sha256: null });
      decisions.compareAndSwap(reservedDecision, decisions.read(capture).content_sha256);
      assert.equal(readHuman().resources.find(row => row.ref === "decision:" + capture).details.phase, "reserved");
      pass(mode + ": human decision inventory preserves a signed capture before and after acknowledgement");

      const differentChoice = signer.seal({ ...retainedDecision, source: { ...retainedDecision.source, choice: "EXPLORING" } });
      decisions.compareAndSwap(differentChoice, decisions.read(capture).content_sha256);
      assert.throws(readHuman, { code: "PROCESS_HUMAN_CAPTURE_CHANGED" });
      const differentReceipt = signer.seal({ ...retainedDecision, receipt_sha256: "b".repeat(64) });
      decisions.compareAndSwap(differentReceipt, decisions.read(capture).content_sha256);
      assert.throws(readHuman, { code: "PROCESS_HUMAN_CAPTURE_CHANGED" });
      decisions.compareAndSwap(retainedDecision, decisions.read(capture).content_sha256);
      assert.equal(readHuman().resources.find(row => row.ref === "decision:" + capture).sha256, shadowHash(retainedDecision));
      pass(mode + ": an accepted human decision refuses separately signed substituted choice or acknowledgement");

      // Recreate the durable window after the capture write and before the
      // operation receipt. All writes here are fixture-only fault injection.
      instances.compareAndSwap(stagedHumanInstance, instances.read(humanId).content_sha256);
      journals.compareAndSwap(stagedHumanRecord, journals.read(humanStage.operation_id).content_sha256);
      decisions.compareAndSwap(reservedDecision, decisions.read(capture).content_sha256);
      const pending = () => readHuman(stagedHumanInstance.instance_sha256);
      assert.equal(pending().resources.find(row => row.ref === "decision:" + capture).sha256, shadowHash(reservedDecision));
      const anotherQuestion = signer.seal({ ...reservedDecision, source: { ...reservedDecision.source, question_sha256: "b".repeat(64) } });
      decisions.compareAndSwap(anotherQuestion, decisions.read(capture).content_sha256);
      assert.throws(pending, { code: "PROCESS_RECONCILIATION_RESOURCE_CHANGED" });
      decisions.compareAndSwap(retainedDecision, decisions.read(capture).content_sha256);
      assert.throws(pending, { code: "PROCESS_RECONCILIATION_HISTORY_UNAVAILABLE" });
      decisions.compareAndSwap(reservedDecision, decisions.read(capture).content_sha256);
      assert.equal(pending().resources.find(row => row.ref === "decision:" + capture).details.phase, "reserved");
      pass(mode + ": a reserved human capture needs the retained question and an acknowledgement needs the retained receipt");
    }

    const native = { contract_version: "native-allocation-journal.v1", journal_id: nativeJournalId(before.record), instance_id: id,
      scope_id: before.record.scope_id, model_sha256: before.record.model_sha256, revision: 1, allocations: [{
        generation: 1, owner_id: "fixture_native_owner", configuration_sha256: H, authorization_sha256: H,
        initial_instance_sha256: before.record.instance_sha256,
        limits: { configuration_sha256: H, authorized_at_ms: 0, global_deadline_ms: 10000, workflow_deadline_ms: 9000,
          max_turn_ms: 1000, max_responses: 2, max_bytes: 1048576 }, phase: "reserved", owned_result_sha256: null,
        tree_proof_sha256: null, tree_closed: false, owned_status: null, first_failure: null, checkpoint: null, consumption: null, closure_ref: null }] };
    const nativeStore = createNativeAllocationJournalStore({ targetRoot: root, stateMode: mode });
    nativeStore.compareAndSwap(signer.seal(native), null);
    const evidenceDirectory = path.join(root, ".aidn/runtime/standard-workflow"); fs.mkdirSync(evidenceDirectory, { recursive: true });
    const lock = { contract_version: "process-local-effect-owner.v1", token: randomUUID(), pid: process.pid,
      scope_sha256: shadowHash({ physical_root: root }), plan_sha256: H, created_at: new Date().toISOString() };
    const lockFile = path.join(evidenceDirectory, "effects.lock"); fs.writeFileSync(lockFile, JSON.stringify(lock));
    fs.writeFileSync(path.join(evidenceDirectory, "unreferenced-proof.json"), "{}");
    const stateBefore = artifacts.observeInventory(), ownerBefore = fs.readFileSync(lockFile);
    observed = open().prepareReconciliationInventory(id, { expectedSha256: before.record.instance_sha256 });
    assert.equal(observed.accounting.native_known, false); assert.equal(observed.accounting.unresolved_native_allocations, 1);
    assert.equal(observed.resources.find(row => row.kind === "native_allocation").details.owner_id, "fixture_native_owner");
    assert.equal(observed.resources.find(row => row.kind === "local_effect_owner").details.owner.token, lock.token);
    assert.deepEqual(observed.resources.find(row => row.kind === "local_effect_owner").details.physical_identity,
      exactFileIdentity(fs.lstatSync(lockFile, { bigint: true })));
    assert.ok(observed.resources.some(row => row.ref === "local:unreferenced-proof.json"));
    assert.deepEqual(fs.readFileSync(lockFile), ownerBefore); assert.deepEqual(artifacts.observeInventory(), stateBefore);
    assert.equal(authorizations, 0);
    pass(`${mode}: native unknown accounting, retained owner and unreferenced evidence stay unresolved without writes`);

    if (mode === "db-only") {
      const projection = path.join(root, "docs/audit/workflows/operation-records", record.operation_id + ".json");
      fs.mkdirSync(path.dirname(projection), { recursive: true }); fs.writeFileSync(projection, "forged projection");
      observed = open().prepareReconciliationInventory(id, { expectedSha256: before.record.instance_sha256 });
      assert.equal(observed.operations[0].record_sha256, shadowHash(record));
      assert.equal(fs.readFileSync(projection, "utf8"), "forged projection");
      pass("db-only: forged visible journal projection is neither read nor adopted");
    }
    const invalid = signer.seal({ ...record, grant: { forged: true } });
    journals.compareAndSwap(invalid, journals.read(record.operation_id).content_sha256);
    assert.throws(() => open().prepareReconciliationInventory(id, { expectedSha256: before.record.instance_sha256 }),
      { code: "PROCESS_RECONCILIATION_RESOURCE_CHANGED" });
    pass(`${mode}: an orphan with a substituted grant fails binding authentication before any disposition`);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    if (childClosed) await childClosed;
    for (const directory of owned.reverse()) {
      const physical = fs.realpathSync(directory), temporary = fs.realpathSync(os.tmpdir());
      if (path.dirname(physical) !== temporary || !path.basename(physical).startsWith("aidn-standard-ports-")) throw Error("INVENTORY_FIXTURE_CLEANUP_OUT_OF_SCOPE");
      fs.rmSync(physical, { recursive: true, force: true });
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (!["files", "dual", "db-only"].includes(mode)) throw Error("INVENTORY_FIXTURE_MODE_REQUIRED");
  let checks = 0;
  await verifyStandardReconciliationInventory(mode, name => { checks++; console.log("PASS " + name); },
    { processOwnerObservation: process.argv.includes("--process-owner-observation") });
  console.log(JSON.stringify({ status: "PASS", checks, mode, resource_disposition: "NOT_IMPLEMENTED", whole_goal_complete: false }));
}
