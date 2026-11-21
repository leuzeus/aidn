import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPrCorrectionReopenFixture } from './standard-pr-correction-fixture-lib.mjs';
import { createProjectArtifactStore } from '../../src/application/runtime/project-artifact-store-service.mjs';
import { artifactMetadataHash } from '../../src/core/workflow/artifact-compare-swap.mjs';
const mode = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7) ?? 'files', owned = [];
assert.ok(['files', 'dual', 'db-only'].includes(mode));
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();
try {
  const f = await createPrCorrectionReopenFixture(mode, owned), head = git(f.root, 'rev-parse', 'HEAD'), count = git(f.root, 'rev-list', '--count', 'HEAD');
  const plan = await f.ops.prepareCycleContext({ session_id: 'S001' }); assert.equal(plan.can_apply, true);
  let reached = false;
  const output = await f.ops.refreshCycleContext(plan, { write: true, expectPlan: plan.plan_sha256, effectGuard: {
    before() {}, async after() {
      assert.equal(f.artifacts.ownerPending(), true); await new Promise(resolve => setImmediate(resolve)); reached = true;
      if (mode === 'files') return;
      const store = createProjectArtifactStore({ targetRoot: f.root, existingOnly: true });
      try {
        const before = store.getArtifact('RUNTIME-STATE.md'); assert.ok(before);
        store.compareAndSwapArtifact({ artifact: { ...before, classification_reason: before.classification_reason + '-late-writer' },
          expectedSha256: before.sha256, expectedMetadataSha256: artifactMetadataHash(before) });
        const after = store.getArtifact(before.path);
        assert.equal(after.content, before.content); assert.equal(after.sha256, before.sha256);
        assert.notEqual(artifactMetadataHash(after), artifactMetadataHash(before));
      } finally { store.close(); }
    }
  } });
  assert.equal(reached, true); assert.equal(git(f.root, 'rev-parse', 'HEAD'), head); assert.equal(git(f.root, 'rev-list', '--count', 'HEAD'), count);
  if (mode === 'files') { assert.equal(output.outcome, 'completed'); assert.equal(output.effect_status, 'confirmed'); assert.equal(f.artifacts.ownerPending(), false); }
  else {
    assert.equal(output.outcome, 'reconciliation_required'); assert.equal(output.effect_status, 'unknown'); assert.deepEqual(output.facts, {});
    assert.equal(output.observations.reason_code, 'STANDARD_CYCLE_METADATA_UNCONFIRMED'); assert.equal(f.artifacts.ownerPending(), true);
  }
  console.log(JSON.stringify({ status: 'PASS', mode, reached_post_cas_wait: reached, output, actual_canonical_cas: true,
    retry: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
} finally { console.log(JSON.stringify({ fixture_cleanup: 'retained', roots: owned })); }
