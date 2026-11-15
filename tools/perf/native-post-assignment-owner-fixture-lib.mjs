import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createNativeOwnerDispositionFixtureHost, createNativeOwnerDispositionFixtureAuthority } from './native-owner-disposition-fixture-lib.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { nativeOwnerDispositionPath, assertNativeOwnerDispositionRecord } from '../../src/core/workflow/native-owner-disposition.mjs';
import { nativeRetiredOwnerRelativePath } from '../../src/application/runtime/local-native-owner-retirement.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import { createHash } from 'node:crypto';

const script = fileURLToPath(import.meta.url), creator = fileURLToPath(new URL('./verify-agentic-process-execution-fixtures.mjs', import.meta.url));
// This is the controlled mixed-host fixture signing key, never data from JSON.
const readSigningKey = () => Buffer.alloc(32, 91);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const lastJSON = text => JSON.parse(text.trim().split(/\r?\n/).findLast(line => line.startsWith('{')));
const open = (data, plan, options = {}) => createNativeOwnerDispositionFixtureHost(data, plan, { ...options, readSigningKey });
function worker(args, expected = 0) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return lastJSON(result.stdout);
}
function tree(root) {
  const files = {}, directories = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name), rel = path.relative(root, file);
      if (entry.isSymbolicLink()) files[rel] = 'LINK:' + fs.readlinkSync(file);
      else if (entry.isDirectory()) { directories.push(rel); visit(file); }
      else files[rel] = hash(fs.readFileSync(file));
    }
  }
  visit(root); return { files, directories };
}
function immutable(data) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: data.root });
  return { native: artifacts.read('workflows/native-allocations/' + data.journal_id + '.json', { required: true }).content,
    dispatch: artifacts.read('workflows/native-dispatches/' + data.input.dispatchId + '.json', { required: true }).content,
    instance: artifacts.read('workflows/process-instances/' + data.configuration.instance_id + '.json', { required: true }).content,
    product: hash(fs.readFileSync(path.join(data.configuration.product_root, 'app.mjs'))),
    control: tree(data.configuration.control_root) };
}
async function produce(mode, home, scenario, held = false) {
  const file = path.join(home, 'fixture.json');
  const args = ['--native-post-assignment-create=' + mode, file, '--profile=' + scenario];
  if (!held) {
    const result = spawnSync(process.execPath, [creator, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return { file, data: read(file), child: null };
  }
  const child = fork(creator, [...args, '--hold'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const message = await Promise.race([once(child, 'message').then(([value]) => value),
    once(child, 'exit').then(([code]) => { throw Error('POST_ASSIGNMENT_CREATOR_EXIT_' + code + ':' + stderr + stdout); })]);
  assert.equal(message.ready, 'original_post_assignment_creator_active');
  return { file, data: read(file), child };
}

export async function verifyNativePostAssignmentOwnerFixture(mode) {
  assert.ok(['files', 'dual', 'db-only'].includes(mode));
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-post-owner-authority-'));
  const produced = await produce(mode, home, 'confirmed_return_failure', true), data = produced.data;
  assert.equal(data.proof_class, 'controlled-Native-RPC-and-supervisor-common-host-only');
  createNativeOwnerDispositionFixtureAuthority(data).ensureKey();
  const planFile = path.join(home, 'plan.json'), original = immutable(data);
  const activeBefore = tree(data.root);
  assert.equal(worker(['prepare', produced.file, planFile, '--expect=NATIVE_OWNER_DISPOSITION_ORIGINAL_ACTIVE']).status, 'EXPECTED_REFUSAL');
  assert.deepEqual(tree(data.root), activeBefore);
  const exit = once(produced.child, 'exit'); produced.child.send({ continue: true });
  assert.equal((await exit)[0], 0);
  const prepared = worker(['prepare', produced.file, planFile]); assert.equal(prepared.status, 'READONLY_POST_ASSIGNMENT_OWNER_PLAN');
  const plan = read(planFile);
  assert.equal(plan.contract_version, 'native-owner-disposition-plan.v2'); assert.equal(plan.profile, 'admitted_post_assignment');
  assert.equal(plan.initial_instance_sha256, data.initial_instance_sha256);
  assert.equal(plan.checkpoint_instance_sha256, data.checkpoint_instance_sha256);
  assert.notEqual(plan.initial_instance_sha256, plan.instance_sha256);
  assert.deepEqual(immutable(data), original);
  for (const [profile, expected] of [['missing', 'NATIVE_OWNER_DISPOSITION_AUTHORITY_UNAVAILABLE'], ['revoked', 'FIXTURE_NATIVE_PERMISSION_REVOKED']]) {
    const before = tree(data.root);
    assert.equal(worker(['apply', produced.file, planFile, '--profile=' + profile, '--expect=' + expected]).status, 'EXPECTED_REFUSAL');
    assert.deepEqual(tree(data.root), before);
  }
  const signer = createOperationJournalSigner(readSigningKey), forgedFile = path.join(home, 'foreign-plan.json');
  const { authentication, key_id, ...planBody } = plan;
  fs.writeFileSync(forgedFile, JSON.stringify(signer.seal({ ...planBody, post_assignment_sha256: H('foreign-post-assignment') })), { flag: 'wx' });
  const forgedBefore = tree(data.root);
  assert.equal(worker(['apply', produced.file, forgedFile, '--expect=NATIVE_OWNER_DISPOSITION_SUBJECT_CHANGED']).status, 'EXPECTED_REFUSAL');
  assert.deepEqual(tree(data.root), forgedBefore);
  const boundaries = ['native_disposition_before_intent', 'native_disposition_intent',
    'native_disposition_fence_acquired', 'native_disposition_lease_retained', 'native_disposition_lock_retired',
    'native_disposition_retirement_confirmed', 'native_disposition_fence_released', 'native_disposition_confirmed'];
  let competingRefused = false;
  if (mode === 'files') for (const boundary of boundaries) {
    if (boundary === 'native_disposition_intent') {
      const first = fork(script, ['apply', produced.file, planFile, '--hold=' + boundary, '--fault=' + boundary],
        { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
      let out = '', error = ''; first.stdout.on('data', b => { out += b; }); first.stderr.on('data', b => { error += b; });
      const ready = await Promise.race([once(first, 'message').then(([v]) => v), once(first, 'exit').then(([code]) => { throw Error('POST_OWNER_FIRST_RECOVERER_EXIT_' + code + ':' + error + out); })]);
      assert.equal(ready.ready, boundary);
      const beforeCompeting = tree(data.root);
      assert.equal(worker(['apply', produced.file, planFile, '--expect=NATIVE_OWNER_DISPOSITION_ACTIVE']).status, 'EXPECTED_REFUSAL');
      assert.deepEqual(tree(data.root), beforeCompeting); competingRefused = true;
      const ended = once(first, 'exit'); first.send({ continue: true }); assert.equal((await ended)[0], 76, error || out);
    } else {
      const interrupted = worker(['apply', produced.file, planFile, '--fault=' + boundary], 76);
      assert.equal(interrupted.status, 'INTERRUPTED_AT_OWNED_BOUNDARY');
    }
    assert.deepEqual(immutable(data), original);
  }
  const result = worker(['apply', produced.file, planFile]);
  assert.equal(result.status, mode === 'files' ? 'retained_confirmation' : 'owner_retirement_confirmed');
  assert.equal(result.written, mode !== 'files');
  const receipt = result.receipt;
  assert.equal(receipt.contract_version, 'native-owner-disposition-receipt.v2'); assert.equal(receipt.profile, plan.profile);
  assert.equal(receipt.post_assignment_sha256, plan.post_assignment_sha256);
  for (const field of ['complete_resource_closure', 'permits_resume', 'permits_native_renewal', 'accounting_reconciled', 'native_started']) assert.equal(receipt[field], false);
  const host = open(data, plan), record = host.readNativeOwnerDisposition(data.input.dispatchId);
  signer.verify(record); signer.verify(record.plan); signer.verify(record.receipt); assertNativeOwnerDispositionRecord(record);
  assert.equal(record.contract_version, 'native-owner-disposition-record.v2'); assert.equal(record.phase, 'confirmed');
  assert.equal(record.attempts.length, mode === 'files' ? 7 : 1);
  assert.equal(H(record.receipt), H(receipt));
  assert.deepEqual(immutable(data), original);
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: data.root });
  const beforeReplay = { owner: artifacts.read(nativeOwnerDispositionPath(data.input.dispatchId), { required: true }).content,
    retired: fs.readFileSync(path.join(data.root, nativeRetiredOwnerRelativePath(data.input.dispatchId))) };
  const replay = worker(['apply', produced.file, planFile]);
  assert.equal(replay.status, 'retained_confirmation'); assert.equal(replay.written, false); assert.equal(H(replay.receipt), H(receipt));
  assert.equal(artifacts.read(nativeOwnerDispositionPath(data.input.dispatchId), { required: true }).content, beforeReplay.owner);
  assert.deepEqual(fs.readFileSync(path.join(data.root, nativeRetiredOwnerRelativePath(data.input.dispatchId))), beforeReplay.retired);
  assert.deepEqual(immutable(data), original);
  assert.throws(() => host.inspect(data.configuration.instance_id), { code: 'STANDARD_PROCESS_NATIVE_ALLOCATION_ACTIVE' });
  assert.throws(() => host.prepareNativeAllocationReconciliation(data.configuration.instance_id, data.input), { code: 'NATIVE_RECONCILIATION_NO_ASSIGNMENT_REQUIRED' });
  if (mode === 'db-only') assert.equal(fs.existsSync(path.join(data.root, 'docs/audit', nativeOwnerDispositionPath(data.input.dispatchId))), false);
  const uncertainHome = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-post-owner-unknown-'));
  const uncertain = await produce(mode, uncertainHome, 'unknown_native_tree');
  createNativeOwnerDispositionFixtureAuthority(uncertain.data).ensureKey();
  const unknownBefore = tree(uncertain.data.root);
  assert.equal(worker(['prepare', uncertain.file, path.join(uncertainHome, 'plan.json'), '--expect=NATIVE_OWNER_DISPOSITION_UNPROVEN_EFFECTS']).status, 'EXPECTED_REFUSAL');
  assert.deepEqual(tree(uncertain.data.root), unknownBefore);
  const witness = { mode, root: data.root, authority_home: home, data_file: produced.file, plan_file: planFile,
    unknown_root: uncertain.data.root, unknown_data_file: uncertain.file,
    plan_sha256: H(plan), receipt_sha256: H(receipt), record_sha256: H(record), attempts: record.attempts.length,
    initial_instance_sha256: plan.initial_instance_sha256, current_instance_sha256: plan.instance_sha256,
    checkpoint_instance_sha256: plan.checkpoint_instance_sha256, original_phase: data.phase, first_failure: data.first_failure,
    original_consumption: data.consumption, one_original_allocation: true, one_original_response: true,
    immutable_native_dispatch_instance_product_and_control_files_unchanged: true,
    active_creator_and_missing_revoked_forged_and_unknown_closure_refused: true, cold_receipt_replay_no_writes: true,
    controlled_interruption_after_physical_retirement: mode === 'files',
    controlled_boundary_chain: mode === 'files' ? boundaries : [], competing_live_recoverer_refused: mode === 'files' ? competingRefused : null,
    operator_HMAC_and_canonical_physical_ports: 'actual', Native_RPC_and_Native_tree_proof: 'controlled',
    Native_model_calls: 0, new_Native_allocation: false, accounting_reconciled: false, workflow_resume: 'NOT_RUN',
    genuine_Native_installed_published_STANDARD_full_plan: 'NOT_QUALIFIED' };
  fs.writeFileSync(path.join(home, 'witness.json'), JSON.stringify(witness, null, 2) + String.fromCharCode(10), { flag: 'wx' });
  return witness;
}

async function main() {
  const [action, first, second, ...args] = process.argv.slice(2);
  const option = name => args.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3) ?? '';
  if (action === 'verify') { console.log(JSON.stringify(await verifyNativePostAssignmentOwnerFixture(first))); return; }
  const data = read(first);
  if (action === 'prepare') {
    try {
      const plan = open(data, null).prepareNativePostAssignmentOwnerDisposition(data.configuration.instance_id, data.input);
      assert.equal(option('expect'), ''); fs.writeFileSync(second, JSON.stringify(plan), { flag: 'wx' });
      console.log(JSON.stringify({ status: 'READONLY_POST_ASSIGNMENT_OWNER_PLAN', plan_sha256: H(plan) }));
    } catch (error) {
      if (error.code !== option('expect')) throw error;
      console.log(JSON.stringify({ status: 'EXPECTED_REFUSAL', code: error.code }));
    }
    return;
  }
  if (action !== 'apply') throw Error('POST_ASSIGNMENT_OWNER_FIXTURE_ACTION_INVALID');
  const plan = read(second), host = open(data, plan, { fault: option('fault'), hold: option('hold'), profile: option('profile') });
  try {
    const result = await host.applyNativeOwnerDisposition(plan, { write: true, expectedPlanSha256: H(plan) });
    assert.equal(option('expect'), ''); console.log(JSON.stringify(result));
  } catch (error) {
    if (error.code === 'FIXTURE_NATIVE_DISPOSITION_INTERRUPT') { console.log(JSON.stringify({ status: 'INTERRUPTED_AT_OWNED_BOUNDARY', boundary: option('fault') })); process.exitCode = 76; }
    else if (error.code === option('expect')) console.log(JSON.stringify({ status: 'EXPECTED_REFUSAL', code: error.code }));
    else throw error;
  }
}
if (process.argv[1] === script) main().catch(error => { console.error(error); process.exitCode = 1; });
