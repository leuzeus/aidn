import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createArtifactStore } from '../../src/adapters/runtime/artifact-store.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createOperatorReviewDocuments } from '../../src/adapters/workflow-console/standard-operator-review-documents.mjs';
import { operatorOffer, assertOperatorClaim } from '../../src/adapters/workflow-console/standard-operator-offer.mjs';
import { codexDecisionForm, createCodexDecisionChannel } from '../../src/adapters/workflow-console/codex-decision-channel.mjs';
import { codexChoiceLabel } from '../../src/adapters/workflow-console/codex-decision-presentation.mjs';
import { presentCodexDecision } from '../../src/adapters/workflow-console/codex-decision-presentation.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-review-documents-'));
const target = path.join(base, 'project'), home = path.join(base, 'authority');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = [
  ['sessions/S001.md', '# Session\nsession_objective: Verify interval boundaries\n'],
  ['cycles/C001-feature-fixture/status.md', '# Cycle\nstate: DONE\nsession_owner: S001\n'],
  ['baseline/current.md', '# Baseline\nversion: v0.3\n'],
  ['CURRENT-STATE.md', '# Current state\nC001 is DONE.\n'],
  ['snapshots/context-snapshot.md', '# Snapshot\nSession S001 remains open.\n'],
  ['cycles/C001-feature-fixture/plan.md', '# Plan\nImplement both inclusive endpoints.\n'],
  ['cycles/C001-feature-fixture/traceability.md', '# Tests\nBoth endpoints and invalid bounds passed.\n'],
  ['cycles/C001-feature-fixture/audit-spec.md', '# Audit\nNo blocking findings.\n'],
];
let cases = 0;
try {
  fs.mkdirSync(path.join(target, '.aidn'), { recursive: true }); fs.mkdirSync(home);
  fs.writeFileSync(path.join(target, '.aidn/config.json'), JSON.stringify({ runtime: { stateMode: 'db-only' } }));
  const write = (name, content) => {
    const store = createArtifactStore({ sqliteFile: path.join(target, '.aidn/runtime/index/workflow-index.sqlite') });
    try { store.upsertArtifact({ path: name, content, content_format: 'utf8', kind: 'other', family: 'support' }); }
    finally { store.close(); }
  };
  rows.forEach(([name, content]) => write(name, content));
  // A stale visible projection must never be used to assemble a Human review.
  fs.mkdirSync(path.join(target, 'docs/audit/sessions'), { recursive: true });
  fs.writeFileSync(path.join(target, 'docs/audit/sessions/S001.md'), 'Stale checkout');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: target, env: {} });
  const refs = artifacts.readMany(rows.map(([name]) => name), { includeMetadata: true }).map(row => ({
    ref: 'audit:' + row.path, sha256: row.sha256, metadata_sha256: row.metadata_sha256 }));
  const output = { observations: { report: { evidence_refs: refs.slice(5) } } };
  const question = { contract_version: 'standard-session-closure-question.v1', operation_id: 'op_' + 'a'.repeat(40),
    instance_id: 'fixture', scope_id: 'b'.repeat(64), occurrence_id: 'root/1', intent_sha256: 'c'.repeat(64), session_id: 'S001',
    review: { session_id: 'S001', session_path: 'sessions/S001.md', mode: 'COMMITTING', branch: 'cycle-fixture', session_branch: 'session-fixture',
      head: 'd'.repeat(40), admission_operation_id: 'op_' + 'e'.repeat(40), admission_output_sha256: 'f'.repeat(64),
      drift_evaluation_operation_id: 'op_' + '1'.repeat(40), drift_evaluation_output_sha256: shadowHash(output),
      drift_finalization_operation_id: 'op_' + '2'.repeat(40), drift_finalization_output_sha256: '3'.repeat(64),
      context_sha256: '4'.repeat(64), scope_sha256: '5'.repeat(64), documents: refs.slice(0, 5), open_cycles: [], session_close_gate_satisfied: false },
    choices: ['close', 'refused', 'deferred', 'cancelled'] };
  const offer = operatorOffer(question, 'fixture:close'), before = shadowHash(offer);
  const materialize = createOperatorReviewDocuments({ home, artifacts, readEvaluation: () => output });
  assert.deepEqual(fs.readdirSync(home), []); cases++;
  const prepared = await materialize(offer);
  assert.equal(prepared.review_documents.length, rows.length);
  for (const row of prepared.review_documents) assert.equal(hash(fs.readFileSync(row.path)), row.sha256);
  assert.equal(fs.readFileSync(prepared.review_documents[0].path, 'utf8'), rows[0][1]);
  assert.equal(fs.readFileSync(path.join(target, 'docs/audit/sessions/S001.md'), 'utf8'), 'Stale checkout');
  assert.equal(prepared.review_documents_prepared, true);
  assert.deepEqual(await materialize(offer), { ...prepared, review_documents_prepared: false });
  assert.equal(shadowHash(offer), before); cases++;
  const form = codexDecisionForm(prepared);
  assert.deepEqual(Object.keys(form.request.requestedSchema.properties), ['choice']);
  const view = presentCodexDecision(prepared);
  assert(view.review_message.includes('[Plan de réalisation — C001](<'));
  assert(view.review_message.includes('[Exigences et tests — C001](<'));
  assert(view.review_message.includes('[Audit du résultat — C001](<'));
  assert(!form.request.message.includes('](<')); assert(!form.request.message.includes('operator-reviews'));
  assert(!form.request.message.includes(home)); assert(form.request.message.includes('Pièces disponibles dans le fil'));
  assert(form.request.message.includes('Verify interval boundaries'));
  assert(!form.request.message.includes('audit:')); assert(!form.request.message.includes('gate satisfied'));
  assert(form.request.message.includes('livraison reste à réaliser')); cases++;
  for (const choice of question.choices) {
    const decoded = form.read({ choice: codexChoiceLabel(choice) });
    const claim = { ...decoded.fields, choice, contract_version: offer.claim_version, source_kind: 'human', authority_id: 'fixture',
      source_event_id: offer.source_ref, subject_sha256: offer.subject_sha256, question_sha256: offer.question_sha256,
      evidence_refs: [{ ref: 'fixture:form', sha256: '6'.repeat(64) }] };
    assertOperatorClaim(claim, question, offer.source_ref);
    assert.equal(claim.session_report !== null, choice === 'close');
    if (choice === 'close') assert(form.request.message.includes(claim.session_report.summary));
    cases++;
  }
  const generic = codexDecisionForm(offer);
  assert.equal(generic.request.requestedSchema.properties.rationale.minLength, 1);
  // Captured desktop failure: close plus an empty rationale must not be treated as an accepted receipt.
  assert.throws(() => generic.read({ choice: 'Clore la session', rationale: '' }), /CODEX_DECISION_FIELDS_INVALID/); cases++;
  for (const context of [{ ...prepared.review_context, cycles: [{ id: 'C001', state: 'OPEN', owner: 'S001' }] },
    { ...prepared.review_context, cycles: [{ id: 'C001', state: 'DONE', owner: 'S002' }] }, { cycles: [] }]) {
    assert(Object.hasOwn(codexDecisionForm({ ...prepared, review_context: context }).request.requestedSchema.properties, 'session_report_summary')); cases++;
  }
  const noticeHome = path.join(base, 'notice-authority'); fs.mkdirSync(noticeHome);
  const noticeDocuments = createOperatorReviewDocuments({ home: noticeHome, artifacts, readEvaluation: () => output });
  let noticeForms = 0, noticeSubmissions = 0, noticePrincipals = [];
  const notice = createCodexDecisionChannel({ session: { question: async () => ({ status: 'question', offer }),
    session: () => ({ principals: noticePrincipals }), prepareReview: noticeDocuments,
    submit: envelope => { assertOperatorClaim(envelope.payload, question, offer.source_ref); noticeSubmissions++;
      return { status: 'received', choice: envelope.payload.choice }; } }, formSupported: () => true,
    elicit: async request => { noticeForms++; assert(!request.message.includes('](<'));
      return { action: 'accept', content: { choice: 'Reporter la décision' } }; } });
  noticePrincipals = [{ authority_id: 'fixture', public_key: notice.describe({}).public_key }];
  const ready = await notice.decide({});
  assert.equal(ready.status, 'review_ready'); assert(ready.message.includes('[Plan de réalisation'));
  assert.equal(ready.question_sha256, offer.question_sha256); assert.equal(noticeForms, 0); assert.equal(noticeSubmissions, 0);
  const choice = await notice.decide({}); assert.equal(choice.choice, 'deferred');
  assert.equal(noticeForms, 1); assert.equal(noticeSubmissions, 1); cases++;
  const changed = structuredClone(offer); changed.question.review.documents[0].metadata_sha256 = '9'.repeat(64);
  await assert.rejects(materialize(changed), /OPERATOR_REVIEW_SOURCE_CHANGED/); cases++;
  const traversal = structuredClone(offer); traversal.question.review.documents[0].ref = 'audit:../outside.md';
  await assert.rejects(materialize(traversal), /STANDARD_ARTIFACT_PATH_INVALID/); cases++;
  const missing = structuredClone(offer); missing.question.review.documents[0].ref = 'audit:missing.md';
  await assert.rejects(materialize(missing), /STANDARD_REQUIRED_ARTIFACT_MISSING/); cases++;
  const badEvaluation = createOperatorReviewDocuments({ home, artifacts, readEvaluation: () => ({}) });
  await assert.rejects(badEvaluation(offer), /OPERATOR_REVIEW_SOURCE_CHANGED/); cases++;
  fs.writeFileSync(prepared.review_documents[0].path, 'Modified review copy');
  await assert.rejects(materialize(offer), /OPERATOR_REVIEW_COPY_CHANGED/); cases++;
  let submissions = 0, forms = 0, principals = [];
  const channel = createCodexDecisionChannel({ session: { question: async () => ({ status: 'question', offer }),
    session: () => ({ principals }),
    prepareReview: materialize, submit: () => { submissions++; } },
    formSupported: () => true, elicit: () => { forms++; } });
  principals = [{ authority_id: 'fixture', public_key: channel.describe({}).public_key }];
  await assert.rejects(channel.decide({}), /OPERATOR_REVIEW_COPY_CHANGED/);
  assert.equal(forms, 0); assert.equal(submissions, 0); assert.equal(shadowHash(offer), before); cases++;
  write(rows[5][0], rows[5][1] + 'Changed');
  await assert.rejects(materialize(offer), /OPERATOR_REVIEW_SOURCE_CHANGED/); cases++;
  console.log(JSON.stringify({ status: 'PASS', cases, canonical_backend: 'sqlite/db-only', direct_document_links: true,
    stale_checkout_ignored: true, human_claims_validated: true, live_desktop: 'SKIP' }));
} finally {
  assert.equal(path.dirname(base), fs.realpathSync(os.tmpdir()));
  fs.rmSync(base, { recursive: true, force: true });
}
