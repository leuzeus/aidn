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
import { assertStandardOperationInput, assertStandardOperationOutput, assertStandardPrCorrectionCheckpointPlan } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { agenticProcessImplementationPins } from '../../src/application/runtime/agentic-process-implementation-pins.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { createProcessOperationJournalStore } from '../../src/adapters/runtime/process-operation-journal-store.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
const H = 'a'.repeat(64), op = n => 'op_' + String(n).repeat(40), owned = [], temporary = fs.realpathSync(os.tmpdir());
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
const input = { contract_version: 'standard-pr-correction-checkpoint-input.v1', reopen_operation_id: op(1) };
const mode = process.argv.find(x => x.startsWith('--mode='))?.slice(7) ?? 'files';
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
// Public fixture key, not a production identity. The complete host's canonical
// intent/receipt authentication is a separate composition obligation.
const signer = createOperationJournalSigner(() => Buffer.alloc(32, 73));
const journal = f => createProcessOperationJournalStore({ targetRoot: f.root, stateMode: f.selectedMode });
function retainDispatch(f, prepared) {
  const id = prepared.plan.operation_id, binding = standardWorkflowOperationBindings().find(row => row.id === 'session_pr_correction_checkpoint');
  const preview = signer.seal({ contract_version: 'standard-operation-preview.v1', instance_id: f.instance.instance_id,
    instance_sha256: f.instance.instance_sha256, scope_id: 'fixture-checkpoint-recovery', model_sha256: H, occurrence_id: 'checkpoint',
    binding, input, prepared, snapshot: {}, prepared_at_ms: prepared.plan.prepared_at_ms });
  const intent = { contract_version: 'process-operation-intent.v1', operation_id: id, binding_ref: binding.id, binding_sha256: shadowHash(binding),
    input_sha256: shadowHash(input), preconditions_sha256: shadowHash(preview), authorization_sha256: H, authority_id: 'fixture_operator',
    scope_id: preview.scope_id, instance_id: f.instance.instance_id, instance_sha256: f.instance.instance_sha256,
    model_sha256: H, occurrence_id: 'checkpoint', instance_revision: 1 };
  journal(f).compareAndSwap(signer.seal({ contract_version: 'process-operation-journal.v1', operation_id: id, revision: 2,
    phase: 'dispatching', preview, intent, grant: { fixture: true }, owner: { generation: '00000000-0000-0000-0000-000000000073', pid: process.pid }, results: [] }), null);
}

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
    readDispatchedOperation(_instance, id) {
      const record = structuredClone(journal(f).read(id).record);
      if (state.tamperedDispatch) record.preview.prepared.plan.prepared_at_ms++;
      return signer.verify(record);
    },
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
  const state = {};
  return { ...f, selectedMode, accepted, state, checkpoint: checkpoint({ ...f, selectedMode }, accepted, state) };
}
const childArg = process.argv.find(x => x.startsWith('--child='));
if (childArg) {
  const saved = JSON.parse(fs.readFileSync(childArg.slice(8), 'utf8'));
  const port = checkpoint(saved, saved.accepted);
  const output = saved.reconcile ? await port.reconcile(saved.instance, saved.prepared.plan.operation_id, { assertAuthorized() {} })
    : await port.apply(saved.instance, saved.prepared, { write: true, expectPlan: saved.prepared.plan_sha256, assertAuthorized() {} });
  console.log(JSON.stringify(output)); process.exit(0);
}
try {
  await test('three private schemas use supported validation keywords', () => {
    for (const kind of ['input', 'plan', 'output']) assert.deepEqual(validateJsonSchemaDefinition(JSON.parse(fs.readFileSync(
      new URL('../../src/core/contracts/workflow-definition/standard-pr-correction-checkpoint-' + kind + '.v1.schema.json', import.meta.url))), '#', { contractKind: 'workflow-definition' }), []);
  });
  await test('registered contracts and direct byte pins reject missing completion facts and authored paths', () => {
    assertStandardOperationInput('session_pr_correction_checkpoint', input);
    assert.throws(() => assertStandardOperationInput('session_pr_correction_checkpoint', { ...input, approved_paths: [] }));
    assert.throws(() => assertStandardOperationOutput({ contract_version: 'standard-pr-correction-checkpoint-output.v1', operation_ref: 'session_pr_correction_checkpoint',
      outcome: 'completed', effect_status: 'confirmed', facts: {}, observations: {}, evidence_refs: [] }));
    const pins = agenticProcessImplementationPins();
    for (const name of ['src/application/runtime/standard-pr-correction-checkpoint.mjs', ...['input', 'plan', 'output'].map(kind =>
      'src/core/contracts/workflow-definition/standard-pr-correction-checkpoint-' + kind + '.v1.schema.json')])
      assert.equal(pins.files.filter(row => row.path === name).length, 1);
  });
  const f = await fixture(mode), before = git(f.root, 'status', '--porcelain'), count = git(f.root, 'rev-list', '--count', 'HEAD');
  let prepared;
  await test('preview binds only accepted reopening postimages and changes nothing', async () => {
    prepared = await f.checkpoint.prepare(f.instance, input, op(2));
    assertStandardPrCorrectionCheckpointPlan(prepared.plan);
    const forged = structuredClone(prepared.plan); forged.git.files = [{ path: 'product/app.mjs', sha256: H }];
    assert.throws(() => assertStandardPrCorrectionCheckpointPlan(forged));
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
    retainDispatch(f, prepared);
    await assert.rejects(f.checkpoint.reconcile(f.instance, prepared.plan.operation_id, { assertAuthorized() {} }),
      { code: mode === 'db-only' ? 'STANDARD_PR_CORRECTION_CHECKPOINT_COMMIT_WITNESS_REQUIRED' : 'STANDARD_PR_CORRECTION_CHECKPOINT_UNCONFIRMED' });
    const directory = fs.mkdtempSync(path.join(temporary, 'aidn-correction-checkpoint-')); owned.push(directory);
    const file = path.join(directory, 'control.json'); fs.writeFileSync(file, JSON.stringify({ root: f.root, selectedMode: mode, instance: f.instance, accepted: f.accepted, prepared }));
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
  await test(mode === 'db-only' ? 'db-only missing acknowledgement refuses recovery without a commit witness'
    : 'signed missing acknowledgement is observed in a new process without replaying Git or rewriting history', async () => {
    const id = prepared.plan.operation_id, retained = journal(f).read(id), head = git(f.root, 'rev-parse', 'HEAD'), countBefore = git(f.root, 'rev-list', '--count', 'HEAD');
    f.state.tamperedDispatch = true;
    await assert.rejects(f.checkpoint.reconcile(f.instance, id, { assertAuthorized() {} }), { code: 'PROCESS_JOURNAL_NOT_AUTHENTICATED' });
    delete f.state.tamperedDispatch;
    if (mode === 'db-only') {
      await assert.rejects(f.checkpoint.reconcile(f.instance, id, { assertAuthorized() {} }), { code: 'STANDARD_PR_CORRECTION_CHECKPOINT_COMMIT_WITNESS_REQUIRED' });
    } else {
      await assert.rejects(f.checkpoint.reconcile(f.instance, id), { code: 'STANDARD_PR_CORRECTION_CHECKPOINT_RECOVERY_AUTHORITY_REQUIRED' });
      await assert.rejects(f.checkpoint.reconcile(f.instance, id, { assertAuthorized() { throw Error('grant absent'); } }), /grant absent/);
      f.state.externalChanged = true;
      await assert.rejects(f.checkpoint.reconcile(f.instance, id, { assertAuthorized() {} }), { code: 'STANDARD_PR_CORRECTION_PROVIDER_CHANGED' });
      delete f.state.externalChanged;
      const directory = fs.mkdtempSync(path.join(temporary, 'aidn-correction-checkpoint-')); owned.push(directory);
      const file = path.join(directory, 'recover.json'); fs.writeFileSync(file, JSON.stringify({ root: f.root, selectedMode: mode,
        instance: f.instance, accepted: f.accepted, prepared, reconcile: true }));
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child=' + file], { encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 1048576 });
      assert.equal(child.status, 0, child.stderr); const result = JSON.parse(child.stdout);
      assert.equal(result.outcome, 'completed'); assert.equal(result.effect_status, 'confirmed');
      assert.equal(result.observations.reconciliation, 'observed-existing-commit');
      assert.equal(result.observations.git.commit_sha, head); assert.equal(result.observations.remote_head, f.head);
      assertStandardOperationOutput(result);
      // Old effect TTL does not become a new dispatch. Only retrospective
      // observation is possible, with the current authority checked separately.
      f.state.now = prepared.plan.prepared_at_ms + 300001;
      assert.equal((await f.checkpoint.reconcile(f.instance, id, { assertAuthorized() {} })).outcome, 'completed');
      delete f.state.now;
      const row = f.artifacts.read(f.names[0], { required: true }), filePath = path.join(f.root, 'docs/audit', f.names[0]);
      fs.appendFileSync(filePath, '\nforeign change\n');
      await assert.rejects(f.checkpoint.reconcile(f.instance, id, { assertAuthorized() {} })); fs.writeFileSync(filePath, row.content);
    }
    assert.deepEqual(journal(f).read(id), retained);
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), head); assert.equal(git(f.root, 'rev-list', '--count', 'HEAD'), countBefore);
    assert.equal(f.artifacts.ownerPending(), false);
  });
  if (mode !== 'db-only') await test('a clean foreign successor cannot stand in for the exact checkpoint witness', async () => {
    const old = git(f.root, 'rev-parse', 'HEAD');
    git(f.root, '-c', 'core.hooksPath=NUL', 'commit', '--allow-empty', '-m', 'test: unrelated successor after checkpoint');
    await assert.rejects(f.checkpoint.reconcile(f.instance, prepared.plan.operation_id, { assertAuthorized() {} }),
      { code: 'STANDARD_PR_CORRECTION_CHECKPOINT_UNCONFIRMED' });
    assert.equal(git(f.root, 'rev-parse', 'HEAD^'), old); assert.equal(f.artifacts.ownerPending(), false);
  });
  if (mode === 'files') await test('lost authority after Git retains unknown effect and owner; no retry', async () => {
    const partial = await fixture('files'), p = await partial.checkpoint.prepare(partial.instance, input, op(3)); let grants = 0;
    const result = await partial.checkpoint.apply(partial.instance, p, { write: true, expectPlan: p.plan_sha256,
      assertAuthorized() { if (++grants >= 4) throw Error('grant lost after Git'); } });
    assert.equal(result.outcome, 'reconciliation_required'); assert.equal(result.effect_status, 'unknown'); assert.deepEqual(result.facts, {});
    assert.notEqual(git(partial.root, 'rev-parse', 'HEAD'), partial.head); assert.equal(partial.artifacts.ownerPending(), true);
    assert.equal((await partial.checkpoint.prepare(partial.instance, input, op(3))).can_apply, false);
    retainDispatch(partial, p); const ownerBefore = fs.readFileSync(path.join(partial.root, '.aidn/runtime/standard-workflow/effects.lock'));
    await assert.rejects(partial.checkpoint.reconcile(partial.instance, op(3), { assertAuthorized() {} }), { code: 'STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED' });
    assert.deepEqual(fs.readFileSync(path.join(partial.root, '.aidn/runtime/standard-workflow/effects.lock')), ownerBefore);
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
    checkpoint_dispatch_hmac: 'ACTUAL_PUBLIC_FIXTURE_KEY',
    checkpoint_recovery: mode === 'db-only' ? 'REFUSED_NO_COMMIT_WITNESS' : 'POSITIVE_MISSING_RECEIPT_OWNER_RELEASED',
    host_ir_binding: 'SOURCE_BOUND_NOT_EXECUTED_BY_THIS_SUITE', cycle_creation: 'NOT_RUN', native_models: 0, full_standard: false, installed_archive: 'NOT_RUN' }));
} finally {
  for (const root of owned.reverse()) {
    const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary);
    assert.ok(['aidn-standard-fresh-', 'aidn-correction-checkpoint-'].some(prefix => path.basename(real).startsWith(prefix)));
    fs.rmSync(real, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ fixture_cleanup: 'completed', roots: owned.length, independent_process_inventory: 'NOT_CAPTURED' }));
}
