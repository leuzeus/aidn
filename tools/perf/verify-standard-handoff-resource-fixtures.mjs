import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStandardHandoffResources } from '../../src/application/runtime/standard-handoff-resources.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { assertHandoffResourceObservation, assertHandoffResourceResult } from '../../src/core/workflow/standard-handoff-resources.mjs';
import { RECONCILIATION_DISCOVERY_DOMAINS } from '../../src/core/workflow/process-reconciliation-inventory.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const windowsAdmission = process.argv.includes('--windows-admission');
if (windowsAdmission && process.platform !== 'win32') throw Error('WINDOWS_HANDOFF_ADMISSION_REQUIRES_WINDOWS');

const clone = value => structuredClone(value), signer = createOperationJournalSigner(() => Buffer.alloc(32, 117));
const operationId = 'op_' + '1'.repeat(40), configuration = { instance_id: 'handoff-case', target_root: 'fixture-only' };
const evidence = [{ ref: 'fixture:independent-discovery', sha256: H('controlled discovery, not actual OS/provider closure') }];
function fixture() {
  let clock = 1000, pending = false, released = true, allowed = true, expiry = Number.MAX_SAFE_INTEGER;
  let inventory = { contract_version: 'process-reconciliation-inventory.v1', instance_id: configuration.instance_id,
    instance_sha256: H('instance'), instance_revision: 1, scope_id: 'fixture-scope', model_sha256: H('model'), policy_sha256: H('policy'),
    model_source_sha256: H('source'), configuration_sha256: H(configuration), physical_root_sha256: H('physical-root'),
    authority_sha256: H('authority'), context_sha256: H('context'), runtime_binding_sha256: H('binding'), observed_at_ms: clock,
    resources: [{ ref: 'artifact:CURRENT-STATE.md', kind: 'artifact', sha256: H('canonical-content'), disposition: 'unresolved',
      details: { metadata_sha256: H('metadata'), physical_identity_sha256: H('physical-identity') } }],
    operations: [{ operation_id: operationId, record_sha256: H('unknown-record'), revision: 1, phase: 'dispatching',
      intent_sha256: H('intent'), prefix_sha256: H('prefix'), binding_sha256: H('operation-binding'), grant_sha256: H('grant'),
      owner: { generation: randomUUID(), pid: 1 }, effect_status: 'unknown', results: [] }],
    accounting: { native_known: true, responses_observed_minimum: 3, storage_debit_bytes_minimum: 700,
      unresolved_native_allocations: 0, operation_attempts: 1, unknown_operations: 1 },
    discovery: RECONCILIATION_DISCOVERY_DOMAINS.map(domain => ({ domain, status: 'independent_observation_required' })),
    complete_resource_closure: false, permits_effects: false, written: false };
  let native = { instance_id: configuration.instance_id, scope_id: null, model_sha256: null, journal_id: null, journal_sha256: null,
    retained_history_status: 'not_allocated', entries: [], permits_effects: false, complete_resource_closure: false };
  const state = { readHook: () => {}, verifyHook: () => {}, currentHook: () => {}, readCalls: 0, verifyCalls: 0, currentCalls: 0 };
  const makeObservation = request => ({ contract_version: 'standard-handoff-resource-observation.v1', authority_id: 'fixture_discoverer',
    request_sha256: H(request), observed_at_ms: clock, evidence_class: 'fixture', evidence_refs: clone(evidence),
    domains: RECONCILIATION_DISCOVERY_DOMAINS.map(domain => ({ domain, complete: true, active_resources: 0, state: 'closed', evidence_refs: clone(evidence) })) });
  const source = {
    async read({ request }) { state.readCalls++; await state.readHook(); return state.value === undefined ? makeObservation(request) : state.value; },
    async verify({ request, observation }) { state.verifyCalls++; await state.verifyHook(); return state.verification ?? {
      outcome: 'verified', authority_id: observation.authority_id, request_sha256: H(request), observation_sha256: H(observation), evidence_class: observation.evidence_class }; },
    assertCurrent() { state.currentCalls++; state.currentHook(); assert(allowed && clock < expiry, 'current independent closure permission or issuer expiry changed'); },
  };
  const options = { configuration, signer, now: () => clock, source,
    readInventory: () => signer.seal({ ...inventory, observed_at_ms: clock }), readNativeHistory: () => clone(native),
    readOwnership: () => ({ pending, fence: { record: { state: released ? 'released' : 'held', revision: 4 } } }) };
  const host = createStandardHandoffResources(options);
  return { host, source, state, options, makeObservation, inventory: () => inventory, native: () => native,
    setClock: value => { clock = value; }, setPending: value => { pending = value; }, setReleased: value => { released = value; },
    revoke: () => { allowed = false; }, setExpiry: value => { expiry = value; } };
}
let checks = 0;
async function check(name, run) { await run(); checks++; console.log('PASS ' + name); }
const inspect = (f, request = f.host.prepare(), extra = {}) => f.host.inspect(request, { sourceRef: 'fixture-discovery', ...extra });

await check('independent seven-domain observation preserves UNKNOWN and original debit without any permission', async () => {
  const f = fixture(), before = H({ inventory: f.inventory(), native: f.native() }), q = f.host.prepare(), result = await inspect(f, q);
  signer.verify(q); signer.verify(result); assertHandoffResourceResult(result);
  assert.equal(result.evidence_class, 'fixture'); assert.equal(result.complete_resource_closure, true); assert.equal(result.snapshot_only, true);
  assert.equal(result.permits_handoff, false); assert.equal(result.permits_effects, false); assert.equal(result.written, false);
  assert.deepEqual(result.unknown_business_operations, [operationId]);
  assert.equal(f.inventory().accounting.responses_observed_minimum, 3); assert.equal(f.inventory().accounting.storage_debit_bytes_minimum, 700);
  assert.equal(H({ inventory: f.inventory(), native: f.native() }), before); assert.equal(f.state.currentCalls, 1);
});
await check('absent independent observation remains WAITING with no closure claim', async () => {
  const f = fixture(); f.state.value = null; const result = await inspect(f);
  assert.deepEqual(result, { status: 'WAITING', written: false, permits_effects: false, permits_handoff: false });
  assert.equal(f.state.verifyCalls, 0); assert.equal(f.state.currentCalls, 0);
});
await check('signature or closed-schema failure refuses before independent discovery', async () => {
  const f = fixture(), q = clone(f.host.prepare()); q.authentication = '0'.repeat(64);
  await assert.rejects(inspect(f, q));
  await assert.rejects(inspect(f, signer.seal({ ...f.host.prepare(), permits_effects: true })), { code: 'STANDARD_HANDOFF_RESOURCE_REQUEST_INVALID' });
  assert.equal(f.state.readCalls, 0);
});
await check('host adds no elapsed preparation limit while all current evidence is unchanged', async () => {
  const f = fixture(), q = f.host.prepare(); f.setClock(1000 + 365 * 86400000);
  assert.equal((await inspect(f, q)).complete_resource_closure, true);
});
await check('future preparation refuses', async () => {
  const f = fixture(), q = f.host.prepare(); f.setClock(999);
  await assert.rejects(inspect(f, q), { code: 'STANDARD_HANDOFF_RESOURCE_REQUEST_FUTURE' });
});
for (const [name, change] of [
  ['canonical bytes', f => { f.inventory().resources[0].sha256 = H('changed'); }],
  ['canonical metadata', f => { f.inventory().resources[0].details.metadata_sha256 = H('changed'); }],
  ['physical identity', f => { f.inventory().resources[0].details.physical_identity_sha256 = H('changed'); }],
  ['process prefix', f => { f.inventory().instance_sha256 = H('changed'); }],
  ['authority', f => { f.inventory().authority_sha256 = H('changed'); }],
  ['Native history', f => { f.native().journal_id = 'changed'; }],
]) await check(name + ' changing during independent discovery refuses', async () => {
  const f = fixture(), q = f.host.prepare(); f.state.readHook = () => change(f);
  await assert.rejects(inspect(f, q), { code: 'STANDARD_HANDOFF_RESOURCE_SUBJECT_CHANGED' });
});
await check('context changing during independent verification refuses', async () => {
  const f = fixture(), q = f.host.prepare(); f.state.verifyHook = () => { f.inventory().context_sha256 = H('changed'); };
  await assert.rejects(inspect(f, q), { code: 'STANDARD_HANDOFF_RESOURCE_SUBJECT_CHANGED' });
});
await check('held ownership refuses without asking an independent source to bless it', async () => {
  for (const set of ['setPending', 'setReleased']) {
    const f = fixture(); f[set](set === 'setPending');
    assert.throws(() => f.host.prepare(), { code: 'STANDARD_HANDOFF_RESOURCE_OWNER_UNRESOLVED' }); assert.equal(f.state.readCalls, 0);
  }
});
await check('ownership acquired during source verification refuses', async () => {
  const f = fixture(), q = f.host.prepare(); f.state.verifyHook = () => f.setPending(true);
  await assert.rejects(inspect(f, q), { code: 'STANDARD_HANDOFF_RESOURCE_OWNER_UNRESOLVED' });
});
await check('unresolved Native history or unknown Native accounting refuses before discovery', async () => {
  for (const change of [f => { f.native().retained_history_status = 'reconciliation_required'; },
    f => { f.inventory().accounting.native_known = false; f.inventory().accounting.unresolved_native_allocations = 1; }]) {
    const f = fixture(); change(f);
    assert.throws(() => f.host.prepare(), { code: 'STANDARD_HANDOFF_NATIVE_HISTORY_UNRESOLVED' }); assert.equal(f.state.readCalls, 0);
  }
});
await check('foreign configured instance refuses', async () => {
  const f = fixture(); f.inventory().instance_id = 'foreign';
  assert.throws(() => f.host.prepare(), { code: 'STANDARD_HANDOFF_RESOURCE_SCOPE_CHANGED' });
});
await check('omitted, reordered, duplicate and open discovery domains refuse', async () => {
  const f = fixture(), q = f.host.prepare(), original = f.makeObservation(q);
  for (const change of [v => v.domains.pop(), v => v.domains.reverse(), v => { v.domains[1] = clone(v.domains[0]); },
    v => { v.domains[0].active_resources = 1; }, v => { v.domains[0].complete = false; }, v => { v.domains[0].state = 'unknown'; },
    v => { v.permits_effects = true; }, v => { v.request_sha256 = H('foreign'); }, v => { v.evidence_refs = []; },
    v => { v.domains[0].evidence_refs.push(clone(v.domains[0].evidence_refs[0])); }]) {
    const value = clone(original); change(value); assert.throws(() => assertHandoffResourceObservation(value, q));
  }
});
await check('host MAC and JSON closure claims cannot replace independent authentication', async () => {
  const f = fixture(); f.state.verification = { outcome: 'verified', authority_id: 'fixture_discoverer' };
  await assert.rejects(inspect(f), { code: 'STANDARD_HANDOFF_RESOURCE_SOURCE_NOT_AUTHENTICATED' });
});
await check('current independent permission revocation and original issuer expiry refuse', async () => {
  for (const mutate of [f => f.revoke(), f => f.setExpiry(1000)]) {
    const f = fixture(); f.state.verifyHook = () => mutate(f); await assert.rejects(inspect(f), /current independent closure permission/);
  }
});
await check('missing or asynchronous final current capability refuses', async () => {
  const f = fixture(); delete f.source.assertCurrent;
  await assert.rejects(inspect(f), { code: 'STANDARD_HANDOFF_RESOURCE_SOURCE_REQUIRED' });
  f.source.assertCurrent = async () => {};
  await assert.rejects(inspect(f), { code: 'STANDARD_HANDOFF_RESOURCE_SOURCE_NOT_CURRENT' });
});
await check('cancellation during source read refuses before verification', async () => {
  const f = fixture(), controller = new AbortController(); f.state.readHook = () => controller.abort();
  await assert.rejects(inspect(f, f.host.prepare(), { signal: controller.signal }), { code: 'STANDARD_HANDOFF_RESOURCE_OBSERVATION_ABORTED' });
  assert.equal(f.state.verifyCalls, 0);
});
await check('publication source permission remains live without claiming closure for a changed owner', async () => {
  const f = fixture(), q = f.host.prepare(), observed = await f.host.observeForPublication(q, { sourceRef: 'fixture-discovery' });
  assert.equal(typeof observed.assertCurrent, 'function'); assert.equal(typeof observed.assertSourceCurrent, 'function');
  observed.assertCurrent(); f.setPending(true);
  assert.throws(() => observed.assertCurrent(), { code: 'STANDARD_HANDOFF_RESOURCE_OWNER_UNRESOLVED' });
  observed.assertSourceCurrent(); assert.equal(observed.result.snapshot_only, true); assert.equal(observed.result.permits_handoff, false);
  f.revoke(); assert.throws(() => observed.assertSourceCurrent(), /current independent closure permission/);
});
await check('publication issuer capability retains original expiry and cancellation', async () => {
  const f = fixture(), controller = new AbortController(), q = f.host.prepare();
  const observed = await f.host.observeForPublication(q, { sourceRef: 'fixture-discovery', signal: controller.signal });
  f.setExpiry(1001); f.setClock(1001); assert.throws(() => observed.assertSourceCurrent(), /current independent closure permission/);
  f.setClock(1000); controller.abort(); assert.throws(() => observed.assertSourceCurrent(), { code: 'STANDARD_HANDOFF_RESOURCE_OBSERVATION_ABORTED' });
});
console.log(JSON.stringify({ status: 'PASS', checks, scope: 'CONTROLLED_READONLY_HANDOFF_RESOURCE_CAPABILITIES_AND_CLOSED_CONTRACTS',
  canonical_inventory_and_independent_resource_discovery: 'FIXTURE', genuine_Native_Human_provider_installed_full_STANDARD: 'NOT_RUN',
  packet_CAS_receipt_ordinary_handoff: 'NOT_PROVEN' }));

const {verifyStandardHostResourceSourceFixtures}=await import('./standard-host-resource-source-fixture-lib.mjs');
console.log(JSON.stringify({default_host_source:await verifyStandardHostResourceSourceFixtures({ focused: windowsAdmission })}));
