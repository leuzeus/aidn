import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createStandardWorkflowOperationHost } from '../../src/application/runtime/standard-workflow-operation-host.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createStandardHandoffOperation } from '../../src/application/runtime/standard-handoff-operation.mjs';
import { createProjectArtifactStore } from '../../src/application/runtime/project-artifact-store-service.mjs';
import { createProcessDispatchRecordStore } from '../../src/adapters/runtime/process-dispatch-record-store.mjs';
import { observeLocalProcessOwner } from '../../src/adapters/runtime/local-process-identity.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { decodeHandoffPacketPlan } from '../../src/core/workflow/standard-handoff-operation.mjs';
import { artifactContentHash, artifactMetadataHash } from '../../src/core/workflow/artifact-compare-swap.mjs';
import { buildCanonicalFromMarkdown } from '../../src/lib/workflow/markdown-render-lib.mjs';
import { simulateAgenticProcess } from '../../src/core/workflow/agentic-process-simulation.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const here = fileURLToPath(import.meta.url), key = () => Buffer.alloc(32, 173), signer = createOperationJournalSigner(key);
const json = file => JSON.parse(fs.readFileSync(file, 'utf8')), save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const input = { contract_version: 'standard-handoff-publication-input.v1', next_agent_role: 'coordinator', next_agent_action: 'reanchor',
  next_agent_goal: 'Resume from the exact retained canonical checkpoint without repeating packet publication.',
  handoff_note: 'Preserve confirmed and uncertain outcomes separately.', from_agent_role: 'coordinator', from_agent_action: 'relay' };
function model() {
  const binding = standardWorkflowOperationBindings().find(row => row.id === 'handoff_packet_publish'); assert(binding);
  return { contract_version: 'agentic-process-model.v2', model_id: 'handoff-returned-receipt-component', revision: 1,
    participants: [{ id: 'project' }], roles: [], policies: [], entry: 'publish', operation_pins: { handoff_packet_publish: H(binding) },
    nodes: [{ id: 'publish', kind: 'operation', participant_ref: 'project', binding_ref: 'handoff_packet_publish' }] };
}
function observationSource(counters, now) {
  return {
    async read({ request }) { counters.discovery++; return { contract_version: 'standard-handoff-resource-observation.v1',
      authority_id: 'fixture_handoff_discovery', request_sha256: H(request), observed_at_ms: now(), evidence_class: 'fixture',
      evidence_refs: [{ ref: 'fixture:controlled-original-discovery', sha256: H(request) }],
      domains: ['deterministic', 'native', 'human', 'control', 'process', 'git', 'provider'].map(domain => ({ domain, complete: true,
        active_resources: 0, state: 'closed', evidence_refs: [{ ref: 'fixture:' + domain, sha256: H({ request, domain }) }] })) }; },
    async verify({ request, observation }) { counters.discovery++; return { outcome: 'verified', authority_id: observation.authority_id,
      request_sha256: H(request), observation_sha256: H(observation), evidence_class: 'fixture' }; },
    assertCurrent() { counters.discovery++; },
  };
}
function open(data, { producer = false, dispatchCheckpoint, handoffPublicationBoundary, allowed = () => true, now = Date.now } = {}) {
  const counters = { normal_grants: 0, disposition_grants: 0, discovery: 0, publication_calls: 0, Native_calls: 0 };
  const dispositionSource = {
    async authorize({ request }) { counters.disposition_grants++; if (!allowed()) return null;
      return { contract_version: 'process-disposition-authorization-grant.v2', authority_id: 'fixture_disposition_operator', authorized: true,
        request_sha256: H(request), principal_sha256: H('controlled disposition principal'), grant_sha256: H({ request, separate_consent: true }),
        observed_at_ms: now(), evidence_refs: [{ ref: 'fixture:new-explicit-recovery-consent', sha256: H(request) }] }; },
    async verify({ request, grant }) { return { outcome: allowed() ? 'verified' : 'denied', authority_id: grant.authority_id,
      request_sha256: H(request), grant_sha256: H(grant) }; },
  };
  const host = createStandardWorkflowOperationHost({ targetRoot: data.root, model: model(), readSigningKey: key, now, dispositionSource,
    authorize(q) { counters.normal_grants++; return { authorized: true, authority_id: 'fixture_operation_operator', principal_sha256: H('controlled operation principal'),
      grant_sha256: H({ preview: q.preview_sha256, scope: q.scope_id }) }; },
    reconciliationConfiguration: data.configuration,
    handoffResourceSource: producer ? observationSource(counters, now) : null,
    handoffNativeHistory: producer ? () => ({ instance_id: data.configuration.instance_id, scope_id: null, model_sha256: null, journal_id: null,
      journal_sha256: null, retained_history_status: 'not_allocated', entries: [], permits_effects: false, complete_resource_closure: false }) : null },
    { dispatchCheckpoint, handoffPublicationBoundary(point) { counters.publication_calls++;
      if (!producer) throw Error('CAPTURED_PUBLICATION_MUST_NOT_REPLAY'); return handoffPublicationBoundary?.(point); } });
  return { host, counters };
}
function tree(roots) {
  const rows = []; const walk = (at, base, label) => {
    for (const e of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(at, e.name), relative = label + ':' + path.relative(base, file);
      if (e.isSymbolicLink()) rows.push([relative, 'link', fs.readlinkSync(file)]);
      else if (e.isDirectory()) { rows.push([relative, 'directory']); walk(file, base, label); }
      else rows.push([relative, 'file', sha(fs.readFileSync(file))]);
    }
  }; roots.forEach((root, i) => walk(root, root, String(i))); return rows;
}
// Controlled fixture perturbation uses the actual owner/CAS and restores every
// metadata field. It does not alter the captured producer or historical output.
async function withConflict(root, name, metadataOnly, inspect) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: root }), before = artifacts.read(name, { required: true });
  if (!artifacts.describe().database) {
    assert.equal(metadataOnly, false); const file = path.join(root, 'docs/audit', name), bytes = fs.readFileSync(file);
    fs.writeFileSync(file, before.content + '\nfixture-conflict\n'); try { await inspect(); } finally { fs.writeFileSync(file, bytes); } return;
  }
  const reader = createProjectArtifactStore({ targetRoot: root, readOnly: true, existingOnly: true }); let retained;
  try { retained = reader.getArtifact(name); } finally { reader.close(); }
  const beforeMetadata = artifactMetadataHash(retained), content = metadataOnly ? before.content : before.content + '\nfixture-conflict\n';
  const changed = { ...retained, ...(metadataOnly ? { updated_at: '2000-01-01T00:00:00.000Z' } : {}) };
  if (metadataOnly) assert.notEqual(changed.updated_at, retained.updated_at);
  async function write(row, text, expectedSha256, expectedMetadataSha256) {
    await artifacts.withLocalEffectOwner(H({ fixture: 'controlled-canonical-conflict', name, text, metadata: row.updated_at }), () => {
      const store = createProjectArtifactStore({ targetRoot: root, existingOnly: true });
      try { store.compareAndSwapArtifact({ expectedSha256, expectedMetadataSha256, artifact: { ...row, content: text,
        sha256: undefined, size_bytes: undefined, mtime_ns: undefined, canonical_json: undefined,
        canonical: buildCanonicalFromMarkdown(text, { relativePath: name,
          classification: { kind: row.kind, family: row.family, ...(row.subtype ? { subtype: row.subtype } : {}) } }) } }); }
      finally { store.close(); }
      artifacts.project([name]); return { effect_status: 'confirmed' };
    });
  }
  await write(changed, content, before.sha256, beforeMetadata);
  const conflict = artifacts.read(name, { required: true }), conflictMetadata = artifacts.metadataHash(name);
  if (metadataOnly) { assert.equal(conflict.sha256, before.sha256); assert.notEqual(conflictMetadata, beforeMetadata); }
  else { assert.notEqual(conflict.sha256, before.sha256); assert.equal(conflictMetadata, beforeMetadata); }
  try { await inspect(); } finally { await write(retained, before.content, conflict.sha256, conflictMetadata); }
  assert.equal(artifacts.read(name).sha256, before.sha256); assert.equal(artifacts.metadataHash(name), beforeMetadata);
}
if (process.argv[2] === '--verify-binding-pins') {
  const url = new URL('../../src/application/runtime/standard-workflow-operations.mjs', import.meta.url), originalRead = fs.readFileSync;
  const baseline = standardWorkflowOperationBindings().find(row => row.id === 'handoff_packet_publish').implementation_sha256;
  const roles = ['../../src/application/runtime/standard-handoff-operation.mjs', '../../src/application/runtime/standard-handoff-publication.mjs',
    '../../src/core/workflow/standard-handoff-operation.mjs'];
  for (const [index, name] of roles.entries()) {
    const target = path.resolve(fileURLToPath(new URL(name, import.meta.url))).toLowerCase(); let reads = 0;
    fs.readFileSync = function(file, ...args) {
      const value = originalRead.call(this, file, ...args), actual = path.resolve(file instanceof URL ? fileURLToPath(file) : String(file)).toLowerCase();
      if (actual !== target) return value; reads++;
      return typeof value === 'string' ? value + '\n// controlled dependency bytes\n' : Buffer.concat([value, Buffer.from('\n// controlled dependency bytes\n')]);
    };
    try {
      const changed = await import(url.href + '?handoff-body-pin=' + index);
      assert(reads > 0, 'common binding must read the ' + name + ' body');
      assert.notEqual(changed.standardWorkflowOperationBindings().find(row => row.id === 'handoff_packet_publish').implementation_sha256, baseline);
    } finally { fs.readFileSync = originalRead; }
  }
  console.log(JSON.stringify({ status: 'PASS', body_roles_pinned: roles.length, checkout_writes: 0, Native_calls: 0 }));
} else if (process.argv[2] === '--produce') {
  const dataFile = process.argv[3], kind = process.argv[4], data = json(dataFile); let runtime;
  runtime = open(data, { producer: true, handoffPublicationBoundary(point) {
    if (kind === 'unknown' && point === 'after_packet_cas') throw Object.assign(Error('FIXTURE_POST_CAS_UNCERTAINTY'), { code: 'FIXTURE_POST_CAS_UNCERTAINTY' });
  }, async dispatchCheckpoint(point, operationId) {
    if (kind !== 'completed' || point !== 'dispatch_returned') return;
    const capsule = createProcessDispatchRecordStore({ targetRoot: data.root, stateMode: data.mode }).read(operationId).record;
    signer.verify(capsule); const live = await runtime.host.prepareOperationDisposition(operationId,
      { expectedSha256: runtime.host.inspect(data.configuration.instance_id).record.instance_sha256 });
    assert.equal(live.assessment, 'unknown');
    save(dataFile + '.witness.json', { kind, capsule_sha256: H(capsule), live_assessment: live.assessment, pid: process.pid, counters: runtime.counters });
    process.exit(42);
  } });
  const result = await runtime.host.dispatch(data.operation_id, { write: true });
  assert.equal(kind, 'unknown'); assert.equal(result.status, 'receipted'); assert.equal(result.receipt.effect_status, 'unknown');
  const capsule = createProcessDispatchRecordStore({ targetRoot: data.root, stateMode: data.mode }).read(data.operation_id).record;
  signer.verify(capsule); save(dataFile + '.witness.json', { kind, capsule_sha256: H(capsule), pid: process.pid, counters: runtime.counters }); process.exit(42);
} else {
  const mode = process.argv[2]; assert(['files', 'dual', 'db-only'].includes(mode)); assert.equal(process.argv.length, 3);
  const owned = [], root = createFreshStandardWorkflowFixture(mode, owned, { absentOptionalDocuments: ['HANDOFF-PACKET.md'] });
  const privateRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-handoff-returned-')); owned.push(privateRoot);
  const control = path.join(privateRoot, 'control'); fs.mkdirSync(control);
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: root }), seed = artifacts.read('CURRENT-STATE.md', { required: true });
  const thinking = seed.content.replace(/^mode:.*$/mi, 'mode: THINKING'); assert.notEqual(thinking, seed.content);
  await artifacts.withLocalEffectOwner(H({ fixture: 'explicit THINKING setup' }), () => {
    artifacts.compareAndSwapPreservingMetadata({ path: 'CURRENT-STATE.md', before_sha256: seed.sha256,
      before_metadata_sha256: artifacts.metadataHash('CURRENT-STATE.md'), after: thinking }); artifacts.project(['CURRENT-STATE.md']); return { effect_status: 'confirmed' };
  });
  let checks = 0; const pass = name => { checks++; console.log('PASS ' + mode + ': ' + name); };
  if (mode === 'files') {
    const probe = spawnSync(process.execPath, [here, '--verify-binding-pins'], { windowsHide: true, encoding: 'utf8', maxBuffer: 1048576 });
    assert.equal(probe.error, undefined); assert.equal(probe.status, 0, probe.stderr);
    assert.equal(JSON.parse(probe.stdout.trim()).body_roles_pinned, 3); pass('common binding changes for writer, adapter and core body bytes without checkout writes');
  }
  async function readonly(name, action) { const before = tree(owned), value = await action(); assert.deepEqual(tree(owned), before, name); pass(name); return value; }
  async function produce(kind) {
    const data = { root, mode, configuration: { instance_id: 'handoff-returned-' + kind, target_root: root, control_root: control } }, live = open(data, { producer: true });
    const initial = live.host.initialize({ instanceId: data.configuration.instance_id });
    live.host.initialize({ instanceId: data.configuration.instance_id, write: true, expectedResultSha256: initial.record.instance_sha256 });
    const current = live.host.inspect(data.configuration.instance_id), occurrence = current.cursor.occurrences.find(row => row.status === 'READY'); assert(occurrence);
    const preview = await readonly(kind + ' original preparation is read-only', () => live.host.preview({ instanceId: data.configuration.instance_id,
      expectedSha256: current.record.instance_sha256, occurrenceId: occurrence.occurrence_id, input: { ...input, next_agent_goal: input.next_agent_goal + ' ' + kind } }));
    assert.equal(preview.prepared.can_apply, true); const staged = await live.host.stage(preview, { write: true, expectedPreviewSha256: H(preview) });
    data.operation_id = staged.operation_id; const file = path.join(privateRoot, kind + '.json'); save(file, data);
    const child = spawnSync(process.execPath, [here, '--produce', file, kind], { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 1048576 });
    save(file + '.exit.json', { status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr, error: child.error?.code ?? null });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 42, child.stderr);
    const witness = json(file + '.witness.json'), store = createProcessDispatchRecordStore({ targetRoot: root, stateMode: mode }), capsule = store.read(data.operation_id).record;
    signer.verify(capsule); assert.equal(H(capsule), witness.capsule_sha256); assert.equal(observeLocalProcessOwner(capsule.process_identity), 'terminated');
    assert.equal(capsule.process_identity.pid, witness.pid); assert.equal(capsule.phase, 'returned'); assert.equal(capsule.leases.length, 1);
    assert.equal(capsule.local_owner_intentions.length, 1); assert.equal(capsule.leases[0].status, kind === 'completed' ? 'released' : 'held');
    pass(kind + ' actual producer exits 42 with authenticated returned capture and exact owner/fence');
    return { data, preview, capsule, store, witness, inner: decodeHandoffPacketPlan(preview.prepared.plan) };
  }
  const captured = await produce('completed'), id = captured.data.operation_id, day = 86400000; let clock = Date.now() - day, allowed = true;
  const cold = open(captured.data, { allowed: () => allowed, now: () => clock }), original = cold.host.readJournal(id);
  assert.equal(original.phase, 'dispatching'); assert.equal(original.results.length, 0); assert.equal(captured.witness.live_assessment, 'unknown');
  assert.equal(artifacts.ownerPending(), false); assert.equal(artifacts.read('HANDOFF-PACKET.md').sha256, captured.inner.after_sha256);
  const business = () => H({ packet: artifacts.read('HANDOFF-PACKET.md'), metadata: artifacts.metadataHash('HANDOFF-PACKET.md'),
    visible: fs.existsSync(path.join(root, 'docs/audit/HANDOFF-PACKET.md')) ? sha(fs.readFileSync(path.join(root, 'docs/audit/HANDOFF-PACKET.md'))) : null,
    capsule: H(captured.store.read(id).record), pending: artifacts.ownerPending() });
  let plan = await readonly('cold completed capture observation is read-only', () => cold.host.prepareOperationDisposition(id,
    { expectedSha256: cold.host.inspect(captured.data.configuration.instance_id).record.instance_sha256 }));
  assert.equal(plan.assessment, 'confirmed_original'); pass('terminated completed publication matches authenticated canonical postimages'); const unchanged = business();
  await withConflict(root, 'HANDOFF-PACKET.md', false, async () => {
    const changed = await cold.host.prepareOperationDisposition(id, { expectedSha256: cold.host.inspect(captured.data.configuration.instance_id).record.instance_sha256 });
    assert.equal(changed.assessment, 'unknown'); assert.equal(cold.host.readJournal(id).results.length, 0);
  }); assert.equal(business(), unchanged); pass('changed canonical packet refuses confirmation and original capture stays intact');
  let metadataCheck = 'FILES_NULL_METADATA';
  if (artifacts.describe().database) {
    await withConflict(root, 'HANDOFF-PACKET.md', true, async () => {
      const changed = await cold.host.prepareOperationDisposition(id, { expectedSha256: cold.host.inspect(captured.data.configuration.instance_id).record.instance_sha256 }); assert.equal(changed.assessment, 'unknown');
    }); assert.equal(business(), unchanged); metadataCheck = 'PASS'; pass('metadata-only canonical change refuses confirmation');
  } else { assert.equal(artifacts.metadataHash('HANDOFF-PACKET.md'), null); pass('FILES metadata stays explicitly null'); }
  if (mode === 'dual') {
    const file = path.join(root, 'docs/audit/HANDOFF-PACKET.md'), bytes = fs.readFileSync(file); fs.appendFileSync(file, '\nfixture-visible-conflict\n');
    try { const changed = await cold.host.prepareOperationDisposition(id, { expectedSha256: cold.host.inspect(captured.data.configuration.instance_id).record.instance_sha256 }); assert.equal(changed.assessment, 'unknown'); }
    finally { fs.writeFileSync(file, bytes); } assert.equal(business(), unchanged); pass('DUAL projection mismatch refuses without materializing');
  } else if (mode === 'db-only') { assert.equal(fs.existsSync(path.join(root, 'docs/audit/HANDOFF-PACKET.md')), false); pass('DB-only confirmation creates no packet projection'); }
  else pass('FILES canonical packet is its exact visible postimage');
  const sourcePath = captured.inner.context.documents.find(row => row.path === 'CURRENT-STATE.md')?.path; assert(sourcePath);
  await withConflict(root, sourcePath, false, async () => {
    const changed = await cold.host.prepareOperationDisposition(id, { expectedSha256: cold.host.inspect(captured.data.configuration.instance_id).record.instance_sha256 }); assert.equal(changed.assessment, 'unknown');
  }); assert.equal(business(), unchanged); pass('changed canonical context refuses the original packet confirmation');
  const confirmer = createStandardHandoffOperation({ targetRoot: root, readSigningKey: key,
    readCurrent: () => cold.host.inspect(captured.data.configuration.instance_id).record, readClaimed: operationId => cold.host.readJournal(operationId) });
  for (const field of ['plan_sha256', 'packet_plan_sha256', 'packet_sha256', 'resource_material_sha256']) {
    const mixed = structuredClone(captured.capsule.output); mixed.observations[field] = H('foreign ' + field);
    if (field === 'packet_sha256') mixed.evidence_refs[0].sha256 = mixed.observations[field];
    assert.equal(confirmer.confirmsOriginal(cold.host.inspect(captured.data.configuration.instance_id).record, original, mixed), false);
  } pass('typed output with foreign outer/inner plan, packet or resource witness is refused');
  plan = await cold.host.prepareOperationDisposition(id, { expectedSha256: cold.host.inspect(captured.data.configuration.instance_id).record.instance_sha256 });
  assert.equal(plan.assessment, 'confirmed_original'); const preparedAt = plan.prepared_at_ms, planSha = H(plan); allowed = false;
  await readonly('denied fresh disposition consent writes no audit, owner, fence or receipt', () => assert.rejects(cold.host.applyOperationDisposition(plan,
    { write: true, expectedPlanSha256: planSha }), { code: 'PROCESS_DISPOSITION_AUTHORIZATION_REQUIRED' }));
  allowed = true; clock += day + 600001;
  const recovered = await cold.host.applyOperationDisposition(plan, { write: true, expectedPlanSha256: planSha }); assert.equal(recovered.status, 'receipted');
  const receipted = cold.host.readJournal(id); signer.verify(receipted); assert.equal(receipted.results.length, 1);
  assert.deepEqual(receipted.results[0].output, captured.capsule.output); assert.equal(receipted.results[0].receipt.output_sha256, captured.capsule.output_sha256);
  for (const field of ['preview', 'intent', 'grant', 'owner']) assert.deepEqual(receipted[field], original[field]);
  assert.equal(H(plan), planSha); assert.equal(plan.prepared_at_ms, preparedAt); assert.equal(business(), unchanged);
  assert.equal(receipted.results[0].output.observations.permits_handoff, false); assert.equal(receipted.results[0].output.observations.complete_resource_closure, false);
  pass('old unchanged plan and new v2 consent recover exactly one original receipt without packet replay');
  const accepted = await cold.host.accept(id, { write: true }); assert.equal(accepted.cursor.status, 'COMPLETED'); assert.equal(business(), unchanged);
  const state = accepted.record, simulation = simulateAgenticProcess({ instanceId: state.instance_id, scopeId: state.scope_id, model: state.model,
    policyPins: state.policy_pins, facts: state.initial_facts, events: state.events,
    ...(state.initial_parameters === undefined ? {} : { parameters: state.initial_parameters }) });
  assert.equal(simulation.trace.at(-1).instance_sha256, state.instance_sha256); assert.equal(state.events.filter(e => e.kind === 'operation_result').length, 1);
  assert.equal(cold.counters.discovery, 0); assert.equal(cold.counters.publication_calls, 0); pass('ordinary common acceptance and same-reducer replay/SIM preserve the original business effect');
  await readonly('duplicate disposition and dispatch retain the exact accepted result', async () => {
    assert.equal((await cold.host.applyOperationDisposition(plan, { write: true, expectedPlanSha256: planSha })).status, 'retained_result');
    assert.equal((await cold.host.dispatch(id, { write: true })).status, 'retained_result');
  });
  const unknown = await produce('unknown'), stopped = open(unknown.data), unknownJournal = stopped.host.readJournal(unknown.data.operation_id);
  assert.equal(unknownJournal.results.length, 1); assert.equal(unknownJournal.results[0].receipt.effect_status, 'unknown'); assert.deepEqual(unknownJournal.results[0].output.facts, {});
  assert.equal(artifacts.ownerPending(), true); assert.equal(artifacts.read('HANDOFF-PACKET.md').sha256, unknown.inner.after_sha256);
  await readonly('terminated producer with held UNKNOWN remains unresolved with no new grant or replay', async () => {
    const retained = await stopped.host.prepareOperationDisposition(unknown.data.operation_id,
      { expectedSha256: stopped.host.inspect(unknown.data.configuration.instance_id).record.instance_sha256 }); assert.equal(retained.assessment, 'unknown');
    assert.equal((await stopped.host.applyOperationDisposition(retained, { write: true, expectedPlanSha256: H(retained) })).status, 'reconciliation_required');
    assert.equal((await stopped.host.dispatch(unknown.data.operation_id, { write: true })).status, 'retained_result');
  }); assert.equal(stopped.counters.disposition_grants, 0); assert.equal(stopped.counters.discovery, 0); assert.equal(stopped.counters.publication_calls, 0);
  console.log(JSON.stringify({ status: 'PASS', mode, checks, root, privateRoot, producer_exits: [42, 42], metadata_tamper: metadataCheck,
    actual_common_host_canonical_stores_signed_capture_disposition_receipt_acceptance_replay_SIM: true,
    original_discovery_and_operator_identity: 'CONTROLLED_FIXTURE', cold_publication_replays: 0, Native_calls: 0,
    held_UNKNOWN: 'RETAINED_UNRESOLVED', full_published_IR_handoff: 'NOT_IMPLEMENTED', post_release_complete_handoff: 'NOT_PROVEN',
    genuine_Native_Human_installed_provider_full_STANDARD: 'NOT_RUN' }));
}
