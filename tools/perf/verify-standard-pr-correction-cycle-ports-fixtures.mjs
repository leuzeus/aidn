import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createPrCorrectionReopenFixture } from './standard-pr-correction-fixture-lib.mjs';
import { createStandardPrCorrectionCheckpoint } from '../../src/application/runtime/standard-pr-correction-checkpoint.mjs';
import { createStandardPrCorrectionReview } from '../../src/application/runtime/standard-pr-correction-review.mjs';
import { createStandardPrCorrectionCycle } from '../../src/application/runtime/standard-pr-correction-cycle.mjs';
import { assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
const mode = process.argv.find(x => x.startsWith('--mode='))?.slice(7) ?? 'files', owned = [];
assert.ok(['files', 'dual', 'db-only'].includes(mode));
const op = n => 'op_' + String(n).repeat(40), H = 'a'.repeat(64);
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + mode + ': ' + name); };
try {
  await test('new private contracts are closed and reject completion facts on UNKNOWN', () => {
    for (const name of ['input', 'plan', 'output']) {
      const schema = JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/standard-pr-correction-cycle-' + name + '.v1.schema.json', import.meta.url)));
      assert.equal(schema.additionalProperties, false); assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []);
    }
    assert.throws(() => assertStandardOperationOutput({ contract_version: 'standard-pr-correction-cycle-output.v1', operation_ref: 'session_pr_correction_cycle_initialize',
      outcome: 'reconciliation_required', effect_status: 'unknown', facts: { session_pr_correction_cycle_initialized: true }, observations: {}, evidence_refs: [] }));
  });
  const f = await createPrCorrectionReopenFixture(mode, owned);
  const reopenPlan = await f.port.prepare(f.instance, f.input), reopenOutput = await f.port.apply(f.instance, reopenPlan,
    { write: true, expectPlan: reopenPlan.plan_sha256, assertAuthorized() {} });
  assert.equal(reopenOutput.outcome, 'completed');
  const rows = new Map([[op(1), { record: { operation_id: op(1), intent: { binding_ref: 'session_pr_correction_reopen' },
    preview: { input: f.input, prepared: reopenPlan } }, output: reopenOutput }]]);
  let authenticated = true, product = H, provider = true;
  const readAcceptedOperation = (_instance, id, binding) => {
    if (!authenticated) throw Object.assign(Error('fixture accepted authority refused'), { code: 'FIXTURE_ACCEPTED_AUTHORITY_REFUSED' });
    assert.equal(rows.get(id)?.record.intent.binding_ref, binding); return structuredClone(rows.get(id));
  };
  const authority = { verifySource: f.authority.verifySource, async verifyProviderSource(_instance, source) {
    if (!provider) throw Object.assign(Error('provider changed'), { code: 'FIXTURE_PROVIDER_CHANGED' });
    return { origin_source_sha256: shadowHash(source), proof_class: 'fixture-provider-double' };
  } };
  const checkpoint = createStandardPrCorrectionCheckpoint({ targetRoot: f.root, authority, readAcceptedOperation, readCurrent: () => f.instance });
  const input = { contract_version: 'standard-pr-correction-checkpoint-input.v1', reopen_operation_id: op(1) };
  const cp = await checkpoint.prepare(f.instance, input, op(2));
  const cpOutput = await checkpoint.apply(f.instance, cp, { write: true, expectPlan: cp.plan_sha256, assertAuthorized() {} });
  assert.equal(cpOutput.outcome, 'completed');
  rows.set(op(2), { record: { operation_id: op(2), intent: { binding_ref: 'session_pr_correction_checkpoint' }, preview: { input, prepared: cp } }, output: cpOutput });
  const reviewInput = { contract_version: 'standard-pr-correction-review-input.v1', checkpoint_operation_id: op(2) };
  const review = await createStandardPrCorrectionReview({ readCheckpoint: checkpoint.readCompleted }).prepare(f.instance, reviewInput, op(3));
  const human = { record: { operation_id: op(3), intent: { binding_ref: 'session_pr_correction_decision' }, preview: { input: reviewInput, prepared: review } },
    output: { contract_version: 'standard-pr-correction-decision-output.v1', operation_ref: 'session_pr_correction_decision', outcome: 'completed', effect_status: 'no_effect',
      facts: { session_pr_correction_cycle_requested: true }, observations: { question_sha256: H, choice: 'create-correction-cycle', review_sha256: shadowHash(review.plan.review),
        source_sha256: H, inbox_id: 'decision_' + '1'.repeat(40), source_ref: 'fixture:human' }, evidence_refs: [] } };
  rows.set(op(3), human); assertStandardOperationOutput(human.output);
  const make = (options = {}) => createStandardPrCorrectionCycle({ targetRoot: f.root, operations: f.ops, readAcceptedOperation,
    readCheckpoint: checkpoint.readCompleted, observeProduct: () => product, readCurrent: () => f.instance,
    async verifyContinuationSource(instance, source, { assertLocal }) { assertLocal(); const result = await authority.verifyProviderSource(instance, source); assertLocal(); return result; }, ...options });
  const request = { contract_version: 'standard-pr-correction-cycle-input.v1', decision_operation_id: op(3), cycle_id: 'C001', title: 'review-correction', objective: 'Correct the reviewed boundary through an ordinary governed cycle.' };
  const head = git(f.root, 'rev-parse', 'HEAD'), commits = git(f.root, 'rev-list', '--count', 'HEAD');
  await test('unaccepted, refused and corrupted requests cannot create a cycle', async () => {
    authenticated = false; await assert.rejects(make().prepare(f.instance, request), { code: 'FIXTURE_ACCEPTED_AUTHORITY_REFUSED' }); authenticated = true;
    const saved = structuredClone(human);
    for (const mutate of [x => { x.output.outcome = 'rejected'; x.output.observations.choice = 'refused'; x.output.facts = {}; },
      x => x.record.preview.prepared.plan_sha256 = 'f'.repeat(64), x => x.output.observations.review_sha256 = 'f'.repeat(64)]) {
      const changed = structuredClone(saved); mutate(changed); rows.set(op(3), changed); await assert.rejects(make().prepare(f.instance, request));
    }
    rows.set(op(3), saved); assert.equal(git(f.root, 'rev-parse', 'HEAD'), head); assert.equal(f.artifacts.ownerPending(), false);
  });
  let prepared;
  await test('actual ordinary admission prepares the corrective branch with NOT_READY DoR', async () => {
    prepared = await make().prepare(f.instance, request); assert.equal(prepared.can_apply, true, JSON.stringify(prepared));
    assert.equal(prepared.plan.inner.plan.branch_name, 'corrective/C001-review-correction');
    assert.equal(prepared.plan.inner.plan.input.base_branch, review.plan.review.head_branch);
    assert.equal(prepared.plan.inner.plan.input.cycle_type, 'corrective');
    assert.ok(prepared.plan.inner.plan.changes.find(x => x.path.endsWith('/status.md')).after.includes('dor_state: NOT_READY'));
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), head); assert.equal(f.artifacts.ownerPending(), false);
  });
  await test('expiry, provider refusal, cancellation and grant revocation refuse before branch creation', async () => {
    const options = { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} };
    await assert.rejects(make({ now: () => prepared.plan.prepared_at_ms + 300001 }).apply(f.instance, prepared, options), { code: 'STANDARD_PLAN_EXPIRED' });
    provider = false; await assert.rejects(make().apply(f.instance, prepared, options), { code: 'FIXTURE_PROVIDER_CHANGED' }); provider = true;
    const abort = new AbortController(); abort.abort(); await assert.rejects(make().apply(f.instance, prepared, { ...options, signal: abort.signal }), { code: 'STANDARD_PR_CORRECTION_ABORTED' });
    await assert.rejects(make().apply(f.instance, prepared, { ...options, assertAuthorized() { throw Object.assign(Error('grant refused'), { code: 'FIXTURE_GRANT_REFUSED' }); } }), { code: 'FIXTURE_GRANT_REFUSED' });
    assert.equal(f.artifacts.ownerPending(), false); assert.equal(git(f.root, 'branch', '--show-current'), review.plan.review.head_branch);
  });
  await test('actual ordinary initializer creates one mapped correction cycle without product or Git commit', async () => {
    const fresh = await make().prepare(f.instance, request);
    const output = await make().apply(f.instance, fresh, { write: true, expectPlan: fresh.plan_sha256, assertAuthorized() {} });
    assert.equal(output.outcome, 'completed', JSON.stringify(output)); assert.equal(output.effect_status, 'confirmed');
    assert.equal(output.facts.session_pr_correction_cycle_initialized, true); assert.equal(output.facts.cycle_dor_ready, false);
    assert.equal(git(f.root, 'branch', '--show-current'), 'corrective/C001-review-correction');
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), head); assert.equal(git(f.root, 'rev-list', '--count', 'HEAD'), commits);
    assert.equal(f.artifacts.ownerPending(), false);
    const status = f.artifacts.cycles().find(row => row.cycle_id === 'C001'); assert.ok(status); assert.ok(status.content.includes('dor_state: NOT_READY'));
    assert.ok(status.content.includes('scope_frozen: false')); assert.equal(output.observations.implementation, 'not-authorized');
  });
  console.log(JSON.stringify({ status: 'PASS', checks, mode, canonical_cas_git: 'ACTUAL', accepted_source_provider_human_authority: 'FIXTURE_DOUBLES',
    production_dispatcher: 'NOT_RUN', ordinary_plan_dor_implementation: 'NOT_RUN', genuine_human: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN', full_standard_workflow: false }));
} finally { console.log(JSON.stringify({ fixture_cleanup: 'retained', roots: owned })); }
