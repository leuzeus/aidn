import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPrCorrectionReopenFixture } from './standard-pr-correction-fixture-lib.mjs';
import { createStandardPrCorrectionCheckpoint } from '../../src/application/runtime/standard-pr-correction-checkpoint.mjs';
import { createStandardPrCorrectionReview } from '../../src/application/runtime/standard-pr-correction-review.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
const mode = process.argv.find(x => x.startsWith('--mode='))?.slice(7) ?? 'files', owned = [], temporary = fs.realpathSync(os.tmpdir());
assert.ok(['files', 'dual', 'db-only'].includes(mode));
const op = n => 'op_' + String(n).repeat(40), git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();
let checks = 0, completed = false;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + mode + ': ' + name); };
try {
  const f = await createPrCorrectionReopenFixture(mode, owned), prepared = await f.port.prepare(f.instance, f.input);
  const output = await f.port.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
  assert.equal(output.outcome, 'completed');
  const accepted = { record: { operation_id: op(1), intent: { binding_ref: 'session_pr_correction_reopen' }, preview: { input: f.input, prepared } }, output };
  let acceptedCheckpoint = null, providerChanged = false, wait = null, calls = 0;
  const authority = { verifySource: f.authority.verifySource, async verifyProviderSource(_instance, source, { signal } = {}) {
    calls++; await wait?.(); if (signal?.aborted) throw Object.assign(Error('abort'), { code: 'STANDARD_PR_CORRECTION_CHECKPOINT_ABORTED' });
    if (providerChanged) throw Object.assign(Error('provider changed'), { code: 'FIXTURE_PROVIDER_CHANGED' });
    return { origin_source_sha256: shadowHash(source), proof_class: 'fixture-provider-double' };
  } };
  const checkpoint = createStandardPrCorrectionCheckpoint({ targetRoot: f.root, authority, readCurrent: () => f.instance,
    readAcceptedOperation(_instance, id, binding) {
      if (binding === 'session_pr_correction_reopen') { assert.equal(id, op(1)); return structuredClone(accepted); }
      assert.equal(binding, 'session_pr_correction_checkpoint'); assert.equal(id, op(2));
      if (!acceptedCheckpoint) throw Object.assign(Error('not accepted'), { code: 'FIXTURE_CHECKPOINT_NOT_ACCEPTED' });
      return structuredClone(acceptedCheckpoint);
    } });
  const input = { contract_version: 'standard-pr-correction-review-input.v1', checkpoint_operation_id: op(2) };
  const review = createStandardPrCorrectionReview({ readCheckpoint: checkpoint.readCompleted });
  await test('an unaccepted checkpoint never supplies a human subject', async () => {
    await assert.rejects(review.prepare(f.instance, input, op(3)), { code: 'FIXTURE_CHECKPOINT_NOT_ACCEPTED' });
  });
  const checkpointInput = { contract_version: 'standard-pr-correction-checkpoint-input.v1', reopen_operation_id: op(1) };
  const p = await checkpoint.prepare(f.instance, checkpointInput, op(2));
  const result = await checkpoint.apply(f.instance, p, { write: true, expectPlan: p.plan_sha256, assertAuthorized() {} });
  assert.equal(result.outcome, 'completed', JSON.stringify(result));
  acceptedCheckpoint = { record: { operation_id: op(2), intent: { binding_ref: 'session_pr_correction_checkpoint' }, preview: { input: checkpointInput, prepared: p } }, output: result };
  const head = git(f.root, 'rev-parse', 'HEAD'), count = git(f.root, 'rev-list', '--count', 'HEAD');
  let questionPlan;
  await test('accepted actual checkpoint supplies exact subject and rereading performs no Git effect', async () => {
    questionPlan = await review.prepare(f.instance, input, op(3)); await review.assertFresh(f.instance, questionPlan.plan);
    assert.equal(questionPlan.plan.review.head_oid, head); assert.equal(questionPlan.plan.review.checkpoint_output_sha256, shadowHash(result));
    assert.equal(questionPlan.plan.review.state_mode, mode); assert.equal(questionPlan.plan.review.postimages.length, 3);
    assert.equal(git(f.root, 'rev-list', '--count', 'HEAD'), count); assert.equal(f.artifacts.ownerPending(), false);
    assert.equal(result.effect_status, mode === 'db-only' ? 'no_effect' : 'confirmed');
    assert.equal(head === f.head, mode === 'db-only');
  });
  await test('provider refusal and abort during fresh observation remain refusals', async () => {
    providerChanged = true; await assert.rejects(review.assertFresh(f.instance, questionPlan.plan), { code: 'FIXTURE_PROVIDER_CHANGED' }); providerChanged = false;
    const abort = new AbortController(); wait = async () => abort.abort();
    await assert.rejects(review.assertFresh(f.instance, questionPlan.plan, { signal: abort.signal }), { code: 'STANDARD_PR_CORRECTION_CHECKPOINT_ABORTED' }); wait = null;
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), head);
  });
  await test('an uncertain or changed accepted checkpoint cannot be reviewed as success', async () => {
    const saved = acceptedCheckpoint;
    for (const mutate of [x => x.output.effect_status = 'unknown', x => x.output.facts = {}, x => x.record.preview.prepared.plan_sha256 = 'f'.repeat(64)]) {
      acceptedCheckpoint = structuredClone(saved); mutate(acceptedCheckpoint); await assert.rejects(review.prepare(f.instance, input, op(3)));
    }
    acceptedCheckpoint = saved;
  });
  await test('pending effect ownership blocks review before provider observation', async () => {
    const before = calls, beforeRows = f.names.map(name => ({ ...f.artifacts.read(name), metadata: f.artifacts.metadataHash(name) }));
    const released = await f.artifacts.withLocalEffectOwner('f'.repeat(64), async () => {
      await assert.rejects(review.prepare(f.instance, input, op(3)), { code: 'STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED' });
      assert.equal(calls, before);
      assert.equal(git(f.root, 'rev-parse', 'HEAD'), head);
      assert.equal(git(f.root, 'rev-list', '--count', 'HEAD'), count);
      assert.deepEqual(f.names.map(name => ({ ...f.artifacts.read(name), metadata: f.artifacts.metadataHash(name) })), beforeRows);
      return { effect_status: 'no_effect' };
    });
    assert.equal(released.effect_status, 'no_effect');
    assert.equal(f.artifacts.ownerPending(), false);
    assert.equal(calls, before);
  });
  await test('a foreign new HEAD cannot reuse the old checkpoint subject', async () => {
    git(f.root, '-c', 'core.hooksPath=NUL', 'commit', '--allow-empty', '-m', 'test: unrelated checkpoint successor');
    await assert.rejects(review.prepare(f.instance, input, op(3)), { code: mode === 'db-only' ? 'STANDARD_PR_CORRECTION_CHECKPOINT_UNCONFIRMED' : 'STANDARD_PR_CORRECTION_CHECKPOINT_UNCONFIRMED' });
    assert.equal(git(f.root, 'rev-list', '--count', 'HEAD'), String(Number(count) + 1));
  });
  console.log(JSON.stringify({ status: 'PASS', checks, mode, canonical_cas_git: 'ACTUAL', accepted_source_provider_authority: 'FIXTURE_DOUBLE',
    production_dispatcher: 'NOT_RUN', genuine_human: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN', full_standard_workflow: false }));
  completed = true;
} finally {
  if (completed && !process.argv.includes('--retain-always')) for (const root of owned.reverse()) { const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary); assert.ok(path.basename(real).startsWith('aidn-standard-fresh-')); fs.rmSync(real, { recursive: true, force: true }); }
  else console.log(JSON.stringify({ fixture_cleanup: 'retained', roots: owned }));
}
