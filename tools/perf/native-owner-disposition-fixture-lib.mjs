import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createNativeAllocationAssessmentFixture } from './native-allocation-assessment-fixture-lib.mjs';
import { createStandardProcessAuthority } from '../../src/application/runtime/standard-process-authority.mjs';
import { createStandardWorkflowOperationHost } from '../../src/application/runtime/standard-workflow-operation-host.mjs';
import { readAgenticProductSnapshot } from '../../src/application/runtime/agentic-process-execution-composition.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { createStandardHostAuthority } from '../../src/adapters/runtime/standard-host-authority.mjs';
import { nativeOwnerDispositionPath, assertNativeOwnerDispositionRecord } from '../../src/core/workflow/native-owner-disposition.mjs';
import { nativeRetiredOwnerRelativePath } from '../../src/application/runtime/local-native-owner-retirement.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const script = fileURLToPath(import.meta.url), key = () => Buffer.alloc(32, 73);
const lastJSON = text => JSON.parse(text.trim().split(/\r?\n/).findLast(row => row.startsWith('{')));
function worker(args, expectedExit = 0) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, expectedExit, result.stderr || result.stdout);
  return lastJSON(result.stdout);
}
function operatorAuthority(data) {
  return createStandardHostAuthority({ configuration: data.configuration,
    environment: { ...process.env, AIDN_STANDARD_HOST_HOME: data.operator_home } }, { useProvider: false });
}
function fixtureSource(data, plan, profile) {
  const authority = operatorAuthority(data), permit = plan ? { action: 'native_owner_retire', key_id: authority.keyId(),
    trust_sha256: authority.trustSha(), action_sha256: H({ fixture_exact_native_action: H(plan) }), subject_sha256: H(plan),
    scope_id: plan.scope_id, instance_sha256: plan.instance_sha256 } : null;
  function check({ request, grant }) {
    assert.equal(request.action, 'native_owner_retire'); assert.equal(request.plan_sha256, H(plan));
    if (profile === 'revoked') throw Object.assign(Error('FIXTURE_NATIVE_PERMISSION_REVOKED'), { code: 'FIXTURE_NATIVE_PERMISSION_REVOKED' });
    authority.verifyNativeOwnerDisposition(request, grant, permit);
  }
  return { authorize({ request }) {
    const grant = authority.authorizeNativeOwnerDisposition(request, profile === 'foreign-trust' ? { ...permit, trust_sha256: H('foreign-trust') } : permit);
    if (profile === 'expired') return { ...grant, contract_version: 'process-disposition-authorization-grant.v1', observed_at_ms: 1, expires_at_ms: 2 };
    if (profile === 'tampered') return { ...grant, grant_sha256: H('tampered') };
    if (profile === 'timeout') return new Promise(() => {});
    return grant;
  }, verify(input) { check(input); return { outcome: 'verified', authority_id: input.grant.authority_id,
    request_sha256: H(input.request), grant_sha256: H(input.grant) }; }, assertCurrent: check };
}
function open(data, plan, { fault = '', hold = '', profile = '', readSigningKey = key } = {}) {
  const product = () => readAgenticProductSnapshot(data.configuration.product_root, data.configuration.product_files);
  const authority = createStandardProcessAuthority({ configuration: data.configuration, model: data.model, readSigningKey,
    readProductSnapshot: product, readProductSha256: () => H(product()) });
  return createStandardWorkflowOperationHost({ targetRoot: data.root, model: data.model, readSigningKey,
    authorize: async () => { throw Error('UNEXPECTED_OPERATION_AUTHORIZATION'); }, processAuthority: authority,
    reconciliationConfiguration: data.configuration, nativeOwnerDispositionSource: profile === 'missing' ? null : fixtureSource(data, plan, profile) }, {
    async nativeOwnerDispositionBoundary(name) {
      if (name === hold) { process.send?.({ ready: name }); await new Promise(resolve => process.once('message', resolve)); }
      if (name === fault) throw Object.assign(Error('FIXTURE_NATIVE_DISPOSITION_INTERRUPT'), { code: 'FIXTURE_NATIVE_DISPOSITION_INTERRUPT' });
    },
  });
}
export const createNativeOwnerDispositionFixtureHost = (data, plan, options) => open(data, plan, options);
export const createNativeOwnerDispositionFixtureAuthority = data => operatorAuthority(data);
async function main() {
  const [action, first, second, ...options] = process.argv.slice(2);
  const option = name => options.find(value => value.startsWith(name + '='))?.slice(name.length + 1) ?? '';
  if (action === 'verify') { console.log(JSON.stringify(await verifyNativeOwnerDispositionFixture(first, { boundaries: process.argv.includes('--boundaries') }))); return; }
  if (action === 'produce') {
    const operatorHome = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-native-disposition-authority-'));
    const f = await createNativeAllocationAssessmentFixture(first, { protectedHome: operatorHome, parentClosed: option('profile') !== 'open-parent', retainAuthorization: option('profile') === 'reconciliation' });
    const data = { mode: first, root: f.root, private_root: f.privateRoot, operator_home: operatorHome, configuration: f.configuration, model: f.model, input: f.input,
      original_dispatch_sha256: f.artifacts.read('workflows/native-dispatches/' + f.dispatch.dispatch_id + '.json').sha256,
      original_journal_sha256: f.artifacts.read('workflows/native-allocations/' + f.journalId + '.json').sha256 };
    operatorAuthority(data).ensureKey(); fs.writeFileSync(second, JSON.stringify(data), { flag: 'wx' });
    console.log(JSON.stringify({ status: 'PRODUCED_ACTUAL_NATIVE_OWNER_WITH_SYNTHETIC_CHECKPOINT', root: f.root, creator_pid: process.pid }));
    if (option('hold')) { process.send?.({ ready: 'original_creator_active' }); await new Promise(resolve => process.once('message', resolve)); }
    return;
  }
  const data = JSON.parse(fs.readFileSync(first, 'utf8'));
  if (action === 'prepare') {
    try {
      const host = open(data, null), plan = host.prepareNativeOwnerDisposition(data.configuration.instance_id, data.input);
      assert.equal(option('expect'), ''); fs.writeFileSync(second, JSON.stringify(plan), { flag: 'wx' });
      console.log(JSON.stringify({ status: 'READONLY_NATIVE_OWNER_PLAN', plan_sha256: H(plan) }));
    } catch (error) { if (error.code !== option('expect')) throw error; console.log(JSON.stringify({ status: 'EXPECTED_REFUSAL', code: error.code })); }
    return;
  }
  if (action !== 'apply') throw Error('NATIVE_OWNER_FIXTURE_ACTION_INVALID');
  const plan = JSON.parse(fs.readFileSync(second, 'utf8')), host = open(data, plan, { fault: option('fault'), hold: option('hold'), profile: option('profile') });
  try {
    const result = await host.applyNativeOwnerDisposition(plan, { write: true, expectedPlanSha256: H(plan) });
    assert.equal(option('expect'), ''); console.log(JSON.stringify(result));
  } catch (error) {
    if (error.code === 'FIXTURE_NATIVE_DISPOSITION_INTERRUPT') { console.log(JSON.stringify({ status: 'INTERRUPTED_AT_OWNED_BOUNDARY', boundary: option('fault'), code: error.code })); process.exitCode = 76; }
    else if (error.code === option('expect')) console.log(JSON.stringify({ status: 'EXPECTED_REFUSAL', code: error.code }));
    else throw error;
  }
}
function snapshotOriginal(data) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: data.root }), id = data.input.dispatchId;
  assert.equal(artifacts.read('workflows/native-dispatches/' + id + '.json').sha256, data.original_dispatch_sha256);
  const dispatch = JSON.parse(artifacts.read('workflows/native-dispatches/' + id + '.json').content);
  assert.equal(artifacts.read('workflows/native-allocations/' + dispatch.journal_id + '.json').sha256, data.original_journal_sha256);
  const native = JSON.parse(artifacts.read('workflows/native-allocations/' + dispatch.journal_id + '.json').content);
  assert.equal(native.allocations.at(-1).phase, 'failed');
  return { artifacts, dispatch, native };
}
export async function verifyNativeOwnerDispositionFixture(mode, { boundaries = false } = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-native-disposition-proof-')), cases = [];
  const make = name => {
    const file = path.join(root, name + '-fixture.json'), plan = path.join(root, name + '-plan.json');
    worker(['produce', mode, file]); worker(['prepare', file, plan]);
    return { file, plan, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  };
  const verify = item => {
    const { artifacts, dispatch } = snapshotOriginal(item.data), row = artifacts.read(nativeOwnerDispositionPath(dispatch.dispatch_id), { required: true });
    const record = assertNativeOwnerDispositionRecord(JSON.parse(row.content)), signer = createOperationJournalSigner(key);
    signer.verify(record); signer.verify(record.plan); signer.verify(record.receipt);
    assert.equal(record.phase, 'confirmed'); assert.equal(record.receipt.permits_resume, false);
    assert.equal(record.receipt.permits_native_renewal, false); assert.equal(record.receipt.accounting_reconciled, false);
    assert.equal(record.receipt.complete_resource_closure, false); assert.equal(artifacts.resourceFence().read().record.state, 'released');
    assert.equal(fs.existsSync(path.join(item.data.root, '.aidn/runtime/standard-workflow/effects.lock')), false);
    assert.equal(fs.existsSync(path.join(item.data.root, nativeRetiredOwnerRelativePath(dispatch.dispatch_id))), true);
    assert.equal(fs.existsSync(path.join(item.data.root, 'docs/audit', nativeOwnerDispositionPath(dispatch.dispatch_id))), mode !== 'db-only');
    const before = H(artifacts.observeInventory()), replay = worker(['apply', item.file, item.plan]);
    assert.equal(replay.status, 'retained_confirmation'); assert.equal(H(replay.receipt), H(record.receipt));
    assert.equal(H(artifacts.observeInventory()), before);
    return record;
  };
  const ordinary = make('ordinary');
  for (const [profile, code] of [['missing', 'NATIVE_OWNER_DISPOSITION_AUTHORITY_UNAVAILABLE'], ['expired', 'NATIVE_OWNER_DISPOSITION_AUTHORIZATION_REQUIRED'],
    ['revoked', 'FIXTURE_NATIVE_PERMISSION_REVOKED'], ['foreign-trust', 'STANDARD_HOST_EXACT_NATIVE_DISPOSITION_REQUIRED'],
    ['tampered', 'STANDARD_HOST_NATIVE_DISPOSITION_GRANT_CHANGED'], ['timeout', 'NATIVE_OWNER_DISPOSITION_AUTHORIZATION_TIMEOUT']]) {
    const before = H(snapshotOriginal(ordinary.data).artifacts.observeInventory());
    worker(['apply', ordinary.file, ordinary.plan, 'profile=' + profile, 'expect=' + code]);
    assert.equal(H(snapshotOriginal(ordinary.data).artifacts.observeInventory()), before);
  }
  const result = worker(['apply', ordinary.file, ordinary.plan]); assert.equal(result.status, 'owner_retirement_confirmed');
  verify(ordinary); cases.push({ name: 'normal-and-replay', root: ordinary.data.root, actual_dead_creator: true, original_history_unchanged: true });
  if (boundaries) {
    const activeFile = path.join(root, 'active-original-fixture.json'), activePlan = path.join(root, 'active-original-plan.json');
    const producer = fork(script, ['produce', mode, activeFile, 'hold=original'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let producerError = ''; producer.stderr.on('data', b => { producerError += b; }); producer.stdout.resume();
    const producerClosed = once(producer, 'exit'); let activeFailure;
    try {
      await Promise.race([once(producer, 'message'), producerClosed.then(([code]) => { throw Error('PRODUCER_EXIT_BEFORE_BOUNDARY:' + code + ':' + producerError); })]);
      worker(['prepare', activeFile, activePlan, 'expect=NATIVE_OWNER_DISPOSITION_ORIGINAL_ACTIVE']);
    } catch (error) { activeFailure = error; }
    finally { if (producer.connected) producer.send('continue'); }
    const [producerCode] = await producerClosed; assert.equal(producerCode, 0, producerError); if (activeFailure) throw activeFailure;
    cases.push({ name: 'actual-active-original-creator', no_disposition_written: true });
    const openParentFile = path.join(root, 'unclosed-parent-fixture.json'), openParentPlan = path.join(root, 'unclosed-parent-plan.json');
    worker(['produce', mode, openParentFile, 'profile=open-parent']);
    worker(['prepare', openParentFile, openParentPlan, 'expect=NATIVE_OWNER_DISPOSITION_UNPROVEN_EFFECTS']);
    cases.push({ name: 'unproved-parent-closure', no_disposition_written: true });
    for (const boundary of ['native_disposition_before_intent', 'native_disposition_intent', 'native_disposition_fence_acquired',
      'native_disposition_lease_retained', 'native_disposition_lock_retired', 'native_disposition_retirement_confirmed', 'native_disposition_fence_released', 'native_disposition_confirmed']) {
      const item = make(boundary); worker(['apply', item.file, item.plan, 'fault=' + boundary], 76);
      const oldReceipt = snapshotOriginal(item.data).artifacts.read(nativeOwnerDispositionPath(item.data.input.dispatchId)).content;
      const priorReceipt = oldReceipt ? JSON.parse(oldReceipt).receipt : null;
      const recovered = worker(['apply', item.file, item.plan]); assert.ok(['owner_retirement_confirmed', 'retained_confirmation'].includes(recovered.status));
      const record = verify(item); if (priorReceipt) assert.equal(H(record.receipt), H(priorReceipt));
      cases.push({ name: boundary, root: item.data.root, actual_exited_repreneur: true, original_history_unchanged: true, immutable_prior_receipt: true });
    }
    const competing = make('competing'), a = fork(script, ['apply', competing.file, competing.plan, 'hold=native_disposition_intent'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stdout = '', stderr = ''; a.stdout.on('data', b => { stdout += b; }); a.stderr.on('data', b => { stderr += b; });
    const completion = once(a, 'exit');
    let competingFailure;
    try {
      await Promise.race([once(a, 'message'), completion.then(([exit]) => { throw Error('REPRENEUR_EXIT_BEFORE_OWNED_BOUNDARY:' + exit + ':' + stderr); })]);
      worker(['apply', competing.file, competing.plan, 'expect=NATIVE_OWNER_DISPOSITION_ACTIVE']);
    } catch (error) { competingFailure = error; }
    finally { if (a.connected) a.send('continue'); }
    const [code] = await completion; assert.equal(code, 0, stderr); assert.equal(lastJSON(stdout).status, 'owner_retirement_confirmed');
    if (competingFailure) throw competingFailure;
    const record = verify(competing); assert.equal(record.attempts.length, 1);
    cases.push({ name: 'two-live-repreners', root: competing.data.root, winning_attempts: 1, physical_retirements: 1 });
  }
  return { mode, proof_root: root, cases, canonical_and_physical_ports: 'REAL', checkpoint_and_failed_return: 'SYNTHETIC',
    authorization_source: 'REAL_PROTECTED_OPERATOR_HMAC_WITH_FIXTURE_EXACT_PERMIT_NO_HUMAN_APPROVAL_CLAIM', Native_calls: 0, original_history_unchanged: true,
    actual_process_interruption: 'CONTROLLED_EXIT_AT_DECLARED_BOUNDARIES', genuine_native: 'NOT_RUN', full_standard: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  try { await main(); } catch (error) { console.error(JSON.stringify({ code: error.code ?? error.name, message: error.message, frames: String(error.stack).split('\n').slice(1, 5) })); process.exitCode = 1; }
  finally { if (process.connected) process.disconnect(); }
}

// Shared arranger for the separate reconciliation fixture. It uses the same
// actual exited producer and protected owner-retirement path, with a committed
// original finite-authorization preimage instead of the older hash-only double.
export function createRetiredNativeOwnerReconciliationFixture(mode, proofRoot, name) {
  const file = path.join(proofRoot, name + '-owner-fixture.json'), plan = path.join(proofRoot, name + '-owner-plan.json');
  worker(['produce', mode, file, 'profile=reconciliation']); worker(['prepare', file, plan]);
  const result = worker(['apply', file, plan]); assert.equal(result.status, 'owner_retirement_confirmed');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')); snapshotOriginal(data);
  return { file, plan, data, owner_receipt: result.receipt };
}
