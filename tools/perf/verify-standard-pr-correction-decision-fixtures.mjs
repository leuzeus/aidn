import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createStandardHumanDecisions } from '../../src/application/runtime/standard-workflow-human-decisions.mjs';
import { createStandardPrCorrectionReview } from '../../src/application/runtime/standard-pr-correction-review.mjs';
import { createProcessDecisionInboxStore } from '../../src/adapters/runtime/process-decision-inbox-store.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { assertDecisionInbox } from '../../src/core/workflow/process-decision-inbox.mjs';
import { assertPrCorrectionReview, prCorrectionChoices, assertPrCorrectionDecisionOutput } from '../../src/core/workflow/standard-pr-correction-decision.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { createStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
const H = 'a'.repeat(64), O = 'b'.repeat(40), op = x => 'op_' + x.repeat(40), key = randomBytes(32), signer = createOperationJournalSigner(() => key);
const baseReview = () => ({ session_id: 'S001', checkpoint_operation_id: op('a'), checkpoint_plan_sha256: H, checkpoint_output_sha256: H,
  reopen_operation_id: op('b'), triage_operation_id: op('c'), product_sha256: H, provider_subject_sha256: H,
  head_oid: O, head_branch: 'S001-example', remote_head_oid: 'c'.repeat(40), base_oid: 'd'.repeat(40), state_mode: 'files',
  postimages: ['sessions/S001.md', 'CURRENT-STATE.md', 'snapshots/context-snapshot.md'].map(path => ({ path, sha256: H, metadata_sha256: null })) });
const candidate = () => ({ cycle_id: 'C002', title: 'review-correction', objective: 'Correct the current reviewed product boundary.' });
function fixture(makeInbox, v2 = false) {
  const version = v2 === 3 ? 3 : v2 ? 2 : 1;
  const rows = new Map(), sources = new Map(); let verified = true;
  const inbox = makeInbox ? makeInbox() : {
    read(id) { const record = structuredClone(rows.get(id) ?? null); return { record, content_sha256: record ? shadowHash(record) : null }; },
    compareAndSwap(row, before) { assertDecisionInbox(row); assert.equal(this.read(row.inbox_id).content_sha256, before); rows.set(row.inbox_id, structuredClone(row)); return { projection: 'canonical' }; } };
  const source = { read({ sourceRef }) { return structuredClone(sources.get(sourceRef) ?? null); },
    verify({ source: claim, sourceRef }) { return { outcome: verified && shadowHash(claim) === shadowHash(sources.get(sourceRef)) ? 'verified' : 'rejected', authority_id: claim.authority_id, source_sha256: shadowHash(claim) }; } };
  const human = () => createStandardHumanDecisions({ inbox, signer, source, projectionRequired: false });
  const record = { operation_id: op('e'), intent: { binding_ref: 'session_pr_correction_decision', instance_id: 'fixture', scope_id: 'scope', occurrence_id: 'correction:0' },
    preview: { prepared: { plan: { review: baseReview(), choices: [...prCorrectionChoices] } } }, results: [] };
  if (version === 2) Object.assign(record.preview.prepared.plan, { contract_version: 'standard-pr-correction-review-plan.v2', candidate_cycle: candidate() });
  if (version === 3) Object.assign(record.preview.prepared.plan, { contract_version: 'standard-pr-correction-review-plan.v3', cycle_constraints: { kind: 'new-admitted-corrective-cycle', minimum_cycle_number: 2, inventory_sha256: H } });
  const claim = (choice = 'create-correction-cycle') => { const question = human().question(record); return { contract_version: 'human-pr-correction-decision.v' + version,
    ...(version === 3 ? { selected_cycle: choice === 'create-correction-cycle' ? candidate() : null, cycle_sha256: choice === 'create-correction-cycle' ? shadowHash(candidate()) : null } : version === 2 ? { cycle_sha256: shadowHash(question.candidate_cycle) } : {}), source_kind: 'human', authority_id: 'fixture_operator',
    source_event_id: 'correction:v' + version + ':1', question_sha256: shadowHash(question), subject_sha256: shadowHash(question.review), choice, rationale: 'Request an ordinary admitted correction cycle', evidence_refs: [{ ref: 'fixture/selection', sha256: H }] }; };
  return { rows, sources, inbox, human, record, claim, deny: () => { verified = false; } };
}
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
await test('seven new private contracts retain closed schemas and exact identities', () => {
  const directory = new URL('../../src/core/contracts/workflow-definition/', import.meta.url);
  const names = ['standard-pr-correction-review.v1', 'standard-pr-correction-review-input.v1', 'standard-pr-correction-review-plan.v1', 'standard-pr-correction-question.v1', 'standard-pr-correction-decision-output.v1', 'human-pr-correction-decision.v1', 'process-decision-inbox.v7'];
  names.push('standard-pr-correction-review-input.v3', 'standard-pr-correction-review-plan.v3', 'standard-pr-correction-question.v3', 'human-pr-correction-decision.v3', 'standard-pr-correction-decision-output.v3', 'process-decision-inbox.v9', 'standard-pr-correction-review-input.v2', 'standard-pr-correction-review-plan.v2', 'standard-pr-correction-question.v2', 'human-pr-correction-decision.v2', 'standard-pr-correction-decision-output.v2', 'process-decision-inbox.v8');
  for (const name of names) { const schema = JSON.parse(fs.readFileSync(new URL(name + '.schema.json', directory))); assert.equal(schema.$id, 'aidn://contracts/workflow-definition/' + name); assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []); }
  assertStandardOperationInput('session_pr_correction_decision', { contract_version: 'standard-pr-correction-review-input.v1', checkpoint_operation_id: op('a') });
  assert.throws(() => assertStandardOperationInput('session_pr_correction_decision', { checkpoint_operation_id: op('a'), authorized: true }));
});
await test('absence waits and unverified provider source cannot reserve a decision', async () => {
  const f = fixture(); assert.equal(await f.human().reserve(f.record, 'fixture:answer'), null); assert.equal(f.rows.size, 0);
  f.sources.set('fixture:answer', f.claim()); f.deny(); await assert.rejects(f.human().reserve(f.record, 'fixture:answer'), { code: 'PROCESS_HUMAN_NOT_AUTHENTICATED' }); assert.equal(f.rows.size, 0);
});
await test('four genuine-source choices keep refusal, defer and cancellation distinct from a request', async () => {
  for (const choice of prCorrectionChoices) {
    const f = fixture(); f.sources.set('fixture:answer', f.claim(choice)); const capture = await f.human().reserve(f.record, 'fixture:answer');
    assert.equal(capture.contract_version, 'process-decision-inbox.v7'); const output = f.human().output(f.record, capture); assertStandardOperationOutput(output);
    assert.equal(output.outcome, ({ 'create-correction-cycle': 'completed', refused: 'rejected', deferred: 'deferred', cancelled: 'cancelled' })[choice]);
    assert.deepEqual(output.facts, choice === 'create-correction-cycle' ? { session_pr_correction_cycle_requested: true } : {});
    assert.equal(output.effect_status, 'no_effect');
    for (const fact of ['cycle_created', 'cycle_implementation_admitted', 'session_pr_merged']) {
      assert.throws(() => assertPrCorrectionDecisionOutput({ ...output, facts: { ...output.facts, [fact]: true } }));
    }
  }
});
await test('checkpoint, triage, product, provider, HEAD and each postimage bind the human subject', async () => {
  for (const change of [r => r.checkpoint_operation_id = op('f'), r => r.triage_operation_id = op('f'), r => r.product_sha256 = 'b'.repeat(64),
    r => r.provider_subject_sha256 = 'b'.repeat(64), r => r.head_oid = 'f'.repeat(40), r => r.base_oid = 'f'.repeat(40),
    ...[0, 1, 2].map(i => r => r.postimages[i].sha256 = 'b'.repeat(64))]) {
    const f = fixture(), original = f.claim(); change(f.record.preview.prepared.plan.review); f.sources.set('fixture:answer', original);
    await assert.rejects(f.human().reserve(f.record, 'fixture:answer'), { code: 'PROCESS_HUMAN_QUESTION_CHANGED' }); assert.equal(f.rows.size, 0);
  }
  const wrong = baseReview(); wrong.postimages.reverse(); assert.throws(() => assertPrCorrectionReview(wrong));
  for (const mode of ['dual', 'db-only']) {
    const review = baseReview(); review.state_mode = mode; assert.throws(() => assertPrCorrectionReview(review));
    review.postimages.forEach(row => row.metadata_sha256 = H); assertPrCorrectionReview(review);
    review.postimages[0].metadata_sha256 = null; assert.throws(() => assertPrCorrectionReview(review));
  }
});
await test('old integration consent and source event reuse cannot become a correction request', async () => {
  const f = fixture(), old = f.claim(); old.contract_version = 'human-session-branch-integration-decision.v1'; old.choice = 'integrate-to-session'; f.sources.set('fixture:old', old);
  await assert.rejects(f.human().reserve(f.record, 'fixture:old'));
  f.sources.set('fixture:answer', f.claim()); await f.human().reserve(f.record, 'fixture:answer');
  f.record.operation_id = op('f'); f.sources.set('fixture:other', f.claim());
  await assert.rejects(f.human().reserve(f.record, 'fixture:other'), { code: 'PROCESS_HUMAN_SOURCE_ALREADY_USED' });
});
await test('review rereads the trusted checkpoint and refuses stale or foreign sources without effects', async () => {
  const review = baseReview(), input = { contract_version: 'standard-pr-correction-review-input.v1', checkpoint_operation_id: op('a') };
  let calls = 0; const port = createStandardPrCorrectionReview({ readCheckpoint: async () => { calls++; return structuredClone(review); } });
  const prepared = await port.prepare({}, input, op('e')); await port.assertFresh({}, prepared.plan); assert.equal(calls, 2);
  review.head_oid = 'f'.repeat(40); await assert.rejects(port.assertFresh({}, prepared.plan), { code: 'STANDARD_PR_CORRECTION_REVIEW_STALE' });
  review.checkpoint_operation_id = op('f'); await assert.rejects(port.prepare({}, input, op('e')), { code: 'STANDARD_PR_CORRECTION_REVIEW_SOURCE_CHANGED' });
  await assert.rejects(port.prepare({}, input, op('e'), { signal: AbortSignal.abort() }), { code: 'STANDARD_PR_CORRECTION_ABORTED' });
});
for (const choice of prCorrectionChoices) await test('v2 human choice ' + choice + ' binds its exact candidate without granting implementation', async () => {
  const f = fixture(undefined, true); f.sources.set('fixture:v2', f.claim(choice));
  const capture = await f.human().reserve(f.record, 'fixture:v2'), output = f.human().output(f.record, capture);
  assert.equal(capture.contract_version, 'process-decision-inbox.v8'); assertStandardOperationOutput(output);
  assert.equal(output.contract_version, 'standard-pr-correction-decision-output.v2');
  assert.deepEqual(output.observations.candidate_cycle, candidate());
  assert.deepEqual(output.facts, choice === 'create-correction-cycle' ? { session_pr_correction_cycle_requested: true } : {});
});
await test('v2 rejects candidate substitution and historical answers for a new subject or occurrence', async () => {
  for (const [key, value] of [['cycle_id', 'C003'], ['title', 'another-correction'], ['objective', 'A different product correction objective.']]) {
    const f = fixture(undefined, true); f.sources.set('fixture:v2', f.claim());
    f.record.preview.prepared.plan.candidate_cycle[key] = value;
    await assert.rejects(f.human().reserve(f.record, 'fixture:v2'), { code: 'STANDARD_PR_CORRECTION_CYCLE_CHOICE_CHANGED' }); assert.equal(f.rows.size, 0);
  }
  const f = fixture(undefined, true), old = f.claim(); f.sources.set('fixture:v2', old);
  f.record.intent.occurrence_id = 'correction:1';
  await assert.rejects(f.human().reserve(f.record, 'fixture:v2'), { code: 'PROCESS_HUMAN_QUESTION_CHANGED' });
  const legacy = fixture().claim(); f.sources.set('fixture:v1', legacy);
  await assert.rejects(f.human().reserve(f.record, 'fixture:v1'), { code: 'STANDARD_PR_CORRECTION_CYCLE_CHOICE_CHANGED' });
});
await test('v2 preparation retains candidate and checkpoint through a fresh review', async () => {
  const port = createStandardPrCorrectionReview({ readCheckpoint: async () => baseReview() });
  const input = { contract_version: 'standard-pr-correction-review-input.v2', checkpoint_operation_id: op('a'), candidate_cycle: candidate() };
  const prepared = await port.prepare({}, input, op('e')); await port.assertFresh({}, prepared.plan);
  assert.deepEqual(prepared.plan.candidate_cycle, candidate());
  await assert.rejects(port.prepare({}, { ...input, candidate_cycle: { ...candidate(), authority: true } }, op('e')));
});
for (const choice of prCorrectionChoices) await test('v3 human selects cycle fields or retains ' + choice + ' without positive authority', async () => {
  const f = fixture(undefined, 3), source = f.claim(choice);
  if (choice === 'create-correction-cycle') {
    source.selected_cycle = { cycle_id: 'C017', title: 'chosen-by-person', objective: 'Implement the newly selected current review corrections.' };
    source.cycle_sha256 = shadowHash(source.selected_cycle);
  }
  f.sources.set('fixture:v3', source);
  const capture = await f.human().reserve(f.record, 'fixture:v3'), output = f.human().output(f.record, capture);
  assert.equal(capture.contract_version, 'process-decision-inbox.v9'); assertStandardOperationOutput(output);
  assert.equal(output.contract_version, 'standard-pr-correction-decision-output.v3');
  assert.deepEqual(output.observations.candidate_cycle, source.selected_cycle);
  assert.equal(Object.hasOwn(f.human().question(f.record), 'candidate_cycle'), false);
  assert.deepEqual(output.facts, choice === 'create-correction-cycle' ? { session_pr_correction_cycle_requested: true } : {});
});
await test('v3 rejects old cycle numbers, substitutions, malformed selection, legacy consent and answer reuse', async () => {
  for (const change of [s => s.selected_cycle.cycle_id = 'C001', s => s.cycle_sha256 = H,
    s => s.selected_cycle.authorized = true, s => s.selected_cycle = null,
    s => { s.choice = 'deferred'; }, s => { s.contract_version = 'human-pr-correction-decision.v2'; delete s.selected_cycle; }]) {
    const f = fixture(undefined, 3), claim = f.claim(); change(claim);
    if (claim.selected_cycle && claim.cycle_sha256 !== H) claim.cycle_sha256 = shadowHash(claim.selected_cycle);
    f.sources.set('fixture:v3', claim); await assert.rejects(f.human().reserve(f.record, 'fixture:v3')); assert.equal(f.rows.size, 0);
  }
  const f = fixture(undefined, 3); f.sources.set('fixture:v3', f.claim()); await f.human().reserve(f.record, 'fixture:v3');
  f.record.operation_id = op('f'); f.record.intent.occurrence_id = 'correction:1'; f.sources.set('fixture:reused', f.claim());
  await assert.rejects(f.human().reserve(f.record, 'fixture:reused'), { code: 'PROCESS_HUMAN_SOURCE_ALREADY_USED' });
});
await test('v3 authenticates current inventory bytes and metadata without accepting caller cycle parameters', async () => {
  const rows = [{ cycle_id: 'C006', path: 'cycles/C006-feature-prior/status.md', sha256: H, metadata_sha256: null }];
  const input = { contract_version: 'standard-pr-correction-review-input.v3', checkpoint_operation_id: op('a') };
  const port = createStandardPrCorrectionReview({ readCheckpoint: async () => baseReview(), readCycleInventory: async () => structuredClone(rows) });
  const prepared = await port.prepare({}, input, op('e')); assert.equal(prepared.plan.cycle_constraints.minimum_cycle_number, 7);
  await port.assertFresh({}, prepared.plan);
  rows[0].sha256 = 'b'.repeat(64); await assert.rejects(port.assertFresh({}, prepared.plan), { code: 'STANDARD_PR_CORRECTION_REVIEW_STALE' });
  rows[0].metadata_sha256 = H; await assert.rejects(port.prepare({}, input, op('e')), { code: 'STANDARD_PR_CORRECTION_CYCLE_INVENTORY_INVALID' });
  await assert.rejects(port.prepare({}, { ...input, candidate_cycle: candidate() }, op('e')), { code: 'STANDARD_PR_CORRECTION_REVIEW_INPUT_INVALID' });
  await assert.rejects(createStandardPrCorrectionReview({ readCheckpoint: async () => baseReview() }).prepare({}, input, op('e')), { code: 'STANDARD_PR_CORRECTION_CYCLE_INVENTORY_REQUIRED' });
  for (const mode of ['dual', 'db-only']) {
    const review = baseReview(); review.state_mode = mode; review.postimages.forEach(row => row.metadata_sha256 = H);
    const db = createStandardPrCorrectionReview({ readCheckpoint: async () => review, readCycleInventory: async () => structuredClone(rows) });
    const before = await db.prepare({}, input, op('e')); rows[0].metadata_sha256 = 'b'.repeat(64);
    await assert.rejects(db.assertFresh({}, before.plan), { code: 'STANDARD_PR_CORRECTION_REVIEW_STALE' }); rows[0].metadata_sha256 = H;
  }
});
const owned = [], temporary = fs.realpathSync(os.tmpdir()); let completed = false;
try {
  for (const mode of ['files', 'dual', 'db-only']) {
    const root = createStandardWorkflowFixture(mode, owned);
    await test(mode + ' v9 human-selected fields survive a cold signed inbox without a proposed candidate', async () => {
      const store = () => createProcessDecisionInboxStore({ targetRoot: root, stateMode: mode }), f = fixture(store, 3);
      f.sources.set('fixture:v3', f.claim()); const capture = await f.human().reserve(f.record, 'fixture:v3');
      const output = f.human().output(f.record, capture), receipt = { output_sha256: shadowHash(output) };
      f.human().acknowledge(capture.inbox_id, receipt); f.record.results.push({ output, receipt });
      await f.human().verifyCaptured(f.record); assert.deepEqual(store().read(capture.inbox_id).record, f.human().captured(f.record));
    });
    await test(mode + ' v8 authenticated decision survives cold signed inbox reads', async () => {
      const store = () => createProcessDecisionInboxStore({ targetRoot: root, stateMode: mode }), f = fixture(store, true);
      f.sources.set('fixture:v2', f.claim()); const capture = await f.human().reserve(f.record, 'fixture:v2');
      const output = f.human().output(f.record, capture), receipt = { output_sha256: shadowHash(output) };
      f.human().acknowledge(capture.inbox_id, receipt); f.record.results.push({ output, receipt });
      await f.human().verifyCaptured(f.record); assert.deepEqual(store().read(capture.inbox_id).record, f.human().captured(f.record));
    });
    await test(mode + ' durable signed v7 capture survives a cold reader and retains refusal against tampering', async () => {
      const makeInbox = () => createProcessDecisionInboxStore({ targetRoot: root, stateMode: mode }), f = fixture(makeInbox);
      f.sources.set('fixture:answer', f.claim()); const capture = await f.human().reserve(f.record, 'fixture:answer');
      const output = f.human().output(f.record, capture), receipt = { output_sha256: shadowHash(output) };
      f.human().acknowledge(capture.inbox_id, receipt); f.record.results.push({ output, receipt });
      assert.equal(f.human().captured(f.record).phase, 'receipted'); await f.human().verifyCaptured(f.record);
      assert.deepEqual(makeInbox().read(capture.inbox_id).record, f.human().captured(f.record));
      const store = makeInbox(), before = store.read(capture.inbox_id), forged = structuredClone(before.record); forged.source.rationale = 'forged';
      store.compareAndSwap(forged, before.content_sha256); assert.throws(() => f.human().captured(f.record), { code: 'PROCESS_JOURNAL_NOT_AUTHENTICATED' });
    });
  }
  completed = true;
} finally {
  if (completed && !process.argv.includes('--retain-always')) for (const root of owned.reverse()) { const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary); assert.ok(path.basename(real).startsWith('aidn-standard-ports-')); fs.rmSync(real, { recursive: true, force: true }); }
  else console.log(JSON.stringify({ fixture_cleanup: 'retained', roots: owned }));
}
console.log(JSON.stringify({ status: 'PASS', checks, proof: 'component-contracts-trusted-source-double-and-durable-signed-human-inbox', model_calls: 0,
  genuine_human: 'NOT_RUN', production_checkpoint_chain: 'NOT_RUN', correction_cycle: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN', complete_standard_workflow: false }));
