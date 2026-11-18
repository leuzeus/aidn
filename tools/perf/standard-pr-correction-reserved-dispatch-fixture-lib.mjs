import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStandardOperationDisposition } from '../../src/application/runtime/standard-operation-disposition.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createProcessOperationJournalStore } from '../../src/adapters/runtime/process-operation-journal-store.mjs';
import { createProcessDispatchRecordStore } from '../../src/adapters/runtime/process-dispatch-record-store.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { observeLocalProcessOwner } from '../../src/adapters/runtime/local-process-identity.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

const here = fileURLToPath(import.meta.url);
// Source/operator authority is doubled. Reservation ordering, stores, kernel
// identities and Git observations use the production implementations.
const signer = createOperationJournalSigner(() => Buffer.alloc(32, 73));
function open(config, state = {}, onBoundary = async () => {}) {
  const journal = createProcessOperationJournalStore({ targetRoot: config.root, stateMode: config.mode });
  return { journal, dispatches: createProcessDispatchRecordStore({ targetRoot: config.root, stateMode: config.mode }),
    observer: createStandardOperationDisposition({ targetRoot: config.root, stateMode: config.mode, signer,
      artifacts: createStandardWorkflowArtifacts({ targetRoot: config.root }), readOperation: id => journal.read(id),
      readAuthority: () => ({ fixture_authority: 'reserved-checkpoint' }),
      readContext: () => ({ fixture_context: state.contextChanged ? 'changed' : 'original' }), onBoundary }) };
}

if (process.argv[2] === '--worker') {
  const config = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const deadline = Number(process.argv[4]);
  assert(Number.isSafeInteger(deadline) && deadline > Date.now(), 'RESERVED_FIXTURE_ORIGINAL_BOUND_EXPIRED');
  // A pending promise does not keep Node alive. Retain the producer with the
  // parent's original absolute worker deadline, never a newly started bound.
  const timer = setTimeout(() => process.exit(124), deadline - Date.now());
  const holder = open(config, {}, async (point, id) => {
    if (point !== config.boundary) return;
    const capsule = holder.dispatches.read(id).record;
    process.send({ point, identity: capsule.process_identity });
    await new Promise(() => {});
  });
  const before = holder.journal.read(config.operation_id), { authentication, key_id, ...body } = before.record;
  const record = signer.seal({ ...body, revision: before.record.revision + 1, owner: { ...body.owner, pid: process.pid } });
  holder.journal.compareAndSwap(record, before.content_sha256);
  try { await holder.observer.run(record, async () => {
    fs.writeFileSync(config.called, 'called\n', { flag: 'wx' });
    return { contract_version: 'standard-pr-correction-checkpoint-output.v1', operation_ref: 'session_pr_correction_checkpoint',
      outcome: 'blocked', effect_status: 'no_effect', observations: { fixture_callback_called: true }, facts: {}, evidence_refs: [] };
  }); } finally { clearTimeout(timer); }
  throw Error('RESERVED_FIXTURE_UNEXPECTED_COMPLETION');
}

export async function verifyPrCorrectionReservedDispatch(f, prepared, owned, { boundary = 'dispatch_reserved' } = {}) {
  const control = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-correction-checkpoint-'));
  owned.push(control);
  const config = { root: f.root, mode: f.selectedMode, operation_id: prepared.plan.operation_id,
    boundary, called: path.join(control, 'callback-called') };
  const configFile = path.join(control, 'source.json');
  fs.writeFileSync(configFile, JSON.stringify(config) + '\n', { flag: 'wx' });
  const started = Date.now(), boundMs = 120000, deadline = started + boundMs;
  const child = fork(here, ['--worker', configFile, String(deadline)], { windowsHide: true, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stdout = '', stderr = '', identity, exit;
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => {
    if (stream === 'stdout') stdout += bytes; else stderr += bytes;
    if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 16384) child.kill();
  });
  const closed = new Promise(resolve => child.once('close', (code, signal) => { exit = { code, signal }; resolve(exit); }));
  const timer = setTimeout(() => child.kill(), Math.max(0, deadline - Date.now()));
  try {
    identity = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('message', value => value.point === boundary ? resolve(value.identity) : reject(Error('RESERVED_FIXTURE_MESSAGE_INVALID')));
      child.once('close', () => reject(Error('RESERVED_FIXTURE_CLOSED_BEFORE_BOUNDARY:' + stderr)));
    });
    assert.equal(observeLocalProcessOwner(identity), 'active');
    const state = {}, reader = open(config, state), original = reader.journal.read(config.operation_id).record;
    const capsule = reader.dispatches.read(config.operation_id).record, capsuleHash = shadowHash(capsule);
    assert.equal(capsule.phase, boundary === 'dispatch_reserved' ? 'reserved' : 'running');
    assert.equal(capsule.output, null); assert.equal(capsule.leases.length, 0);
    assert.equal(fs.existsSync(config.called), boundary !== 'dispatch_reserved');
    if (boundary === 'dispatch_reserved')
      assert.throws(() => reader.observer.observeReservedDispatch(original), { code: 'PROCESS_RESERVED_DISPATCH_UNCONFIRMED' });
    child.kill(); await closed;
    assert(Date.now() < deadline, 'RESERVED_FIXTURE_ORIGINAL_BOUND_EXPIRED');
    assert.equal(observeLocalProcessOwner(identity), 'terminated');
    f.state.reservationReader = record => reader.observer.observeReservedDispatch(record);
    if (boundary !== 'dispatch_reserved') {
      assert.equal(reader.observer.observeReservedDispatch(original), null);
      await assert.rejects(f.checkpoint.reconcile(f.instance, config.operation_id, { assertAuthorized() {} }),
        { code: 'STANDARD_PR_CORRECTION_CHECKPOINT_UNCONFIRMED' });
    } else {
      const reservation = reader.observer.observeReservedDispatch(original);
      assert.equal(reservation.dispatch_sha256, capsuleHash);
      const output = await f.checkpoint.reconcile(f.instance, config.operation_id, { assertAuthorized() {} });
      assert.equal(output.outcome, 'blocked'); assert.equal(output.effect_status, 'no_effect'); assert.deepEqual(output.facts, {});
      assert.equal(output.observations.reconciliation, 'observed-reserved-before-effect');
      assert.equal(output.observations.reserved_dispatch_sha256, capsuleHash);
      assert.deepEqual(output.observations.git.observed, prepared.plan.git.observed);
      await assert.rejects(f.checkpoint.reconcile(f.instance, config.operation_id, {
        assertAuthorized() { throw Error('RESERVED_FIXTURE_GRANT_REVOKED'); } }), /RESERVED_FIXTURE_GRANT_REVOKED/);
      f.state.externalChanged = true;
      await assert.rejects(f.checkpoint.reconcile(f.instance, config.operation_id, { assertAuthorized() {} }),
        { code: 'STANDARD_PR_CORRECTION_PROVIDER_CHANGED' });
      f.state.externalChanged = false;
      state.contextChanged = true;
      assert.throws(() => reader.observer.observeReservedDispatch(original), { code: 'PROCESS_RESERVED_DISPATCH_UNCONFIRMED' });
      state.contextChanged = false;
    }
    assert.equal(shadowHash(reader.dispatches.read(config.operation_id).record), capsuleHash);
    assert.deepEqual(reader.journal.read(config.operation_id).record, original);
    fs.writeFileSync(path.join(control, 'observation.json'), JSON.stringify({ boundary, identity, exit,
      original_worker_bound_ms: boundMs, deadline_ms: deadline, terminated_before_deadline: true,
      capsule_phase: capsule.phase, callback_called: fs.existsSync(config.called), capsule_unchanged: true,
      journal_results: original.results.length, canonical_host_acceptance: 'NOT_RUN',
      genuine_Native_clients: 0, genuine_model_calls: 0 }) + '\n', { flag: 'wx' });
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    for (const [name, value] of [['stdout', stdout], ['stderr', stderr]])
      fs.writeFileSync(path.join(control, name + '.log'), value, { flag: 'wx' });
  }
}
