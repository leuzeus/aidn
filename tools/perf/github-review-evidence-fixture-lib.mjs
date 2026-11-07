import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGithubReviewEvidenceAdapter, createGithubReviewContentAsyncAdapter } from '../../src/adapters/git-provider/github-review-evidence.mjs';
import { createGithubWorkflowAdapter, createGithubPrContentAsyncAdapter } from '../../src/adapters/git-provider/github-workflow-adapter.mjs';
export function createGithubReviewFixture({ workingDirectory, pullRequest }) {
  const date = '2026-11-03T00:00:00Z', calls = [];
  const actor = { id: 'U_fixture', login: 'fixture-reviewer', __typename: 'User' };
  const state = { pullRequest: structuredClone(pullRequest), reviews: [{ id: 'REVIEW_fixture', state: 'APPROVED', body: 'Complete fixture review evidence.', submittedAt: date, updatedAt: date,
    author: actor, commit: { oid: pullRequest.head_oid } }], checks: [{ __typename: 'CheckRun', id: 'CHECK_fixture', name: 'Governance Admission', status: 'COMPLETED', conclusion: 'SUCCESS',
    startedAt: date, completedAt: date, checkSuite: { id: 'SUITE_fixture', app: { id: 'APP_fixture', slug: 'github-actions' }, commit: { oid: pullRequest.head_oid } } }],
    threads: [], beforeCall: null };
  const connection = nodes => ({ nodes, totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null } });
  const host = { executable: process.execPath, executableSha256: createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'),
    workingDirectory, repository: { owner: 'fixture', name: 'repository', node_id: pullRequest.repository_id } };
  const run = (_binary, _args, options) => {
    const body = JSON.parse(options.input); calls.push(body); state.beforeCall?.(body, calls.length);
    const p = state.pullRequest, repository = { id: p.repository_id, nameWithOwner: 'fixture/repository', pullRequest: {
      id: p.node_id, number: p.number, headRefOid: p.head_oid, baseRefOid: p.base_oid, headRefName: p.head_branch, baseRefName: p.base_branch,
      state: p.state, isDraft: p.draft, merged: p.state === 'MERGED', mergeCommit: null, updatedAt: date,
    } };
    if (body.query.includes('reviews(first:')) repository.pullRequest.reviews = connection(state.reviews);
    else if (body.query.includes('statusCheckRollup {')) repository.pullRequest.statusCheckRollup = { commit: { oid: p.head_oid }, state: 'SUCCESS', contexts: connection(state.checks) };
    else if (body.query.includes('reviewThreads(first:')) repository.pullRequest.reviewThreads = connection(state.threads);
    return { status: 0, signal: null, stdout: JSON.stringify({ data: { repository } }) };
  };
  const review = createGithubReviewEvidenceAdapter(host, { run }), threads = createGithubWorkflowAdapter(host, { run });
  const content = createGithubReviewContentAsyncAdapter(host, { run: async (...args) => run(...args) }), prContent = createGithubPrContentAsyncAdapter(host, { run: async (...args) => run(...args) });
  return { state, calls, run, port: { observeReviewEvidence: review.observeReviewEvidence, observePullRequest: threads.observePullRequest,
    observeReviewContent: content.observeReviewEvidence, observePrContent: prContent.observePullRequest } };
}
// Composed fixtures recover the actual fake-provider PR identity from its
// durable store, then read the current refs from their real local bare remote.
// The synthetic successful review/check is a fixture capability, never native
// evidence or an approval inferred from the incoming observation request.
export function createComposedGithubReviewFixture({ controlRoot, remoteRoot }) {
  function port() {
    const state = JSON.parse(fs.readFileSync(path.join(controlRoot, 'pr-open-provider-fixture.json'), 'utf8'));
    if (state.pulls.length !== 1) throw Error('FIXTURE_REVIEW_PR_AMBIGUOUS');
    const row = state.pulls[0];
    const ref = branch => execFileSync('git', ['--git-dir=' + remoteRoot, 'rev-parse', '--verify', 'refs/heads/' + branch],
      { encoding: 'utf8', windowsHide: true, stdio: 'pipe', timeout: 10000 }).trim();
    const fixture = createGithubReviewFixture({ workingDirectory: controlRoot, pullRequest: { repository_id: row.head.repo.node_id,
      node_id: row.node_id, number: row.number, head_oid: ref(row.head.ref), base_oid: ref(row.base.ref), head_branch: row.head.ref,
      base_branch: row.base.ref, state: row.state.toUpperCase(), draft: row.draft } });
    const correctionFile = path.join(controlRoot, 'standard-pr-correction-fixture.json');
    if (fs.existsSync(correctionFile)) {
      const correction = JSON.parse(fs.readFileSync(correctionFile, 'utf8'));
      if (typeof correction.review_body !== 'string' || !correction.review_body.trim()) throw Error('FIXTURE_REVIEW_BODY_INVALID');
      fixture.state.reviews[0].body = correction.review_body;
      fixture.state.reviews[0].state = 'CHANGES_REQUESTED';
    }
    return fixture.port;
  }
  return { observeReviewEvidence: input => port().observeReviewEvidence(input), observePullRequest: input => port().observePullRequest(input),
    observeReviewContent: (input, options) => port().observeReviewContent(input, options), observePrContent: (input, options) => port().observePrContent(input, options) };
}
