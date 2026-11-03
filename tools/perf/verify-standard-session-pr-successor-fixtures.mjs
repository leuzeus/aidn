import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPrSuccessorFixture } from './standard-session-pr-successor-fixture-lib.mjs';
import { createLocalWorkflowSessionPush } from '../../src/adapters/runtime/local-workflow-session-push.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
const temporary = fs.realpathSync(os.tmpdir()), owned = [], H = 'a'.repeat(64), op = n => 'op_' + n.repeat(40);
const mode = process.argv.find(x => x.startsWith('--mode='))?.slice(7) ?? 'files';
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
let checks = 0; const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
const grant = prepared => ({ write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
async function checkpoint(f) {
  const prepared = await f.checkpoint.prepare(f.instance, f.checkpointInput, f.checkpointId);
  assert.equal(prepared.can_apply, true, JSON.stringify(prepared));
  const output = await f.checkpoint.apply(f.instance, prepared, grant(prepared));
  assert.equal(output.outcome, 'completed', JSON.stringify(output)); assertStandardOperationOutput(output);
  f.records.set(f.checkpointId, { record: { operation_id: f.checkpointId, intent: { binding_ref: 'session_pr_checkpoint' }, preview: { input: f.checkpointInput, prepared } }, output });
  return output;
}
try {
  await test('closed successor contracts distinguish checkpoint and exact-head review from approval or merge', () => {
    for (const operation of ['checkpoint', 'update-push']) for (const kind of ['input', 'plan', 'output']) {
      const schema = JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/standard-session-pr-' + operation + '-' + kind + '.v1.schema.json', import.meta.url)));
      assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []);
    }
    assertStandardOperationInput('session_pr_checkpoint', { record_operation_id: op('2') });
    assertStandardOperationInput('session_pr_update_push', { contract_version: 'standard-session-pr-update-push-input.v1', checkpoint_operation_id: op('3') });
  });
  const f = await createPrSuccessorFixture(mode, owned, temporary);
  const physical = () => f.names.map(name => { const file = path.join(f.root, 'docs/audit', name); return fs.existsSync(file) ? fs.readFileSync(file).toString('base64') : null; });
  const initialFiles = physical(), originalHashes = shadowHash(f.source.documents), postimages = shadowHash(f.recorded.output.observations.postimages);
  await test('successor authority accepts only recorded new postimages and refuses old delivery hashes or owner markers', () => {
    const source = f.authority.readSource(f.instance, f.checkpointInput); assert.equal(source.parent_head, f.head);
    assert.equal(shadowHash(source.postimages), postimages); assert.notEqual(source.postimages[0].sha256, f.source.documents[0].sha256);
    const rows = f.recorded.output.observations.postimages; f.recorded.output.observations.postimages = f.source.documents;
    assert.throws(() => f.authority.readSource(f.instance, f.checkpointInput), { code: 'STANDARD_PR_SUCCESSOR_POSTIMAGE_CHANGED' }); f.recorded.output.observations.postimages = rows;
    const old = f.history.documents[0].sha256; f.history.documents[0].sha256 = 'b'.repeat(64);
    assert.throws(() => f.authority.readSource(f.instance, f.checkpointInput), { code: 'STANDARD_PR_SUCCESSOR_HISTORY_CHANGED' }); f.history.documents[0].sha256 = old;
    f.recorded.output.effect_status = 'unknown'; assert.throws(() => f.authority.readSource(f.instance, f.checkpointInput)); f.recorded.output.effect_status = 'confirmed';
  });
  await test('preview and denied checkpoint leave canonical PR postimages and Git unchanged', async () => {
    const before = git(f.root, 'status', '--porcelain'), ready = await f.checkpoint.prepare(f.instance, f.checkpointInput, f.checkpointId);
    assert.equal(ready.can_apply, true); await assert.rejects(f.checkpoint.apply(f.instance, ready, { ...grant(ready), write: false }));
    assert.equal(git(f.root, 'status', '--porcelain'), before); assert.deepEqual(physical(), initialFiles); assert.equal(f.artifacts.ownerPending(), false);
  });
  await test('actual Git checkpoint commits only canonical successor files and DB-only keeps the exact HEAD', async () => {
    const output = await checkpoint(f), head = output.observations.git.commit_sha ?? output.observations.git.head;
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), head); assert.equal(git(f.root, 'status', '--porcelain'), '');
    assert.equal(shadowHash(f.source.documents), originalHashes); assert.equal(shadowHash(f.recorded.output.observations.postimages), postimages); assert.deepEqual(physical(), initialFiles);
    if (mode === 'db-only') { assert.equal(head, f.head); assert.equal(output.effect_status, 'no_effect'); }
    else { assert.notEqual(head, f.head); assert.deepEqual(git(f.root, 'diff-tree', '--no-commit-id', '--name-only', '-r', head).split(/\r?\n/).sort(), f.names.map(name => 'docs/audit/' + name).sort()); }
    assert.equal(f.artifacts.ownerPending(), false);
  });
  await test('changed PR identity or stale grant refuses the update before any Git remote effect', async () => {
    const app = f.update(), ready = await app.prepare(f.instance, f.updateInput, op('4'));
    await assert.rejects(app.apply(f.instance, ready, { ...grant(ready), expectPlan: 'b'.repeat(64) }));
    await assert.rejects(f.update({ now: () => ready.plan.prepared_at_ms + 300001 }).apply(f.instance, ready, grant(ready)));
    const file = path.join(path.dirname(f.remote), 'pr-open-provider-fixture.json');
    const state = f.provider.read(); const snapshot = fs.readFileSync(file); state.pulls[0].node_id = 'PR_foreign'; fs.writeFileSync(file, JSON.stringify(state));
    await assert.rejects(app.apply(f.instance, ready, grant(ready))); fs.writeFileSync(file, snapshot);
    assert.equal(f.pushPort.inspect('S001-record').remote_head, f.head); assert.equal(f.artifacts.ownerPending(), false);
  });
  await test('real update push reobserves provider HEAD and leaves review/checks pending without inheriting old approvals', async () => {
    const app = f.update(), ready = await app.prepare(f.instance, f.updateInput, op('4')), output = await app.apply(f.instance, ready, grant(ready));
    assert.equal(output.outcome, 'completed', JSON.stringify(output)); assertStandardOperationOutput(output);
    assert.deepEqual(output.facts, { session_pr_head_confirmed: true, session_pr_review_required: true });
    assert.equal(output.observations.pull_request.head_oid, git(f.root, 'rev-parse', 'HEAD')); assert.equal(output.observations.review_head, output.observations.pull_request.head_oid);
    assert.equal(output.observations.inherited_review_evidence, 'none'); assert.equal(output.observations.checks, 'pending'); assert.equal(output.observations.review, 'pending');
    assert.equal(output.observations.previous_head, f.head); assert.equal(f.provider.read().posts, 1); assert.equal(f.artifacts.ownerPending(), false);
    const bad = structuredClone(output); bad.facts.session_pr_merged = true; assert.throws(() => assertStandardOperationOutput(bad));
    if (mode === 'db-only') { assert.equal(output.effect_status, 'no_effect'); assert.equal(output.observations.git.changed, false); }
    else { assert.equal(output.effect_status, 'confirmed'); await assert.rejects(app.prepare(f.instance, f.updateInput, op('5'))); }
  });
  if (mode === 'files') await test('lost grant after an actual update retains unknown ownership and never authorizes a second push', async () => {
    const partial = await createPrSuccessorFixture(mode, owned, temporary); await checkpoint(partial); let allowed = true;
    const pushPort = createLocalWorkflowSessionPush({ targetRoot: partial.root, remoteRoot: partial.remote }, { afterPush() { allowed = false; } });
    const app = partial.update({ pushPort }), ready = await app.prepare(partial.instance, partial.updateInput, op('4'));
    const output = await app.apply(partial.instance, ready, { ...grant(ready), assertAuthorized() { if (!allowed) throw Error('grant revoked'); } });
    assert.equal(output.effect_status, 'unknown'); assert.equal(output.outcome, 'reconciliation_required'); assert.deepEqual(output.facts, {}); assertStandardOperationOutput(output);
    assert.notEqual(pushPort.inspect('S001-record').remote_head, partial.head); assert.equal(partial.artifacts.ownerPending(), true);
    assert.equal((await app.prepare(partial.instance, partial.updateInput, op('5'))).can_apply, false);
  });
  console.log(JSON.stringify({ status: 'PASS', checks, state_mode: mode, canonical_writer_checkpoint_push: 'ACTUAL', git_remote: 'ACTUAL_LOCAL_BARE', github_adapter: 'ACTUAL', http: 'DOUBLED_REST',
    accepted_operation_lookup_and_history: 'INJECTED_FIXTURE', full_signed_standard_chain: 'NOT_RUN', real_github: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
} finally {
  for (const root of owned.reverse()) { const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary); assert.ok(/^aidn-standard-(fresh|pr-successor)-/.test(path.basename(real))); fs.rmSync(real, { recursive: true, force: true }); }
  console.log(JSON.stringify({ cleanup_completed: true }));
}
