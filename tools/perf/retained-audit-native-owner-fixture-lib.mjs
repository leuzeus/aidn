import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRetainedAuditNativeOwnerAssertion } from '../../src/application/runtime/retained-audit-native-owner.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

// Called inside the production Native dispatch owner. The actual canonical
// fence, signed running capsule, live process and physical lock are exercised;
// the allocation is an identified fixture reservation and starts no Native.
export function verifyRetainedAuditNativeOwner({ configuration, instance, signer, artifacts, authority, journalId, intent, test }) {
  const reservation = { journal_id: journalId, generation: 1, owner_id: 'fixture-worker-reservation' };
  const entry = { phase: 'reserved', owner_id: reservation.owner_id, generation: 1,
    initial_instance_sha256: instance.instance_sha256, configuration_sha256: H(configuration), authorization_sha256: intent.authorization_sha256 };
  const journal = signer.seal({ journal_id: journalId, instance_id: instance.instance_id, scope_id: instance.scope_id,
    model_sha256: instance.model_sha256, allocations: [entry] });
  const make = (overrides = {}) => createRetainedAuditNativeOwnerAssertion({ configuration, instance, signer, artifacts, reservation,
    readAuthority: () => authority, readInstance: () => instance, readJournal: () => journal, ...overrides });
  test('retained audit accepts its live signed Native owner while generic pending-owner guard refuses', () => {
    assert.equal(artifacts.ownerPending(), true); assert.equal(make()(), undefined);
  });
  for (const [name, change] of [
    ['missing reservation', () => ({ reservation: null })],
    ['foreign owner', () => ({ reservation: { ...reservation, owner_id: 'foreign' } })],
    ['wrong generation', () => ({ reservation: { ...reservation, generation: 2 } })],
    ['different current instance', () => ({ readInstance: () => ({ ...instance, instance_sha256: H('changed') }) })],
    ['changed authority', () => ({ readAuthority: () => ({ ...authority, scope_id: H('foreign') }) })],
    ['failed allocation', () => ({ readJournal: () => signer.seal({ ...journal, allocations: [{ ...entry, phase: 'failed' }] }) })],
    ['foreign authorization', () => ({ readJournal: () => signer.seal({ ...journal, allocations: [{ ...entry, authorization_sha256: H('foreign') }] }) })],
    ['changed fence', () => ({ artifacts: { ...artifacts, resourceFence: () => ({ read: () => ({ record: { state: 'released' } }) }) } })],
    ['incomplete canonical inventory', () => ({ artifacts: { ...artifacts, inventory: () => ({ ...artifacts.inventory(), complete: false }) } })],
  ]) test('retained audit refuses ' + name, () => assert.throws(() => make(change())()));
  const originalRead = artifacts.read;
  for (const [name, mutate, resign] of [
    ['returned dispatch', r => { r.phase = 'returned'; r.result_sha256 = H('returned'); }, true],
    ['released lease', r => { r.leases[0].status = 'released'; }, true],
    ['forged dispatch', r => { r.nonce = '00000000-0000-4000-8000-000000000001'; }, false],
  ]) test('retained audit refuses ' + name, () => {
    const changed = { ...artifacts, read: (p, options) => {
      const row = originalRead(p, options); if (!p.startsWith('workflows/native-dispatches/')) return row;
      let value = JSON.parse(row.content); mutate(value); if (resign) value = signer.seal(value);
      return { ...row, content: JSON.stringify(value) };
    } };
    assert.throws(() => make({ artifacts: changed })());
  });
  test('retained audit detects physical lock substitution even when its original content is restored', () => {
    const file = path.join(artifacts.root, '.aidn/runtime/standard-workflow/effects.lock');
    const before = fs.readFileSync(file), forged = JSON.parse(before); forged.token = '00000000-0000-4000-8000-000000000002';
    try { fs.writeFileSync(file, JSON.stringify(forged)); assert.throws(() => make()()); }
    finally { fs.writeFileSync(file, before); }
    // A content restoration changes the physical witness (mtime/ctime); the
    // production observer must still reject it. The fixture owner releases it
    // through its original descriptor after this callback.
    assert.throws(() => make()());
  });
}
