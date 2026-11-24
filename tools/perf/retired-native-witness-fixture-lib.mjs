import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { exactFileIdentity, resolveFileStatDevice } from '../../src/lib/fs/exact-file-identity.mjs';
import { inspectRetiredNativeOwnerWitness, inspectNativeOwnerLock, nativeRetiredOwnerRelativePath } from '../../src/application/runtime/local-native-owner-retirement.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

// Real filesystem observations. This fixture supplies already-authenticated
// lease data; the history-reader suite separately checks receipt authentication.
export function verifyRetiredNativeWitness(test) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-retired-witness-'));
  const dispatchId = 'native_dispatch_' + 'a'.repeat(40), file = path.join(root, nativeRetiredOwnerRelativePath(dispatchId));
  const owner = { owner: 'fixture-retired-only' }, bytes = JSON.stringify(owner), digest = createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
  const identity = () => exactFileIdentity(resolveFileStatDevice(file, fs.lstatSync(file, { bigint: true }), () => assert.fail('identity race')));
  const original = identity(), lease = { owner, physical_identity: original };
  const input = { targetRoot: root, dispatchId, originalLease: lease, expectedLockSha256: digest };
  const observe = overrides => inspectRetiredNativeOwnerWitness({ ...input, ...overrides });
  try {
    test('retired witness accepts the retained physical object and owner bytes', () => assert.equal(observe().sha256, digest));
    test('metadata-only ctime change preserves historical witness admission', () => {
      fs.chmodSync(file, 0o444); fs.chmodSync(file, original.mode & 0o777);
      const after = identity(); assert.notEqual(after.ctime_ns, original.ctime_ns);
      assert.deepEqual({ ...after, ctime_ns: original.ctime_ns }, original);
      assert.equal(observe().sha256, digest);
    });
    for (const field of ['dev', 'ino', 'size', 'nlink', 'mode', 'mtime_ns']) test('retired witness refuses changed signed ' + field, () => {
      const altered = { ...original, [field]: typeof original[field] === 'number' ? original[field] + 1 : String(BigInt(original[field]) + 1n) };
      assert.throws(() => observe({ originalLease: { ...lease, physical_identity: altered } }), { code: 'NATIVE_OWNER_RETIRED_WITNESS_CHANGED' });
    });
    test('retired witness refuses changed owner or content digest', () => {
      assert.throws(() => observe({ originalLease: { ...lease, owner: { owner: 'foreign' } } }), { code: 'NATIVE_OWNER_RETIRED_WITNESS_CHANGED' });
      assert.throws(() => observe({ expectedLockSha256: H('foreign') }), { code: 'NATIVE_OWNER_RETIRED_WITNESS_CHANGED' });
      fs.writeFileSync(file, JSON.stringify({ owner: 'fixture-altered-only' }));
      assert.throws(() => observe(), { code: 'NATIVE_OWNER_RETIRED_WITNESS_CHANGED' });
    });
    test('byte-identical replacement cannot impersonate the archived object', () => {
      const replacement = file + '.replacement'; fs.writeFileSync(replacement, bytes);
      fs.unlinkSync(file); fs.renameSync(replacement, file);
      assert.notEqual(identity().ino, original.ino);
      assert.throws(() => observe(), { code: 'NATIVE_OWNER_RETIRED_WITNESS_CHANGED' });
    });
    test('additional hard link refuses the retired witness', () => {
      const link = file + '.hardlink'; fs.linkSync(file, link);
      assert.throws(() => observe(), { code: 'NATIVE_OWNER_PHYSICAL_LOCK_CHANGED' }); fs.unlinkSync(link);
    });
    test('absent archived witness refuses historical admission', () => {
      fs.unlinkSync(file); assert.throws(() => observe(), { code: 'NATIVE_OWNER_RETIRED_WITNESS_CHANGED' });
    });
    test('live-owner identity still refuses metadata-only changes', () => {
      const live = path.join(root, '.aidn/runtime/standard-workflow/effects.lock'); fs.writeFileSync(live, bytes);
      const stat = fs.lstatSync(live, { bigint: true });
      const liveIdentity = exactFileIdentity(resolveFileStatDevice(live, stat, () => assert.fail('identity race')));
      const parameters = { targetRoot: root, dispatchId, intention: { lock_path: '.aidn/runtime/standard-workflow/effects.lock', owner }, lease: { owner, physical_identity: liveIdentity } };
      inspectNativeOwnerLock(parameters); fs.chmodSync(live, 0o444); fs.chmodSync(live, liveIdentity.mode & 0o777);
      assert.throws(() => inspectNativeOwnerLock(parameters), { code: 'NATIVE_OWNER_PHYSICAL_LOCK_CHANGED' });
    });
  } finally {
    const resolved = fs.realpathSync(root), parent = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), parent); assert.match(path.basename(resolved), /^aidn-retired-witness-/);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
