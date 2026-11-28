import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { withStandardDispatchContext } from '../../src/application/runtime/standard-dispatch-context.mjs';

const owned = [], H = 'a'.repeat(64), B = 'b'.repeat(64), id = 'op_' + '1'.repeat(40);
let succeeded = false, checks = 0;
try {
  for (const mode of ['dual', 'db-only']) {
    const root = createStandardWorkflowFixture(mode, owned), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
    const name = 'notes/borrowed-disposition-owner-fixture.md', before = artifacts.read(name);
    assert.equal(before.sha256, null); assert.equal(artifacts.metadataHash(name), null);
    const fence = artifacts.resourceFence(), lease = fence.acquire();
    let callbacks = 0, revoked = false, admissions = 0;
    const capability = { operation_id: id, plan_sha256: H, lease, assertCurrent() {
      admissions++; fence.assert(lease); if (revoked) throw Object.assign(Error('FIXTURE_CONTROL_REVOKED'), { code: 'FIXTURE_CONTROL_REVOKED' });
    } };
    const run = (cap, callback) => withStandardDispatchContext({ artifactContinuation: cap },
      () => artifacts.withLocalEffectOwner(H, callback));
    await run(capability, async () => {
      artifacts.assertLocalEffectOwner(H); callbacks++;
      artifacts.compareAndSwapPreservingMetadata({ path: name, before_sha256: null, before_metadata_sha256: null,
        after: '# Controlled borrowed owner\n' });
      artifacts.assertLocalEffectOwner(H);
    });
    assert.equal(callbacks, 1); assert.ok(admissions >= 2);
    assert.equal(artifacts.read(name, { required: true }).content, '# Controlled borrowed owner\n');
    assert.equal(fence.read().record.token, lease.record.token); assert.equal(fence.read().record.state, 'held');
    assert.equal(artifacts.localOwnerPending(), false, 'no invented physical effect lock is declared');
    assert.equal(artifacts.ownerPending(), true, 'the controller still owns the canonical fence');
    console.log('PASS ' + mode + ': actual canonical CAS borrows the exact held fence without second acquisition or release'); checks++;
    const after = artifacts.read(name).sha256, metadata = artifacts.metadataHash(name);
    await assert.rejects(async () => run({ ...capability, plan_sha256: B }, () => { callbacks++; }), { code: 'STANDARD_EFFECT_OWNER_REQUIRED' });
    const substituted = structuredClone(lease); substituted.record.token = '22222222-2222-4222-8222-222222222222';
    await assert.rejects(async () => run({ ...capability, lease: substituted }, () => { callbacks++; }), { code: 'STANDARD_RESOURCE_FENCE_CHANGED' });
    assert.equal(callbacks, 1); assert.equal(artifacts.read(name).sha256, after); assert.equal(artifacts.metadataHash(name), metadata);
    console.log('PASS ' + mode + ': wrong plan and substituted lease refuse before any callback or business change'); checks++;
    await assert.rejects(() => run(capability, async () => {
      await Promise.resolve(); revoked = true; artifacts.assertLocalEffectOwner(H); callbacks++;
    }), { code: 'FIXTURE_CONTROL_REVOKED' });
    assert.equal(callbacks, 1); assert.equal(fence.read().record.token, lease.record.token);
    assert.equal(fence.read().record.state, 'held'); assert.equal(artifacts.read(name).sha256, after);
    assert.equal(artifacts.localOwnerPending(), false);
    assert.throws(() => artifacts.assertLocalEffectOwner(H), { code: 'STANDARD_EFFECT_OWNER_REQUIRED' });
    console.log('PASS ' + mode + ': current control revocation stops callback progress and leaves ownership with the controller'); checks++;
    fence.release(lease); assert.equal(fence.read().record.state, 'released');
  }
  succeeded = true;
  console.log(JSON.stringify({ status: 'PASS', checks, scope: 'actual-artifact-lease-primitive-with-controlled-capability',
    operator_source_authentication: 'NOT_RUN', original_dispatch_intent_authentication: 'NOT_RUN', continuation_execution: 'NOT_PROVEN',
    Native_calls: 0, full_standard_workflow: false }));
} finally {
  if (!succeeded) console.log(JSON.stringify({ fixture_cleanup: 'retained', roots: owned, reason: 'qualification_failed' }));
  else for (const root of owned) {
    const physical = fs.realpathSync(root), temporary = fs.realpathSync(os.tmpdir());
    if (path.dirname(physical) !== temporary || !path.basename(physical).startsWith('aidn-standard-ports-'))
      throw Error('BORROWED_OWNER_FIXTURE_CLEANUP_OUT_OF_SCOPE');
    fs.rmSync(physical, { recursive: true, force: true });
  }
}
