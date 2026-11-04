import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createGithubReviewEvidenceAdapter, assertGithubReviewEvidence } from '../../src/adapters/git-provider/github-review-evidence.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import requestSchema from '../../src/core/contracts/workflow-definition/github-review-evidence-request.v1.schema.json' with { type: 'json' };
import outputSchema from '../../src/core/contracts/workflow-definition/github-review-evidence.v1.schema.json' with { type: 'json' };
const sha = data => createHash('sha256').update(data).digest('hex');
const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'aidn-review-evidence-'));
const head = 'a'.repeat(40), base = 'b'.repeat(40), date = '2026-11-03T00:00:00Z';
const request = { contract_version: 'github-review-evidence-request.v1', pull_request_number: 7, expected_pull_request_id: 'PR_fixture',
  expected_head_oid: head, expected_base_oid: base, expected_head_ref: 'S001-example', expected_base_ref: 'dev' };
const config = { executable: process.execPath, executableSha256: sha(fs.readFileSync(process.execPath)), workingDirectory: root,
  repository: { owner: 'fixture', name: 'repository', node_id: 'R_fixture' }, environment: { GH_HOST: 'foreign.invalid', GH_DEBUG: 'api' } };
const connection = (nodes, cursor = null, total = nodes.length) => ({ nodes, totalCount: total, pageInfo: { hasNextPage: cursor !== null, endCursor: cursor } });
const actor = () => ({ id: 'U_fixture', login: 'reviewer', __typename: 'User' });
const review = (id = 'R1') => ({ id, state: 'APPROVED', submittedAt: date, updatedAt: date, author: actor(), commit: { oid: head } });
const checkRun = (id = 'C1') => ({ __typename: 'CheckRun', id, name: 'Governance Admission', status: 'COMPLETED', conclusion: 'SUCCESS',
  startedAt: date, completedAt: date, checkSuite: { id: 'CS1', app: { id: 'APP1', slug: 'github-actions' }, commit: { oid: head } } });
const status = () => ({ __typename: 'StatusContext', id: 'S1', context: 'legacy', state: 'PENDING', createdAt: date, updatedAt: date, creator: actor(), commit: { oid: head } });
function response(kind, rows) {
  const p = { id: 'PR_fixture', number: 7, headRefOid: head, baseRefOid: base, headRefName: 'S001-example', baseRefName: 'dev', state: 'OPEN', isDraft: false, updatedAt: date };
  if (kind === 'reviews') p.reviews = connection(rows ?? [review()]);
  else p.statusCheckRollup = { commit: { oid: head }, state: 'SUCCESS', contexts: connection(rows ?? [checkRun(), status()]) };
  return { data: { repository: { id: 'R_fixture', nameWithOwner: 'fixture/repository', pullRequest: p } } };
}
function fixture(handler, options = {}) {
  let calls = 0;
  const instance = createGithubReviewEvidenceAdapter(config, { ...options, run(exe, args, input) {
    calls++; const body = JSON.parse(input.input), kind = body.query.includes('reviews(first:') ? 'reviews' : 'checks';
    assert.equal(exe, fs.realpathSync(process.execPath)); assert.deepEqual(args, ['api', 'graphql', '--hostname', 'github.com', '--input', '-']);
    assert.equal(input.env.GH_HOST, 'github.com'); assert.equal(input.env.GH_DEBUG, ''); assert.equal(input.shell, false); assert.equal(input.windowsHide, true);
    assert.ok(!body.query.includes('mutation')); assert.ok(input.timeout > 0 && input.timeout <= 60000);
    const result = handler ? handler({ kind, calls, variables: body.variables }) : response(kind);
    return result?.status !== undefined ? result : { status: 0, signal: null, stdout: JSON.stringify(result) };
  } });
  return { instance, calls: () => calls };
}
const checks = [], check = (name, fn) => { fn(); checks.push(name); console.log('PASS ' + name); };
try {
  check('closed versioned contracts use supported vocabulary', () => { for (const schema of [requestSchema, outputSchema]) assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []); });
  check('actual adapter observes review identity, app identity, checks and legacy statuses at exact head/base', () => {
    const f = fixture(), value = f.instance.observeReviewEvidence(request); assertGithubReviewEvidence(value); assert.equal(f.calls(), 4);
    assert.equal(value.reviews[0].author.node_id, 'U_fixture'); assert.equal(value.checks[0].app.node_id, 'APP1'); assert.equal(value.checks[1].state, 'PENDING');
    for (const key of ['authorized', 'can_merge', 'approved', 'triaged']) assert.equal(Object.hasOwn(value, key), false);
    assert.deepEqual(fs.readdirSync(root), []);
  });
  check('polling time does not change content identity', () => {
    const a = fixture(null, { now: () => 1793664000000 }).instance.observeReviewEvidence(request);
    const b = fixture(null, { now: () => 1793665000000 }).instance.observeReviewEvidence(request);
    assert.equal(a.evidence_sha256, b.evidence_sha256); assert.notEqual(a.observed_until, b.observed_until);
  });
  check('old approvals, dismissed reviews, deleted authors and absent rollup remain data', () => {
    const value = fixture(({ kind }) => { const r = response(kind), p = r.data.repository.pullRequest;
      if (kind === 'reviews') { p.reviews.nodes[0].state = 'DISMISSED'; p.reviews.nodes[0].commit.oid = 'c'.repeat(40); p.reviews.nodes[0].author = null; }
      else p.statusCheckRollup = null; return r;
    }).instance.observeReviewEvidence(request);
    assert.equal(value.reviews[0].state, 'DISMISSED'); assert.equal(value.reviews[0].author, null); assert.notEqual(value.reviews[0].commit_oid, head);
    assert.equal(value.rollup_state, null); assert.deepEqual(value.checks, []);
  });
  check('all review and check pages are exhausted twice with stable ordinal ordering', () => {
    const f = fixture(({ kind, variables }) => { const r = response(kind), p = r.data.repository.pullRequest;
      const rows = kind === 'reviews' ? [review(variables.cursor ? 'R2' : 'R1')] : [checkRun(variables.cursor ? 'C2' : 'C1')];
      const page = connection(rows, variables.cursor ? null : 'next', 2);
      if (kind === 'reviews') p.reviews = page; else p.statusCheckRollup.contexts = page; return r;
    }); const value = f.instance.observeReviewEvidence(request); assert.equal(f.calls(), 8); assert.equal(value.checks.length, 2); assert.equal(value.reviews.length, 2);
  });
  check('collection changes at unchanged head and unchanged PR updatedAt refuse', () => {
    for (const mutate of [p => p.reviews.nodes[0].state = 'DISMISSED', p => p.reviews.nodes[0].author.id = 'U_other']) {
      assert.throws(() => fixture(({ kind, calls }) => { const r = response(kind); if (kind === 'reviews' && calls > 2) mutate(r.data.repository.pullRequest); return r; }).instance.observeReviewEvidence(request), { code: 'GITHUB_REVIEW_COLLECTION_CHANGED' });
    }
    for (const mutate of [c => c.conclusion = 'FAILURE', c => c.id = 'rerun', c => c.checkSuite.app.id = 'APP_other'])
      assert.throws(() => fixture(({ kind, calls }) => { const r = response(kind); if (kind === 'checks' && calls > 2) mutate(r.data.repository.pullRequest.statusCheckRollup.contexts.nodes[0]); return r; }).instance.observeReviewEvidence(request), { code: 'GITHUB_REVIEW_COLLECTION_CHANGED' });
  });
  check('foreign repository, head, base, branches or PR refuse', () => {
    for (const mutate of [r => r.id = 'R_other', r => r.nameWithOwner = 'foreign/repository', r => r.pullRequest.id = 'PR_other',
      r => r.pullRequest.headRefOid = 'c'.repeat(40), r => r.pullRequest.baseRefOid = 'c'.repeat(40), r => r.pullRequest.baseRefName = 'main', r => r.pullRequest.headRefName = 'other'])
      assert.throws(() => fixture(({ kind }) => { const r = response(kind); mutate(r.data.repository); return r; }).instance.observeReviewEvidence(request), { code: 'GITHUB_REVIEW_SOURCE_CHANGED' });
  });
  check('duplicate ids, missing pages, excessive totals and cursor loops refuse', () => {
    for (const mutate of [page => page.nodes.push(review()), page => page.totalCount++, page => page.totalCount = 501,
      page => { page.nodes = []; page.pageInfo = { hasNextPage: true, endCursor: 'same' }; }])
      assert.throws(() => fixture(({ kind }) => { const r = response(kind); if (kind === 'reviews') mutate(r.data.repository.pullRequest.reviews); return r; }).instance.observeReviewEvidence(request), { code: 'GITHUB_REVIEW_PAGINATION_INVALID' });
    assert.throws(() => fixture(({ kind, calls }) => { const r = response(kind); if (kind === 'reviews') r.data.repository.pullRequest.reviews = connection([review('R' + calls)], 'same', 3); return r; }).instance.observeReviewEvidence(request), { code: 'GITHUB_REVIEW_PAGINATION_INVALID' });
  });
  check('foreign check commit and inconsistent completed status refuse', () => {
    for (const mutate of [p => p.statusCheckRollup.commit.oid = 'c'.repeat(40), p => p.statusCheckRollup.contexts.nodes[0].checkSuite.commit.oid = 'c'.repeat(40),
      p => p.statusCheckRollup.contexts.nodes[0].status = 'IN_PROGRESS'])
      assert.throws(() => fixture(({ kind }) => { const r = response(kind); if (kind === 'checks') mutate(r.data.repository.pullRequest); return r; }).instance.observeReviewEvidence(request),
        e => ['GITHUB_REVIEW_SOURCE_CHANGED', 'GITHUB_REVIEW_EVIDENCE_INVALID'].includes(e.code));
  });
  check('provider failure, partial errors and malformed output do not become empty successful checks', () => {
    for (const value of [{ status: 1, stdout: '', stderr: 'fixture secret' }, { status: 0, stdout: '{}' }, { errors: [{ message: 'fixture secret' }], ...response('reviews') }])
      assert.throws(() => fixture(() => value).instance.observeReviewEvidence(request), { code: 'GITHUB_REVIEW_UNAVAILABLE' });
  });
  check('deadline covers every page and second scan without renewal', () => {
    let clock = 1793664000000;
    assert.throws(() => fixture(({ kind, calls }) => { if (calls === 3) clock += 60001; return response(kind); }, { now: () => clock }).instance.observeReviewEvidence(request), { code: 'GITHUB_REVIEW_DEADLINE' });
  });
  check('request fields cannot supply code, identities, policy or approval', () => {
    for (const extra of [{ query: 'mutation{}' }, { approved: true }, { reviewers: ['self'] }, { executable: 'other' }])
      assert.throws(() => fixture().instance.observeReviewEvidence({ ...request, ...extra }), { code: 'GITHUB_REVIEW_REQUEST_INVALID' });
  });
  check('pin mismatch and forged evidence content refuse', () => {
    assert.throws(() => createGithubReviewEvidenceAdapter({ ...config, executableSha256: '0'.repeat(64) }), { code: 'GITHUB_REVIEW_HOST_CHANGED' });
    const value = fixture().instance.observeReviewEvidence(request); value.reviews[0].state = 'CHANGES_REQUESTED';
    assert.throws(() => assertGithubReviewEvidence(value), { code: 'GITHUB_REVIEW_EVIDENCE_INVALID' });
  });
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, proof_class: 'actual-read-only-adapter-with-fixture-GitHub-transport',
    actual_network: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
} finally {
  const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('aidn-review-evidence-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
