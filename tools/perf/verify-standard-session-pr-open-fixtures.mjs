import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createGithubPrOpenTransportFixture } from './github-pr-open-fixture-lib.mjs';
import { createStandardSessionPrOpen } from '../../src/application/runtime/standard-session-pr-open.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
const temporary = fs.realpathSync(os.tmpdir()), owned = [], H = 'a'.repeat(64), op = x => 'op_' + x.repeat(40);
const mode = process.argv.find(x => x.startsWith('--mode='))?.slice(7) ?? 'files';
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
try {
  await test('closed contracts distinguish an observed open PR from review/merge/sync completion', () => {
    for (const kind of ['input', 'plan', 'output']) {
      const schema = JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/standard-session-pr-open-' + kind + '.v1.schema.json', import.meta.url)));
      assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []);
    }
    assertStandardOperationInput('session_pr_open', { contract_version: 'standard-session-pr-open-input.v1', push_operation_id: op('1') });
    const output = { contract_version: 'standard-session-pr-open-output.v1', operation_ref: 'session_pr_open', outcome: 'completed', effect_status: 'confirmed', observations: {},
      facts: { session_pr_open_confirmed: true }, evidence_refs: [{ ref: 'github:pull-request/PR_fixture', sha256: H }] };
    assertStandardOperationOutput(output);
    for (const mutate of [x => x.facts.merged = true, x => x.effect_status = 'unknown', x => x.evidence_refs = []]) {
      const bad = structuredClone(output); mutate(bad); assert.throws(() => assertStandardOperationOutput(bad), { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });
    }
  });
  const root = createFreshStandardWorkflowFixture(mode, owned), base = fs.mkdtempSync(path.join(temporary, 'aidn-standard-pr-open-')); owned.push(base);
  const remote = path.join(base, 'remote.git'); fs.mkdirSync(remote); git(remote, 'init', '--bare');
  git(root, '-c', 'core.hooksPath=NUL', 'push', '--', remote, 'HEAD:refs/heads/dev'); git(root, 'switch', '-c', 'S001-example');
  fs.writeFileSync(path.join(root, 'pr-component.txt'), 'Explicit fixture delivery difference\n'); git(root, 'add', 'pr-component.txt');
  git(root, '-c', 'core.hooksPath=NUL', 'commit', '-m', 'test: arrange distinct session delivery');
  git(root, '-c', 'core.hooksPath=NUL', 'push', '--', remote, 'HEAD:refs/heads/S001-example');
  const head = git(root, 'rev-parse', 'HEAD'), instance = { instance_id: 'fixture-pr-open', instance_sha256: H }, artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  // Only these previously accepted capabilities are injected. Application,
  // owner, closed contracts and the GitHub adapter are actual; HTTP is doubled.
  let source = { push_operation_id: op('1'), output: { outcome: 'completed', effect_status: 'confirmed', facts: { session_remote_head_confirmed: true },
    observations: { session_id: 'S001', git: { branch: 'S001-example', head, remote_head: head } } },
    admission: { outcome: 'completed', facts: { session_pr_admitted: true }, observations: { session_id: 'S001', session_branch: 'S001-example', head, admission: { source_branch: 'dev' } } } };
  const input = { contract_version: 'standard-session-pr-open-input.v1', push_operation_id: op('1') }, provider = createGithubPrOpenTransportFixture({ remoteRoot: remote, controlRoot: base });
  const service = extra => createStandardSessionPrOpen({ targetRoot: root, readPush: async () => structuredClone(source), readCurrent: () => instance, pullRequestPort: provider.port, ...extra });
  let ready;
  await test('preparation reads actual remote heads through the provider adapter without POST or owner', async () => {
    ready = await service().prepare(instance, input, op('2')); assert.equal(ready.can_apply, true); assert.equal(provider.read().posts, 0); assert.equal(artifacts.ownerPending(), false);
  });
  await test('changed source, expired plan or missing exact permission refuse before provider effect', async () => {
    await assert.rejects(service().apply(instance, ready, { write: false, expectPlan: ready.plan_sha256, assertAuthorized() {} }));
    await assert.rejects(service({ now: () => ready.plan.prepared_at_ms + 300001 }).apply(instance, ready, { write: true, expectPlan: ready.plan_sha256, assertAuthorized() {} }));
    source.output.effect_status = 'unknown'; await assert.rejects(service().apply(instance, ready, { write: true, expectPlan: ready.plan_sha256, assertAuthorized() {} })); source.output.effect_status = 'confirmed';
    assert.equal(provider.read().posts, 0); assert.equal(artifacts.ownerPending(), false);
  });
  await test('application creates one remote PR through the actual adapter and emits only the open fact', async () => {
    ready = await service().prepare(instance, input, op('2'));
    const result = await service().apply(instance, ready, { write: true, expectPlan: ready.plan_sha256, assertAuthorized() {} });
    assert.equal(result.outcome, 'completed', JSON.stringify(result)); assert.equal(result.effect_status, 'confirmed'); assert.equal(result.observations.pull_request.head_oid, head);
    assertStandardOperationOutput(result); assert.deepEqual(result.facts, { session_pr_open_confirmed: true }); assert.equal(provider.read().posts, 1); assert.equal(artifacts.ownerPending(), false);
  });
  await test('fresh explicit recovery observes the same PR without another create or checkout change', async () => {
    const status = git(root, 'status', '--porcelain'), refs = git(root, 'show-ref');
    const app = service(), plan = await app.prepare(instance, input, op('3')), result = await app.apply(instance, plan, { write: true, expectPlan: plan.plan_sha256, assertAuthorized() {} });
    assert.equal(result.outcome, 'completed'); assert.equal(result.effect_status, 'no_effect'); assert.equal(result.observations.action, 'recovered'); assert.equal(provider.read().posts, 1);
    assert.equal(git(root, 'status', '--porcelain'), status); assert.equal(git(root, 'show-ref'), refs); assert.equal(artifacts.ownerPending(), false);
  });
  await test('loss of authority after create retains an unknown result and blocks a fresh operation', async () => {
    const control = path.join(base, 'unknown'); fs.mkdirSync(control); let granted = true;
    const uncertain = createGithubPrOpenTransportFixture({ remoteRoot: remote, controlRoot: control, afterPost() { granted = false; } });
    const app = service({ pullRequestPort: uncertain.port }), plan = await app.prepare(instance, input, op('4'));
    const result = await app.apply(instance, plan, { write: true, expectPlan: plan.plan_sha256, assertAuthorized() { if (!granted) throw Error('denied'); } });
    assert.equal(result.outcome, 'reconciliation_required'); assert.equal(result.effect_status, 'unknown'); assert.deepEqual(result.facts, {}); assertStandardOperationOutput(result);
    assert.equal(uncertain.read().posts, 1); assert.equal(artifacts.ownerPending(), true); assert.equal((await app.prepare(instance, input, op('5'))).can_apply, false);
  });
  console.log(JSON.stringify({ status: 'PASS', checks, state_mode: mode, application_owner_github_adapter: 'ACTUAL', remote_refs: 'ACTUAL_LOCAL_BARE_GIT',
    accepted_push_admission_sources: 'INJECTED_FIXTURE', http: 'DOUBLED_REST', full_standard_composition: 'NOT_RUN', real_github: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
} finally {
  for (const root of owned.reverse()) { const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary); assert.ok(/^aidn-standard-(?:fresh|pr-open)-/.test(path.basename(real))); fs.rmSync(real, { recursive: true, force: true }); }
  console.log(JSON.stringify({ cleanup_completed: true }));
}
