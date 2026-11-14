#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { assertNativeDispatchRecord, nativeDispatchId, nativeDispatchPath, nativeDispatchContextHash } from '../../src/core/workflow/native-dispatch-record.mjs';
import { nativeJournalId } from '../../src/core/workflow/native-allocation-journal.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

const args = process.argv.slice(2), modes = ['files', 'dual', 'db-only'];
if (args.some(value => !modes.includes(value) && value !== '--contracts-only') || args.filter(value => modes.includes(value)).length > 1)
  throw Object.assign(Error('NATIVE_DISPATCH_FIXTURE_ARGUMENT_INVALID'), { code: 'NATIVE_DISPATCH_FIXTURE_ARGUMENT_INVALID' });
const contractsOnly = args.includes('--contracts-only'), mode = args.find(value => modes.includes(value)) ?? 'files';
const key = () => Buffer.alloc(32, 73), signer = createOperationJournalSigner(key), H = value => shadowHash(value);
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
let checks = 0;
const test = (name, run) => { run(); checks++; console.log('PASS ' + name); };
function fixtureBody(kind = 'allocation') {
  const authority = { scope_id: 'fixture-scope', model_sha256: H('model'), policy_pins: {} };
  const intent = { instance_id: 'case', [kind === 'allocation' ? 'authorization_sha256' : 'epoch_request_sha256']: H('intent') };
  const processIdentity = { platform: 'win32', host: 'synthetic-fixture', pid: 27, creation: 'synthetic-process-identity' };
  const root = 'synthetic-physical-root', ownerPlan = H({ authority, ...intent });
  const body = { contract_version: 'native-dispatch-record.v1', nonce: uuid(1), revision: 1,
    journal_id: nativeJournalId({ instance_id: 'case', scope_id: authority.scope_id }), instance_id: 'case', scope_id: authority.scope_id,
    model_sha256: authority.model_sha256, configuration_sha256: H('configuration'), authority, intent, kind, owner_plan_sha256: ownerPlan,
    physical_root_sha256: H(root), local_owner_scope_sha256: H({ physical_root: root }), process_identity: structuredClone(processIdentity),
    instance_sha256: H('instance'), instance_revision: 7, native_journal_before_sha256: H('before'), native_journal_after_sha256: null,
    phase: 'running', local_owner_intentions: [], leases: [], result_sha256: null, error_code: null,
    permits_effects: false, complete_resource_closure: false };
  body.dispatch_id = nativeDispatchId(body);
  const owner = { contract_version: 'process-local-effect-owner.v1', token: uuid(2), pid: processIdentity.pid,
    scope_sha256: body.local_owner_scope_sha256, plan_sha256: ownerPlan, created_at: '2030-01-01T00:00:00.000Z' };
  const fence = { contract_version: 'local-artifact-resource-fence.v1', revision: 2, physical_root_sha256: body.physical_root_sha256,
    state: 'held', token: uuid(3), process_identity: processIdentity };
  body.local_owner_intentions.push({ owner: structuredClone(owner), lock_path: '.aidn/runtime/standard-workflow/effects.lock',
    resource_fence: { record: structuredClone(fence), previous_sha256: H('previous-fence') }, context_sha256: nativeDispatchContextHash(body) });
  body.leases.push({ owner: structuredClone(owner), physical_identity: { dev: '9007199254740993', ino: '9007199254740995', size: 200, nlink: 1, mode: 33206,
    mtime_ns: '1794660000000000001', ctime_ns: '1794660000000000003' }, resource_fence: structuredClone(fence), status: 'held' });
  return body;
}
for (const kind of ['allocation', 'authorization_epoch']) test('closed ' + kind + ' owner provenance DTO', () => {
  const record = signer.seal(fixtureBody(kind)); signer.verify(record); assertNativeDispatchRecord(record);
  assert.match(nativeDispatchPath(record.dispatch_id), /^workflows\/native-dispatches\/native_dispatch_[a-f0-9]{40}\.json$/);
  assert.equal(record.permits_effects, false); assert.equal(record.complete_resource_closure, false);
});
test('proposal without physical allocation remains valid evidence only', () => {
  const body = fixtureBody(); body.phase = 'reserved'; body.leases = [];
  assertNativeDispatchRecord(signer.seal(body));
});
for (const [name, mutate] of [
  ['unknown approval field', body => { body.approved = true; }],
  ['foreign dispatch identity', body => { body.dispatch_id = 'native_dispatch_' + 'b'.repeat(40); }],
  ['foreign instance', body => { body.instance_id = 'other'; }],
  ['foreign authority scope', body => { body.authority.scope_id = 'other'; }],
  ['foreign model', body => { body.model_sha256 = H('other'); }],
  ['wrong intent kind', body => { body.kind = 'authorization_epoch'; }],
  ['foreign original owner PID', body => { body.local_owner_intentions[0].owner.pid++; }],
  ['foreign original plan', body => { body.owner_plan_sha256 = H('other'); }],
  ['foreign owner scope', body => { body.local_owner_intentions[0].owner.scope_sha256 = H('other'); }],
  ['changed context', body => { body.local_owner_intentions[0].context_sha256 = H('other'); }],
  ['foreign fence process creation', body => { body.local_owner_intentions[0].resource_fence.record.process_identity.creation = 'other'; }],
  ['foreign fence root', body => { body.local_owner_intentions[0].resource_fence.record.physical_root_sha256 = H('other'); }],
  ['different physical lease fence', body => { body.leases[0].resource_fence.token = uuid(9); }],
  ['lossy numeric physical identity', body => { body.leases[0].physical_identity.ino = 9007199254740992; }],
  ['hardlinked owner', body => { body.leases[0].physical_identity.nlink = 2; }],
  ['duplicate lease', body => { body.leases.push(structuredClone(body.leases[0])); }],
  ['missing current lease', body => { body.leases = []; }],
  ['unpaired original prefix', body => { body.instance_revision = null; }],
  ['returned without result digest', body => { body.phase = 'returned'; }],
  ['error content instead of bounded code', body => { body.phase = 'threw'; body.error_code = 'private message with spaces'; }],
  ['closure authority claim', body => { body.complete_resource_closure = true; }],
]) test('refuse ' + name, () => {
  // Each mutation is signed again: a valid fixture MAC cannot make internally
  // contradictory provenance or an effect/closure assertion acceptable.
  const body = structuredClone(fixtureBody()); mutate(body);
  assert.throws(() => assertNativeDispatchRecord(signer.seal(body)), { code: 'NATIVE_DISPATCH_RECORD_INVALID' });
});
if (contractsOnly) {
  console.log(JSON.stringify({ ok: true, checks, scope: 'NATIVE_DISPATCH_DATA_CONTRACTS_ONLY', effect_owner_port: 'NOT_RUN', Native_calls: 0, full_standard: false }));
} else {
  const { createFreshStandardWorkflowFixture } = await import('./standard-workflow-fixture-lib.mjs');
  const { createStandardProcessAuthority } = await import('../../src/application/runtime/standard-process-authority.mjs');
  const { createStandardWorkflowOperationHost } = await import('../../src/application/runtime/standard-workflow-operation-host.mjs');
  const { readAgenticProductSnapshot } = await import('../../src/application/runtime/agentic-process-execution-composition.mjs');
  const { createStandardWorkflowArtifacts } = await import('../../src/application/runtime/standard-workflow-artifacts.mjs');
  const { standardWorkflowOperationBindings } = await import('../../src/application/runtime/standard-workflow-operations.mjs');
  const { createNativeDispatchProvenance } = await import('../../src/application/runtime/native-dispatch-provenance.mjs');
  const { agentRunPhysicalPath } = await import('../../src/application/runtime/agent-run-configuration-service.mjs');
  const snapshotTree = root => {
    const files = {}, directories = [];
    const visit = at => { for (const entry of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(at, entry.name), relative = path.relative(root, file).replaceAll(path.sep, '/');
      if (entry.isSymbolicLink()) files[relative] = 'LINK:' + fs.readlinkSync(file);
      else if (entry.isDirectory()) { directories.push(relative); visit(file); }
      else files[relative] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    } }; visit(root); return { files, directories };
  };
  const owned = [], results = [];
  for (const point of ['returned', 'epoch_returned', 'unknown', 'native_owner_reserved', 'native_fence_acquired', 'native_owner_declared', 'native_owner_released', 'native_dispatch_returned']) {
    const root = createFreshStandardWorkflowFixture(mode, owned), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
    const binding = standardWorkflowOperationBindings().find(row => row.id === 'context_reload');
    const model = { contract_version: 'agentic-process-model.v2', model_id: 'native-owner-component', revision: 1,
      participants: [{ id: 'project' }], roles: [], policies: [], entry: 'observe', operation_pins: { context_reload: H(binding) },
      nodes: [{ id: 'observe', kind: 'operation', participant_ref: 'project', binding_ref: 'context_reload' }] };
    const privateRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-native-owner-boundary-')); owned.push(privateRoot);
    const configuration = { target_root: root, instance_id: 'case', product_root: path.join(root, 'product'), product_files: ['app.mjs'],
      control_root: path.join(privateRoot, 'control'), review_root: path.join(privateRoot, 'review'),
      native: { home: path.join(privateRoot, 'home'), protected_roots: [] } };
    for (const directory of [configuration.product_root, configuration.control_root, configuration.review_root, configuration.native.home]) fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(configuration.product_root, 'app.mjs'), 'export const value = 1;\n');
    const productSnapshot = () => readAgenticProductSnapshot(configuration.product_root, configuration.product_files);
    const authority = createStandardProcessAuthority({ configuration, model, readSigningKey: key, readProductSha256: () => H(productSnapshot()), readProductSnapshot: productSnapshot });
    const hostOptions = { targetRoot: root, model, readSigningKey: key, authorize: async () => null, processAuthority: authority, reconciliationConfiguration: configuration };
    const host = createStandardWorkflowOperationHost(hostOptions);
    const preview = host.initialize({ instanceId: 'case', write: false });
    assert.equal(preview.written, false);
    host.initialize({ instanceId: 'case', write: true, expectedResultSha256: preview.record.instance_sha256 });
    const observed = authority.read(), journalId = nativeJournalId({ instance_id: 'case', scope_id: observed.scope_id });
    let callbacks = 0;
    const port = createNativeDispatchProvenance({ configuration, options: { targetRoot: root, stateMode: mode }, signer, journalId,
      processAuthority: authority, readJournal: () => ({ record: null, content_sha256: null }), readInstance: () => host.inspect('case').record }, {
      onBoundary(name) { if (name === point) throw Object.assign(Error('FIXTURE_NATIVE_OWNER_INTERRUPT'), { code: 'FIXTURE_NATIVE_OWNER_INTERRUPT' }); },
    });
    const intent = { instance_id: 'case', [point === 'epoch_returned' ? 'epoch_request_sha256' : 'authorization_sha256']: H('controlled-intent') };
    const execute = () => port.withOwner(intent, async () => {
      callbacks++; assert.equal(artifacts.ownerPending(), true);
      return point === 'unknown' ? { status: 'CONTROLLED_UNKNOWN_NO_NATIVE_RUN' } : { native_started: false, status: 'CONTROLLED_NO_NATIVE_EFFECT' };
    });
    if (point.startsWith('native_')) await assert.rejects(execute, { code: 'FIXTURE_NATIVE_OWNER_INTERRUPT' });
    else await execute();
    const records = artifacts.observeInventory().rows.filter(row => row.path.startsWith('workflows/native-dispatches/'));
    assert.equal(records.length, 1);
    const record = JSON.parse(records[0].content); signer.verify(record); assertNativeDispatchRecord(record);
    assert.equal(record.local_owner_intentions.length, 1);
    assert.equal(record.kind, point === 'epoch_returned' ? 'authorization_epoch' : 'allocation');
    assert.equal(record.configuration_sha256, H(configuration));
    assert.equal(record.physical_root_sha256, H(agentRunPhysicalPath(root)));
    const released = ['returned', 'epoch_returned', 'native_dispatch_returned'].includes(point);
    const retained = !released && point !== 'native_owner_reserved';
    assert.equal(artifacts.ownerPending(), retained);
    assert.equal(callbacks, ['native_owner_reserved', 'native_fence_acquired', 'native_owner_declared'].includes(point) ? 0 : 1);
    assert.equal(record.phase, point.startsWith('native_') && point !== 'native_dispatch_returned' ? 'threw' : 'returned');
    assert.equal(record.leases.length, ['returned', 'epoch_returned', 'unknown', 'native_owner_declared', 'native_owner_released', 'native_dispatch_returned'].includes(point) ? 1 : 0);
    if (record.leases.length) assert.equal(record.leases[0].status, released || point === 'native_owner_released' ? 'released' : 'held');
    assert.equal(fs.existsSync(path.join(root, '.aidn/runtime/standard-workflow/effects.lock')), ['unknown', 'native_owner_declared'].includes(point));
    const fence = artifacts.resourceFence().read().record;
    assert.equal(fence?.state ?? null, point === 'native_owner_reserved' ? null : retained ? 'held' : 'released');
    if (point === 'native_dispatch_returned') { assert.equal(record.error_code, null); assert.ok(record.result_sha256); }
    const visible = path.join(root, 'docs/audit', nativeDispatchPath(record.dispatch_id));
    const relativeVisible = path.relative(root, visible).replaceAll(path.sep, '/');
    const ignoreCandidates = [relativeVisible, 'docs/audit/cycles/C999-feature-business/plan.md',
      'docs/audit/workflows/native-dispatches-unrelated/notes.md'];
    const ignored = execFileSync('git', ['-C', root, 'check-ignore', '--no-index', '-z', '--stdin'], {
      input: ignoreCandidates.join('\0') + '\0', encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
    assert.deepEqual(ignored, [relativeVisible], 'only the exact canonical runtime namespace is ignored');
    assert.equal(fs.existsSync(visible), mode !== 'db-only');
    if (mode !== 'db-only') assert.deepEqual(JSON.parse(fs.readFileSync(visible)), record);
    if (retained) await assert.rejects(execute, { code: 'STANDARD_RESOURCE_FENCE_RECONCILIATION_REQUIRED' });
    const instance = host.inspect('case').record, beforeInventory = snapshotTree(root), beforePrivate = snapshotTree(privateRoot);
    const inventory = host.prepareReconciliationInventory('case', { expectedSha256: instance.instance_sha256 });
    signer.verify(inventory);
    const resource = inventory.resources.find(row => row.ref === 'native-dispatch:' + record.dispatch_id);
    assert.ok(resource); assert.equal(resource.kind, 'native_journal'); assert.equal(resource.sha256, H(record));
    assert.equal(resource.details.record_kind, 'native_dispatch');
    assert.equal(inventory.permits_effects, false); assert.equal(inventory.complete_resource_closure, false); assert.equal(inventory.written, false);
    const foreign = createStandardWorkflowOperationHost({ ...hostOptions, reconciliationConfiguration: { ...configuration, instance_id: 'foreign-case' } });
    assert.throws(() => foreign.prepareReconciliationInventory('case', { expectedSha256: instance.instance_sha256 }), { code: 'PROCESS_RECONCILIATION_RESOURCE_CHANGED' });
    assert.deepEqual(snapshotTree(root), beforeInventory); assert.deepEqual(snapshotTree(privateRoot), beforePrivate);
    assert.equal(host.inspect('case').record.instance_sha256, instance.instance_sha256);
    results.push({ point, root, record_sha256: H(record), owner_pending: retained, callback_count: callbacks,
      evidence_only: true, native_calls: 0, signed_readonly_inventory: true, foreign_configuration_refused: true,
      runtime_path_ignored_adjacent_business_paths_reviewable: true, all_fixture_bytes_and_directories_unchanged_by_inventory: true });
    console.log('PASS ' + mode + ' actual canonical owner boundary ' + point); checks++;
  }
  // Retain owned fixtures, including every expected UNKNOWN owner. Cleanup is a
  // separate recovery operation; a successful assertion cannot retire a lock.
  console.log(JSON.stringify({ ok: true, checks, mode, results, retained_roots: owned, authority: 'REAL_COMMON_OWNER_PORT',
    action_results: 'CONTROLLED_NO_NATIVE_EXECUTION', Native_calls: 0, actual_crash_process: 'NOT_RUN', genuine_native: 'NOT_RUN', full_standard: false }));
}
