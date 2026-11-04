import assert from 'node:assert/strict';
import os from 'node:os';
import { createGithubReviewFixture } from './github-review-evidence-fixture-lib.mjs';
import { createStandardPrCorrectionAuthority } from '../../src/application/runtime/standard-pr-correction-authority.mjs';
import { createStandardSessionPrReviewContentObservation } from '../../src/application/runtime/standard-session-pr-review-observe.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
const H = 'a'.repeat(64), op = n => 'op_' + String(n).repeat(40);
const p = { contract_version: 'github-pr-link.v1', repository_id: 'R_fixture', node_id: 'PR_fixture', number: 1, head_branch: 'S001-correction', base_branch: 'dev',
  head_oid: 'a'.repeat(40), base_oid: 'b'.repeat(40), state: 'OPEN', draft: false, url: 'https://github.com/fixture/repository/pull/1', title_sha256: H, body_sha256: H };
const instance = { instance_id: 'source-fixture', instance_sha256: H };
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
async function fixture() {
  const provider = createGithubReviewFixture({ workingDirectory: os.tmpdir(), pullRequest: p });
  const observed = await createStandardSessionPrReviewContentObservation({ reviewPort: provider.port, readCurrent: () => instance,
    readConfirmedHead: () => ({ update_operation_id: op(4), session_id: 'S001', head: p.head_oid, pull_request: p, material_sha256: H }) })
    .observe(instance, { contract_version: 'standard-session-pr-review-observe-input.v1', update_operation_id: op(4) });
  assert.equal(observed.outcome, 'completed');
  const payload = { event: { head_oid: p.head_oid, base_oid: p.base_oid, pull_request_id: p.node_id, repository_id: p.repository_id }, observation: observed };
  const corrections = [{ kind: 'review', node_id: 'REVIEW_fixture', thread_id: null, correction: 'Correct and validate the boundary.' }];
  const triage = { contract_version: 'standard-pr-triage-output.v1', operation_ref: 'session_pr_triage_evaluate', outcome: 'completed', effect_status: 'no_effect',
    facts: { session_pr_findings_classified: true, session_pr_corrections_required: true, session_pr_responses_required: true }, evidence_refs: [],
    observations: { selection_operation_id: op(2), received_operation_id: op(3), product_sha256: H, payload_sha256: shadowHash(payload), head_oid: p.head_oid, base_oid: p.base_oid,
      corrections, dispositions: [{ disposition: 'valid' }], triage_completion: 'pending-effects-and-verification',
      checks_acceptance: 'not-established', merge_authorization: 'not-established' } };
  const record = (id, input, output, binding) => ({ record: { operation_id: id, preview: { input }, intent: { binding_ref: binding } }, output });
  const rows = { [op(1)]: record(op(1), { report_occurrence_id: 'root/triage' }, triage, 'session_pr_triage_evaluate'),
    [op(2)]: record(op(2), { received_operation_id: op(3) }, { outcome: 'completed', facts: { session_pr_triage_source_selected: true },
      observations: { received_operation_id: op(3), payload, payload_sha256: shadowHash(payload), product_sha256: H } }, 'session_pr_triage_select'),
    [op(3)]: record(op(3), {}, { outcome: 'completed', facts: { session_pr_review_event_received: true }, observations: { inbox_id: 'captured', payload } }, 'session_pr_review_receive'),
    [op(4)]: record(op(4), {}, { outcome: 'completed', facts: { session_pr_head_confirmed: true }, observations: { pull_request: p } }, 'session_pr_update_push') };
  const state = { authenticated: true, eventCurrent: true, product: H, localHead: p.head_oid, remoteHead: p.head_oid, reevalChanged: false, eventCalls: 0 };
  const capture = { phase: 'delivered', payload };
  const authority = createStandardPrCorrectionAuthority({ reviewPort: provider.port, readCurrent: () => instance,
    readAcceptedOperation(_instance, id, binding) { assert.ok(state.authenticated, 'fixture accepted authority refused'); assert.equal(rows[id]?.record.intent.binding_ref, binding); return structuredClone(rows[id]); },
    reevaluateTriage: async () => state.reevalChanged ? { ...triage, outcome: 'blocked', facts: {} } : structuredClone(triage),
    readControl: id => { assert.equal(id, 'captured'); return structuredClone(capture); }, observeProduct: () => state.product,
    inspectPush: async () => ({ head: state.localHead, remote_head: state.remoteHead }),
    async verifyEvent() { state.eventCalls++; if (!state.eventCurrent) throw Error('fixture event refused'); } });
  return { authority, state, rows, provider, triage, input: { triage_operation_id: op(1) } };
}
await test('fresh complete provider content is reobserved while accepted triage/event identities stay fixture capabilities', async () => {
  const f = await fixture(), source = await f.authority.readSource(instance, f.input);
  assert.equal(source.corrections.length, 1); assert.equal(source.session_id, 'S001'); assert.ok(f.state.eventCalls >= 2);
  const proof = await f.authority.verifySource(instance, source); assert.equal(proof.origin_source_sha256, shadowHash(source));
  assert.equal(proof.canonical_transition, 'verified-separately-by-exact-plan-postimages');
});
for (const change of ['accepted', 'event', 'product', 'reevaluation', 'remote']) await test(change + ' refusal cannot reopen the canonical owner', async () => {
  const f = await fixture();
  if (change === 'accepted') f.state.authenticated = false;
  if (change === 'event') f.state.eventCurrent = false;
  if (change === 'product') f.state.product = 'b'.repeat(64);
  if (change === 'reevaluation') f.state.reevalChanged = true;
  if (change === 'remote') f.state.remoteHead = 'c'.repeat(40);
  await assert.rejects(f.authority.readSource(instance, f.input));
});
await test('same-head edited review body is refused by fresh full-content comparison', async () => {
  const f = await fixture(), source = await f.authority.readSource(instance, f.input);
  f.provider.state.reviews[0].body += ' Additional finding.';
  await assert.rejects(f.authority.verifySource(instance, source), { code: 'STANDARD_PR_CORRECTION_PROVIDER_CHANGED' });
});
await test('event authentication changing during full content collection refuses the continuation', async () => {
  const f = await fixture(), source = await f.authority.readSource(instance, f.input);
  f.provider.state.beforeCall = () => { f.state.eventCurrent = false; };
  await assert.rejects(f.authority.verifySource(instance, source));
});
await test('base/head/product/source changes cannot inherit the prior classification', async () => {
  for (const kind of ['base', 'head', 'source']) {
    const f = await fixture(), source = await f.authority.readSource(instance, f.input);
    if (kind === 'base') f.provider.state.pullRequest.base_oid = 'c'.repeat(40);
    if (kind === 'head') f.provider.state.pullRequest.head_oid = 'c'.repeat(40);
    if (kind === 'source') f.rows[op(2)].output.observations.received_operation_id = op(9);
    await assert.rejects(f.authority.verifySource(instance, source));
  }
});
await test('cancellation refuses before observing a late source', async () => {
  const f = await fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.authority.readSource(instance, f.input, { signal: controller.signal }), { code: 'STANDARD_PR_CORRECTION_ABORTED' });
});
await test('provider-only observation never substitutes for proof of a changed local HEAD', async () => {
  const f = await fixture(), source = await f.authority.readSource(instance, f.input);
  f.state.localHead = 'c'.repeat(40);
  await assert.rejects(f.authority.verifySource(instance, source), { code: 'STANDARD_PR_CORRECTION_REMOTE_CHANGED' });
  const observation = await f.authority.verifyProviderSource(instance, source);
  assert.equal(observation.origin_source_sha256, shadowHash(source));
  assert.equal(observation.canonical_transition, 'local-checkpoint-proof-required');
  f.state.remoteHead = 'c'.repeat(40);
  await assert.rejects(f.authority.verifyProviderSource(instance, source), { code: 'STANDARD_PR_CORRECTION_REMOTE_CHANGED' });
});
for (const change of ['event', 'product', 'provider']) await test('provider-only observation still refuses changed ' + change, async () => {
  const f = await fixture(), source = await f.authority.readSource(instance, f.input);
  f.state.localHead = 'c'.repeat(40);
  if (change === 'event') f.state.eventCurrent = false;
  if (change === 'product') f.state.product = 'c'.repeat(64);
  if (change === 'provider') f.provider.state.reviews[0].body += ' New finding.';
  await assert.rejects(f.authority.verifyProviderSource(instance, source));
});
console.log(JSON.stringify({ status: 'PASS', checks, proof_class: 'component-capability-doubles', review_content_adapters: 'ACTUAL',
  accepted_receipts_native_event_and_transport: 'DOUBLED', canonical_writes: 'NOT_RUN', host_ir_binding: 'NOT_EXERCISED_BY_THIS_SUITE', full_standard: false }));
