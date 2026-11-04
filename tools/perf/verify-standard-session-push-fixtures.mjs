import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createLocalWorkflowSessionPush } from '../../src/adapters/runtime/local-workflow-session-push.mjs';
import { createStandardSessionPush } from '../../src/application/runtime/standard-session-push.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
const temporary = fs.realpathSync(os.tmpdir()), owned = [], H = 'a'.repeat(64), op = x => 'op_' + x.repeat(40);
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
const tree = root => { const rows = []; const walk = at => { for (const name of fs.readdirSync(at).sort()) { const file = path.join(at, name); if (fs.lstatSync(file).isDirectory()) walk(file); else rows.push([path.relative(root, file).replaceAll('\\', '/'), shadowHash({ bytes: fs.readFileSync(file).toString('base64') })]); } }; walk(root); return shadowHash(rows); };
const mode = process.argv.find(x => x.startsWith('--mode='))?.slice(7) ?? 'files';
let checks = 0, cleanup = false;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
try {
  await test('closed push schemas and output facts reject fabricated completion before any transport', () => {
    for (const kind of ['input', 'plan', 'output']) {
      const name = 'standard-session-push-' + kind + '.v1';
      const schema = JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/' + name + '.schema.json', import.meta.url)));
      assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []);
    }
    assertStandardOperationInput('session_push', { contract_version: 'standard-session-push-input.v1', admission_operation_id: op('1') });
    const output = { contract_version: 'standard-session-push-output.v1', operation_ref: 'session_push', outcome: 'completed', effect_status: 'confirmed',
      observations: {}, facts: { session_remote_head_confirmed: true }, evidence_refs: [{ ref: 'git:session-push/' + op('2'), sha256: H }] };
    assertStandardOperationOutput(output); assertStandardOperationOutput({ ...output, effect_status: 'no_effect' });
    for (const mutate of [x => x.effect_status = 'unknown', x => x.facts = {}, x => x.facts.merged = true, x => x.evidence_refs = []]) {
      const bad = structuredClone(output); mutate(bad); assert.throws(() => assertStandardOperationOutput(bad), { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });
    }
  });
  const root = createFreshStandardWorkflowFixture(mode, owned), bare = fs.mkdtempSync(path.join(temporary, 'aidn-standard-push-')); owned.push(bare);
  git(bare, 'init', '--bare'); git(root, 'switch', '-c', 'S001-push');
  const head = git(root, 'rev-parse', 'HEAD'), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  const instance = { instance_id: 'push-fixture', instance_sha256: H };
  let accepted = { admission_operation_id: op('1'), output: { outcome: 'completed', effect_status: 'no_effect',
    facts: { session_pr_admitted: true, session_push_required: true, session_pr_open_required: false },
    observations: { session_id: 'S001', session_branch: 'S001-push', head } } };
  const port = createLocalWorkflowSessionPush({ targetRoot: root, remoteRoot: bare });
  const input = { contract_version: 'standard-session-push-input.v1', admission_operation_id: op('1') };
  const service = extra => createStandardSessionPush({ targetRoot: root, readAdmission: async () => structuredClone(accepted), readCurrent: () => instance, pushPort: port, ...extra });
  const readRemote = () => port.inspect('S001-push').remote_head;
  let plan;
  await test('preview reads real Git and pins absent remote head without creating a branch', async () => {
    plan = await service().prepare(instance, input, op('2')); assert.equal(plan.can_apply, true); assert.equal(plan.plan.git.remote_head, null);
    assert.equal(readRemote(), null); assert.equal(artifacts.ownerPending(), false); assert.equal(git(root, 'status', '--porcelain'), '');
  });
  await test('reused local capability refuses changed effective filters on its next observation', () => {
    git(root, 'config', 'filter.fixture.clean', 'echo forbidden');
    try { assert.throws(() => port.inspect('S001-push'), { code: 'WORKFLOW_BRANCH_FILTER_CONTEXT_CHANGED' }); }
    finally { git(root, 'config', '--remove-section', 'filter.fixture'); }
    assert.equal(readRemote(), null); assert.equal(fs.existsSync(path.join(root, 'forbidden')), false);
  });
  await test('missing exact intent, lost permission and changed admission refuse before remote effect', async () => {
    await assert.rejects(service().apply(instance, plan, { write: true, expectPlan: H, assertAuthorized() {} }), { code: 'STANDARD_SESSION_PUSH_EXPLICIT_EFFECT_REQUIRED' });
    await assert.rejects(service().apply(instance, plan, { write: true, expectPlan: plan.plan_sha256, assertAuthorized() { throw Error('denied'); } }));
    accepted.output.observations.head = 'b'.repeat(40);
    await assert.rejects(service().apply(instance, plan, { write: true, expectPlan: plan.plan_sha256, assertAuthorized() {} })); accepted.output.observations.head = head;
    assert.equal(readRemote(), null); assert.equal(artifacts.ownerPending(), false);
  });
  await test('expired preview cannot renew authority or produce a push', async () => {
    const expired = service({ now: () => plan.plan.prepared_at_ms + 300001 });
    await assert.rejects(expired.apply(instance, plan, { write: true, expectPlan: plan.plan_sha256, assertAuthorized() {} }), { code: 'STANDARD_SESSION_PUSH_EXPLICIT_EFFECT_REQUIRED' });
    assert.equal(readRemote(), null); assert.equal(artifacts.ownerPending(), false);
  });
  await test('dirty tree and URL rewrite are refused by real transport preview', () => {
    const dirty = path.join(root, 'uncommitted.txt'); fs.writeFileSync(dirty, 'pending'); assert.throws(() => port.inspect('S001-push')); fs.unlinkSync(dirty);
    git(root, 'config', 'url.file:///wrong/.insteadOf', 'file:///'); assert.throws(() => port.inspect('S001-push'), { code: 'WORKFLOW_PUSH_URL_REWRITE_UNSUPPORTED' });
    git(root, 'config', '--remove-section', 'url.file:///wrong/'); assert.equal(readRemote(), null);
  });
  await test('actual push changes only the expected remote ref, with no checkout pre-push hook', async () => {
    const marker = path.join(root, '.git/PUSH_HOOK_EXECUTED'), hook = path.join(root, '.git/hooks/pre-push');
    fs.writeFileSync(hook, '#!/bin/sh\necho executed > "' + marker.replaceAll('\\', '/') + '"\n'); fs.chmodSync(hook, 0o755);
    git(root, 'push', '--dry-run', '--', bare, 'HEAD:refs/heads/control-probe');
    assert.equal(fs.existsSync(marker), true); fs.unlinkSync(marker); assert.equal(readRemote(), null);
    const before = tree(root), refs = git(root, 'show-ref'), index = fs.readFileSync(path.join(root, '.git/index'));
    plan = await service().prepare(instance, input, op('2'));
    const result = await service().apply(instance, plan, { write: true, expectPlan: plan.plan_sha256, assertAuthorized() {} });
    assert.equal(result.outcome, 'completed', JSON.stringify(result)); assert.equal(result.effect_status, 'confirmed'); assertStandardOperationOutput(result);
    assert.equal(readRemote(), head); assert.equal(git(bare, 'for-each-ref', '--format=%(refname)'), 'refs/heads/S001-push');
    assert.equal(git(root, 'show-ref'), refs); assert.deepEqual(fs.readFileSync(path.join(root, '.git/index')), index);
    assert.equal(fs.existsSync(marker), false); assert.equal(artifacts.ownerPending(), false); assert.equal(tree(root), before);
  });
  await test('already present remote head is observed without replaying push', async () => {
    let calls = 0;
    const observed = createLocalWorkflowSessionPush({ targetRoot: root, remoteRoot: bare }, { afterPush() { calls++; } });
    const app = service({ pushPort: observed }); const ready = await app.prepare(instance, input, op('3'));
    const result = await app.apply(instance, ready, { write: true, expectPlan: ready.plan_sha256, assertAuthorized() {} });
    assert.equal(result.outcome, 'completed'); assert.equal(result.effect_status, 'no_effect'); assert.equal(calls, 0); assert.equal(result.observations.git.changed, false);
  });
  await test('remote drift after preview is refused without overwriting its new ref', async () => {
    const ready = await service().prepare(instance, input, op('4')), previous = git(root, 'rev-parse', 'HEAD^');
    git(bare, 'update-ref', 'refs/heads/S001-push', previous, head);
    await assert.rejects(service().apply(instance, ready, { write: true, expectPlan: ready.plan_sha256, assertAuthorized() {} }));
    assert.equal(readRemote(), previous); assert.equal(artifacts.ownerPending(), false); git(bare, 'update-ref', 'refs/heads/S001-push', head, previous);
  });
  await test('permission lost after actual remote effect yields unknown and retains the real owner', async () => {
    git(bare, 'update-ref', '-d', 'refs/heads/S001-push', head);
    let permitted = true;
    const transport = createLocalWorkflowSessionPush({ targetRoot: root, remoteRoot: bare }, { afterPush() { permitted = false; } });
    const app = service({ pushPort: transport }), ready = await app.prepare(instance, input, op('5'));
    const result = await app.apply(instance, ready, { write: true, expectPlan: ready.plan_sha256, assertAuthorized() { if (!permitted) throw Error('grant lost'); } });
    assert.equal(readRemote(), head); assert.equal(result.outcome, 'reconciliation_required'); assert.equal(result.effect_status, 'unknown'); assert.deepEqual(result.facts, {});
    assertStandardOperationOutput(result); assert.equal(artifacts.ownerPending(), true);
    assert.equal((await app.prepare(instance, input, op('6'))).reason_code, 'STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED');
  });
  console.log(JSON.stringify({ status: 'PASS', checks, state_mode: mode, transport: 'ACTUAL_LOCAL_BARE_GIT', stores: mode === 'files' ? 'ACTUAL_FILES' : 'ACTUAL_SQLITE',
    admission_closure_sources: 'INJECTED_FIXTURE', full_composition: 'NOT_RUN', github: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
} finally {
  for (const root of owned.reverse()) { const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary); assert.ok(/^aidn-standard-(?:fresh|push)-/.test(path.basename(real))); fs.rmSync(real, { recursive: true, force: true }); }
  cleanup = true; console.log(JSON.stringify({ cleanup_completed: cleanup }));
}
