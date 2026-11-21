import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStandardSessionPrRecordAuthority } from '../../src/application/runtime/standard-session-pr-record-authority.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'aidn-pr-record-authority-')), H = 'a'.repeat(64), oid = 'a'.repeat(40), id = x => 'op_' + x.repeat(40);
const relative = '.aidn/runtime/perf/workflow-events.ndjson', file = path.join(root, relative), branch = 'feature/C001-closed';
fs.mkdirSync(path.dirname(file), { recursive: true });
const cycleEvent = { event: 'checkpoint_summary', result: 'ok', skill: 'perf-checkpoint', run_id: 'process_close_' + id('7').slice(3), branch, mode: 'COMMITTING' };
const finalEvent = { event: 'hook_session_close', result: 'ok', run_id: 'fixture_final', branch, mode: 'COMMITTING' };
const prefix = JSON.stringify(cycleEvent) + '\n', bytes = prefix + JSON.stringify(finalEvent) + '\n'; fs.writeFileSync(file, bytes);
const observation = (event, offset) => ({ event_file: relative, event_offset: offset, event });
const docs = ['sessions/S001.md', 'cycles/C001-feature/status.md', 'CURRENT-STATE.md', 'snapshots/context-snapshot.md'].map(name => ({ ref: 'audit:' + name, sha256: H, metadata_sha256: null }));
const link = { contract_version: 'github-pr-link.v1', repository_id: 'R_fixture', node_id: 'PR_fixture', number: 1, head_branch: 'S001-record', base_branch: 'dev', head_oid: oid, base_oid: 'b'.repeat(40), state: 'OPEN', draft: false, url: 'https://github.com/fixture/repository/pull/1', title_sha256: H, body_sha256: H };
const record = (key, binding, input, prepared, output) => ({ record: { operation_id: id(key), intent: { binding_ref: binding }, preview: { input, prepared } }, output: { outcome: 'completed', effect_status: 'confirmed', facts: {}, observations: {}, ...output } });
const records = new Map([
  [id('1'), record('1', 'session_pr_open', { push_operation_id: id('2') }, { plan: { provider: { plan: { request: { head_branch: link.head_branch } } } } }, { facts: { session_pr_open_confirmed: true }, observations: { session_id: 'S001', pull_request: link } })],
  [id('2'), record('2', 'session_push', { admission_operation_id: id('3') }, {}, { facts: { session_remote_head_confirmed: true }, observations: { git: { remote_head: oid } } })],
  [id('3'), record('3', 'session_pr_admit', { integration_operation_id: id('4') }, {}, { effect_status: 'no_effect' })],
  [id('4'), record('4', 'session_branch_integrate', {}, { plan: { review: { delivery_operation_id: id('5'), closure_operation_id: id('7'), session_id: 'S001', session_path: 'sessions/S001.md', source_branch: branch, target_branch: link.head_branch, documents: docs } } }, {})],
  [id('5'), record('5', 'session_delivery_checkpoint', { finalization_operation_id: id('6') }, {}, {})],
  [id('6'), record('6', 'session_close_finalize', {}, { plan: { session_id: 'S001', run_id: 'fixture_final' } }, { facts: { session_close_completed: true }, observations: observation(finalEvent, Buffer.byteLength(prefix)) })],
  [id('7'), record('7', 'cycle_close_finalize', {}, {}, { facts: { cycle_close_completed: true }, observations: { ...observation(cycleEvent, 0), target_state: 'DONE' } })],
]);
let observed = link, lookups = 0;
const authority = createStandardSessionPrRecordAuthority({ targetRoot: root, readAcceptedOperation(_instance, operationId, binding) {
  lookups++; const selected = records.get(operationId); assert.equal(selected?.record.intent.binding_ref, binding); return structuredClone(selected);
}, pullRequestPort: { prepare() { const plan = { observed: { existing: observed } }; return { can_apply: true, plan, plan_sha256: shadowHash(plan) }; } } });
let checks = 0; const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); }, instance = { instance_id: 'fixture' }, input = { open_operation_id: id('1') };
try {
  await test('historical accepted chain and actual physical closure events produce immutable predecessor hashes', async () => {
    const source = await authority.readSource(instance, input); assert.equal(lookups, 7); assert.deepEqual(source.documents.map(row => row.path), ['sessions/S001.md', 'CURRENT-STATE.md', 'snapshots/context-snapshot.md']);
    assert.equal(source.open_operation_id, id('1')); assert.equal(source.documents[0].sha256, H);
  });
  await test('provider head and PR identity changes refuse lifecycle recording', async () => {
    observed = { ...link, head_oid: 'c'.repeat(40) }; await assert.rejects(authority.readSource(instance, input), { code: 'STANDARD_PR_RECORD_REMOTE_CHANGED' }); observed = link;
  });
  await test('changed physical event bytes cannot be replaced by CLOSED or DONE markers', async () => {
    fs.writeFileSync(file, bytes.replace('checkpoint_summary', 'checkpoint_forgery')); await assert.rejects(authority.readSource(instance, input)); fs.writeFileSync(file, bytes);
  });
  await test('unretained closure and missing predecessor document evidence fail before a writer', async () => {
    const closed = records.get(id('7')); closed.output.observations.target_state = 'NO_GO'; await assert.rejects(authority.readSource(instance, input)); closed.output.observations.target_state = 'DONE';
    const review = records.get(id('4')).record.preview.prepared.plan.review; const original = review.documents; review.documents = original.filter(row => row.ref !== 'audit:CURRENT-STATE.md'); await assert.rejects(authority.readSource(instance, input)); review.documents = original;
  });
  console.log(JSON.stringify({ status: 'PASS', checks, physical_files: 'ACTUAL', accepted_operation_capability: 'INJECTED_FIXTURE', provider_observation: 'INJECTED_FIXTURE', canonical_writer: 'NOT_RUN', full_standard_composition: 'NOT_RUN' }));
} finally { assert.equal(path.dirname(fs.realpathSync(root)), parent); assert.ok(path.basename(root).startsWith('aidn-pr-record-authority-')); fs.rmSync(root, { recursive: true, force: true }); console.log(JSON.stringify({ cleanup_completed: true })); }
