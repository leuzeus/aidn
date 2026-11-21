import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRetiredNativePostAssignmentOwnerFixture } from './native-post-assignment-owner-fixture-lib.mjs';
import { createNativeReconciliationProducerFixtureHost, issueNativeReconciliationFixtureSource } from './native-reconciliation-producer-fixture-lib.mjs';
import { createStandardHostAuthority } from '../../src/adapters/runtime/standard-host-authority.mjs';
import { createStandardWorkflowMixedHost } from '../../src/application/runtime/standard-workflow-mixed-composition.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { assertNativeAllocationJournal } from '../../src/core/workflow/native-allocation-journal.mjs';
import { assertNativeReconciliationRecord, nativeReconciliationId, nativeReconciliationPath, retainedNativeReconciliationReceipt } from '../../src/core/workflow/native-allocation-reconciliation-record.mjs';
import { nativeAllocationTotals, effectiveNativeEpochAuthorization } from '../../src/core/workflow/native-authorization-epoch.mjs';
import { nativeOwnerDispositionPath } from '../../src/core/workflow/native-owner-disposition.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const script = fileURLToPath(import.meta.url), read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
// Controlled common-host fixture key. JSON never supplies key bytes.
const readSigningKey = () => Buffer.alloc(32, 91), signer = createOperationJournalSigner(readSigningKey);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const operator = data => createStandardHostAuthority({ configuration: data.configuration,
  environment: { ...process.env, AIDN_STANDARD_HOST_HOME: data.operator_home } }, { useProvider: false });
const open = (data, preparation, options = {}) => createNativeReconciliationProducerFixtureHost(data, preparation, { ...options, readSigningKey });
const artifacts = data => createStandardWorkflowArtifacts({ targetRoot: data.root });
function worker(args, expectedExit = 0) {
  const result = spawnSync(process.execPath, [script, ...args], { windowsHide: true, encoding: 'utf8', maxBuffer: 16777216 });
  assert.equal(result.status, expectedExit, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).findLast(line => line.startsWith('{')));
}
function tree(root) {
  const rows = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name), relative = path.relative(root, file);
      if (entry.isSymbolicLink()) rows[relative] = 'LINK:' + fs.readlinkSync(file);
      else if (entry.isDirectory()) visit(file);
      else rows[relative] = sha(fs.readFileSync(file));
    }
  }
  visit(root); return rows;
}
function immutable(data) {
  const a = artifacts(data);
  return { dispatch: a.read('workflows/native-dispatches/' + data.input.dispatchId + '.json', { required: true }).sha256,
    instance: a.read('workflows/process-instances/' + data.configuration.instance_id + '.json', { required: true }).sha256,
    owner: a.read(nativeOwnerDispositionPath(data.input.dispatchId), { required: true }).sha256,
    product: tree(data.configuration.product_root), control: tree(data.configuration.control_root) };
}
async function make(mode) {
  const retired = await createRetiredNativePostAssignmentOwnerFixture(mode), pair = generateKeyPairSync('ed25519');
  const privateFile = path.join(retired.data.operator_home, 'fixture-independent-native-owner.pem');
  fs.writeFileSync(privateFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx' });
  fs.writeFileSync(path.join(retired.data.operator_home, 'principals.json'), JSON.stringify({ contract_version: 'standard-host-principals.v1', principals: [
    { authority_id: 'fixture_native_resource_owner', kinds: ['native-renewal'], public_key: pair.publicKey.export({ type: 'spki', format: 'pem' }) }] }));
  const data = { ...retired.data, resource_private_key: privateFile }, file = path.join(data.operator_home, 'post-reconciliation-fixture.json');
  fs.writeFileSync(file, JSON.stringify(data), { flag: 'wx' });
  const preparation = path.join(data.operator_home, 'post-reconciliation-preparation.json'); worker(['prepare', file, preparation]);
  return { data, file, preparation, retired };
}
function verify(item, expectedAttempts) {
  const data = item.data, a = artifacts(data), preparation = read(item.preparation), q = preparation.request;
  const native = assertNativeAllocationJournal(JSON.parse(a.read('workflows/native-allocations/' + q.journal_id + '.json', { required: true }).content));
  const record = assertNativeReconciliationRecord(JSON.parse(a.read(nativeReconciliationPath(nativeReconciliationId(q.journal_id, q.generation)), { required: true }).content));
  for (const value of [native, record, record.inventory, record.original_journal, q, q.post_assignment_assessment,
    q.post_assignment_assessment.base_assessment, retainedNativeReconciliationReceipt(record)]) signer.verify(value);
  assert.equal(native.contract_version, 'native-allocation-journal.v5'); assert.equal(record.contract_version, 'native-allocation-reconciliation-record.v2');
  assert.equal(record.phase, 'confirmed'); assert.equal(record.attempts.length, expectedAttempts);
  assert.equal(q.profile, 'admitted_post_assignment'); assert.equal(native.allocations.length, 1); assert.equal(native.allocations[0].phase, 'failed');
  assert.equal(native.allocations[0].consumption.responses_observed, 1); assert.deepEqual(native.allocations, record.original_journal.allocations);
  assert.deepEqual(native.origin_journal, record.original_journal); assert.equal(H(record.original_journal), q.journal_sha256);
  const receipt = retainedNativeReconciliationReceipt(record); assert.equal(H(native.reconciliations[0]), H(receipt));
  assert.equal(receipt.contract_version, 'native-allocation-reconciliation-receipt.v2');
  for (const key of ['permits_effects', 'permits_resume', 'permits_native_renewal', 'complete_resource_closure', 'native_started']) assert.equal(receipt[key], false);
  const host = open(data, preparation), current = host.inspect(data.configuration.instance_id);
  assert.equal(current.record.instance_sha256, q.instance_sha256);
  const inventory = host.prepareReconciliationInventory(q.instance_id, { expectedSha256: q.instance_sha256 });
  assert.equal(inventory.accounting.native_known, true); assert.equal(inventory.accounting.unresolved_native_allocations, 0);
  assert.equal(inventory.accounting.responses_observed_minimum, 1);
  assert.equal(inventory.accounting.storage_debit_bytes_minimum, receipt.grant.consumption.storage_debit_bytes);
  const row = inventory.resources.find(value => value.ref === 'native:' + q.journal_id + '/' + q.generation);
  assert.equal(row.details.phase, 'failed'); assert.equal(row.details.reconciliation_receipt_sha256, H(receipt));
  assert.deepEqual(row.details.consumption, record.original_journal.allocations[0].consumption);
  assert.ok(receipt.grant.consumption.storage_debit_bytes >= q.minimum_consumption.storage_debit_bytes);
  assert.deepEqual(receipt.grant.consumption.response_sha256, q.minimum_consumption.response_sha256);
  assert.equal(nativeAllocationTotals(native.allocations).known, false); assert.equal(nativeAllocationTotals(native.allocations, native.reconciliations).known, true);
  assert.equal(a.resourceFence().read().record.state, 'released');
  if (data.mode === 'db-only') assert.equal(fs.existsSync(path.join(data.root, 'docs/audit', nativeReconciliationPath(record.reconciliation_id))), false);
  return { native, record, receipt };
}
async function freshEpoch(item) {
  const data = item.data, source = operator(data).nativeAuthorizationSource;
  const host = createStandardWorkflowMixedHost({ configuration: data.configuration, readSigningKey,
    environment: { ...process.env, AIDN_STANDARD_HOST_HOME: data.operator_home },
    authorize: async () => { throw Error('UNEXPECTED_PRODUCT_OPERATION'); }, nativeAuthorizationSource: source });
  const before = host.inspectAllocations(), request = host.prepareNativeAuthorizationEpoch();
  assert.equal(request.contract_version, 'native-authorization-epoch-request.v2'); assert.equal(request.next_generation, 2);
  assert.equal(request.consumption.responses, 1); assert.ok(request.resources.some(row => row.kind === 'native_scope'));
  assert.ok(request.resources.some(row => row.kind === 'native_session'));
  const time = Date.now(), ref = 'fixture-post-assignment-new-epoch';
  const grant = { contract_version: 'native-authorization-epoch-grant.v1', authority_id: 'fixture_native_resource_owner', source_event_id: randomUUID(),
    request_sha256: H(request), authorization: { approved: true, model_allowed: true, configuration_sha256: request.configuration_sha256,
      authorized_at_ms: time, global_deadline_ms: time + 600000, workflow_deadline_ms: time + 600000, max_turn_ms: 60000,
      max_responses: 3, max_bytes: Math.max(8388608, request.consumption.bytes + 1048576) },
    closure: { contract_version: 'native-resource-closure.v1', request_sha256: H(request), inventory_sha256: H(request.resources), observed_at_ms: time,
      complete: true, active_resources: 0, evidence_class: 'fixture', resources: request.resources.map(resource => ({ resource_sha256: H(resource), state: 'closed',
        evidence_refs: [{ ref: 'fixture:synthetic-current-native-scope-closure', sha256: H(resource) }] })) },
    evidence_refs: [{ ref: 'fixture:synthetic-separate-finite-epoch-approval', sha256: H(request) }] };
  const envelope = { contract_version: 'standard-host-source.v1', kind: 'native-renewal', authority_id: grant.authority_id,
    source_ref: ref, subject_sha256: H(request), payload: grant, issued_at_ms: time, expires_at_ms: time + 600000 };
  const file = path.join(data.operator_home, 'inbox', ref + '.json');
  fs.writeFileSync(file, JSON.stringify({ ...envelope, signature: sign(null, Buffer.from(H(envelope)), fs.readFileSync(data.resource_private_key)).toString('base64') }));
  const result = await host.activateNativeAuthorizationEpoch(request, { write: true, sourceRef: ref });
  assert.equal(result.status, 'authorized'); assert.equal(result.native_started, false); assert.equal(result.journal_phase, 'failed');
  const after = host.inspectAllocations(); assert.equal(after.contract_version, 'native-allocation-journal.v5');
  assert.deepEqual(after.allocations, before.allocations); assert.deepEqual(after.reconciliations, before.reconciliations); assert.deepEqual(after.origin_journal, before.origin_journal);
  const effective = effectiveNativeEpochAuthorization(after, grant.authorization);
  assert.equal(effective.max_responses, grant.authorization.max_responses - request.consumption.responses);
  assert.equal(effective.max_bytes, grant.authorization.max_bytes - request.consumption.bytes);
  const saved = H(artifacts(data).observeInventory()), replay = await host.activateNativeAuthorizationEpoch(request, { write: false });
  assert.equal(replay.status, 'retained'); assert.equal(replay.written, false); assert.equal(H(artifacts(data).observeInventory()), saved);
  return { request_version: request.contract_version, epoch: result.epoch, original_failed_phase_preserved: true,
    known_responses: request.consumption.responses, known_bytes: request.consumption.bytes, effective_responses: effective.max_responses,
    current_native_scope_included: true, new_allocations: 0, actual_source_Ed25519: true, consent_and_closure: 'SYNTHETIC_FIXTURE' };
}
export async function verifyNativePostAssignmentReconciliationFixture(mode) {
  assert.ok(['files', 'dual', 'db-only'].includes(mode));
  const item = await make(mode), data = item.data, preparation = read(item.preparation), q = preparation.request;
  const original = immutable(data), nativeBefore = artifacts(data).read('workflows/native-allocations/' + q.journal_id + '.json', { required: true }).content;
  assert.equal(q.contract_version, 'native-allocation-reconciliation-request.v2'); assert.equal(q.minimum_consumption.responses_observed, 1);
  assert.notEqual(q.initial_instance_sha256, q.instance_sha256); assert.ok(q.resources.some(row => row.kind === 'native_scope'));
  assert.throws(() => open(data, null).prepareNativeAllocationReconciliation(data.configuration.instance_id, data.input), { code: 'NATIVE_RECONCILIATION_NO_ASSIGNMENT_REQUIRED' });
  for (const [profile, code] of [['missing-operator', 'NATIVE_RECONCILIATION_SOURCE_REQUIRED'], ['missing-resource', 'NATIVE_RECONCILIATION_RESOURCE_SOURCE_REQUIRED'],
    ['source-storage-refund', 'NATIVE_RECONCILIATION_GRANT_UNBOUND'], ['source-response-refund', 'NATIVE_RECONCILIATION_GRANT_INVALID'],
    ['source-missing-scope', 'NATIVE_RECONCILIATION_GRANT_INVALID'], ['source-revoked-after-verification', 'STANDARD_HOST_SOURCE_NOT_AUTHENTICATED']]) {
    const before = H(artifacts(data).observeInventory());
    worker(['apply', item.file, item.preparation, '--profile=' + profile, '--expect=' + code]);
    assert.equal(H(artifacts(data).observeInventory()), before); assert.deepEqual(immutable(data), original);
    assert.equal(artifacts(data).read('workflows/native-allocations/' + q.journal_id + '.json').content, nativeBefore);
  }
  const forgedFile = path.join(data.operator_home, 'foreign-post-checkpoint-resources.json'), { key_id, authentication, ...requestBody } = q;
  fs.writeFileSync(forgedFile, JSON.stringify({ request: signer.seal({ ...requestBody, checkpoint_resources_sha256: H('foreign') }), inventory: preparation.inventory }));
  const beforeForged = H(artifacts(data).observeInventory());
  worker(['apply', item.file, forgedFile, '--expect=NATIVE_RECONCILIATION_POST_ASSIGNMENT_CHANGED']);
  assert.equal(H(artifacts(data).observeInventory()), beforeForged);
  let committedReceipt = null;
  if (mode === 'files') {
    const interrupted = worker(['apply', item.file, item.preparation, '--fault=native_reconciliation_journal_cas'], 77);
    assert.equal(interrupted.status, 'CONTROLLED_POST_RECONCILIATION_CAS_INTERRUPT');
    const committed = JSON.parse(artifacts(data).read('workflows/native-allocations/' + q.journal_id + '.json').content);
    committedReceipt = H(committed.reconciliations[0]); assert.equal(committed.contract_version, 'native-allocation-journal.v5');
    const sourceFile = path.join(data.operator_home, 'inbox', 'fixture-post-accounting.json');
    fs.writeFileSync(path.join(data.operator_home, 'post-CAS-original-signed-source.json'), fs.readFileSync(sourceFile), { flag: 'wx' });
    fs.unlinkSync(sourceFile);
  }
  const result = worker(['apply', item.file, item.preparation, ...(mode === 'files' ? ['--keep-source', '--profile=missing-resource'] : [])]);
  assert.equal(result.status, 'allocation_reconciliation_confirmed'); assert.equal(result.native_started, false);
  const actual = verify(item, mode === 'files' ? 2 : 1);
  if (committedReceipt) assert.equal(H(actual.receipt), committedReceipt);
  assert.deepEqual(immutable(data), original);
  const beforeReplay = H(artifacts(data).observeInventory()), replay = worker(['apply', item.file, item.preparation, '--keep-source', '--profile=missing-resource']);
  assert.equal(replay.status, 'retained_confirmation'); assert.equal(replay.written, false); assert.equal(H(replay.receipt), H(actual.receipt));
  assert.equal(H(artifacts(data).observeInventory()), beforeReplay); assert.deepEqual(immutable(data), original);
  const epoch = await freshEpoch(item); assert.deepEqual(immutable(data), original);
  const witness = { mode, root: data.root, data_file: item.file, preparation_file: item.preparation,
    record_sha256: H(actual.record), receipt_sha256: H(actual.receipt), attempts: actual.record.attempts.length,
    original_failed_phase_and_nonrefunded_consumption_preserved: true, original_instance_dispatch_owner_product_control_unchanged: true,
    actual_local_operator_HMAC_and_independent_source_Ed25519: true, refunded_or_incomplete_or_revoked_source_refused: true,
    source_revoked_after_verification_refused_before_intent: true, cold_after_CAS_without_recapturing_resource_source: mode === 'files',
    one_original_Native_allocation: true, original_Native_responses: 1, original_minimum_bytes: q.minimum_consumption.storage_debit_bytes,
    final_accounted_bytes: actual.receipt.grant.consumption.storage_debit_bytes, epoch, Native_transport_and_OS_closure: 'CONTROLLED',
    Native_model_calls: 0, new_Native_allocations: 0, workflow_resume: 'NOT_RUN', genuine_Native_Human_installed_public_v2_full_plan: 'NOT_QUALIFIED' };
  fs.writeFileSync(path.join(data.operator_home, 'post-reconciliation-witness.json'), JSON.stringify(witness, null, 2) + '\n', { flag: 'wx' });
  return witness;
}
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  try {
    const [action, first, second, ...options] = process.argv.slice(2), option = name => options.find(value => value.startsWith(name + '='))?.slice(name.length + 1) ?? '';
    if (action === 'verify') console.log(JSON.stringify(await verifyNativePostAssignmentReconciliationFixture(first)));
    else {
      const data = read(first);
      if (action === 'prepare') {
        const prepared = open(data, null).prepareNativePostAssignmentAllocationReconciliation(data.configuration.instance_id, data.input);
        fs.writeFileSync(second, JSON.stringify(prepared), { flag: 'wx' }); console.log(JSON.stringify({ status: 'READONLY_POST_ASSIGNMENT_RECONCILIATION', request_sha256: H(prepared.request) }));
      } else {
        assert.equal(action, 'apply'); const prepared = read(second), profile = option('--profile');
        if (!options.includes('--keep-source')) issueNativeReconciliationFixtureSource(data, prepared, 'fixture-post-accounting', profile);
        try {
          const result = await open(data, prepared, { profile, fault: option('--fault') }).applyNativeAllocationReconciliation(prepared,
            { write: true, expectedRequestSha256: H(prepared.request), sourceRef: 'fixture-post-accounting' });
          assert.equal(option('--expect'), ''); console.log(JSON.stringify(result));
        } catch (error) {
          if (error.code === 'FIXTURE_RECONCILIATION_INTERRUPT') { console.log(JSON.stringify({ status: 'CONTROLLED_POST_RECONCILIATION_CAS_INTERRUPT' })); process.exitCode = 77; }
          else if (error.code === option('--expect')) console.log(JSON.stringify({ status: 'EXPECTED_REFUSAL', code: error.code }));
          else throw error;
        }
      }
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
}
