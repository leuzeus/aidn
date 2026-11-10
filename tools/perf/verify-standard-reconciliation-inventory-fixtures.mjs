import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
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
import { assertProcessReconciliationInventory } from "../../src/core/workflow/process-reconciliation-inventory.mjs";
import { exactFileIdentity } from "../../src/lib/fs/exact-file-identity.mjs";
import { processModelIdentity } from "../../src/core/workflow/process-call-model.mjs";

// Fault-injected journal states below qualify discovery/authentication only.
// They are not real process-death, external closure or disposition evidence.
export async function verifyStandardReconciliationInventory(mode, pass) {
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
    const owner = { generation: randomUUID(), pid: process.pid };
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
  await verifyStandardReconciliationInventory(mode, name => { checks++; console.log("PASS " + name); });
  console.log(JSON.stringify({ status: "PASS", checks, mode, resource_disposition: "NOT_IMPLEMENTED", whole_goal_complete: false }));
}
