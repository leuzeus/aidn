import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "../../core/workflow/shadow-json.mjs";
import requestSchema from "../../core/contracts/workflow-definition/github-pr-observation-request.v1.schema.json" with { type: "json" };
import outputSchema from "../../core/contracts/workflow-definition/github-pr-observation-output.v1.schema.json" with { type: "json" };
const commentSchema = { $schema: outputSchema.$schema, $id: outputSchema.$id + "/comment", ...outputSchema.properties.threads.items.properties.comments.items };
const fail = code => { throw Object.assign(Error(code), { code }); };
const sha = data => createHash("sha256").update(data).digest("hex");
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
const oid = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const compareId = (a, b) => a === b ? 0 : a < b ? -1 : 1;
const identifier = value => typeof value === "string" && value.length > 0 && value.length <= 256;
export const githubObservationLimits = Object.freeze({ requests: 32, threads: 500, comments: 1000, commentBytes: 65536, bodyBytes: 1048576, deadlineMs: 60000, pageSize: 50 });
const commentFields = "id author { login __typename } body createdAt updatedAt commit { oid } originalCommit { oid }";
const metadataFields = "id number headRefOid headRefName baseRefName state isDraft merged mergeCommit { oid } updatedAt";
// Fixed queries only. An IR/request cannot supply GraphQL, shell or credentials.
const queries = Object.freeze({
  threads: `query AidnReviewThreads($owner:String!,$name:String!,$number:Int!,$cursor:String) {
    repository(owner:$owner,name:$name) { id nameWithOwner pullRequest(number:$number) { ${metadataFields}
      reviewThreads(first:50,after:$cursor) { totalCount nodes { id path line isResolved isOutdated
        comments(first:50) { totalCount nodes { ${commentFields} } pageInfo { hasNextPage endCursor } }
      } pageInfo { hasNextPage endCursor } }
    } }
  }`,
  comments: `query AidnReviewComments($id:ID!,$cursor:String) { node(id:$id) { ... on PullRequestReviewThread {
    id pullRequest { id headRefOid }
    comments(first:50,after:$cursor) { totalCount nodes { ${commentFields} } pageInfo { hasNextPage endCursor } }
  } } }`,
  metadata: `query AidnReviewMetadata($owner:String!,$name:String!,$number:Int!) {
    repository(owner:$owner,name:$name) { id nameWithOwner pullRequest(number:$number) { ${metadataFields} } }
  }`,
});
function chunks(text) {
  const result = []; let part = "";
  for (const c of text) { if (part.length + c.length > 8192) { result.push(part); part = ""; } part += c; }
  result.push(part); return result;
}
function content(value) { return { repository: value.repository, pull_request: value.pull_request, threads: value.threads }; }
export function assertGithubPrObservation(value) {
  if (!valid(value, outputSchema) || value.observation_sha256 !== shadowHash(content(value))) fail("GITHUB_PR_OBSERVATION_INVALID");
  const pr = value.pull_request;
  if (value.pagination.requests !== value.pagination.thread_pages + value.pagination.comment_pages + 1 || value.pagination.requests > githubObservationLimits.requests) fail("GITHUB_PR_OBSERVATION_INVALID");
  if (pr.merged !== (pr.state === "MERGED") || pr.merged !== (pr.merge_oid !== null) || Date.parse(value.observed_until) < Date.parse(value.observed_from)) fail("GITHUB_PR_OBSERVATION_INVALID");
  const threads = new Set(), comments = new Set(); let bytes = 0;
  for (const thread of value.threads) {
    if (threads.has(thread.node_id)) fail("GITHUB_PR_OBSERVATION_INVALID"); threads.add(thread.node_id);
    for (const row of thread.comments) {
      if (comments.has(row.node_id)) fail("GITHUB_PR_OBSERVATION_INVALID"); comments.add(row.node_id);
      const body = row.body_chunks.join(""), size = Buffer.byteLength(body);
      if (size > githubObservationLimits.commentBytes || sha(body) !== row.body_sha256) fail("GITHUB_PR_OBSERVATION_INVALID"); bytes += size;
    }
  }
  if (bytes > githubObservationLimits.bodyBytes || comments.size > githubObservationLimits.comments) fail("GITHUB_PR_OBSERVATION_INVALID");
  return value;
}
// The embedding host pins the executable/repository. The runner is a test seam,
// never configuration, an IR binding parameter or an authenticated-result flag.
export function createGithubWorkflowAdapter({ executable, executableSha256, workingDirectory, repository, environment = process.env }, { run = spawnSync, now = Date.now } = {}) {
  if (!path.isAbsolute(executable ?? "") || !/^[a-f0-9]{64}$/.test(executableSha256 ?? "") || !path.isAbsolute(workingDirectory ?? "")
    || !repository || Object.keys(repository).some(key => !["owner", "name", "node_id"].includes(key))
    || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(repository.owner ?? "")
    || !/^[A-Za-z0-9_.-]{1,100}$/.test(repository.name ?? "") || [".", ".."].includes(repository.name)
    || repository.node_id != null && !identifier(repository.node_id) || typeof run !== "function" || typeof now !== "function") fail("GITHUB_PR_HOST_CONFIGURATION_INVALID");
  const binary = fs.realpathSync(executable), cwd = fs.realpathSync(workingDirectory), repo = structuredClone(repository);
  const env = { ...environment, GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GH_DEBUG: "", GH_FORCE_TTY: "", GH_PAGER: "" };
  function pinned() {
    if (fs.realpathSync(executable) !== binary || fs.realpathSync(workingDirectory) !== cwd || !fs.statSync(binary).isFile()
      || !fs.statSync(cwd).isDirectory() || sha(fs.readFileSync(binary)) !== executableSha256) fail("GITHUB_PR_HOST_PIN_CHANGED");
  }
  pinned();
  return Object.freeze({ observePullRequest(request) {
    if (!valid(request, requestSchema)) fail("GITHUB_PR_OBSERVATION_REQUEST_INVALID");
    const start = now(), mono = performance.now(); let requests = 0, threadPages = 0, commentPages = 0, totalComments = 0, totalBytes = 0;
    if (!Number.isSafeInteger(start) || start < 0) fail("GITHUB_PR_OBSERVATION_CLOCK_INVALID");
    function call(kind, variables) {
      pinned();
      const elapsed = Math.max(now() - start, performance.now() - mono), remaining = Math.floor(githubObservationLimits.deadlineMs - elapsed);
      if (!Number.isFinite(elapsed) || elapsed < 0 || remaining <= 0) fail("GITHUB_PR_OBSERVATION_DEADLINE");
      if (++requests > githubObservationLimits.requests) fail("GITHUB_PR_OBSERVATION_LIMIT");
      let result;
      try { result = run(binary, ["api", "graphql", "--hostname", "github.com", "--input", "-"], {
        cwd, env, shell: false, windowsHide: true, encoding: "utf8", input: JSON.stringify({ query: queries[kind], variables }), timeout: remaining, maxBuffer: 4194304,
      }); } catch { fail("GITHUB_PR_OBSERVATION_UNAVAILABLE"); }
      if (result?.error || result?.status !== 0 || result?.signal) fail("GITHUB_PR_OBSERVATION_UNAVAILABLE");
      let response;
      try { response = JSON.parse(result.stdout); } catch { fail("GITHUB_PR_OBSERVATION_UNAVAILABLE"); }
      if (!response || typeof response !== "object" || response.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length)
        || !response.data || typeof response.data !== "object") fail("GITHUB_PR_OBSERVATION_UNAVAILABLE");
      return response.data;
    }
    const variables = { owner: repo.owner, name: repo.name, number: request.pull_request_number };
    function metadata(data) {
      const r = data?.repository, p = r?.pullRequest;
      if (!identifier(r?.id) || typeof r.nameWithOwner !== "string" || r.nameWithOwner.toLowerCase() !== (repo.owner + "/" + repo.name).toLowerCase()
        || repo.node_id != null && r.id !== repo.node_id || p?.id !== request.expected_pull_request_id || p.number !== request.pull_request_number
        || p.headRefOid !== request.expected_head_oid || !oid(p.headRefOid)) fail("GITHUB_PR_SOURCE_CHANGED");
      const [owner, name] = r.nameWithOwner.split("/");
      return { repository: { host: "github.com", owner, name, node_id: r.id }, pull_request: { node_id: p.id, number: p.number,
        head_oid: p.headRefOid, head_ref: p.headRefName, base_ref: p.baseRefName, state: p.state, is_draft: p.isDraft,
        merged: p.merged, merge_oid: p.mergeCommit?.oid ?? null, updated_at: p.updatedAt } };
    }
    function connection(value, maximum, seen, expectedTotal) {
      if (!value || !Number.isInteger(value.totalCount) || value.totalCount < 0 || value.totalCount > maximum || expectedTotal != null && value.totalCount !== expectedTotal
        || !Array.isArray(value.nodes) || value.nodes.length > githubObservationLimits.pageSize || typeof value.pageInfo?.hasNextPage !== "boolean") fail("GITHUB_PR_PAGINATION_INVALID");
      if (value.pageInfo.hasNextPage && !value.nodes.length) fail("GITHUB_PR_PAGINATION_INVALID");
      const next = value.pageInfo.hasNextPage ? value.pageInfo.endCursor : null;
      if (next !== null && (typeof next !== "string" || !next || next.length > 1024)) fail("GITHUB_PR_PAGINATION_INVALID");
      for (const node of value.nodes) { if (!identifier(node?.id) || seen.has(node.id)) fail("GITHUB_PR_PAGINATION_INVALID"); seen.add(node.id); }
      return { nodes: value.nodes, next, total: value.totalCount };
    }
    function normalizeComment(row) {
      if (typeof row.body !== "string" || ++totalComments > githubObservationLimits.comments) fail("GITHUB_PR_OBSERVATION_LIMIT");
      const size = Buffer.byteLength(row.body); totalBytes += size;
      if (size > githubObservationLimits.commentBytes || totalBytes > githubObservationLimits.bodyBytes) fail("GITHUB_PR_OBSERVATION_LIMIT");
      const normalized = { node_id: row.id, author_login: row.author?.login ?? null, author_type: row.author?.__typename ?? null,
        body_chunks: chunks(row.body), body_sha256: sha(row.body), created_at: row.createdAt, updated_at: row.updatedAt,
        commit_oid: row.commit?.oid ?? null, original_commit_oid: row.originalCommit?.oid ?? null };
      if (!valid(normalized, commentSchema)) fail("GITHUB_PR_OBSERVATION_INVALID");
      return normalized;
    }
    const threads = [], seenThreads = new Set(), threadCursors = new Set(); let cursor = null, expectedTotal = null, original = null;
    do {
      const data = call("threads", { ...variables, cursor }); threadPages++;
      const current = metadata(data); if (original && shadowHash(current) !== shadowHash(original)) fail("GITHUB_PR_SOURCE_CHANGED"); original ??= current;
      const page = connection(data.repository.pullRequest.reviewThreads, githubObservationLimits.threads, seenThreads, expectedTotal); expectedTotal = page.total;
      for (const row of page.nodes) {
        const seen = new Set(), cursors = new Set(); let pageComments = connection(row.comments, githubObservationLimits.comments, seen, null), next = pageComments.next;
        const count = pageComments.total, comments = pageComments.nodes.map(normalizeComment);
        while (next !== null) {
          if (cursors.has(next)) fail("GITHUB_PR_PAGINATION_INVALID"); cursors.add(next);
          const data = call("comments", { id: row.id, cursor: next }); commentPages++;
          if (data.node?.id !== row.id || data.node?.pullRequest?.id !== request.expected_pull_request_id || data.node.pullRequest.headRefOid !== request.expected_head_oid) fail("GITHUB_PR_SOURCE_CHANGED");
          pageComments = connection(data.node.comments, githubObservationLimits.comments, seen, count); comments.push(...pageComments.nodes.map(normalizeComment)); next = pageComments.next;
        }
        if (comments.length !== count) fail("GITHUB_PR_PAGINATION_INVALID");
        comments.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || compareId(a.node_id, b.node_id));
        threads.push({ node_id: row.id, path: row.path, line: row.line, is_resolved: row.isResolved, is_outdated: row.isOutdated, comments });
      }
      cursor = page.next; if (cursor !== null) { if (threadCursors.has(cursor)) fail("GITHUB_PR_PAGINATION_INVALID"); threadCursors.add(cursor); }
    } while (cursor !== null);
    if (threads.length !== expectedTotal) fail("GITHUB_PR_PAGINATION_INVALID");
    if (shadowHash(metadata(call("metadata", variables))) !== shadowHash(original)) fail("GITHUB_PR_SOURCE_CHANGED");
    pinned(); const end = now(); if (!Number.isSafeInteger(end) || end < start || Math.max(end - start, performance.now() - mono) > githubObservationLimits.deadlineMs) fail("GITHUB_PR_OBSERVATION_DEADLINE");
    threads.sort((a, b) => compareId(a.node_id, b.node_id));
    const observation = { contract_version: "github-pr-observation.v1", ...original, threads, observed_from: new Date(start).toISOString(), observed_until: new Date(end).toISOString(),
      pagination: { requests, thread_pages: threadPages, comment_pages: commentPages, complete: true }, consistency: "head-and-pr-metadata-rechecked" };
    return assertGithubPrObservation({ ...observation, observation_sha256: shadowHash(content(observation)) });
  } });
}
