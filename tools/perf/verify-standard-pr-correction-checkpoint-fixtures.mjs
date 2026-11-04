import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPrCorrectionReopenFixture } from './standard-pr-correction-fixture-lib.mjs';
import { createStandardPrCorrectionCheckpoint } from '../../src/application/runtime/standard-pr-correction-checkpoint.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { preWriteAdmit } from '../runtime/pre-write-admit.mjs';
const H = 'a'.repeat(64), op = n => 'op_' + String(n).repeat(40), owned = [], temporary = fs.realpathSync(os.tmpdir());
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
const input = { contract_version: 'standard-pr-correction-checkpoint-input.v1', reopen_operation_id: op(1) };
const mode = process.argv.find(x => x.startsWith('--mode='))?.slice(7) ?? 'files';
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };

// Receipt, provider/event and native-result authentication are fixture doubles.
// The component's exact-plan/CAS/physical projection/Git and admission are real.
function checkpoint(f, accepted, state = {}) {
  const authority = {
    async verifySource(_instance, expected) {
      assert.equal(git(f.root, 'rev-parse', 'HEAD'), expected.pull_request.head_oid);
      if (state.externalChanged) throw Object.assign(Error('provider changed'), { code: 'STANDARD_PR_CORRECTION_PROVIDER_CHANGED' });
      return { origin_source_sha256: shadowHash(expected), proof_class: 'fixture-source-double' };
    },
    async verifyProviderSource(_instance, expected) {
      if (state.foreignCommitAfterGit) git(f.root, '-c', 'core.hooksPath=NUL', 'commit', '--allow-empty', '-m', 'test: unrelated concurrent commit');
      if (state.externalChanged) throw Object.assign(Error('provider changed'), { code: 'STANDARD_PR_CORRECTION_PROVIDER_CHANGED' });
      return { origin_source_sha256: shadowHash(expected), canonical_transition: 'local-checkpoint-proof-required', proof_class: 'fixture-source-double' };
    },
  };
  return createStandardPrCorrectionCheckpoint({ targetRoot: f.root, authority, readCurrent: () => f.instance,
    now: () => state.now ?? Date.now(),
    readAcceptedOperation(_instance, id, binding) {
      assert.equal(id, op(1)); assert.equal(binding, 'session_pr_correction_reopen');
      if (state.unauthenticated) throw Object.assign(Error('untrusted receipt'), { code: 'FIXTURE_ACCEPTED_OPERATION_UNAUTHENTICATED' });
      return structuredClone(accepted);
    } });
}
async function fixture(selectedMode) {
  const f = await createPrCorrectionReopenFixture(selectedMode, owned), prepared = await f.port.prepare(f.instance, f.input);
  const output = await f.port.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
  assert.equal(output.outcome, 'completed');
  const accepted = { record: { operation_id: op(1), intent: { binding_ref: 'session_pr_correction_reopen' }, preview: { input: f.input, prepared } }, output };
  const state = {}, port = checkpoint(f, accepted, state);
  return { ...f, accepted, state, checkpoint: port };
}
const childArg = process.argv.find(x => x.startsWith('--child='));
if (childArg) {
  const saved = JSON.parse(fs.readFileSync(childArg.slice(8), 'utf8'));
  const port = checkpoint(saved, saved.accepted);
  const output = await port.apply(saved.instance, saved.prepared, { write: true, expectPlan: saved.prepared.plan_sha256, assertAuthorized() {} });
  console.log(JSON.stringify(output)); process.exit(0);
}
try {
  await test('three private schemas use supported validation keywords', () => {
    for (const kind of ['input', 'plan', 'output']) assert.deepEqual(validateJsonSchemaDefinition(JSON.parse(fs.readFileSync(
      new URL('../../src/core/contracts/workflow-definition/standard-pr-correction-checkpoint-' + kind + '.v1.schema.json', import.meta.url))), '#', { contractKind: 'workflow-definition' }), []);
  });
  const f = await fixture(mode), before = git(f.root, 'status', '--porcelain'), count = git(f.root, 'rev-list', '--count', 'HEAD');
  let prepared;
  await test('preview binds only accepted reopening postimages and changes nothing', async () => {
    prepared = await f.checkpoint.prepare(f.instance, input, op(2));
    assert.equal(prepared.can_apply, true);
    assert.equal(git(f.root, 'status', '--porcelain'), before);
    assert.equal(prepared.plan.git.observed.head, f.head); assert.equal(f.artifacts.ownerPending(), false);
    assert.deepEqual(prepared.plan.git.files.map(row => row.path).sort(), mode === 'db-only' ? [] : f.names.map(name => 'docs/audit/' + name).sort());
    await assert.rejects(f.checkpoint.apply(f.instance, prepared, { write: true, expectPlan: H, assertAuthorized() {} }));
    await assert.rejects(f.checkpoint.prepare(f.instance, { ...input, files: [] }, op(2)), { code: 'STANDARD_PR_CORRECTION_CHECKPOINT_INPUT_INVALID' });
  });
  await test('untrusted receipts and altered accepted postimages refuse without a commit', async () => {
    f.state.unauthenticated = true;
    await assert.rejects(f.checkpoint.prepare(f.instance, input, op(2)), { code: 'FIXTURE_ACCEPTED_OPERATION_UNAUTHENTICATED' });
    f.state.unauthenticated = false;
    const old = f.accepted.output.observations.postimages[0].sha256;
    f.accepted.output.observations.postimages[0].sha256 = H;
    await assert.rejects(f.checkpoint.prepare(f.instance, input, op(2)));
    f.accepted.output.observations.postimages[0].sha256 = old;
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.head);
  });
  await test('foreign dirty product cannot enter the finite checkpoint', async () => {
    const file = path.join(f.root, 'foreign-product.mjs'); fs.writeFileSync(file, 'export const foreign = true;\n');
    try { await assert.rejects(f.checkpoint.prepare(f.instance, input, op(2)), { code: 'STANDARD_PR_CORRECTION_CHECKPOINT_FOREIGN_CHANGE' }); }
    finally { fs.unlinkSync(file); }
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.head);
  });
  await test('expired preview and a lost provider before effect preserve HEAD and release owner', async () => {
    f.state.now = prepared.plan.prepared_at_ms + 300001;
    await assert.rejects(f.checkpoint.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} }));
    delete f.state.now; f.state.externalChanged = true;
    const result = await f.checkpoint.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
    assert.equal(result.outcome, 'blocked'); assert.equal(result.effect_status, 'no_effect'); assert.deepEqual(result.facts, {});
    f.state.externalChanged = false;
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.head); assert.equal(f.artifacts.ownerPending(), false);
  });
  await test('exact checkpoint resumes in a fresh process and retains original provider HEAD', async () => {
    const directory = fs.mkdtempSync(path.join(temporary, 'aidn-correction-checkpoint-')); owned.push(directory);
    const file = path.join(directory, 'control.json'); fs.writeFileSync(file, JSON.stringify({ root: f.root, instance: f.instance, accepted: f.accepted, prepared }));
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child=' + file], { encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 1048576 });
    assert.equal(child.status, 0, String(child.stderr));
    const result = JSON.parse(child.stdout);
    assert.equal(result.outcome, 'completed', JSON.stringify(result)); assert.equal(result.facts.session_pr_correction_checkpoint_completed, true);
    assert.equal(result.observations.remote_head, f.head); assert.equal(result.observations.product_admission, 'not-established');
    assert.equal(git(f.root, 'status', '--porcelain'), ''); assert.equal(f.artifacts.ownerPending(), false);
    if (mode === 'db-only') {
      assert.equal(result.effect_status, 'no_effect'); assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.head);
    } else {
      assert.equal(result.effect_status, 'confirmed'); assert.equal(git(f.root, 'rev-parse', 'HEAD^'), f.head);
      assert.deepEqual(git(f.root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').sort(), f.names.map(name => 'docs/audit/' + name).sort());
      // A lost acknowledgement must not trigger a second metadata commit.
      const again = await f.checkpoint.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
      assert.equal(again.outcome, 'blocked'); assert.deepEqual(again.facts, {});
      assert.equal(Number(git(f.root, 'rev-list', '--count', 'HEAD')), Number(count) + 1);
    }
    const native = await preWriteAdmit({ targetRoot: f.root, skill: 'pr-orchestrate', nativeRequest: { tool_name: 'apply_patch', cwd: f.root,
      tool_input: { command: '*** Begin Patch\n*** Add File: app.mjs\n+export const value = 2;\n*** End Patch' } } });
    assert.equal(native.write_decision.outcome, 'deny'); assert.equal(fs.existsSync(path.join(f.root, 'app.mjs')), false);
    assert.match(f.artifacts.read('CURRENT-STATE.md', { required: true }).content, /^active_cycle: none$/m);
  });
  if (mode === 'files') await test('lost authority after Git retains unknown effect and owner; no retry', async () => {
    const partial = await fixture('files'), p = await partial.checkpoint.prepare(partial.instance, input, op(3)); let grants = 0;
    const result = await partial.checkpoint.apply(partial.instance, p, { write: true, expectPlan: p.plan_sha256,
      assertAuthorized() { if (++grants >= 4) throw Error('grant lost after Git'); } });
    assert.equal(result.outcome, 'reconciliation_required'); assert.equal(result.effect_status, 'unknown'); assert.deepEqual(result.facts, {});
    assert.notEqual(git(partial.root, 'rev-parse', 'HEAD'), partial.head); assert.equal(partial.artifacts.ownerPending(), true);
    assert.equal((await partial.checkpoint.prepare(partial.instance, input, op(3))).can_apply, false);
    await assert.rejects(partial.checkpoint.apply(partial.instance, p, { write: true, expectPlan: p.plan_sha256, assertAuthorized() {} }), { code: 'STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED' });
  });
  if (mode === 'files') await test('an unrelated commit after the owned Git effect cannot inherit continuation', async () => {
    const foreign = await fixture('files'), p = await foreign.checkpoint.prepare(foreign.instance, input, op(4));
    foreign.state.foreignCommitAfterGit = true;
    const result = await foreign.checkpoint.apply(foreign.instance, p, { write: true, expectPlan: p.plan_sha256, assertAuthorized() {} });
    assert.equal(result.outcome, 'reconciliation_required'); assert.equal(result.effect_status, 'unknown'); assert.deepEqual(result.facts, {});
    assert.equal(result.observations.reason_code, 'STANDARD_PR_CORRECTION_CHECKPOINT_UNCONFIRMED');
    assert.equal(foreign.artifacts.ownerPending(), true);
    assert.equal(git(foreign.root, 'rev-parse', 'HEAD^^'), foreign.head);
    assert.equal((await foreign.checkpoint.prepare(foreign.instance, input, op(4))).can_apply, false);
  });
  console.log(JSON.stringify({ status: 'PASS', checks, mode, git_cas_projection_admission: 'ACTUAL', accepted_source_native_provider_event: 'DOUBLED',
    host_ir_binding: 'NOT_IMPLEMENTED', cycle_creation: 'NOT_RUN', native_models: 0, full_standard: false, installed_archive: 'NOT_RUN' }));
} finally {
  for (const root of owned.reverse()) {
    const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary);
    assert.ok(['aidn-standard-fresh-', 'aidn-correction-checkpoint-'].some(prefix => path.basename(real).startsWith(prefix)));
    fs.rmSync(real, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ fixture_cleanup: 'completed', roots: owned.length, independent_process_inventory: 'NOT_CAPTURED' }));
}
