import { createNativeReconciliationHistoryReader } from '../../src/application/runtime/native-reconciliation-history.mjs';
import { createNativeAuthorizationEpochs } from '../../src/application/runtime/native-authorization-epochs.mjs';
import { createNativeDispatchProvenance } from '../../src/application/runtime/native-dispatch-provenance.mjs';
import { createNativeAllocationJournalStore } from '../../src/adapters/runtime/native-allocation-journal-store.mjs';
import { readNativeAllocationCheckpoint, readNativeAllocationHistory } from '../../src/application/runtime/native-allocation-evidence.mjs';
import { createProcessControlInboxStore } from '../../src/adapters/runtime/process-control-inbox-store.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRetiredNativeOwnerReconciliationFixture } from './native-owner-disposition-fixture-lib.mjs';
import { createStandardHostAuthority } from '../../src/adapters/runtime/standard-host-authority.mjs';
import { createStandardProcessAuthority } from '../../src/application/runtime/standard-process-authority.mjs';
import { createStandardWorkflowOperationHost } from '../../src/application/runtime/standard-workflow-operation-host.mjs';
import { readAgenticProductSnapshot } from '../../src/application/runtime/agentic-process-execution-composition.mjs';
import { createStandardWorkflowArtifacts, STANDARD_ARTIFACT_MAX_BYTES, STANDARD_ARTIFACT_INVENTORY_MAX_BYTES } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { assertNativeReconciliationRecord, nativeReconciliationId, nativeReconciliationPath, retainedNativeReconciliationReceipt } from '../../src/core/workflow/native-allocation-reconciliation-record.mjs';
import { assertNativeAllocationJournal } from '../../src/core/workflow/native-allocation-journal.mjs';
import { nativeAllocationTotals } from '../../src/core/workflow/native-authorization-epoch.mjs';
import { isNativePostAssignmentReconciliation } from '../../src/core/workflow/native-allocation-reconciliation.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const script = fileURLToPath(import.meta.url), key = () => Buffer.alloc(32, 73);
const lastJSON = text => JSON.parse(text.trim().split(/\r?\n/).findLast(row => row.startsWith('{')));
function worker(args, expectedExit = 0) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, expectedExit, result.stderr || result.stdout); return lastJSON(result.stdout);
}
const operator = data => createStandardHostAuthority({ configuration: data.configuration,
  environment: { ...process.env, AIDN_STANDARD_HOST_HOME: data.operator_home } }, { useProvider: false });
function fixtureOperator(data, q, profile) {
  const authority = operator(data), permit = q ? { action: 'native_allocation_reconcile', key_id: authority.keyId(), trust_sha256: authority.trustSha(),
    action_sha256: H({ fixture_exact_reconciliation: H(q) }), subject_sha256: H(q), scope_id: q.scope_id, instance_sha256: q.instance_sha256 } : null;
  const current = ({ request, grant }) => {
    if (profile === 'revoked-operator') throw Object.assign(Error('FIXTURE_RECONCILIATION_PERMISSION_REVOKED'), { code: 'FIXTURE_RECONCILIATION_PERMISSION_REVOKED' });
    authority.verifyNativeReconciliation(request, grant, permit);
  };
  return { authorize({ request }) {
    const grant = authority.authorizeNativeReconciliation(request, profile === 'foreign-operator-trust' ? { ...permit, trust_sha256: H('foreign') } : permit);
    if (profile === 'expired-operator') return { ...grant, contract_version: 'process-disposition-authorization-grant.v1', observed_at_ms: 1, expires_at_ms: 2 };
    if (profile === 'tampered-operator') return { ...grant, grant_sha256: H('tampered') };
    return grant;
  }, verify(input) { current(input); return { outcome: 'verified', authority_id: input.grant.authority_id, request_sha256: H(input.request), grant_sha256: H(input.grant) }; }, assertCurrent: current };
}
function issueFixtureSource(data, preparation, sourceRef, profile) {
  const q = preparation.request, post = isNativePostAssignmentReconciliation(q), artifacts = createStandardWorkflowArtifacts({ targetRoot: data.root });
  const original = JSON.parse(artifacts.read('workflows/native-allocations/' + q.journal_id + '.json', { required: true }).content);
  // This is an independent Ed25519 transport fixture with measured local file
  // bytes. Native/session/OS closure remains explicitly synthetic.
  const entry = original.allocations[q.generation - 1], bytes = fs.statSync(entry.checkpoint.path).size + fs.statSync(entry.closure_ref.path).size;
  const grant = { contract_version: post ? 'native-allocation-reconciliation-grant.v2' : 'native-allocation-reconciliation-grant.v1',
    ...(post ? { profile: q.profile, post_assignment_sha256: q.post_assignment_sha256 } : {}),
    authority_id: 'fixture_native_resource_owner', source_event_id: randomUUID(), request_sha256: H(q),
    consumption: { ...structuredClone(q.minimum_consumption), storage_debit_bytes: Math.max(bytes, q.minimum_consumption.storage_debit_bytes) },
    closure: { contract_version: 'native-resource-closure.v1', request_sha256: H(q), inventory_sha256: H(q.resources), observed_at_ms: Date.now(),
      complete: true, active_resources: 0, evidence_class: 'fixture', resources: q.resources.map(resource => ({ resource_sha256: H(resource), state: 'closed',
        evidence_refs: [{ ref: 'fixture:synthetic-independent-native-discovery', sha256: H(resource) }] })) },
    evidence_refs: [{ ref: 'fixture:measured-checkpoint-and-closure-bytes', sha256: H({ bytes, checkpoint: entry.checkpoint.sha256, closure: entry.closure_ref.sha256 }) }] };
  if (profile === 'source-storage-refund') grant.consumption.storage_debit_bytes = q.minimum_consumption.storage_debit_bytes - 1;
  if (profile === 'source-response-refund') { grant.consumption.responses_observed = 0; grant.consumption.response_sha256 = []; }
  if (profile === 'source-missing-scope') grant.closure.resources = grant.closure.resources.filter(row => row.resource_sha256 !== H(q.resources.find(value => value.kind === 'native_scope')));
  if (profile === 'source-open-resource') grant.closure.resources[0].state = 'active';
  if (profile === 'source-foreign-principal') grant.authority_id = 'unregistered_resource_owner';
  const now = Date.now(), envelope = { contract_version: 'standard-host-source.v1', kind: 'native-renewal', authority_id: grant.authority_id,
    source_ref: sourceRef, subject_sha256: profile === 'source-foreign-subject' ? H('other') : H(q), payload: grant,
    issued_at_ms: profile === 'source-expired' ? 1 : now, expires_at_ms: profile === 'source-expired' ? 2 : now + 600000 };
  const pem = fs.readFileSync(data.resource_private_key);
  const signed = { ...envelope, signature: sign(null, Buffer.from(H(envelope)), pem).toString('base64') };
  if (profile === 'source-tampered-signature') signed.signature = (signed.signature[0] === 'A' ? 'B' : 'A') + signed.signature.slice(1);
  const inbox = path.join(data.operator_home, 'inbox'); fs.mkdirSync(inbox, { recursive: true });
  fs.writeFileSync(path.join(inbox, sourceRef + '.json'), JSON.stringify(signed));
  return grant;
}
function processAuthority(data, readSigningKey = key) {
  const product = () => readAgenticProductSnapshot(data.configuration.product_root, data.configuration.product_files);
  return createStandardProcessAuthority({ configuration: data.configuration, model: data.model, readSigningKey,
    readProductSnapshot: product, readProductSha256: () => H(product()) });
}
function open(data, preparation, { profile = '', fault = '', hold = '', readSigningKey = key } = {}) {
  const authority = processAuthority(data, readSigningKey);
  const nativeSource = operator(data).nativeAuthorizationSource;
  return createStandardWorkflowOperationHost({ targetRoot: data.root, model: data.model, readSigningKey,
    authorize: async () => { throw Error('UNEXPECTED_OPERATION_AUTHORIZATION'); }, processAuthority: authority,
    reconciliationConfiguration: data.configuration, nativeReconciliationSource: profile === 'missing-operator' ? null : fixtureOperator(data, preparation?.request, profile),
    nativeAuthorizationSource: profile === 'missing-resource' ? null : {
      read: input => profile === 'source-timeout' ? new Promise(() => {}) : nativeSource.read(input),
      verify: input => {
        if (profile === 'source-unverified') return { outcome: 'denied' };
        if (profile === 'source-revoked-after-verification') {
          const verified = nativeSource.verify(input), file = path.join(data.operator_home, 'inbox', input.sourceRef + '.json');
          const envelope = JSON.parse(fs.readFileSync(file, 'utf8')); envelope.signature = Buffer.alloc(64).toString('base64');
          fs.writeFileSync(file, JSON.stringify(envelope)); return verified;
        }
        if (profile !== 'source-revoked') return nativeSource.verify(input);
        const registry = path.join(data.operator_home, 'principals.json'), before = fs.readFileSync(registry);
        try { fs.writeFileSync(registry, JSON.stringify({ contract_version: 'standard-host-principals.v1', principals: [] })); return nativeSource.verify(input); }
        finally { fs.writeFileSync(registry, before); }
      }, assertCurrent: nativeSource.assertCurrent,
    } }, { async nativeReconciliationBoundary(name) {
      if (name === hold) { process.send?.({ ready: name }); await new Promise(resolve => process.once('message', resolve)); }
      if (name === fault) throw Object.assign(Error('FIXTURE_RECONCILIATION_INTERRUPT'), { code: 'FIXTURE_RECONCILIATION_INTERRUPT' });
    } });
}
export const createNativeReconciliationProducerFixtureHost = (data, preparation, options) => open(data, preparation, options);
export const issueNativeReconciliationFixtureSource = (data, preparation, sourceRef, profile = '') => issueFixtureSource(data, preparation, sourceRef, profile);

function make(mode, root, name) {
  const owner = createRetiredNativeOwnerReconciliationFixture(mode, root, name), pair = generateKeyPairSync('ed25519');
  const issuer = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-reconciliation-issuer-'));
  const privateFile = path.join(issuer, 'fixture-native-owner.pem'); fs.writeFileSync(privateFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(path.join(owner.data.operator_home, 'principals.json'), JSON.stringify({ contract_version: 'standard-host-principals.v1', principals: [
    { authority_id: 'fixture_native_resource_owner', kinds: ['native-renewal'], public_key: pair.publicKey.export({ type: 'spki', format: 'pem' }) }] }));
  const data = { ...owner.data, resource_private_key: privateFile }, file = path.join(root, name + '-fixture.json'), preparation = path.join(root, name + '-preparation.json');
  fs.writeFileSync(file, JSON.stringify(data), { flag: 'wx' }); worker(['prepare', file, preparation]);
  return { file, preparation, data };
}
async function main() {
  const [action, first, second, ...options] = process.argv.slice(2), option = name => options.find(value => value.startsWith(name + '='))?.slice(name.length + 1) ?? '';
  if (action === 'verify') { console.log(JSON.stringify(await verifyNativeReconciliationProducerFixture(first, { boundaries: process.argv.includes('--boundaries') }))); return; }
  const data = JSON.parse(fs.readFileSync(first, 'utf8'));
  if (action === 'prepare') { const prepared = open(data, null).prepareNativeAllocationReconciliation(data.configuration.instance_id, data.input);
    fs.writeFileSync(second, JSON.stringify(prepared), { flag: 'wx' }); console.log(JSON.stringify({ status: 'READONLY_RECONCILIATION_PREPARATION', request_sha256: H(prepared.request) })); return; }
  if (action !== 'apply') throw Error('NATIVE_RECONCILIATION_FIXTURE_ACTION_INVALID');
  const preparation = JSON.parse(fs.readFileSync(second, 'utf8')), profile = option('profile'), sourceRef = option('source') || 'fixture-proof';
  if (profile === 'old-preparation') { const realNow = Date.now; Date.now = () => realNow() + 8 * 86400000; }
  issueFixtureSource(data, preparation, sourceRef, profile);
  const host = open(data, preparation, { profile, fault: option('fault'), hold: option('hold') });
  try {
    const result = await host.applyNativeAllocationReconciliation(preparation, { write: true, expectedRequestSha256: H(preparation.request), sourceRef });
    assert.equal(option('expect'), ''); console.log(JSON.stringify(result));
  } catch (error) {
    if (error.code === 'FIXTURE_RECONCILIATION_INTERRUPT') { console.log(JSON.stringify({ status: 'INTERRUPTED_AT_OWNED_BOUNDARY', boundary: option('fault'), code: error.code })); process.exitCode = 77; }
    else if (error.code === option('expect')) console.log(JSON.stringify({ status: 'EXPECTED_REFUSAL', code: error.code })); else throw error;
  }
}
function verify(item) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: item.data.root }), nativeRows = artifacts.observeInventory().rows;
  const native = assertNativeAllocationJournal(JSON.parse(nativeRows.find(row => row.path.startsWith('workflows/native-allocations/')).content));
  assert.equal(native.contract_version, 'native-allocation-journal.v4');
  const preparation = JSON.parse(fs.readFileSync(item.preparation, 'utf8')), q = preparation.request, id = nativeReconciliationId(q.journal_id, q.generation);
  const record = assertNativeReconciliationRecord(JSON.parse(artifacts.read(nativeReconciliationPath(id), { required: true }).content)), signer = createOperationJournalSigner(key);
  for (const value of [record, record.request, record.inventory, record.original_journal, native, retainedNativeReconciliationReceipt(record)]) signer.verify(value);
  assert.equal(record.phase, 'confirmed'); assert.equal(H(record.original_journal), q.journal_sha256);
  for (const [relative, expected] of [['docs/audit/' + nativeReconciliationPath(id), 0],
    ['docs/audit/workflows/native-allocation-reconciliations-adjacent/business-plan.md', 1]]) {
    const ignored = spawnSync('git', ['--no-optional-locks', 'check-ignore', '--quiet', '--', relative], { cwd: item.data.root, encoding: 'utf8', windowsHide: true });
    assert.equal(ignored.status, expected, ignored.stderr);
  }
  const activeHost = open(item.data, preparation), current = activeHost.inspect(item.data.configuration.instance_id);
  assert.equal(current.record.instance_sha256, q.instance_sha256);
  const inventory = activeHost.prepareReconciliationInventory(q.instance_id, { expectedSha256: q.instance_sha256 });
  assert.equal(inventory.accounting.native_known, true); assert.equal(inventory.accounting.unresolved_native_allocations, 0);
  assert.equal(inventory.accounting.storage_debit_bytes_minimum, native.reconciliations[0].grant.consumption.storage_debit_bytes);
  const allocationRow = inventory.resources.find(row => row.ref === 'native:' + q.journal_id + '/' + q.generation);
  assert.equal(allocationRow.details.phase, 'failed'); assert.equal(allocationRow.details.consumption.storage_debit_bytes, record.original_journal.allocations[0].consumption.storage_debit_bytes);
  assert.equal(allocationRow.details.reconciliation_receipt_sha256, H(native.reconciliations[0]));
  assert.equal(inventory.complete_resource_closure, false); assert.equal(inventory.permits_effects, false);
  assert.equal(H(record.original_journal.allocations), H(native.allocations)); assert.equal(native.allocations[0].phase, 'failed');
  assert.deepEqual(native.origin_journal, record.original_journal);
  assert.equal(artifacts.read('workflows/native-dispatches/' + q.dispatch_id + '.json').sha256, item.data.original_dispatch_sha256);
  assert.equal(nativeAllocationTotals(native.allocations).known, false);
  assert.equal(nativeAllocationTotals(native.allocations, native.reconciliations).known, true);
  assert.ok(native.reconciliations[0].grant.consumption.storage_debit_bytes >= native.allocations[0].consumption.storage_debit_bytes);
  assert.equal(native.reconciliations[0].permits_native_renewal, false); assert.equal(native.reconciliations[0].permits_resume, false);
  assert.equal(native.reconciliations[0].complete_resource_closure, false); assert.equal(artifacts.resourceFence().read().record.state, 'released');
  assert.equal(fs.existsSync(path.join(item.data.root, 'docs/audit', nativeReconciliationPath(id))), item.data.mode !== 'db-only');
  const before = H(artifacts.observeInventory()), replay = worker(['apply', item.file, item.preparation]);
  assert.equal(replay.status, 'retained_confirmation'); assert.equal(H(replay.receipt), H(native.reconciliations[0])); assert.equal(H(artifacts.observeInventory()), before);
  return { record, native, artifacts };
}
export async function verifyNativeReconciliationProducerFixture(mode, { boundaries = false } = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-reconciliation-proof-')), cases = [];
  const normal = make(mode, root, 'ordinary');
  for (const [profile, code] of [['missing-operator', 'NATIVE_RECONCILIATION_SOURCE_REQUIRED'], ['missing-resource', 'NATIVE_RECONCILIATION_RESOURCE_SOURCE_REQUIRED'],
    ['expired-operator', 'NATIVE_RECONCILIATION_OPERATOR_REQUIRED'], ['revoked-operator', 'FIXTURE_RECONCILIATION_PERMISSION_REVOKED'],
    ['foreign-operator-trust', 'STANDARD_HOST_EXACT_NATIVE_RECONCILIATION_REQUIRED'], ['tampered-operator', 'STANDARD_HOST_NATIVE_RECONCILIATION_GRANT_CHANGED'],
    ['source-unverified', 'NATIVE_RECONCILIATION_SOURCE_NOT_AUTHENTICATED'], ['source-revoked', 'STANDARD_HOST_SOURCE_NOT_AUTHENTICATED'],
    ['source-tampered-signature', 'STANDARD_HOST_SOURCE_NOT_AUTHENTICATED'], ['source-foreign-principal', 'STANDARD_HOST_SOURCE_NOT_AUTHENTICATED'],
    ['source-expired', 'STANDARD_HOST_SOURCE_INVALID'],
    ['source-foreign-subject', 'STANDARD_HOST_SOURCE_INVALID'], ['source-storage-refund', 'NATIVE_RECONCILIATION_GRANT_UNBOUND'],
    ['source-open-resource', 'NATIVE_RECONCILIATION_GRANT_INVALID'], ['source-timeout', 'NATIVE_RECONCILIATION_SOURCE_TIMEOUT']]) {
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: normal.data.root }), before = H(artifacts.observeInventory());
    worker(['apply', normal.file, normal.preparation, 'profile=' + profile, 'expect=' + code]); assert.equal(H(artifacts.observeInventory()), before);
  }
  const result = worker(['apply', normal.file, normal.preparation]); assert.equal(result.status, 'allocation_reconciliation_confirmed');
  verify(normal); cases.push({ name: 'normal-retained-failure-final-debit-and-cold-replay', root: normal.data.root, actual_dead_creator: true, independent_signature: 'REAL_ED25519', source_closure: 'SYNTHETIC' });
  cases.push(await verifyFreshEpochAfterReconciliation(normal));
  if (boundaries) {
    const aged = make(mode, root, 'old-preparation'); worker(['apply', aged.file, aged.preparation, 'profile=old-preparation']); verify(aged);
    cases.push({ name: 'old-preparation-new-current-source', root: aged.data.root, injected_clock_offset_days: 8, Native_calls: 0 });
  }
  if (boundaries) for (const point of ['native_reconciliation_before_intent', 'native_reconciliation_intent', 'native_reconciliation_fence_acquired',
    'native_reconciliation_lease_retained', 'native_reconciliation_journal_cas', 'native_reconciliation_commit_retained', 'native_reconciliation_fence_released', 'native_reconciliation_confirmed']) {
    const item = make(mode, root, point); worker(['apply', item.file, item.preparation, 'fault=' + point], 77);
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: item.data.root }), current = JSON.parse(artifacts.observeInventory().rows.find(row => row.path.startsWith('workflows/native-allocations/')).content);
    const prior = current.contract_version === 'native-allocation-journal.v4' ? H(current.reconciliations.at(-1)) : null;
    if (prior !== null && point !== 'native_reconciliation_confirmed') {
      const prepared = JSON.parse(fs.readFileSync(item.preparation, 'utf8')), pendingHost = open(item.data, prepared);
      assert.throws(() => pendingHost.inspect(item.data.configuration.instance_id), /STANDARD_PROCESS_NATIVE_ALLOCATION_ACTIVE/);
      const pendingInventory = pendingHost.prepareReconciliationInventory(prepared.request.instance_id, { expectedSha256: prepared.request.instance_sha256 });
      assert.equal(pendingInventory.accounting.native_known, false);
      assert.equal(pendingInventory.accounting.unresolved_native_allocations, 1);
    }
    worker(['apply', item.file, item.preparation]); const after = verify(item);
    if (prior !== null) assert.equal(H(after.native.reconciliations.at(-1)), prior);
    cases.push({ name: point, root: item.data.root, actual_exited_repreneur: true, original_failure_preserved: true, prior_receipt_immutable: true });
  }
  if (boundaries && mode === 'files') cases.push(verifyCapacityBeforeIntent(root));
  if (boundaries) {
    const competing = make(mode, root, 'competing'), active = fork(script, ['apply', competing.file, competing.preparation,
      'hold=native_reconciliation_intent', 'source=competing-winner'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stdout = '', stderr = ''; active.stdout.on('data', value => { stdout += value; }); active.stderr.on('data', value => { stderr += value; });
    const completion = once(active, 'exit'); let failure;
    try {
      await Promise.race([once(active, 'message'), completion.then(([code]) => { throw Error('REPRENEUR_EXIT_BEFORE_BOUNDARY:' + code + ':' + stderr); })]);
      worker(['apply', competing.file, competing.preparation, 'source=competing-loser', 'expect=NATIVE_RECONCILIATION_REPRENEUR_ACTIVE']);
    } catch (error) { failure = error; }
    finally { if (active.connected) active.send('continue'); }
    const [code] = await completion; assert.equal(code, 0, stderr); assert.equal(lastJSON(stdout).status, 'allocation_reconciliation_confirmed');
    if (failure) throw failure;
    const result = verify(competing); assert.equal(result.record.attempts.length, 1);
    assert.equal(result.native.revision, result.record.original_journal.revision + 1);
    cases.push({ name: 'two-live-repreneurs-one-intent-one-native-journal-CAS', root: competing.data.root, winning_attempts: 1, Native_calls: 0 });
  }
  return { mode, root, cases, canonical_and_physical_ports: 'REAL', operator_HMAC: 'REAL_PROTECTED_HOST', independent_source_signature: 'REAL_ED25519_PROTECTED_PRINCIPAL',
    grant_and_native_closure: 'SYNTHETIC_FIXTURE', measured_local_debit: true, Native_calls: 0, workflow_resume: false, full_standard: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  try { await main(); } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (process.connected) process.disconnect(); }
}

async function verifyFreshEpochAfterReconciliation(item) {
  const preparation = JSON.parse(fs.readFileSync(item.preparation, 'utf8')), q = preparation.request, data = item.data;
  const signer = createOperationJournalSigner(key), options = { targetRoot: data.root, stateMode: data.mode };
  const store = createNativeAllocationJournalStore(options), artifacts = createStandardWorkflowArtifacts({ targetRoot: data.root });
  const history = createNativeReconciliationHistoryReader({ ...options, configuration: data.configuration, signer, artifacts });
  const proc = processAuthority(data), host = open(data, preparation);
  const product = () => H(readAgenticProductSnapshot(data.configuration.product_root, data.configuration.product_files));
  const read = () => { const found = store.read(q.journal_id); signer.verify(found.record); return found; };
  const current = check => { const record = host.inspect(data.configuration.instance_id).record;
    proc.authenticate(record, { productSha256: product(), checkControlContext: check, forNative: check }); return record; };
  const provenance = createNativeDispatchProvenance({ configuration: data.configuration, options, signer, journalId: q.journal_id, processAuthority: proc,
    readJournal: read, readInstance: () => current(false), projectionRequired: data.mode === 'dual' });
  const epochs = createNativeAuthorizationEpochs({ configuration: data.configuration, signer, read,
    write(body, expected) { const record = signer.seal(body), result = store.compareAndSwap(record, expected);
      if (result.projection === 'pending') store.materialize(q.journal_id, { write: true }); return record; },
    checkpoint: entry => readNativeAllocationCheckpoint(entry, data.configuration, { scopeId: q.scope_id, modelSha256: q.model_sha256 }),
    authenticatedCurrent: current, initialCurrent: () => current(true), journalId: q.journal_id,
    preview: () => ({ scope_id: q.scope_id, model_sha256: q.model_sha256, product_sha256: product() }),
    source: operator(data).nativeAuthorizationSource, processAuthority: proc, reconciliationHistory: history,
    withNativeOwner: provenance.withOwner, materialize: () => { if (data.mode === 'dual') store.materialize(q.journal_id, { write: true }); } });
  const before = read().record, receiptHash = H(before.reconciliations[0]), request = epochs.prepare();
  assert.equal(request.next_generation, 2); assert.equal(request.consumption.bytes, before.reconciliations[0].grant.consumption.storage_debit_bytes);
  assert.equal(request.initial_authorization.global_deadline_ms, before.allocations[0].limits.global_deadline_ms);
  const time = Date.now(), sourceRef = 'fixture-fresh-epoch';
  const grant = { contract_version: 'native-authorization-epoch-grant.v1', authority_id: 'fixture_native_resource_owner', source_event_id: randomUUID(),
    request_sha256: H(request), authorization: { approved: true, model_allowed: true, configuration_sha256: q.configuration_sha256,
      authorized_at_ms: time, global_deadline_ms: time + 600000, workflow_deadline_ms: time + 600000, max_turn_ms: 60000, max_responses: 3, max_bytes: 4194304 },
    closure: { contract_version: 'native-resource-closure.v1', request_sha256: H(request), inventory_sha256: H(request.resources), observed_at_ms: time,
      complete: true, active_resources: 0, evidence_class: 'fixture', resources: request.resources.map(resource => ({ resource_sha256: H(resource), state: 'closed',
        evidence_refs: [{ ref: 'fixture:synthetic-fresh-epoch-closure', sha256: H(resource) }] })) },
    evidence_refs: [{ ref: 'fixture:synthetic-fresh-explicit-epoch-consent', sha256: H('fixture-epoch-consent') }] };
  const envelope = { contract_version: 'standard-host-source.v1', kind: 'native-renewal', authority_id: grant.authority_id, source_ref: sourceRef,
    subject_sha256: H(request), payload: grant, issued_at_ms: time, expires_at_ms: time + 600000 };
  fs.writeFileSync(path.join(data.operator_home, 'inbox', sourceRef + '.json'), JSON.stringify({ ...envelope,
    signature: sign(null, Buffer.from(H(envelope)), fs.readFileSync(data.resource_private_key)).toString('base64') }));
  const activated = await epochs.activate(request, { write: true, sourceRef });
  assert.equal(activated.status, 'authorized'); assert.equal(activated.journal_phase, 'failed'); assert.equal(activated.native_started, false);
  const after = read().record; assertNativeAllocationJournal(after); assert.equal(after.contract_version, 'native-allocation-journal.v4');
  assert.equal(after.allocations.length, 1); assert.equal(after.allocations[0].phase, 'failed'); assert.deepEqual(after.allocations, before.allocations);
  assert.equal(H(after.reconciliations[0]), receiptHash); assert.deepEqual(after.origin_journal, before.origin_journal);
  assert.equal((await epochs.activate(request)).authorization_status, 'active');
  const controlRecords = createProcessControlInboxStore(options);
  const retained = readNativeAllocationHistory({ journal: after, entry: after.allocations[0], current: current(true), configuration: data.configuration,
    signer, controls: controlRecords, reconciliationHistory: history }); assert.equal(retained.parent_closed, true);
  const epochDispatches = artifacts.observeInventory().rows.filter(row => row.path.startsWith('workflows/native-dispatches/'))
    .map(row => JSON.parse(row.content)).filter(row => row.kind === 'authorization_epoch');
  assert.equal(epochDispatches.length, 1); assert.equal(epochDispatches[0].phase, 'returned'); assert.ok(epochDispatches[0].leases.every(row => row.status === 'released'));
  assert.equal(artifacts.resourceFence().read().record.state, 'released'); verify(item);
  return { name: 'separate-fresh-epoch-under-real-owner-with-retained-failure', root: data.root, source_signature: 'REAL_ED25519',
    epoch_activated: true, old_debit_preserved: true, original_failed_phase: true, new_allocations: 0, Native_calls: 0, consent_and_closure: 'SYNTHETIC_FIXTURE' };
}

function verifyCapacityBeforeIntent(root) {
  const item = make('files', root, 'capacity'), artifacts = createStandardWorkflowArtifacts({ targetRoot: item.data.root });
  const existingBytes = artifacts.observeInventory().rows.reduce((sum, row) => sum + Buffer.byteLength(row.content), 0);
  let remaining = STANDARD_ARTIFACT_INVENTORY_MAX_BYTES - 4096 - existingBytes, serial = 0;
  assert.ok(remaining > 0);
  const directory = path.join(item.data.root, 'docs/audit/workflows/capacity-padding'); fs.mkdirSync(directory);
  while (remaining) { const bytes = Math.min(remaining, STANDARD_ARTIFACT_MAX_BYTES);
    fs.writeFileSync(path.join(directory, 'part_' + String(++serial).padStart(3, '0') + '.md'), Buffer.alloc(bytes, 32)); remaining -= bytes; }
  const prepared = path.join(root, 'capacity-current-preparation.json'); worker(['prepare', item.file, prepared]); item.preparation = prepared;
  const before = artifacts.observeInventory(), bytes = before.rows.reduce((sum, row) => sum + Buffer.byteLength(row.content), 0);
  assert.equal(bytes, STANDARD_ARTIFACT_INVENTORY_MAX_BYTES - 4096);
  worker(['apply', item.file, item.preparation, 'expect=NATIVE_RECONCILIATION_HISTORY_CAPACITY_REQUIRED']);
  const preparation = JSON.parse(fs.readFileSync(item.preparation, 'utf8')), q = preparation.request;
  assert.equal(artifacts.read('workflows/native-allocations/' + q.journal_id + '.json').sha256, item.data.original_journal_sha256);
  assert.equal(artifacts.read(nativeReconciliationPath(nativeReconciliationId(q.journal_id, q.generation))).content, null);
  assert.equal(H(artifacts.observeInventory()), H(before)); assert.equal(artifacts.resourceFence().read().record.state, 'released');
  return { name: 'existing-inventory-capacity-refuses-before-intent-and-native-CAS', root: item.data.root, before_bytes: bytes,
    existing_limit_bytes: STANDARD_ARTIFACT_INVENTORY_MAX_BYTES, old_native_and_owner_unchanged: true, Native_calls: 0 };
}
