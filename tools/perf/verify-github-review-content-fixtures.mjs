import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createGithubReviewContentAsyncAdapter, assertGithubReviewContent, createGithubReviewEvidenceAdapter } from '../../src/adapters/git-provider/github-review-evidence.mjs';
import { createGithubPrContentAsyncAdapter, assertGithubPrContent, createGithubPrReviewEffectsAsyncAdapter, assertGithubPrReviewEffects, createGithubWorkflowAdapter } from '../../src/adapters/git-provider/github-workflow-adapter.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import evidenceSchema from '../../src/core/contracts/workflow-definition/github-review-evidence.v2.schema.json' with { type: 'json' };
import threadSchema from '../../src/core/contracts/workflow-definition/github-pr-observation-output.v2.schema.json' with { type: 'json' };
import effectsSchema from '../../src/core/contracts/workflow-definition/github-pr-observation-output.v3.schema.json' with { type: 'json' };
import requestSchema from '../../src/core/contracts/workflow-definition/github-pr-observation-request.v2.schema.json' with { type: 'json' };
const sha = text => createHash('sha256').update(text).digest('hex'), head = 'a'.repeat(40), base = 'b'.repeat(40), date = '2026-11-03T00:00:00Z';
const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'aidn-review-content-'));
const config = { executable: process.execPath, executableSha256: sha(fs.readFileSync(process.execPath)), workingDirectory: root,
  repository: { owner: 'fixture', name: 'repository', node_id: 'R_fixture' } };
const request = { contract_version: 'github-review-evidence-request.v1', pull_request_number: 7, expected_pull_request_id: 'PR_fixture',
  expected_head_oid: head, expected_base_oid: base, expected_head_ref: 'S001-example', expected_base_ref: 'dev' };
const threadRequest = { ...request, contract_version: 'github-pr-observation-request.v2' };
const page = (nodes, cursor = null, total = nodes.length) => ({ nodes, totalCount: total, pageInfo: { hasNextPage: cursor !== null, endCursor: cursor } });
function response(input, mutate) {
  const q = JSON.parse(input.input), p = { id: 'PR_fixture', number: 7, headRefOid: head, baseRefOid: base, headRefName: 'S001-example', baseRefName: 'dev',
    state: 'OPEN', isDraft: false, merged: false, mergeCommit: null, updatedAt: date };
  const comment = { id: 'C1', author: { id: 'U1', login: 'reviewer', __typename: 'User' }, body: 'Evidence with a full technical rationale.', createdAt: date, updatedAt: date, commit: { oid: head }, originalCommit: { oid: head } };
  if (q.query.includes('reviews(first:')) p.reviews = page([{ id: 'REV1', author: comment.author, body: 'Complete review body.', state: 'COMMENTED', submittedAt: date, updatedAt: date, commit: { oid: head } }]);
  else if (q.query.includes('statusCheckRollup')) p.statusCheckRollup = { commit: { oid: head }, state: 'PENDING', contexts: page([]) };
  else if (q.query.includes('reviewThreads(first:')) p.reviewThreads = page([{ id: 'T1', path: 'src/example.mjs', line: 1, isResolved: false, isOutdated: false, comments: page([comment]) }]);
  const r = { data: { repository: { id: 'R_fixture', nameWithOwner: 'fixture/repository', pullRequest: p } } };
  mutate?.(r, q); return { status: 0, signal: null, stdout: JSON.stringify(r) };
}
const checks = [], check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name); };
function review(mutate) { let calls = 0; return createGithubReviewContentAsyncAdapter(config, { run: async (_e, _a, input) => response(input, (r, q) => mutate?.(r, q, ++calls)) }); }
function threads(mutate) { let calls = 0; return createGithubPrContentAsyncAdapter(config, { run: async (_e, _a, input) => response(input, (r, q) => mutate?.(r, q, ++calls)) }); }
function effects(mutate) {
  return createGithubPrReviewEffectsAsyncAdapter(config, {
    run: async (_e, _a, input) => response(input, (r, q) => {
      const p = r.data.repository.pullRequest;
      p.headRepository = { id: 'R_fixture' };
      assert.match(q.query, /headRepository \{ id \}/);
      if (p.reviewThreads) {
        assert.match(q.query, /replyTo \{ id \} state isMinimized publishedAt/);
        const thread = p.reviewThreads.nodes[0], original = thread.comments.nodes[0];
        const root = { ...original, replyTo: null, state: 'SUBMITTED', isMinimized: false, publishedAt: date };
        const reply = { ...root, id: 'C2', replyTo: { id: root.id }, author: { id: 'U2', login: 'responder', __typename: 'User' },
          body: 'Technical response.', state: 'SUBMITTED' };
        thread.comments = page([root, reply]);
        thread.isResolved = true;
      }
      mutate?.(r, q);
    }),
  }).observePrReviewEffects(threadRequest);
}
try {
  await check('new closed schemas use supported vocabulary', () => { for (const schema of [evidenceSchema, threadSchema, effectsSchema, requestSchema]) assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []); });
  await check('complete review bodies and immutable actor IDs survive typed observation', async () => {
    const r = await review().observeReviewEvidence(request), t = await threads().observePullRequest(threadRequest);
    assertGithubReviewContent(r); assertGithubPrContent(t);
    assert.equal(r.contract_version, 'github-review-evidence.v2'); assert.equal(r.reviews[0].body_chunks.join(''), 'Complete review body.');
    assert.equal(r.reviews[0].body_sha256, sha('Complete review body.')); assert.equal(r.reviews[0].author.node_id, 'U1');
    assert.equal(t.pull_request.base_oid, base); assert.equal(t.threads[0].comments[0].author_node_id, 'U1');
    assert.equal(t.threads[0].is_resolved, false); assert.equal(t.threads[0].is_outdated, false);
  });
  await check('full Unicode review text survives bounded chunks without truncation', async () => {
    const body = '🙂é rationale\n'.repeat(2000), value = await review(r => { if (r.data.repository.pullRequest.reviews) r.data.repository.pullRequest.reviews.nodes[0].body = body; }).observeReviewEvidence(request);
    assert.equal(value.reviews[0].body_chunks.join(''), body); assert.equal(value.reviews[0].body_sha256, sha(body)); assert.ok(value.reviews[0].body_chunks.length > 1);
  });
  await check('body changes at identical head and review timestamps refuse the collection', async () => {
    await assert.rejects(review((r, _q, calls) => { if (r.data.repository.pullRequest.reviews && calls > 2) r.data.repository.pullRequest.reviews.nodes[0].body += ' changed'; }).observeReviewEvidence(request), { code: 'GITHUB_REVIEW_COLLECTION_CHANGED' });
  });
  await check('missing, malformed and oversized bodies refuse instead of shortening evidence', async () => {
    for (const body of [undefined, null, 'x'.repeat(65537)]) await assert.rejects(review(r => { if (r.data.repository.pullRequest.reviews) r.data.repository.pullRequest.reviews.nodes[0].body = body; }).observeReviewEvidence(request), { code: 'GITHUB_REVIEW_CONTENT_LIMIT' });
  });
  await check('review body digest and chunks are semantically checked after parsing', async () => {
    const value = await review().observeReviewEvidence(request); value.reviews[0].body_chunks[0] += ' forged';
    assert.throws(() => assertGithubReviewContent(value), { code: 'GITHUB_REVIEW_EVIDENCE_INVALID' });
  });
  await check('aggregate review content above the fixed byte ceiling refuses before evidence is returned', async () => {
    await assert.rejects(review(r => {
      const p = r.data.repository.pullRequest.reviews; if (!p) return;
      const row = p.nodes[0]; p.nodes = Array.from({ length: 17 }, (_, i) => ({ ...row, id: 'REV' + i, body: 'x'.repeat(65536) })); p.totalCount = p.nodes.length;
    }).observeReviewEvidence(request), { code: 'GITHUB_REVIEW_CONTENT_LIMIT' });
  });
  await check('comment author ID and exact base are required, while deleted authors stay null', async () => {
    const value = await threads(r => { if (r.data.repository.pullRequest.reviewThreads) r.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0].author = null; }).observePullRequest(threadRequest);
    assert.equal(value.threads[0].comments[0].author_node_id, null);
    await assert.rejects(threads(r => { if (r.data.repository.pullRequest.reviewThreads) delete r.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0].author.id; }).observePullRequest(threadRequest), { code: 'GITHUB_PR_OBSERVATION_INVALID' });
    await assert.rejects(threads(r => { r.data.repository.pullRequest.baseRefOid = 'c'.repeat(40); }).observePullRequest(threadRequest), { code: 'GITHUB_PR_SOURCE_CHANGED' });
  });
  await check('new content request cannot drift either branch or bypass expected base identity', async () => {
    for (const field of ['headRefName', 'baseRefName']) await assert.rejects(threads(r => { r.data.repository.pullRequest[field] = 'foreign'; }).observePullRequest(threadRequest), { code: 'GITHUB_PR_SOURCE_CHANGED' });
    const invalid = { ...threadRequest }; delete invalid.expected_base_oid;
    await assert.rejects(threads().observePullRequest(invalid), { code: 'GITHUB_PR_OBSERVATION_REQUEST_INVALID' });
  });
  await check('nested comment pagination keeps full content, actor identity and exact base checks', async () => {
    function paginate(r, q, wrongBase) {
      const p = r.data.repository.pullRequest;
      if (p.reviewThreads) Object.assign(p.reviewThreads.nodes[0].comments, page(p.reviewThreads.nodes[0].comments.nodes, 'next-comment', 2));
      if (q.query.includes('query AidnReviewComments')) {
        assert.match(q.query, /baseRefOid headRefName baseRefName/);
        r.data.node = { id: 'T1', pullRequest: { id: 'PR_fixture', headRefOid: head, baseRefOid: wrongBase ? 'c'.repeat(40) : base, headRefName: 'S001-example', baseRefName: 'dev' },
          comments: page([{ id: 'C2', author: { id: 'U2', login: 'second-reviewer', __typename: 'User' }, body: 'Complete second comment.', createdAt: date, updatedAt: date, commit: { oid: head }, originalCommit: { oid: head } }], null, 2) };
      }
    }
    const value = await threads((r, q) => paginate(r, q, false)).observePullRequest(threadRequest);
    assert.equal(value.threads[0].comments.length, 2); assert.equal(value.threads[0].comments[1].author_node_id, 'U2');
    await assert.rejects(threads((r, q) => paginate(r, q, true)).observePullRequest(threadRequest), { code: 'GITHUB_PR_SOURCE_CHANGED' });
  });
  await check('all content review pages are collected twice and every body enters the digest', async () => {
    const value = await review((r, q) => {
      const p = r.data.repository.pullRequest.reviews; if (!p) return;
      p.nodes[0].id = q.variables.cursor ? 'REV2' : 'REV1'; p.nodes[0].body = q.variables.cursor ? 'second page body' : 'first page body';
      Object.assign(p, page(p.nodes, q.variables.cursor ? null : 'page2', 2));
    }).observeReviewEvidence(request);
    assert.equal(value.reviews.length, 2); assert.equal(value.requests, 6); assert.equal(value.reviews[1].body_chunks.join(''), 'second page body');
  });
  await check('review effects read-back binds reply linkage, publication, actor and exact resolved thread', async () => {
    const result = await effects();
    assertGithubPrReviewEffects(result);
    assert.equal(result.contract_version, 'github-pr-observation.v3');
    const [thread] = result.threads, [original, reply] = thread.comments;
    assert.equal(thread.is_resolved, true);
    assert.equal(original.reply_to_node_id, null);
    assert.equal(reply.reply_to_node_id, original.node_id);
    assert.equal(reply.author_node_id, 'U2');
    assert.equal(reply.state, 'SUBMITTED');
    assert.equal(reply.is_minimized, false);
    assert.equal(reply.published_at, date);
    assert.equal(reply.body_sha256, sha('Technical response.'));
    assert.throws(() => assertGithubPrContent(result), { code: 'GITHUB_PR_OBSERVATION_INVALID' });
    assert.equal(Object.hasOwn((await threads().observePullRequest(threadRequest)).threads[0].comments[0], 'reply_to_node_id'), false);
    const tampered = structuredClone(result);
    tampered.threads[0].comments[1].reply_to_node_id = 'C_other';
    assert.throws(() => assertGithubPrReviewEffects(tampered), { code: 'GITHUB_PR_OBSERVATION_INVALID' });
  });
  await check('unpublished and minimized comments stay explicit and malformed publication refuses', async () => {
    function change(reply, r) {
      const row = r.data.repository.pullRequest.reviewThreads?.nodes[0].comments.nodes[1];
      if (row) reply(row);
    }
    const result = await effects(r => change(row => Object.assign(row, { state: 'PENDING', isMinimized: true, publishedAt: null }), r));
    const reply = result.threads[0].comments[1];
    assert.equal(reply.state, 'PENDING');
    assert.equal(reply.is_minimized, true);
    assert.equal(reply.published_at, null);
    for (const mutate of [row => { delete row.replyTo; }, row => { row.replyTo = { id: row.id }; },
      row => { row.state = 'PENDING'; }, row => { row.publishedAt = '2099-01-01T00:00:00Z'; }]) {
      await assert.rejects(effects(r => change(mutate, r)), { code: 'GITHUB_PR_OBSERVATION_INVALID' });
    }
  });
  await check('review effects refuse fork, draft and closed PRs', async () => {
    for (const fields of [{ headRepository: { id: 'R_other' } }, { isDraft: true }, { state: 'CLOSED' }]) {
      await assert.rejects(effects(r => Object.assign(r.data.repository.pullRequest, fields)), { code: 'GITHUB_PR_SOURCE_CHANGED' });
    }
  });
  await check('historical readers retain v1 envelopes without content fields or implicit conversion', () => {
    const run = (_e, _a, input) => response(input);
    const a = createGithubReviewEvidenceAdapter(config, { run }).observeReviewEvidence(request);
    const b = createGithubWorkflowAdapter(config, { run }).observePullRequest({ contract_version: 'github-pr-observation-request.v1', pull_request_number: 7, expected_pull_request_id: 'PR_fixture', expected_head_oid: head });
    assert.equal(a.contract_version, 'github-review-evidence.v1'); assert.equal(Object.hasOwn(a.reviews[0], 'body_chunks'), false);
    assert.equal(b.contract_version, 'github-pr-observation.v1'); assert.equal(Object.hasOwn(b.pull_request, 'base_oid'), false); assert.equal(Object.hasOwn(b.threads[0].comments[0], 'author_node_id'), false);
  });
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, actual_network: 'NOT_RUN', native: 'NOT_RUN', durable_pr_wait: 'NOT_RUN', triage: 'NOT_RUN', complete_standard_workflow: false }));
} finally {
  const actual = fs.realpathSync(root); assert.equal(path.dirname(actual), parent); assert.ok(path.basename(actual).startsWith('aidn-review-content-')); fs.rmSync(actual, { recursive: true, force: true });
  console.log(JSON.stringify({ cleanup: 'PASS', fixture_removed: !fs.existsSync(root) }));
}
