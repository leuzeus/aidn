import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPrSuccessorFixture } from './standard-session-pr-successor-fixture-lib.mjs';
import { createLocalWorkflowBranchIntegration } from '../../src/adapters/runtime/local-workflow-branch-integration.mjs';
import { createStandardSessionPrRedeliveryAuthority } from '../../src/application/runtime/standard-session-pr-redelivery-authority.mjs';
import { createStandardSessionPrUpdatePush } from '../../src/application/runtime/standard-session-pr-update-push.mjs';
import { createStandardSessionPrReviewAuthority } from '../../src/application/runtime/standard-session-pr-review-authority.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
const owned = [], mode = process.argv.find(x => x.startsWith('--mode='))?.slice(7) ?? 'files';
const op = n => 'op_' + n.repeat(40), git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
const grant = prepared => ({ write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
try {
  const f = await createPrSuccessorFixture(mode, owned, fs.realpathSync(os.tmpdir()));
  const checkpoint = await f.checkpoint.prepare(f.instance, f.checkpointInput, f.checkpointId);
  const checkpointOutput = await f.checkpoint.apply(f.instance, checkpoint, grant(checkpoint));
  assert.equal(checkpointOutput.outcome, 'completed');
  f.records.set(f.checkpointId, { record: { operation_id: f.checkpointId, intent: { binding_ref: 'session_pr_checkpoint' }, preview: { input: f.checkpointInput, prepared: checkpoint } }, output: checkpointOutput });
  const initial = f.update(), initialPlan = await initial.prepare(f.instance, f.updateInput, op('4'));
  const initialOutput = await initial.apply(f.instance, initialPlan, grant(initialPlan)); assert.equal(initialOutput.outcome, 'completed');
  f.records.set(op('4'), { record: { operation_id: op('4'), intent: { binding_ref: 'session_pr_update_push' }, preview: { prepared: initialPlan } }, output: initialOutput });
  f.records.set(op('1'), { record: f.history.open.record, output: { outcome: 'completed', effect_status: 'confirmed', facts: { session_pr_open_confirmed: true }, observations: { session_id: 'S001', pull_request: f.source.pull_request } } });
  git(f.root, 'checkout', '-b', 'C002-correction'); fs.writeFileSync(path.join(f.root, 'product.txt'), 'A separately committed corrective product change\n');
  git(f.root, 'add', 'product.txt'); git(f.root, 'commit', '-m', 'feat: correct disposable product');
  const local = createLocalWorkflowBranchIntegration({ targetRoot: f.root });
  const observed = local.inspect({ source_branch: 'C002-correction', target_branch: 'S001-record' });
  const canonical = { session_id: 'S001', cycle_id: 'C002', source_branch: 'C002-correction', target_branch: 'S001-record', delivery_head: observed.head };
  const integrationPlan = { operation_id: op('6'), input: { decision_operation_id: op('5') }, review: { ...canonical, git: observed } };
  const localPlan = { operation_id: op('6'), plan_sha256: shadowHash(integrationPlan), observed };
  const proof = await local.integrate(localPlan, { write: true, assertAuthorized() {} });
  const integrated = { integration_operation_id: op('6'), canonical, plan: integrationPlan,
    output: { outcome: 'completed', effect_status: 'confirmed', facts: { session_branch_integrated: true }, observations: { decision_operation_id: op('5'), git: proof } } };
  f.records.set(op('6'), { record: { operation_id: op('6'), intent: { binding_ref: 'session_branch_integrate' }, preview: { prepared: { plan: integrationPlan } } }, output: integrated.output });
  const cycle = { record: { operation_id: op('7'), intent: { binding_ref: 'session_pr_correction_cycle_initialize' }, preview: { prepared: { plan: {
    input: { cycle_id: 'C002' }, review: { session_id: 'S001' }, origin: { session_id: 'S001', update_operation_id: op('4'), pull_request: initialOutput.observations.pull_request } } } } },
    output: { outcome: 'completed', effect_status: 'confirmed', facts: { session_pr_correction_cycle_initialized: true } } };
  f.records.set(op('7'), cycle);
  const instance = { ...f.instance, events: [{ kind: 'operation_intent', intent: { operation_id: op('1'), binding_ref: 'session_pr_open' } },
    { kind: 'operation_result', receipt: { operation_id: op('1'), outcome: 'completed' } }] };
  function accepted(_instance, id, binding) { const row = f.records.get(id); assert.equal(row?.record.intent?.binding_ref ?? (id === op('1') ? 'session_pr_open' : null), binding); return structuredClone(row); }
  const authority = createStandardSessionPrRedeliveryAuthority({ readAcceptedOperation: accepted,
    readAcceptedUpdate: (state, id) => accepted(state, id, 'session_pr_update_push'), readIntegration: async () => structuredClone(integrated), inspectIntegration: () => local.inspectIntegration(localPlan) });
  const input = { contract_version: 'standard-session-pr-redelivery-push-input.v1', integration_operation_id: op('6'), cycle_operation_id: op('7') };
  const app = createStandardSessionPrUpdatePush({ targetRoot: f.root, redelivery: true, readCheckpoint: authority.readSource,
    readCurrent: () => instance, pushPort: f.pushPort, pullRequestPort: f.provider.port });
  await test('new contract accepts only separate corrective integration and admitted cycle identities', () => {
    assertStandardOperationInput('session_pr_redelivery_push', input);
    assert.throws(() => assertStandardOperationInput('session_pr_update_push', input));
    assert.throws(() => assertStandardOperationInput('session_pr_redelivery_push', { ...input, checkpoint_operation_id: op('3') }));
  });
  await test('authority authenticates prior PR and real current integration without old canonical postimages', async () => {
    const source = await authority.readSource(instance, input); assert.equal(source.delivery_head, observed.head);
    assert.equal(source.parent_head, initialOutput.observations.review_head); assert.notEqual(source.delivery_head, source.parent_head);
    assert.equal(git(f.root, 'branch', '--show-current'), 'S001-record');
  });
  await test('foreign cycle, uncertain integration and changed prior PR never authorize redelivery', async () => {
    cycle.record.preview.prepared.plan.input.cycle_id = 'C003'; await assert.rejects(authority.readSource(instance, input)); cycle.record.preview.prepared.plan.input.cycle_id = 'C002';
    integrated.output.effect_status = 'unknown'; await assert.rejects(authority.readSource(instance, input)); integrated.output.effect_status = 'confirmed';
    cycle.record.preview.prepared.plan.origin.pull_request.head_oid = '0'.repeat(40); await assert.rejects(authority.readSource(instance, input));
    cycle.record.preview.prepared.plan.origin.pull_request.head_oid = initialOutput.observations.review_head;
  });
  const prepared = await app.prepare(instance, input, op('8'));
  await test('preview and missing authorization leave real remote and local owner unchanged', async () => {
    const head = f.pushPort.inspect('S001-record').remote_head;
    await assert.rejects(app.apply(instance, prepared, { ...grant(prepared), write: false }));
    await assert.rejects(app.apply(instance, prepared, { ...grant(prepared), assertAuthorized() { throw Error('revoked'); } }));
    assert.equal(f.pushPort.inspect('S001-record').remote_head, head); assert.equal(f.artifacts.ownerPending(), false);
  });
  let delivered;
  await test('actual corrective push binds the new PR HEAD and resets checks and review', async () => {
    delivered = await app.apply(instance, prepared, grant(prepared)); assert.equal(delivered.outcome, 'completed', JSON.stringify(delivered));
    assertStandardOperationOutput(delivered); assert.equal(delivered.observations.review_head, observed.head);
    assert.equal(delivered.observations.integration_operation_id, op('6')); assert.equal(delivered.observations.previous_update_operation_id, op('4'));
    assert.equal(delivered.observations.inherited_review_evidence, 'none'); assert.equal(delivered.observations.checks, 'pending');
    assert.equal(f.pushPort.inspect('S001-record').remote_head, observed.head); assert.equal(f.provider.read().posts, 1);
    assert.equal(f.artifacts.ownerPending(), false);
  });
  await test('fresh review authenticates redelivery and rejects previous-head substitution', async () => {
    const update = { record: { intent: { binding_ref: 'session_pr_redelivery_push' }, preview: { prepared } }, output: delivered };
    const reader = createStandardSessionPrReviewAuthority({ readAcceptedOperation: accepted, readAcceptedUpdate: () => update,
      readCheckpoint() { throw Error('old checkpoint forbidden'); }, readRedelivery: authority.readSource, inspectPush: branch => f.pushPort.inspect(branch) });
    const review = await reader.readConfirmedHead(instance, { update_operation_id: op('8') }); assert.equal(review.head, observed.head);
    const saved = delivered.observations.review_head; delivered.observations.review_head = initialOutput.observations.review_head;
    await assert.rejects(reader.readConfirmedHead(instance, { update_operation_id: op('8') })); delivered.observations.review_head = saved;
  });
  await test('late authorization context mutation after actual push retains UNKNOWN and its owner', async () => {
    const priorSource = await authority.readSource(instance, input), oldHead = git(f.root, 'rev-parse', 'HEAD');
    fs.appendFileSync(path.join(f.root, 'product.txt'), 'Second disposable change for the late authorization boundary\n');
    git(f.root, 'add', 'product.txt'); git(f.root, 'commit', '-m', 'test: exercise late push authorization boundary');
    const nextHead = git(f.root, 'rev-parse', 'HEAD');
    const source = { ...priorSource, parent_head: oldHead, delivery_head: nextHead, pull_request: delivered.observations.pull_request };
    let changed = false, readAfterPush = false;
    // This isolated shared-port test injects source/current capabilities. It
    // does not claim another authenticated corrective integration.
    const late = createStandardSessionPrUpdatePush({ targetRoot: f.root, redelivery: true,
      async readCheckpoint() {
        if (f.pushPort.inspect('S001-record').remote_head === nextHead) readAfterPush = true;
        return structuredClone(source);
      }, readCurrent: () => changed ? { ...instance, instance_sha256: 'b'.repeat(64) } : instance,
      pushPort: f.pushPort, pullRequestPort: f.provider.port });
    const ready = await late.prepare(instance, input, op('9'));
    const output = await late.apply(instance, ready, { ...grant(ready), async assertAuthorized() {
      if (readAfterPush) { await Promise.resolve(); changed = true; }
    } });
    assert.equal(changed, true); assert.equal(output.outcome, 'reconciliation_required'); assert.equal(output.effect_status, 'unknown');
    assert.deepEqual(output.facts, {}); assertStandardOperationOutput(output);
    assert.equal(output.observations.reason_code, 'STANDARD_PR_UPDATE_CONTEXT_CHANGED');
    assert.equal(f.pushPort.inspect('S001-record').remote_head, nextHead); assert.equal(f.artifacts.ownerPending(), true);
    assert.equal((await late.prepare(instance, input, op('a'))).can_apply, false);
  });
  console.log(JSON.stringify({ status: 'PASS', checks, mode, git_integration_push: 'ACTUAL_LOCAL_PORTS', provider: 'DOUBLED_REST',
    accepted_closure_cycle_human_journals: 'INJECTED_FIXTURE', full_standard_journey: 'NOT_RUN', genuine_human_provider_native_pg_installed: 'NOT_RUN', retained_roots: owned }));
} finally { console.log(JSON.stringify({ retained_roots: owned, cleanup: 'NONE_RETAIN_ALWAYS' })); }
