import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPrCorrectionReopenFixture } from './standard-pr-correction-fixture-lib.mjs';
import { createGithubReviewFixture } from './github-review-evidence-fixture-lib.mjs';
import { createStandardPrCorrectionAuthority } from '../../src/application/runtime/standard-pr-correction-authority.mjs';
import { createStandardPrCorrectionReopen } from '../../src/application/runtime/standard-pr-correction-reopen.mjs';
import { createStandardPrCorrectionCheckpoint } from '../../src/application/runtime/standard-pr-correction-checkpoint.mjs';
import { createStandardSessionPrReviewContentObservation } from '../../src/application/runtime/standard-session-pr-review-observe.mjs';
import { createLocalWorkflowSessionPush } from '../../src/adapters/runtime/local-workflow-session-push.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

export const fixtureHash = 'a'.repeat(64), fixtureOp = n => 'op_' + String(n).repeat(40);
// Public, dedicated fixture key. This source authenticates a synthetic triage
// and accepted-source chain; it is not a native producer or production receipt.
export const correctionFixtureSigner = createOperationJournalSigner(() => Buffer.alloc(32, 127));
const signer = correctionFixtureSigner;
const productHash = root => shadowHash({ product: fs.readFileSync(path.join(root, 'fixture-product.txt'), 'utf8') });
export function bindCorrectionRealPorts(saved, { now = Date.now } = {}) {
  const { root, remoteRoot, instance, input, p } = saved;
  const state = { eventCurrent: true, prefix: instance.instance_sha256, hook: null };
  const provider = createGithubReviewFixture({ workingDirectory: os.tmpdir(), pullRequest: p });
  provider.state.reviews[0].state = 'CHANGES_REQUESTED';
  provider.state.beforeCall = (...args) => state.hook?.(...args);
  const readCurrent = () => ({ ...instance, instance_sha256: state.prefix });
  const readAcceptedOperation = (_instance, id, binding) => {
    assert.equal(_instance.instance_sha256, state.prefix, 'FIXTURE_ACCEPTED_PREFIX_CHANGED');
    const value = signer.verify(saved.rows[id]);
    assert.equal(value.record.intent.binding_ref, binding); return structuredClone(value);
  };
  const push = createLocalWorkflowSessionPush({ targetRoot: root, remoteRoot });
  const reviewPort = { ...provider.port, async observeReviewContent(...args) {
    await state.beforeReview?.(); return provider.port.observeReviewContent(...args);
  } };
  const authority = createStandardPrCorrectionAuthority({ now, reviewPort, readCurrent, readAcceptedOperation,
    reevaluateTriage: async () => structuredClone(signer.verify(saved.rows[fixtureOp(1)]).output),
    readControl: id => { assert.equal(id, 'fixture-capture'); return structuredClone(signer.verify(saved.capture)); },
    verifyEvent: async capture => { signer.verify(capture); if (!state.eventCurrent) throw Error('FIXTURE_EVENT_NOT_CURRENT'); },
    observeProduct: () => productHash(root), inspectPush: branch => push.inspect(branch),
    observeOwnedPush: (branch, options) => push.observeOwned(branch, options) });
  const componentAuthority = { ...authority, async readSource(...args) {
    state.readingSource = true;
    try { return await authority.readSource(...args); } finally { state.readingSource = false; }
  } };
  return { root, remoteRoot, instance, input, p, saved, state, provider, push, authority,
    artifacts: createStandardWorkflowArtifacts({ targetRoot: root }),
    port: createStandardPrCorrectionReopen({ targetRoot: root, authority: componentAuthority, readCurrent, now }),
    checkpoint: createStandardPrCorrectionCheckpoint({ targetRoot: root, authority, readCurrent, readAcceptedOperation, now }) };
}
export async function createCorrectionRealPortFixture(mode, owned, makeRemote) {
  const base = await createPrCorrectionReopenFixture(mode, owned), p = base.source.pull_request;
  fs.writeFileSync(path.join(base.root, 'fixture-product.txt'), 'retained fixture product\n');
  const git = (...args) => execFileSync('git', ['-C', base.root, ...args], { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();
  git('add', 'fixture-product.txt'); git('-c', 'core.hooksPath=NUL', 'commit', '-m', 'test: arrange concrete correction product');
  p.head_oid = git('rev-parse', 'HEAD'); p.base_oid = git('rev-parse', 'HEAD^');
  const product = productHash(base.root);
  const remoteRoot = makeRemote(base.root, p.head_branch);
  const provider = createGithubReviewFixture({ workingDirectory: os.tmpdir(), pullRequest: p });
  provider.state.reviews[0].state = 'CHANGES_REQUESTED';
  const observed = await createStandardSessionPrReviewContentObservation({ reviewPort: provider.port, readCurrent: () => base.instance,
    readConfirmedHead: () => ({ update_operation_id: fixtureOp(4), session_id: 'S001', head: p.head_oid, pull_request: p, material_sha256: fixtureHash }) })
    .observe(base.instance, { contract_version: 'standard-session-pr-review-observe-input.v1', update_operation_id: fixtureOp(4) });
  assert.equal(observed.outcome, 'completed');
  const payload = { event: { head_oid: p.head_oid, base_oid: p.base_oid, pull_request_id: p.node_id, repository_id: p.repository_id }, observation: observed };
  const triage = { contract_version: 'standard-pr-triage-output.v1', operation_ref: 'session_pr_triage_evaluate', outcome: 'completed', effect_status: 'no_effect',
    facts: { session_pr_findings_classified: true, session_pr_corrections_required: true, session_pr_responses_required: true }, evidence_refs: [],
    observations: { selection_operation_id: fixtureOp(2), received_operation_id: fixtureOp(3), product_sha256: product,
      payload_sha256: shadowHash(payload), head_oid: p.head_oid, base_oid: p.base_oid, corrections: base.source.corrections,
      dispositions: [{ disposition: 'valid' }], triage_completion: 'pending-effects-and-verification',
      checks_acceptance: 'not-established', merge_authorization: 'not-established' } };
  const record = (id, input, output, binding) => signer.seal({ record: { operation_id: id, preview: { input }, intent: { binding_ref: binding } }, output });
  const saved = { root: base.root, remoteRoot, instance: base.instance, input: base.input, p,
    capture: signer.seal({ phase: 'delivered', payload }), rows: {
      [fixtureOp(1)]: record(fixtureOp(1), { report_occurrence_id: 'root/triage' }, triage, 'session_pr_triage_evaluate'),
      [fixtureOp(2)]: record(fixtureOp(2), { received_operation_id: fixtureOp(3) }, { outcome: 'completed', facts: { session_pr_triage_source_selected: true },
        observations: { received_operation_id: fixtureOp(3), payload, payload_sha256: shadowHash(payload), product_sha256: product } }, 'session_pr_triage_select'),
      [fixtureOp(3)]: record(fixtureOp(3), {}, { outcome: 'completed', facts: { session_pr_review_event_received: true },
        observations: { inbox_id: 'fixture-capture', payload } }, 'session_pr_review_receive'),
      [fixtureOp(4)]: record(fixtureOp(4), {}, { outcome: 'completed', facts: { session_pr_head_confirmed: true }, observations: { pull_request: p } }, 'session_pr_update_push') } };
  return { ...bindCorrectionRealPorts(saved), names: base.names, ops: base.ops };
}
export function acceptFixtureReopen(f, prepared, output) {
  f.saved.rows[fixtureOp(5)] = signer.seal({ record: { operation_id: fixtureOp(5), intent: { binding_ref: 'session_pr_correction_reopen' },
    preview: { input: f.input, prepared } }, output });
  return { contract_version: 'standard-pr-correction-checkpoint-input.v1', reopen_operation_id: fixtureOp(5) };
}
