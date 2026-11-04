import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import requestSchema from '../../core/contracts/workflow-definition/github-review-evidence-request.v1.schema.json' with { type: 'json' };
import outputSchema from '../../core/contracts/workflow-definition/github-review-evidence.v1.schema.json' with { type: 'json' };

const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const sha = data => createHash('sha256').update(data).digest('hex');
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
const order = (a, b) => a.node_id === b.node_id ? 0 : a.node_id < b.node_id ? -1 : 1;
const actorFields = 'login __typename ... on User { id } ... on Bot { id } ... on Organization { id }';
const metadataFields = 'id number headRefOid headRefName baseRefOid baseRefName state isDraft updatedAt';
const query = fields => `query AidnReviewEvidence($owner:String!,$name:String!,$number:Int!,$cursor:String) {
  repository(owner:$owner,name:$name) { id nameWithOwner pullRequest(number:$number) { ${metadataFields} ${fields} } } }`;
// Fixed read-only queries. No authored request can supply query text, commands,
// credentials, host identity, a reviewer allowlist or a successful verdict.
const queries = Object.freeze({
  reviews: query(`reviews(first:50,after:$cursor) { totalCount nodes { id state submittedAt updatedAt
    author { ${actorFields} } commit { oid } } pageInfo { hasNextPage endCursor } }`),
  checks: query(`statusCheckRollup { commit { oid } state contexts(first:50,after:$cursor) { totalCount nodes {
    __typename ... on CheckRun { id name status conclusion startedAt completedAt checkSuite { id app { id slug } commit { oid } } }
    ... on StatusContext { id context state createdAt updatedAt creator { ${actorFields} } commit { oid } }
  } pageInfo { hasNextPage endCursor } } }`),
});
export const githubReviewEvidenceLimits = Object.freeze({ requests: 48, rows: 500, deadlineMs: 60000, pageSize: 50 });
const content = value => ({ repository: value.repository, pull_request: value.pull_request, reviews: value.reviews, checks: value.checks,
  rollup_state: value.rollup_state });
export function assertGithubReviewEvidence(value) {
  if (!valid(value, outputSchema) || value.evidence_sha256 !== shadowHash(content(value))
    || Date.parse(value.observed_until) < Date.parse(value.observed_from)) fail('GITHUB_REVIEW_EVIDENCE_INVALID');
  for (const rows of [value.reviews, value.checks]) {
    if (new Set(rows.map(row => row.node_id)).size !== rows.length
      || shadowHash([...rows].sort(order)) !== shadowHash(rows)) fail('GITHUB_REVIEW_EVIDENCE_INVALID');
  }
  for (const row of value.checks) if (row.commit_oid !== value.pull_request.head_oid
    || row.kind === 'CheckRun' && (row.status === 'COMPLETED') !== (row.conclusion !== null)) fail('GITHUB_REVIEW_EVIDENCE_INVALID');
  return value;
}
// This is a live observation capability supplied by the trusted embedding.
// JSON validation/digests do not authenticate data from arbitrary callers.
export function createGithubReviewEvidenceAdapter({ executable, executableSha256, workingDirectory, repository, environment = process.env },
  { run = spawnSync, now = Date.now } = {}) {
  if (!path.isAbsolute(executable ?? '') || !/^[a-f0-9]{64}$/.test(executableSha256 ?? '') || !path.isAbsolute(workingDirectory ?? '')
    || !repository || Object.keys(repository).some(key => !['owner', 'name', 'node_id'].includes(key))
    || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(repository.owner ?? '')
    || !/^[A-Za-z0-9_.-]{1,100}$/.test(repository.name ?? '') || ['.', '..'].includes(repository.name)
    || typeof repository.node_id !== 'string' || !repository.node_id || repository.node_id.length > 256
    || typeof run !== 'function' || typeof now !== 'function') fail('GITHUB_REVIEW_HOST_INVALID');
  const binary = fs.realpathSync(executable), cwd = fs.realpathSync(workingDirectory), repo = structuredClone(repository);
  const env = { ...environment, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_DEBUG: '', GH_FORCE_TTY: '', GH_PAGER: '' };
  function pinned() {
    if (fs.realpathSync(executable) !== binary || fs.realpathSync(workingDirectory) !== cwd || !fs.statSync(binary).isFile()
      || !fs.statSync(cwd).isDirectory() || sha(fs.readFileSync(binary)) !== executableSha256) fail('GITHUB_REVIEW_HOST_CHANGED');
  }
  pinned();
  return Object.freeze({ observeReviewEvidence(request) {
    if (!valid(request, requestSchema)) fail('GITHUB_REVIEW_REQUEST_INVALID');
    const start = now(), mono = performance.now(); let requests = 0;
    if (!Number.isSafeInteger(start) || start < 0) fail('GITHUB_REVIEW_CLOCK_INVALID');
    function remaining() {
      const time = now(), elapsed = Math.max(time - start, performance.now() - mono);
      if (!Number.isSafeInteger(time) || time < start || elapsed >= githubReviewEvidenceLimits.deadlineMs) fail('GITHUB_REVIEW_DEADLINE');
      return Math.floor(githubReviewEvidenceLimits.deadlineMs - elapsed);
    }
    function call(kind, cursor) {
      pinned(); const timeout = remaining();
      if (++requests > githubReviewEvidenceLimits.requests) fail('GITHUB_REVIEW_LIMIT');
      let result, data;
      try { result = run(binary, ['api', 'graphql', '--hostname', 'github.com', '--input', '-'], {
        cwd, env, shell: false, windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 4194304,
        input: JSON.stringify({ query: queries[kind], variables: { owner: repo.owner, name: repo.name, number: request.pull_request_number, cursor } }),
      }); } catch { fail('GITHUB_REVIEW_UNAVAILABLE'); }
      if (result?.error || result?.status !== 0 || result?.signal) fail('GITHUB_REVIEW_UNAVAILABLE');
      try { data = JSON.parse(result.stdout); } catch { fail('GITHUB_REVIEW_UNAVAILABLE'); }
      if (!data || data.errors !== undefined && (!Array.isArray(data.errors) || data.errors.length) || !data.data?.repository) fail('GITHUB_REVIEW_UNAVAILABLE');
      remaining(); return data.data.repository;
    }
    function metadata(r) {
      const p = r.pullRequest;
      if (r.id !== repo.node_id || typeof r.nameWithOwner !== 'string' || r.nameWithOwner.toLowerCase() !== `${repo.owner}/${repo.name}`.toLowerCase()
        || p?.id !== request.expected_pull_request_id || p.number !== request.pull_request_number || p.headRefOid !== request.expected_head_oid
        || p.baseRefOid !== request.expected_base_oid || p.baseRefName !== request.expected_base_ref || p.headRefName !== request.expected_head_ref)
        fail('GITHUB_REVIEW_SOURCE_CHANGED');
      const [owner, name] = r.nameWithOwner.split('/');
      return { repository: { host: 'github.com', owner, name, node_id: r.id }, pull_request: { node_id: p.id, number: p.number,
        head_oid: p.headRefOid, base_oid: p.baseRefOid, head_ref: p.headRefName, base_ref: p.baseRefName,
        state: p.state, is_draft: p.isDraft, updated_at: p.updatedAt } };
    }
    const actor = row => row === null ? null : { node_id: row?.id, login: row?.login, type: row?.__typename };
    const review = row => ({ node_id: row.id, state: row.state, submitted_at: row.submittedAt, updated_at: row.updatedAt,
      author: actor(row.author), commit_oid: row.commit?.oid ?? null });
    function check(row) {
      if (row.__typename === 'CheckRun') return { node_id: row.id, kind: 'CheckRun', name: row.name, status: row.status,
        conclusion: row.conclusion, started_at: row.startedAt, completed_at: row.completedAt,
        suite_id: row.checkSuite?.id, app: row.checkSuite?.app === null ? null : { node_id: row.checkSuite?.app?.id, slug: row.checkSuite?.app?.slug },
        commit_oid: row.checkSuite?.commit?.oid };
      if (row.__typename === 'StatusContext') return { node_id: row.id, kind: 'StatusContext', name: row.context, state: row.state,
        created_at: row.createdAt, updated_at: row.updatedAt, creator: actor(row.creator), commit_oid: row.commit?.oid };
      fail('GITHUB_REVIEW_EVIDENCE_INVALID');
    }
    function collect(kind, expected) {
      let cursor = null, total = null, original = expected, rollupState;
      const ids = new Set(), cursors = new Set(), rows = [];
      do {
        const r = call(kind, cursor), m = metadata(r);
        if (original && shadowHash(original) !== shadowHash(m)) fail('GITHUB_REVIEW_SOURCE_CHANGED'); original ??= m;
        const rollup = r.pullRequest.statusCheckRollup;
        if (kind === 'checks') {
          if (rollup !== null && rollup?.commit?.oid !== request.expected_head_oid) fail('GITHUB_REVIEW_SOURCE_CHANGED');
          const state = rollup?.state ?? null;
          if (rollupState !== undefined && rollupState !== state) fail('GITHUB_REVIEW_SOURCE_CHANGED'); rollupState = state;
        }
        const page = kind === 'reviews' ? r.pullRequest.reviews : rollup === null
          ? { totalCount: 0, nodes: [], pageInfo: { hasNextPage: false } } : rollup?.contexts;
        if (!page || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0 || page.totalCount > githubReviewEvidenceLimits.rows
          || total !== null && total !== page.totalCount || !Array.isArray(page.nodes) || page.nodes.length > githubReviewEvidenceLimits.pageSize
          || typeof page.pageInfo?.hasNextPage !== 'boolean' || page.pageInfo.hasNextPage && !page.nodes.length) fail('GITHUB_REVIEW_PAGINATION_INVALID');
        total = page.totalCount;
        for (const row of page.nodes) {
          if (typeof row?.id !== 'string' || !row.id || row.id.length > 256 || ids.has(row.id)) fail('GITHUB_REVIEW_PAGINATION_INVALID');
          ids.add(row.id); rows.push(kind === 'reviews' ? review(row) : check(row));
        }
        cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
        if (cursor !== null) {
          if (typeof cursor !== 'string' || !cursor || cursor.length > 1024 || cursors.has(cursor)) fail('GITHUB_REVIEW_PAGINATION_INVALID'); cursors.add(cursor);
        }
      } while (cursor !== null);
      if (rows.length !== total) fail('GITHUB_REVIEW_PAGINATION_INVALID');
      return { metadata: original, rows: rows.sort(order), ...(kind === 'checks' ? { rollup_state: rollupState } : {}) };
    }
    function scan() {
      const reviews = collect('reviews'), checks = collect('checks', reviews.metadata);
      return { ...reviews.metadata, reviews: reviews.rows, checks: checks.rows, rollup_state: checks.rollup_state };
    }
    const first = scan(), second = scan();
    // Re-read entire collections: PR updatedAt alone does not fence mutable
    // check runs, review dismissal or a rerun at an unchanged head.
    if (shadowHash(first) !== shadowHash(second)) fail('GITHUB_REVIEW_COLLECTION_CHANGED');
    pinned(); remaining(); const end = now();
    return assertGithubReviewEvidence({ contract_version: 'github-review-evidence.v1', ...second,
      observed_from: new Date(start).toISOString(), observed_until: new Date(end).toISOString(), requests,
      consistency: 'two-complete-identical-collections', evidence_sha256: shadowHash(second) });
  } });
}
