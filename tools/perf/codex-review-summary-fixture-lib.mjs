import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createGithubPrReviewEventAsyncAdapter } from '../../src/adapters/git-provider/github-workflow-adapter.mjs';
import { createStandardPrReviewControlSource } from '../../src/application/runtime/standard-session-pr-review-control-source.mjs';
import { createStandardSessionPrReviewContentObservation } from '../../src/application/runtime/standard-session-pr-review-observe.mjs';
import { createStandardControlInbox } from '../../src/application/runtime/standard-workflow-control-inbox.mjs';
import { createGithubReviewFixture } from './github-review-evidence-fixture-lib.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import { assertControlReviewEvent, assertControlReviewPayload } from '../../src/core/workflow/process-control-inbox.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import schema from '../../src/core/contracts/workflow-definition/github-pr-review-event.v2.schema.json' with { type: 'json' };

export async function verifyCodexReviewSummary({ test, workingDirectory }) {
  const digest = 'a'.repeat(64), head = 'b'.repeat(40), base = 'c'.repeat(40);
  const date = new Date(Date.now() - 3600000).toISOString();
  const state = { code_review: { commit_sha: head, has_any_findings: false, has_unresolved_findings: false, status: 'completed' },
    security_review: { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null } };
  const body = value => '<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ' + JSON.stringify(value) + ' -->\nCompleted review.';
  const original = { __typename: 'IssueComment', id: 'IC_fixture', body: body(state), createdAt: date, updatedAt: date, isMinimized: false,
    lastEditedAt: date, editor: { id: 'BOT_fixture', login: 'fixture-bot', __typename: 'Bot' },
    author: { id: 'BOT_fixture', login: 'fixture-bot', __typename: 'Bot' }, repository: { id: 'R_fixture', nameWithOwner: 'fixture/repository' },
    pullRequest: { id: 'PR_fixture', number: 7, headRefOid: head, baseRefOid: base, headRefName: 'S001-example', baseRefName: 'main',
      headRepository: { id: 'R_fixture' }, baseRepository: { id: 'R_fixture' }, baseRef: { target: { oid: base } }, state: 'OPEN',
      isDraft: false, merged: false, mergedAt: null, mergeCommit: null } };
  let node = structuredClone(original);
  const request = { contract_version: 'process-control-request.v1', scope_id: digest, instance_id: 'summary_fixture', instance_sha256: digest,
    model_sha256: digest, instance_revision: 1, occurrence_id: 'root/wait', correlation_id: 'summary_fixture:root/wait',
    event_keys: ['review_snapshot', 'checks_snapshot'], context_sha256: digest, branch: 'S001-example', head };
  const subject = { repository_id: 'R_fixture', pull_request_id: 'PR_fixture', pull_request_number: 7,
    head_oid: head, base_oid: base, head_ref: request.branch, base_ref: 'main', reviews: [], not_before_ms: Date.parse(date) - 1 };
  const adapter = createGithubPrReviewEventAsyncAdapter({ executable: process.execPath,
    executableSha256: createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'), workingDirectory,
    repository: { owner: 'fixture', name: 'repository', node_id: 'R_fixture' },
    reviewer: { node_id: 'BOT_fixture', login: 'fixture-bot[bot]', type: 'Bot' } }, { async run(_binary, args, options) {
      assert.deepEqual(args, ['api', 'graphql', '--hostname', 'github.com', '--input', '-']);
      const query = JSON.parse(options.input); assert.match(query.query, /\.\.\. on IssueComment/);
      assert.doesNotMatch(query.query, /mutation/); assert.equal(options.shell, false);
      return { status: 0, stdout: JSON.stringify({ data: { node } }) };
    } });
  const readEvent = () => adapter.readEvent({ request, sourceRef: 'IC_fixture', subject });
  await test('Codex summary closed v2 retains complete body and publication time without inventing a formal review', async () => {
    assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []);
    const event = await readEvent(); assertControlReviewEvent(event);
    assert.equal(event.contract_version, 'github-pr-review-event.v2'); assert.equal(event.occurred_at, date);
    assert.equal(event.summary.body_chunks.join(''), original.body); assert.equal(event.summary.node_id, 'IC_fixture');
    assert.equal(event.actor.login, 'fixture-bot'); assert.equal(event.state, undefined);
  });
  for (const [name, change] of [
    ['wrong actor node', n => { n.author.id = 'BOT_other'; }], ['human actor', n => { n.author.__typename = 'User'; }],
    ['human edit of bot comment', n => { n.editor = { id: 'U_other', login: 'operator', __typename: 'User' }; }],
    ['missing editor on edited comment', n => { n.editor = null; }],
    ['inconsistent edit date', n => { n.lastEditedAt = new Date(Date.parse(date) - 1).toISOString(); }],
    ['wrong login', n => { n.author.login = 'another'; }], ['foreign repository', n => { n.repository.id = 'R_other'; }],
    ['foreign PR', n => { n.pullRequest.id = 'PR_other'; }], ['fork head', n => { n.pullRequest.headRepository.id = 'R_other'; }],
    ['changed head', n => { n.pullRequest.headRefOid = 'd'.repeat(40); }], ['changed base', n => { n.pullRequest.baseRefOid = 'd'.repeat(40); }],
    ['minimized', n => { n.isMinimized = true; }], ['future publication', n => { n.updatedAt = new Date(Date.now() + 60000).toISOString(); }],
    ['abbreviated prose receipt', n => { n.body = '<!-- codex-review-receipt:v1 -->\nReviewed commit: ' + head.slice(0, 10); }],
    ['duplicate marker', n => { n.body += '\n' + n.body; }],
    ...[['status', 'in_progress'], ['has_any_findings', true], ['has_unresolved_findings', true], ['commit_sha', head.slice(0, 10)]]
      .map(([key, value]) => ['invalid code state ' + key, n => { const copy = structuredClone(state); copy.code_review[key] = value; n.body = body(copy); }]),
    ['security findings', n => { const copy = structuredClone(state); copy.security_review.has_any_findings = true; n.body = body(copy); }],
  ]) await test('Codex summary refuses ' + name, async () => {
    node = structuredClone(original); change(node); await assert.rejects(readEvent()); node = structuredClone(original);
  });
  await test('unedited completed bot summary is accepted with explicit null edit metadata', async () => {
    node.editor = null; node.lastEditedAt = null; assertControlReviewEvent(await readEvent()); node = structuredClone(original);
  });
  await test('an exact retained REST Bot login remains accepted alongside the GraphQL alias', async () => {
    node.author.login += '[bot]'; node.editor.login += '[bot]';
    assertControlReviewEvent(await readEvent()); node = structuredClone(original);
  });
  const p = { repository_id: subject.repository_id, node_id: subject.pull_request_id, number: 7, head_oid: head, base_oid: base,
    head_branch: request.branch, base_branch: 'main', state: 'OPEN', draft: false };
  const fixture = createGithubReviewFixture({ workingDirectory, pullRequest: p }); fixture.state.reviews = [];
  const instance = { ...request, revision: 1 }, updateId = 'op_' + 'e'.repeat(40);
  const observer = createStandardSessionPrReviewContentObservation({ readCurrent: () => instance, reviewPort: fixture.port,
    readConfirmedHead: async () => ({ update_operation_id: updateId, session_id: 'S001', head, material_sha256: digest, pull_request: p }) });
  let proofTime = () => Date.now();
  const source = createStandardPrReviewControlSource({ observer, readEvent,
    async verifyEvent({ event }) { const fresh = await readEvent(); return { outcome: 'verified', current: true,
      authority_id: fresh.authority_id, event_sha256: H(fresh), subject_sha256: H(fresh.actor), observed_at_ms: proofTime() }; },
    async readContext() { return { instance, request_sha256: H(request), reviewSubject: subject,
      input: { contract_version: 'standard-session-pr-review-observe-input.v1', update_operation_id: updateId } }; } });
  let capture;
  await test('fresh authenticated reread admits an older summary and preserves empty formal reviews plus pending triage', async () => {
    capture = await source.readReview({ request, sourceRef: 'IC_fixture' });
    assertControlReviewPayload(capture.payload, capture.source, request);
    assert.equal(capture.payload.event.occurred_at, date);
    assert.deepEqual(capture.payload.observation.observations.evidence.reviews, []);
    assert.equal(capture.payload.observation.observations.merge_authorization, 'not-established');
    assert.equal((await source.verifyReview({ ...capture, request, sourceRef: 'IC_fixture' })).outcome, 'verified');
  });
  await test('stale or missing provider observation cannot admit an old summary', async () => {
    for (const invalid of [undefined, Date.now() - 300001, Date.now() + 60000]) {
      proofTime = () => invalid; await assert.rejects(source.readReview({ request, sourceRef: 'IC_fixture' }), { code: 'PROCESS_CONTROL_PR_EVENT_STALE' });
    }
    proofTime = () => Date.now();
  });
  await test('same-head comment edit or deletion refuses retained delivery', async () => {
    node.body += '\nEdited'; await assert.rejects(source.verifyReview({ ...capture, request, sourceRef: 'IC_fixture' }));
    node = null; await assert.rejects(source.verifyReview({ ...capture, request, sourceRef: 'IC_fixture' })); node = structuredClone(original);
  });
  await test('review I/O may exceed five seconds but cancellation still prevents reservation', async () => {
    let writes = 0;
    const store = { read() { throw Error('UNEXPECTED_READ'); }, compareAndSwap() { writes++; } };
    const inbox = createStandardControlInbox({ store, signer: {}, projectionRequired: false,
      source: { async readReview({ signal }) { await delay(5100, null, { signal }); return null; } } });
    assert.equal(await inbox.reserveReview(request, 'IC_fixture'), null); assert.equal(writes, 0);
    const stop = new AbortController(); const waiting = inbox.reserveReview(request, 'IC_fixture', { signal: stop.signal });
    stop.abort(); await assert.rejects(waiting, { code: 'PROCESS_CONTROL_AUTHORITY_ABORTED' }); assert.equal(writes, 0);
  });
  await test('the fixed review deadline aborts a hung source without a canonical write', async () => {
    const originalTimer = globalThis.setTimeout; let observedSignal, deadline, writes = 0;
    // Accelerate only the production deadline timer; run the real timeout and
    // cancellation path without spending a minute in the fixture.
    globalThis.setTimeout = (fn, ms, ...args) => { deadline = ms; return originalTimer(fn, 0, ...args); };
    try {
      const inbox = createStandardControlInbox({ signer: {}, projectionRequired: false,
        store: { read() { throw Error('UNEXPECTED_READ'); }, compareAndSwap() { writes++; } },
        source: { readReview({ signal }) { observedSignal = signal; return new Promise(() => {}); } } });
      await assert.rejects(inbox.reserveReview(request, 'IC_fixture'), { code: 'PROCESS_CONTROL_AUTHORITY_TIMEOUT' });
      assert.equal(deadline, 60000); assert.equal(observedSignal.aborted, true); assert.equal(writes, 0);
    } finally { globalThis.setTimeout = originalTimer; }
  });
}
