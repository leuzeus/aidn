import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createStandardHumanDecisions } from '../../src/application/runtime/standard-workflow-human-decisions.mjs';
import { createProcessDecisionInboxStore } from '../../src/adapters/runtime/process-decision-inbox-store.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { assertDecisionInbox, decisionInboxPath } from '../../src/core/workflow/process-decision-inbox.mjs';
import { assertSessionBranchIntegrationDecisionOutput, assertSessionBranchIntegrationReview, sessionBranchIntegrationChoices } from '../../src/core/workflow/standard-session-branch-integration-decision.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { createStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
const H = 'a'.repeat(64), O = 'b'.repeat(40), op = x => 'op_' + x.repeat(40), key = randomBytes(32), signer = createOperationJournalSigner(() => key);
const scope = { source_branch: 'C001-feature-example', target_branch: 'S001-example' };
const baseReview = () => ({ session_id: 'S001', session_path: 'sessions/S001.md', cycle_id: 'C001', cycle_path: 'cycles/C001-feature-example/status.md', ...scope,
  delivery_operation_id: op('a'), delivery_output_sha256: H, closure_operation_id: op('b'), closure_output_sha256: H, material_sha256: H, delivery_head: O,
  documents: ['sessions/S001.md', 'cycles/C001-feature-example/status.md', 'CURRENT-STATE.md', 'snapshots/context-snapshot.md'].map(ref => ({ ref: 'audit:' + ref, sha256: H, metadata_sha256: H })),
  git: { ...scope, source_ref: 'refs/heads/' + scope.source_branch, target_ref: 'refs/heads/' + scope.target_branch, source_head: O, target_head: 'c'.repeat(40), current_ref: 'refs/heads/' + scope.source_branch,
    head: O, index_sha256: H, clean: true, lock_present: false, filter_context_sha256: H, source_lock_present: false, source_symbolic: false, target_symbolic: false,
    head_reflog: { byte_length: 0, sha256: H }, target_reflog: { byte_length: 0, sha256: H }, fast_forward: true, target_checked_out_elsewhere: false, worktree_bindings_sha256: H } });
function fixture(makeInbox) {
  const rows = new Map(), sources = new Map(); let verified = true, calls = 0;
  const inbox = makeInbox ? makeInbox() : { read(id) { const record = structuredClone(rows.get(id) ?? null); return { record, content_sha256: record ? shadowHash(record) : null }; },
    compareAndSwap(row, before) { assertDecisionInbox(row); assert.equal(this.read(row.inbox_id).content_sha256, before); rows.set(row.inbox_id, structuredClone(row)); return { projection: 'canonical' }; } };
  const source = { read({ sourceRef }) { calls++; return structuredClone(sources.get(sourceRef) ?? null); },
    verify({ source: claim, sourceRef }) { calls++; return { outcome: verified && shadowHash(claim) === shadowHash(sources.get(sourceRef)) ? 'verified' : 'rejected', authority_id: claim.authority_id, source_sha256: shadowHash(claim) }; } };
  const human = () => createStandardHumanDecisions({ inbox, signer, source, projectionRequired: false });
  const record = { operation_id: op('d'), intent: { binding_ref: 'session_branch_integration_decision', instance_id: 'fixture', scope_id: 'scope', occurrence_id: 'integrate:0' },
    preview: { prepared: { plan: { review: baseReview(), choices: [...sessionBranchIntegrationChoices] } } }, results: [] };
  const claim = (choice = 'integrate-to-session') => { const question = human().question(record); return { contract_version: 'human-session-branch-integration-decision.v1', source_kind: 'human', authority_id: 'fixture_operator',
    source_event_id: 'integration:1', question_sha256: shadowHash(question), subject_sha256: shadowHash(question.review), choice, rationale: 'Explicit local cycle to session integration', evidence_refs: [{ ref: 'human/selection', sha256: H }] }; };
  return { rows, sources, human, record, claim, deny: () => { verified = false; }, calls: () => calls };
}
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
await test('ten private integration contracts use supported schema vocabulary and exact identities', () => {
  const directory = new URL('../../src/core/contracts/workflow-definition/', import.meta.url);
  const names = fs.readdirSync(directory).filter(name => name.includes('session-branch-') || name === 'process-decision-inbox.v6.schema.json'); assert.equal(names.length, 10);
  for (const name of names) { const schema = JSON.parse(fs.readFileSync(new URL(name, directory))); assert.equal(schema.$id, 'aidn://contracts/workflow-definition/' + name.replace('.schema.json', '')); assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []); }
});
await test('absence and provider refusal preserve waiting without a capture', async () => {
  const f = fixture(); assert.equal(await f.human().reserve(f.record, 'fixture:answer'), null); assert.equal(f.rows.size, 0);
  f.sources.set('fixture:answer', f.claim()); f.deny(); await assert.rejects(f.human().reserve(f.record, 'fixture:answer'), { code: 'PROCESS_HUMAN_NOT_AUTHENTICATED' }); assert.equal(f.rows.size, 0);
});
await test('integration effect success and uncertainty have their own exact fact/evidence contract', () => {
  const output = { contract_version: 'standard-session-branch-integrate-output.v1', operation_ref: 'session_branch_integrate', outcome: 'completed', effect_status: 'confirmed',
    facts: { session_branch_integrated: true }, observations: { decision_operation_id: op('d') }, evidence_refs: [{ ref: 'git:session-integration/' + op('e'), sha256: H }] };
  assertStandardOperationOutput(output);
  for (const mutate of [x => x.facts = { session_delivery_checkpoint_completed: true }, x => x.effect_status = 'no_effect', x => x.evidence_refs = [], x => x.evidence_refs.push({ ref: 'extra', sha256: H })]) {
    const bad = structuredClone(output); mutate(bad); assert.throws(() => assertStandardOperationOutput(bad), { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });
  }
  for (const [outcome, effect_status] of [['blocked', 'no_effect'], ['reconciliation_required', 'unknown']]) {
    const value = { ...output, outcome, effect_status, facts: {}, evidence_refs: [] }; assertStandardOperationOutput(value);
    const bad = { ...value, facts: { session_branch_integrated: true } }; assert.throws(() => assertStandardOperationOutput(bad), { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });
  }
});
await test('integration consent, refusal, deferral and cancellation remain distinct no-effect decisions', async () => {
  for (const choice of sessionBranchIntegrationChoices) { const f = fixture(); f.sources.set('fixture:answer', f.claim(choice)); const capture = await f.human().reserve(f.record, 'fixture:answer');
    const output = f.human().output(f.record, capture); assertSessionBranchIntegrationDecisionOutput(output); assert.equal(output.effect_status, 'no_effect');
    assert.equal(output.outcome, ({ 'integrate-to-session': 'completed', refused: 'rejected', deferred: 'deferred', cancelled: 'cancelled' })[choice]);
    assert.deepEqual(output.facts, choice === 'integrate-to-session' ? { session_branch_integration_requested: true } : {});
    const forged = structuredClone(output); forged.facts.session_branch_integrated = true; assert.throws(() => assertSessionBranchIntegrationDecisionOutput(forged));
  }
});
await test('changed canonical subject or Git/index/filter/worktree/checkpoint preimage invalidates the answer', async () => {
  for (const change of [r => r.documents[0].sha256 = 'f'.repeat(64), r => r.git.target_head = 'd'.repeat(40), r => r.git.index_sha256 = 'e'.repeat(64), r => r.git.filter_context_sha256 = 'd'.repeat(64), r => r.git.worktree_bindings_sha256 = 'c'.repeat(64), r => r.delivery_operation_id = op('e')]) {
    const f = fixture(), old = f.claim(); change(f.record.preview.prepared.plan.review); f.sources.set('fixture:answer', old);
    await assert.rejects(f.human().reserve(f.record, 'fixture:answer'), { code: 'PROCESS_HUMAN_QUESTION_CHANGED' });
  }
});
await test('dirty/divergent/unowned/symbolic or foreign-target observations cannot offer consent', () => {
  for (const change of [r => r.git.clean = false, r => r.git.fast_forward = false, r => r.git.target_checked_out_elsewhere = true, r => r.git.source_symbolic = true, r => r.git.source_lock_present = true, r => r.git.target_branch = 'foreign', r => r.git.source_head = 'f'.repeat(40)]) {
    const review = baseReview(); change(review); assert.throws(() => assertSessionBranchIntegrationReview(review), { code: 'STANDARD_SESSION_INTEGRATION_REVIEW_INVALID' });
  }
});
await test('retain or promotion is never a branch integration decision', async () => {
  for (const choice of ['retain', 'promote', 'close']) { const f = fixture(), claim = f.claim(); claim.choice = choice; f.sources.set('fixture:answer', claim);
    await assert.rejects(f.human().reserve(f.record, 'fixture:answer'), { code: 'STANDARD_SESSION_INTEGRATION_SOURCE_INVALID' }); }
});
await test('v6 capture is immutable, cold-readable without provider calls and never reusable for another occurrence', async () => {
  const f = fixture(); f.sources.set('fixture:answer', f.claim()); const capture = await f.human().reserve(f.record, 'fixture:answer'); assert.equal(capture.contract_version, 'process-decision-inbox.v6'); signer.verify(capture);
  const receipt = { receipt_id: 'fixture_receipt' }; f.record.results.push({ output: f.human().output(f.record, capture), receipt }); f.human().acknowledge(capture.inbox_id, receipt);
  const before = shadowHash([...f.rows]), calls = f.calls(); f.sources.clear(); assert.equal(f.human().captured(f.record).phase, 'receipted'); f.human().acknowledge(capture.inbox_id, receipt);
  assert.equal(f.calls(), calls); assert.equal(shadowHash([...f.rows]), before);
  f.record.operation_id = op('e'); f.sources.set('fixture:answer', f.claim()); await assert.rejects(f.human().reserve(f.record, 'fixture:answer'), { code: 'PROCESS_HUMAN_SOURCE_ALREADY_USED' });
});
if (!process.argv.includes('--contract-only')) {
  const owned = [], temporary = fs.realpathSync(os.tmpdir());
  try {
    for (const mode of ['files', 'dual', 'db-only']) await test('real canonical v6 store, cold capture and HMAC tamper refusal: ' + mode, async () => {
      const root = createStandardWorkflowFixture(mode, owned), makeInbox = () => createProcessDecisionInboxStore({ targetRoot: root, stateMode: mode }), f = fixture(makeInbox);
      f.sources.set('fixture:answer', f.claim()); const capture = await f.human().reserve(f.record, 'fixture:answer'), receipt = { receipt_id: 'fixture_receipt' };
      f.record.results.push({ output: f.human().output(f.record, capture), receipt }); const cold = fixture(makeInbox); cold.human().acknowledge(capture.inbox_id, receipt);
      assert.equal(cold.human().captured(f.record).phase, 'receipted'); assert.equal(cold.calls(), 0);
      assert.equal(fs.existsSync(path.join(root, 'docs/audit', decisionInboxPath(capture.inbox_id))), mode !== 'db-only');
      const store = makeInbox(), before = store.read(capture.inbox_id), forged = structuredClone(before.record); forged.source.rationale = 'forged'; store.compareAndSwap(forged, before.content_sha256);
      assert.throws(() => fixture(makeInbox).human().captured(f.record), { code: 'PROCESS_JOURNAL_NOT_AUTHENTICATED' });
    });
  } finally { for (const root of owned.reverse()) { const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary); assert.ok(path.basename(real).startsWith('aidn-standard-ports-')); fs.rmSync(real, { recursive: true, force: true }); } }
}
console.log(JSON.stringify({ status: 'PASS', checks, source: 'fixture-human-provider', model_calls: 0, actual_git_integration: 'NOT_RUN', actual_closure_delivery_source_chain: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
