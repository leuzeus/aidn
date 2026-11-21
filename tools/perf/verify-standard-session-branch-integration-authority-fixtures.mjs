import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStandardSessionBranchIntegrationAuthority } from '../../src/application/runtime/standard-session-branch-integration-authority.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
const temporary = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(temporary, 'aidn-integration-authority-'));
const H = 'a'.repeat(64), O = 'b'.repeat(40), op = x => 'op_' + x.repeat(40);
const put = (name, content) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const sourceBranch = 'C001-feature-example', sessionPath = 'sessions/S001.md', cyclePath = 'cycles/C001-feature-example/status.md';
put('.aidn/config.json', JSON.stringify({ version: 1, runtime: { stateMode: 'files' } }));
const sessionText = 'session_id: S001\nstate: CLOSED\nsession_closure_status: completed\nmode: COMMITTING\nsession_branch: S001-example\n';
const cycleText = 'state: DONE\nsession_owner: S001\nbranch_name: ' + sourceBranch + '\n';
put('docs/audit/' + sessionPath, sessionText); put('docs/audit/' + cyclePath, cycleText);
put('docs/audit/CURRENT-STATE.md', 'active_session: S001\n'); put('docs/audit/snapshots/context-snapshot.md', '# Snapshot\n');
const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
const event = { event: 'checkpoint_summary', run_id: 'process_close_' + op('b').slice(3), result: 'ok', skill: 'perf-checkpoint', mode: 'COMMITTING', branch: sourceBranch };
const eventPath = '.aidn/runtime/perf/workflow-events.ndjson', eventBytes = JSON.stringify(event) + '\n'; put(eventPath, eventBytes);
const input = { contract_version: 'standard-session-branch-integration-review-input.v1', delivery_operation_id: op('a'), closure_operation_id: op('b') };
const final = { session_id: 'S001', session_path: sessionPath, branch: sourceBranch, parent_head: O, material_sha256: H, postimages: [] };
const entry = (id, plan, output) => ({ record: { operation_id: id, preview: { prepared: { plan } } }, output });
const records = new Map([
  [op('a'), entry(op('a'), { input: { finalization_operation_id: op('f') }, source_sha256: shadowHash(final) }, { outcome: 'completed', effect_status: 'confirmed', facts: { session_delivery_checkpoint_completed: true }, observations: { finalization_operation_id: op('f'), git: { commit_sha: O } }, evidence_refs: [] })],
  [op('b'), entry(op('b'), { input: { closure_operation_id: op('c') }, scope: { session_id: 'S001', cycle_id: 'C001', branch: sourceBranch } }, { effect_status: 'confirmed', facts: { cycle_close_completed: true }, observations: { target_state: 'DONE', event_file: eventPath, event_offset: 0, event }, evidence_refs: [{ ref: 'docs/audit/' + cyclePath, sha256: artifacts.read(cyclePath).sha256 }] })],
  [op('c'), entry(op('c'), { input: { decision_operation_id: op('d') }, target_state: 'DONE' }, { effect_status: 'confirmed', facts: { cycle_terminal_recorded: true } })],
  [op('d'), entry(op('d'), {}, { effect_status: 'no_effect', observations: { choice: 'retain' } })],
]);
const instance = { events: [{ kind: 'operation_intent', intent: { operation_id: op('b'), binding_ref: 'cycle_close_finalize' } }, { kind: 'operation_result', receipt: { operation_id: op('b'), outcome: 'completed' } }] };
const initial = structuredClone([...records]);
const initialEvents = structuredClone(instance.events), siblingPath = 'cycles/C002-feature-other/status.md';
const service = createStandardSessionBranchIntegrationAuthority({ targetRoot: root, readAcceptedOperation: (_, id) => records.get(id), readDeliverySource: async () => structuredClone(final) });
const reset = () => { records.clear(); for (const [id, row] of structuredClone(initial)) records.set(id, row); instance.events = structuredClone(initialEvents);
  fs.rmSync(path.join(root, 'docs/audit/cycles/C002-feature-other'), { recursive: true, force: true });
  put(eventPath, eventBytes); put('docs/audit/' + sessionPath, sessionText); put('docs/audit/' + cyclePath, cycleText); };
function sibling(state = 'DONE') {
  put('docs/audit/' + siblingPath, cycleText.replace('state: DONE', 'state: ' + state).replace(sourceBranch, 'C002-feature-other'));
  const record = entry(op('e'), { scope: { session_id: 'S001', cycle_id: 'C002', branch: 'C002-feature-other' } }, {
    effect_status: 'confirmed', facts: { cycle_close_completed: true }, observations: { target_state: state },
    evidence_refs: [{ ref: 'docs/audit/' + siblingPath, sha256: artifacts.read(siblingPath).sha256 }] });
  records.set(op('e'), record);
  instance.events.push({ kind: 'operation_intent', intent: { operation_id: op('e'), binding_ref: 'cycle_close_finalize' } },
    { kind: 'operation_result', receipt: { operation_id: op('e'), outcome: 'completed' } });
}
let checks = 0;
const test = async (name, fn) => { reset(); await fn(); checks++; console.log('PASS ' + name); };
try {
  await test('derives the integration target only from the canonical closed owner and exact delivery/closure chain', async () => {
    const before = artifacts.read(sessionPath).sha256, result = await service.readSource(instance, input);
    assert.equal(result.target_branch, 'S001-example'); assert.equal(result.source_branch, sourceBranch); assert.equal(result.delivery_head, O);
    assert.equal(result.cycle_path, cyclePath); assert.equal(result.documents.length, 4); assert.equal(artifacts.read(sessionPath).sha256, before);
  });
  await test('CLOSED and DONE markers cannot replace a confirmed delivery and closure receipt', async () => {
    for (const id of [op('a'), op('b')]) { reset(); records.get(id).output.effect_status = 'unknown'; await assert.rejects(service.readSource(instance, input)); }
  });
  await test('distributed session continuity list resolves the same canonical integration target', async () => {
    put('docs/audit/' + sessionPath, sessionText.replace('session_branch:', '- session_branch:'));
    const result = await service.readSource(instance, input);
    assert.equal(result.target_branch, 'S001-example');
    assert.equal(result.source_branch, sourceBranch);
  });
  await test('NO_GO, DROPPED, report and non-retain decisions cannot authorize integration', async () => {
    for (const state of ['NO_GO', 'DROPPED']) { reset(); records.get(op('b')).output.observations.target_state = state; await assert.rejects(service.readSource(instance, input), { code: 'STANDARD_SESSION_INTEGRATION_RETAINED_CLOSURE_REQUIRED' }); }
    reset(); records.get(op('d')).output.observations.choice = 'report'; await assert.rejects(service.readSource(instance, input), { code: 'STANDARD_SESSION_INTEGRATION_RETAINED_CLOSURE_REQUIRED' });
  });
  await test('changed delivery source, physical closure event and event offset are refused', async () => {
    records.get(op('a')).record.preview.prepared.plan.source_sha256 = 'f'.repeat(64); await assert.rejects(service.readSource(instance, input), { code: 'STANDARD_SESSION_INTEGRATION_DELIVERY_CHANGED' });
    reset(); put(eventPath, JSON.stringify({ ...event, result: 'failed' }) + '\n'); await assert.rejects(service.readSource(instance, input), { code: 'STANDARD_SESSION_INTEGRATION_CLOSURE_EVENT_CHANGED' });
    reset(); records.get(op('b')).output.observations.event_offset = 2; await assert.rejects(service.readSource(instance, input), { code: 'STANDARD_SESSION_INTEGRATION_CLOSURE_EVENT_CHANGED' });
  });
  await test('canonical cycle/session owner, branch and lifecycle remain actual preconditions', async () => {
    for (const [name, text] of [[sessionPath, sessionText.replace('CLOSED', 'OPEN')], [cyclePath, cycleText.replace('S001', 'S002')], [cyclePath, cycleText.replace(sourceBranch, 'foreign')]]) {
      reset(); put('docs/audit/' + name, text); await assert.rejects(service.readSource(instance, input), { code: 'STANDARD_SESSION_INTEGRATION_CANONICAL_OWNER_CHANGED' });
    }
  });
  await test('a changed DONE postimage cannot authenticate itself through its lifecycle marker', async () => {
    put('docs/audit/' + cyclePath, cycleText + 'foreign: changed\n'); await assert.rejects(service.readSource(instance, input), { code: 'STANDARD_SESSION_INTEGRATION_POSTIMAGE_CHANGED' });
  });
  await test('an attached lifecycle marker without its own accepted terminal source refuses', async () => {
    put('docs/audit/cycles/C002-feature-other/status.md', cycleText.replace(sourceBranch, 'C002-feature-other'));
    await assert.rejects(service.readSource(instance, input), { code: 'STANDARD_SESSION_INTEGRATION_POSTIMAGE_CHANGED' });
  });
  await test('authenticated terminal siblings enter the fresh subject without replacing the selected cycle authority', async () => {
    for (const state of ['DONE', 'NO_GO', 'DROPPED']) {
      reset(); sibling(state); const source = await service.readSource(instance, input);
      assert.equal(source.cycle_id, 'C001'); assert.equal(source.closure_operation_id, op('b'));
      assert.equal(source.documents.length, 5); assert.ok(source.documents.some(row => row.ref === 'audit:' + siblingPath));
    }
  });
  await test('sibling status, owner, receipt and current postimage must all match its own original closure', async () => {
    for (const edit of [() => put('docs/audit/' + siblingPath, cycleText.replace('DONE', 'OPEN').replace(sourceBranch, 'C002-feature-other')),
      () => put('docs/audit/' + siblingPath, cycleText.replace('S001', 'S002').replace(sourceBranch, 'C002-feature-other')),
      () => { records.get(op('e')).output.effect_status = 'unknown'; },
      () => { records.get(op('e')).record.preview.prepared.plan.scope.cycle_id = 'C003'; },
      () => put('docs/audit/' + siblingPath, artifacts.read(siblingPath).content + 'foreign: changed\n')]) {
      reset(); sibling(); edit(); await assert.rejects(service.readSource(instance, input));
    }
  });
  console.log(JSON.stringify({ status: 'PASS', checks, canonical_files: 'ACTUAL', accepted_journal_and_R07_capabilities: 'FIXTURE', actual_hook_or_git_integration: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
} finally { const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary); assert.ok(path.basename(real).startsWith('aidn-integration-authority-')); fs.rmSync(real, { recursive: true, force: true }); }
