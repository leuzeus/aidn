import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createStandardSessionBranchIntegration } from '../../src/application/runtime/standard-session-branch-integration.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
const temp = fs.realpathSync(os.tmpdir()), roots = [], H = 'a'.repeat(64), op = x => 'op_' + x.repeat(40);
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
const put = (root, name, content) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
function fixture() {
  const root = fs.mkdtempSync(path.join(temp, 'aidn-session-integration-')); roots.push(root);
  const target = 'S001-example', source = 'C001-feature-example';
  git(root, 'init', '-b', target); git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'core.autocrlf', 'false'); git(root, 'config', 'commit.gpgSign', 'false');
  put(root, '.aidn/config.json', JSON.stringify({ version: 1, runtime: { stateMode: 'files' } })); put(root, '.gitignore', '.aidn/runtime/\n');
  const names = ['sessions/S001.md', 'cycles/C001-feature-example/status.md', 'CURRENT-STATE.md', 'snapshots/context-snapshot.md'];
  for (const name of names) put(root, 'docs/audit/' + name, '# Fixture canonical document\n');
  put(root, 'product.mjs', 'export const value = 1;\n'); git(root, 'add', '.'); git(root, 'commit', '-m', 'fixture session');
  git(root, 'switch', '-c', source); put(root, 'product.mjs', 'export const value = 2;\n'); git(root, 'add', '.'); git(root, 'commit', '-m', 'fixture retained delivery');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: root }), head = git(root, 'rev-parse', 'HEAD'), instance = { instance_id: 'fixture', instance_sha256: H };
  let decisionPlan = null, choice = 'integrate-to-session';
  const readSource = async () => ({ session_id: 'S001', session_path: names[0], cycle_id: 'C001', cycle_path: names[1], source_branch: source, target_branch: target,
    delivery_operation_id: op('a'), delivery_output_sha256: H, closure_operation_id: op('b'), closure_output_sha256: H, material_sha256: H, delivery_head: head,
    documents: names.map(name => ({ ref: 'audit:' + name, sha256: artifacts.read(name, { required: true }).sha256, metadata_sha256: artifacts.metadataHash(name) })) });
  const make = () => createStandardSessionBranchIntegration({ targetRoot: root, readSource, readCurrent: () => instance,
    readDecision: async () => ({ decision_operation_id: op('d'), choice, source_sha256: H, plan: decisionPlan }) });
  return { root, artifacts, instance, head, source, target, make, readSource, setPlan: plan => { decisionPlan = plan; }, setChoice: value => { choice = value; },
    reviewInput: { contract_version: 'standard-session-branch-integration-review-input.v1', delivery_operation_id: op('a'), closure_operation_id: op('b') },
    effectInput: { contract_version: 'standard-session-branch-integrate-input.v1', decision_operation_id: op('d') } };
}
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
try {
  const f = fixture(), service = f.make();
  let prepared;
  await test('decision preparation binds actual clean refs/index/filter/worktree and canonical document bytes without effects', async () => {
    const before = git(f.root, 'status', '--porcelain'), index = fs.readFileSync(path.join(f.root, '.git/index'));
    const selected = await service.prepareDecision(f.instance, f.reviewInput); f.setPlan(selected.plan);
    assert.equal(selected.plan.review.git.head, f.head); assert.equal(selected.plan.review.target_branch, f.target);
    assert.equal(git(f.root, 'status', '--porcelain'), before); assert.deepEqual(fs.readFileSync(path.join(f.root, '.git/index')), index); assert.equal(f.artifacts.ownerPending(), false);
  });
  await test('retain, promotion, refusal, report and cancellation cannot substitute integration consent', async () => {
    for (const choice of ['retain', 'promote', 'refused', 'deferred', 'cancelled']) { f.setChoice(choice);
      await assert.rejects(service.prepare(f.instance, f.effectInput, op('e')), { code: 'STANDARD_SESSION_INTEGRATION_DECISION_REQUIRED' }); }
    f.setChoice('integrate-to-session'); prepared = await service.prepare(f.instance, f.effectInput, op('e'));
  });
  await test('explicit write, exact preview and fresh grant are required before integration', async () => {
    await assert.rejects(service.apply(f.instance, prepared, { expectPlan: prepared.plan_sha256, assertAuthorized() {} }), { code: 'STANDARD_SESSION_INTEGRATION_EXPLICIT_EFFECT_REQUIRED', effect_status: 'no_effect' });
    await assert.rejects(service.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() { throw Object.assign(Error('denied'), { code: 'DENIED' }); } }), { code: 'DENIED', effect_status: 'no_effect' });
    assert.equal(git(f.root, 'symbolic-ref', 'HEAD'), 'refs/heads/' + f.source); assert.equal(f.artifacts.ownerPending(), false);
  });
  await test('canonical bytes changed after consent refuse before any ref or index effect', async () => {
    const file = path.join(f.root, 'docs/audit/sessions/S001.md'), before = fs.readFileSync(file); fs.writeFileSync(file, '# altered\n');
    await assert.rejects(service.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} }), { code: 'STANDARD_SESSION_INTEGRATION_REVIEW_INVALID', effect_status: 'no_effect' });
    assert.equal(git(f.root, 'symbolic-ref', 'HEAD'), 'refs/heads/' + f.source); assert.equal(f.artifacts.ownerPending(), false); fs.writeFileSync(file, before);
  });
  await test('cold application performs the actual bounded FF/ref/HEAD transaction and preserves every document and index byte', async () => {
    const index = fs.readFileSync(path.join(f.root, '.git/index')), source = await f.readSource();
    const result = await f.make().apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
    assert.equal(result.outcome, 'completed', JSON.stringify(result)); assert.equal(result.effect_status, 'confirmed'); assert.deepEqual(result.facts, { session_branch_integrated: true });
    assert.equal(git(f.root, 'symbolic-ref', 'HEAD'), 'refs/heads/' + f.target); assert.equal(git(f.root, 'rev-parse', f.target), f.head);
    assert.deepEqual(fs.readFileSync(path.join(f.root, '.git/index')), index); assert.equal(shadowHash(await f.readSource()), shadowHash(source));
    assert.equal(git(f.root, 'status', '--porcelain'), ''); assert.equal(f.artifacts.ownerPending(), false);
    await assert.rejects(f.make().apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} }), { code: 'STANDARD_SESSION_INTEGRATION_REVIEW_INVALID', effect_status: 'no_effect' });
  });
  await test('grant loss after the actual Git transaction retains an unknown owner, empty facts and no retry', async () => {
    const g = fixture(), host = g.make(), selected = await host.prepareDecision(g.instance, g.reviewInput); g.setPlan(selected.plan);
    const pending = await host.prepare(g.instance, g.effectInput, op('f')); let grants = 0;
    const result = await host.apply(g.instance, pending, { write: true, expectPlan: pending.plan_sha256, assertAuthorized() { if (++grants === 5) throw Object.assign(Error('lost'), { code: 'LOST' }); } });
    assert.equal(result.outcome, 'reconciliation_required'); assert.equal(result.effect_status, 'unknown'); assert.deepEqual(result.facts, {});
    assert.equal(git(g.root, 'symbolic-ref', 'HEAD'), 'refs/heads/' + g.target); assert.equal(g.artifacts.ownerPending(), true);
    const before = git(g.root, 'reflog', '-1', '--format=%gs', 'HEAD');
    assert.deepEqual(await g.make().prepare(g.instance, g.effectInput, op('e')), { can_apply: false, reason_code: 'STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED' });
    assert.equal(git(g.root, 'reflog', '-1', '--format=%gs', 'HEAD'), before);
  });
  console.log(JSON.stringify({ status: 'PASS', checks, git: 'ACTUAL', artifacts: 'ACTUAL_FILES', accepted_human_and_closure_sources: 'FIXTURE_CAPABILITIES', model_calls: 0, complete_standard_workflow: false, native: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
} finally { for (const root of roots.reverse()) { const real = fs.realpathSync(root); assert.equal(path.dirname(real), temp); assert.ok(path.basename(real).startsWith('aidn-session-integration-')); fs.rmSync(real, { recursive: true, force: true }); } }
