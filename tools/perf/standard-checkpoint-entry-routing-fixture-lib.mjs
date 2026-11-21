import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStandardWorkflowAction } from '../../src/application/runtime/standard-workflow-entry.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

// Entry orchestration only: the constructor ports below are identified doubles.
// They prove no journal authentication, OS death, Git witness or public CLI run.
// Authored request/action JSON cannot select these production composition ports.
const checkpoint = 'session_pr_correction_checkpoint';
const failure = code => Object.assign(Error(code), { code });
function fixture({ binding = checkpoint, phase = 'dispatching', acceptedUnknown = false,
  completedReceipt = false, ownerStatus = 'original_process_absent' } = {}) {
  const id = 'op_' + '1'.repeat(40), counters = { dispatch: 0, reconcile: 0, append: 0, accept: 0, grants: 0 };
  const receipt = { operation_id: id, outcome: 'completed', effect_status: 'confirmed' };
  const unknown = { ...receipt, outcome: 'reconciliation_required', effect_status: 'unknown' };
  let record = { operation_id: id, phase, revision: 2, intent: { binding_ref: binding },
    preview: { binding: { id: binding, effect_class: 'mutating' }, input: {}, prepared: {} },
    results: phase === 'receipted' ? [{ receipt: unknown }, ...(completedReceipt ? [{ receipt }] : [])] : [] };
  let instance = { instance_sha256: 'a'.repeat(64), scope_id: 'fixture-entry-routing', initial_parameters: {} };
  let accepted = false, authorizeCurrent, grantDenied = false, witnessUnavailable = false;
  const ownerObservations = [];
  const cursor = () => ({ status: 'WAITING', occurrences: [{ status: 'WAITING', occurrence_id: 'checkpoint',
    operation: { intent: { operation_id: id, binding_ref: binding }, ...(acceptedUnknown ? { receipt: unknown } : {}) } }] });
  const state = () => ({ record: structuredClone(instance), cursor: cursor() });
  const readOperation = () => structuredClone(record);
  const grant = async () => {
    await authorizeCurrent({ preview_sha256: H(record.preview), binding: record.preview.binding });
  };
  const append = () => { counters.append++; record = { ...record, phase: 'receipted', revision: record.revision + 1,
    results: [...record.results, { receipt }] }; return { status: 'receipted', receipt }; };
  const authority = { keyId: () => 'fixture-retained-key', trustSha: () => 'b'.repeat(64),
    authorizeOperation(input, permit) {
      counters.grants++; assert.equal(permit, H(record.preview), 'CURRENT_EXACT_OPERATION_CONSENT_REQUIRED');
      assert.equal(input.preview_sha256, permit);
      if (grantDenied) throw failure('FIXTURE_CURRENT_GRANT_REQUIRED');
      return { authorized: true };
    } };
  const host = { inspect: state, previewNative: () => ({ native_started: false }), readOperation,
    prepareProcessOwnerObservation({ expectedSha256, operationId }) {
      assert.equal(expectedSha256, instance.instance_sha256); assert.equal(operationId, id);
      ownerObservations.push(ownerStatus); return { observation: { owner_status: ownerStatus } };
    },
    async step() { return accepted ? { kind: 'observe', status: 'WAITING' }
      : acceptedUnknown ? { kind: 'reconciliation', status: 'WAITING' }
        : { kind: 'operation_wait', status: 'WAITING', operation_id: id }; },
    async dispatchOperation(_id, { write }) {
      assert.equal(_id, id); assert.equal(write, true); counters.dispatch++;
      if (record.phase === 'staged') { await grant(); return append(); }
      if (record.phase === 'receipted' && record.results.at(-1).receipt.outcome === 'completed') return { status: 'retained_result', receipt };
      return { status: 'reconciliation_required' };
    },
    async reconcileCorrectionCheckpoint(_id, { write, signal }) {
      assert.equal(_id, id); assert.equal(write, true); assert(!signal?.aborted); counters.reconcile++;
      await grant();
      if (witnessUnavailable) throw failure('STANDARD_PR_CORRECTION_CHECKPOINT_UNCONFIRMED');
      return append();
    },
    async acceptOperation(_id, { write }) {
      assert.equal(_id, id); assert.equal(write, true); await grant(); counters.accept++; accepted = true;
      instance = { ...instance, instance_sha256: H({ before: instance.instance_sha256, receipt }) }; return state();
    } };
  const ports = { authority, compose(authorize) { authorizeCurrent = authorize; return host; } };
  const input = { request: { fixture: 'constructor-fixed-routing' }, configuration: { instance_id: 'routing' }, parameters: {}, modelSource: {} };
  const preview = () => runStandardWorkflowAction(input, ports);
  const apply = (prepared, options = {}) => runStandardWorkflowAction({ ...input, preparedAction: prepared.preview,
    execute: true, expectPlan: H(prepared.preview), ...options }, ports);
  return { preview, apply, counters, readOperation, state, ownerObservations, setOwnerStatus(status) { ownerStatus = status; }, denyGrant() { grantDenied = true; },
    refuseWitness() { witnessUnavailable = true; } };
}

export async function verifyStandardCheckpointEntryRouting() {
  let checks = 0;
  const test = async (name, run) => { await run(); checks++; console.log('PASS entry routing: ' + name); };
  await test('missing checkpoint receipt uses observation, current consent and ordinary acceptance', async () => {
    const f = fixture(), before = f.readOperation(), preview = await f.preview();
    assert.equal(preview.preview.kind, 'dispatch'); assert.equal(preview.written, false);
    assert.deepEqual(f.readOperation(), before); assert.equal(f.counters.grants, 0);
    const applied = await f.apply(preview);
    assert.equal(applied.result.operation_outcome, 'completed', JSON.stringify({ reason: 'CHECKPOINT_RECOVERY_ENTRY_REQUIRED', counters: f.counters }));
    assert.equal(applied.result.effect_status, 'confirmed'); assert.equal(applied.written, true);
    assert.equal(applied.result.workflow_completed, false); assert.equal(applied.result.native_started, false);
    assert.deepEqual(f.counters, { dispatch: 0, reconcile: 1, append: 1, accept: 1, grants: 2 });
    assert.equal(f.ownerObservations.length, 2, 'OWNER_ABSENCE_MUST_BE_REOBSERVED_AT_APPLICATION');
    assert.deepEqual(f.readOperation().results.slice(0, before.results.length), before.results);
    await assert.rejects(f.apply(preview), { code: 'STANDARD_ENTRY_PRECONDITIONS_CHANGED' });
    assert.equal(f.counters.append, 1); assert.equal(f.counters.accept, 1);
  });
  await test('an accepted UNKNOWN checkpoint selects the same exact recovery action', async () => {
    const f = fixture({ phase: 'receipted', acceptedUnknown: true }), before = f.readOperation(), preview = await f.preview();
    assert.equal(preview.preview.kind, 'dispatch'); assert.equal(preview.written, false);
    const applied = await f.apply(preview); assert.equal(applied.result.operation_outcome, 'completed');
    assert.equal(f.counters.dispatch, 0); assert.equal(f.counters.reconcile, 1);
    assert.deepEqual(f.readOperation().results[0], before.results[0]); assert.equal(f.readOperation().results.length, 2);
  });
  await test('a staged checkpoint retains its first normal dispatch', async () => {
    const f = fixture({ phase: 'staged' }), applied = await f.apply(await f.preview());
    assert.equal(applied.result.operation_outcome, 'completed');
    assert.equal(f.counters.dispatch, 1); assert.equal(f.counters.reconcile, 0); assert.equal(f.counters.accept, 1);
  });
  await test('a retained confirmation after UNKNOWN needs only ordinary acceptance', async () => {
    const f = fixture({ phase: 'receipted', acceptedUnknown: true, completedReceipt: true }), before = f.readOperation();
    const preview = await f.preview(); assert.equal(preview.preview.kind, 'dispatch');
    const applied = await f.apply(preview); assert.equal(applied.result.operation_outcome, 'completed');
    assert.deepEqual(f.counters, { dispatch: 1, reconcile: 0, append: 0, accept: 1, grants: 1 });
    assert.deepEqual(f.readOperation(), before); assert.equal(f.ownerObservations.length, 0);
  });
  await test('active or unresolved producers remain read-only waits', async () => {
    for (const ownerStatus of ['original_process_active', 'unresolved']) {
      const f = fixture({ ownerStatus }), before = f.readOperation(), preview = await f.preview();
      assert.equal(preview.preview.kind, 'observe'); assert.equal(preview.can_apply, false); assert.equal(preview.written, false);
      assert.equal(preview.preview.payload.reason, ownerStatus === 'original_process_active'
        ? 'checkpoint_original_process_active' : 'checkpoint_original_process_unresolved');
      assert.deepEqual(f.readOperation(), before); assert.equal(f.ownerObservations.length, 1);
      assert.deepEqual(f.counters, { dispatch: 0, reconcile: 0, append: 0, accept: 0, grants: 0 });
    }
  });
  await test('unavailable owner evidence after preview revokes the prepared recovery action', async () => {
    const f = fixture(), preview = await f.preview(); f.setOwnerStatus('unresolved');
    await assert.rejects(f.apply(preview), { code: 'STANDARD_ENTRY_ACTION_CHANGED' });
    assert.equal(f.ownerObservations.length, 2);
    assert.deepEqual(f.counters, { dispatch: 0, reconcile: 0, append: 0, accept: 0, grants: 0 });
  });
  await test('another interrupted operation keeps the existing dispatch behavior', async () => {
    const f = fixture({ binding: 'session_pr_update_push' }), before = f.readOperation(), applied = await f.apply(await f.preview());
    assert.equal(applied.written, false); assert.equal(f.counters.dispatch, 1); assert.equal(f.counters.reconcile, 0);
    assert.deepEqual(f.readOperation(), before); assert.equal(f.counters.accept, 0);
  });
  await test('another accepted UNKNOWN operation gains no checkpoint route', async () => {
    const f = fixture({ binding: 'session_pr_update_push', phase: 'receipted', acceptedUnknown: true }), preview = await f.preview();
    assert.equal(preview.preview.kind, 'observe'); assert.equal(preview.can_apply, false);
    assert.deepEqual(f.counters, { dispatch: 0, reconcile: 0, append: 0, accept: 0, grants: 0 });
  });
  await test('current grant refusal cannot fall back to business dispatch', async () => {
    const f = fixture(), before = f.readOperation(), preview = await f.preview(); f.denyGrant();
    await assert.rejects(f.apply(preview), { code: 'FIXTURE_CURRENT_GRANT_REQUIRED' });
    assert.deepEqual(f.readOperation(), before); assert.equal(f.counters.dispatch, 0);
    assert.equal(f.counters.append, 0); assert.equal(f.counters.accept, 0);
  });
  await test('an unconfirmed witness preserves the original journal and never dispatches again', async () => {
    const f = fixture(), before = f.readOperation(), preview = await f.preview(); f.refuseWitness();
    await assert.rejects(f.apply(preview), { code: 'STANDARD_PR_CORRECTION_CHECKPOINT_UNCONFIRMED' });
    assert.deepEqual(f.readOperation(), before); assert.equal(f.counters.dispatch, 0);
    assert.equal(f.counters.append, 0); assert.equal(f.counters.accept, 0);
  });
  await test('pre-cancelled execution invokes no writer or observer', async () => {
    const f = fixture(), preview = await f.preview(), controller = new AbortController(); controller.abort();
    const before = f.ownerObservations.length;
    await assert.rejects(f.apply(preview, { signal: controller.signal }), { code: 'STANDARD_ENTRY_ABORTED' });
    assert.equal(f.ownerObservations.length, before);
    assert.deepEqual(f.counters, { dispatch: 0, reconcile: 0, append: 0, accept: 0, grants: 0 });
  });
  await test('a foreign journal digest cannot acquire an operation permit', async () => {
    const f = fixture(), preview = await f.preview(); preview.preview.payload.journal_sha256 = 'f'.repeat(64);
    await assert.rejects(f.apply(preview), { code: 'STANDARD_ENTRY_ACTION_CHANGED' });
    assert.deepEqual(f.counters, { dispatch: 0, reconcile: 0, append: 0, accept: 0, grants: 0 });
  });
  return { status: 'PASS_ENTRY_ROUTING_WITH_CONSTRUCTOR_PORT_DOUBLES_ONLY', checks,
    actual_Git_witness: 'NOT_RUN', actual_public_CLI: 'NOT_RUN', genuine_Native: 'NOT_RUN', full_standard: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await verifyStandardCheckpointEntryRouting()));
