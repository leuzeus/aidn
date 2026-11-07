import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { driveGithubObservation, driveGithubObservationAsync, runGithubObservationCommand } from "./github-observation-transport.mjs";
import { performance } from "node:perf_hooks";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "../../core/workflow/shadow-json.mjs";
import { assertControlRequest, assertControlReviewEvent } from "../../core/workflow/process-control-inbox.mjs";
import requestSchema from "../../core/contracts/workflow-definition/github-pr-observation-request.v1.schema.json" with { type: "json" };
import outputSchema from "../../core/contracts/workflow-definition/github-pr-observation-output.v1.schema.json" with { type: "json" };
import contentRequestSchema from "../../core/contracts/workflow-definition/github-pr-observation-request.v2.schema.json" with { type: "json" };
import contentSchema from "../../core/contracts/workflow-definition/github-pr-observation-output.v2.schema.json" with { type: "json" };
import reviewEffectsSchema from "../../core/contracts/workflow-definition/github-pr-observation-output.v3.schema.json" with { type: "json" };
import mergeSchema from "../../core/contracts/workflow-definition/github-pr-merge-observation.v1.schema.json" with { type: "json" };
const contentCommentSchema = { $schema: contentSchema.$schema, $id: contentSchema.$id + "/comment", ...contentSchema.properties.threads.items.properties.comments.items };
const reviewEffectsCommentSchema = { $schema: reviewEffectsSchema.$schema, $id: reviewEffectsSchema.$id + "/comment", ...reviewEffectsSchema.properties.threads.items.properties.comments.items };
const commentSchema = { $schema: outputSchema.$schema, $id: outputSchema.$id + "/comment", ...outputSchema.properties.threads.items.properties.comments.items };
const fail = code => { throw Object.assign(Error(code), { code }); };
const sha = data => createHash("sha256").update(data).digest("hex");
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
const oid = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const compareId = (a, b) => a === b ? 0 : a < b ? -1 : 1;
const identifier = value => typeof value === "string" && value.length > 0 && value.length <= 256;
const providerDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
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
const mergeFields = `id number headRefOid headRefName baseRefName state isDraft merged mergedAt
  headRepository { id } baseRef { target { oid } }
  mergeCommit { oid parents(first:3) { totalCount nodes { oid } pageInfo { hasNextPage } } }`;
const mergeQuery = `query AidnPrMerge($owner:String!,$name:String!,$number:Int!) {
  repository(owner:$owner,name:$name) { id nameWithOwner pullRequest(number:$number) { ${mergeFields} } }
}`;
const reviewEventQuery = `query AidnPrReviewEvent($id:ID!) {
  node(id:$id) {
    __typename
    ... on PullRequestReview {
      id state submittedAt updatedAt isMinimized body commit { oid }
      author { __typename login ... on User { id } ... on Bot { id } }
      repository { id nameWithOwner }
      pullRequest { ${mergeFields} baseRefOid baseRepository { id } }
    }
  }
}`;
const contentCommentFields = commentFields.replace('author { login __typename }', 'author { login __typename ... on User { id } ... on Bot { id } ... on Organization { id } }');
const contentQueries = Object.freeze(Object.fromEntries(Object.entries(queries).map(([kind, text]) => [kind,
  text.replaceAll(commentFields, contentCommentFields).replaceAll(metadataFields, metadataFields + ' baseRefOid')
    .replace('pullRequest { id headRefOid }', 'pullRequest { id headRefOid baseRefOid headRefName baseRefName }')])));
const reviewEffectsQueries = Object.freeze(Object.fromEntries(Object.entries(contentQueries).map(([kind, text]) => [kind,
  text.replaceAll(contentCommentFields, contentCommentFields + " replyTo { id } state isMinimized publishedAt")
    .replaceAll(metadataFields + " baseRefOid", metadataFields + " baseRefOid headRepository { id }")])));
function chunks(text) {
  const result = []; let part = "";
  for (const c of text) { if (part.length + c.length > 8192) { result.push(part); part = ""; } part += c; }
  result.push(part); return result;
}
function content(value) { return { repository: value.repository, pull_request: value.pull_request, threads: value.threads }; }
function assertObservation(value, schema) {
  if (!valid(value, schema) || value.observation_sha256 !== shadowHash(content(value))) fail("GITHUB_PR_OBSERVATION_INVALID");
  const pr = value.pull_request;
  if (value.pagination.requests !== value.pagination.thread_pages + value.pagination.comment_pages + 1 || value.pagination.requests > githubObservationLimits.requests) fail("GITHUB_PR_OBSERVATION_INVALID");
  if (pr.merged !== (pr.state === "MERGED") || pr.merged !== (pr.merge_oid !== null) || Date.parse(value.observed_until) < Date.parse(value.observed_from)) fail("GITHUB_PR_OBSERVATION_INVALID");
  const threads = new Set(), comments = new Set(); let bytes = 0;
  for (const thread of value.threads) {
    if (threads.has(thread.node_id)) fail("GITHUB_PR_OBSERVATION_INVALID"); threads.add(thread.node_id);
    for (const row of thread.comments) {
      if (comments.has(row.node_id)) fail("GITHUB_PR_OBSERVATION_INVALID"); comments.add(row.node_id);
      if (schema !== outputSchema && [row.author_node_id, row.author_login, row.author_type].some(v => v === null)
        && ![row.author_node_id, row.author_login, row.author_type].every(v => v === null)) fail("GITHUB_PR_OBSERVATION_INVALID");
      if (schema === reviewEffectsSchema && (row.reply_to_node_id === row.node_id
        || row.published_at !== null && (row.state !== "SUBMITTED" || Date.parse(row.published_at) < Date.parse(row.created_at)
          || Date.parse(row.published_at) > Date.parse(value.observed_until)))) fail("GITHUB_PR_OBSERVATION_INVALID");
      const body = row.body_chunks.join(""), size = Buffer.byteLength(body);
      if (size > githubObservationLimits.commentBytes || sha(body) !== row.body_sha256) fail("GITHUB_PR_OBSERVATION_INVALID"); bytes += size;
    }
  }
  if (bytes > githubObservationLimits.bodyBytes || comments.size > githubObservationLimits.comments) fail("GITHUB_PR_OBSERVATION_INVALID");
  return value;
}
export const assertGithubPrObservation = value => assertObservation(value, outputSchema);
export const assertGithubPrContent = value => assertObservation(value, contentSchema);
export const assertGithubPrReviewEffects = value => assertObservation(value, reviewEffectsSchema);
export function assertGithubPrMergeObservation(value) {
  if (!valid(value, mergeSchema)) fail("GITHUB_PR_MERGE_OBSERVATION_INVALID");
  const p = value.pull_request, from = Date.parse(value.observed_from), until = Date.parse(value.observed_until);
  if (!Number.isFinite(from) || !Number.isFinite(until) || until < from
    || p.merged !== (p.state === "MERGED") || p.merged !== (p.merge_oid !== null) || p.merged !== (p.merged_at !== null)
    || p.merged && (!p.merge_parent_oids.length || new Set(p.merge_parent_oids).size !== p.merge_parent_oids.length
      || p.merge_parent_oids.includes(p.merge_oid)
      || p.merge_parent_oids.length === 2 && p.merge_parent_oids[1] !== p.head_oid
      || p.observed_base_tip_oid === p.merge_parent_oids[0] || !(Date.parse(p.merged_at) <= until))
    || !p.merged && p.merge_parent_oids.length) fail("GITHUB_PR_MERGE_OBSERVATION_INVALID");
  return value;
}
function mergeObservation(repository, p, start, end) {
  const parents = p.mergeCommit?.parents;
  if (p.merged && (!Array.isArray(parents?.nodes) || parents.totalCount !== parents.nodes.length
    || parents.pageInfo?.hasNextPage !== false)) fail("GITHUB_PR_MERGE_OBSERVATION_INVALID");
  return assertGithubPrMergeObservation({
    contract_version: "github-pr-merge-observation.v1", repository,
    pull_request: { node_id: p.id, number: p.number, head_oid: p.headRefOid, head_ref: p.headRefName, base_ref: p.baseRefName,
      state: p.state, is_draft: p.isDraft, merged: p.merged, merge_oid: p.mergeCommit?.oid ?? null,
      head_repository_id: p.headRepository?.id, observed_base_tip_oid: p.baseRef?.target?.oid,
      merged_at: p.mergedAt, merge_parent_oids: parents?.nodes.map(parent => parent?.oid) ?? [] },
    observed_from: new Date(start).toISOString(), observed_until: new Date(end).toISOString(),
  });
}
function normalizeReviewEvent(node, { request, sourceRef, subject }, repo, reviewer, start, end) {
  if (node === null) return null;
  if (node?.__typename !== "PullRequestReview" || node.id !== sourceRef) fail("GITHUB_REVIEW_EVENT_NODE_CHANGED");
  const { author, pullRequest: p, repository } = node;
  const actor = { node_id: author?.id, login: author?.login, type: author?.__typename };
  if (actor.node_id !== reviewer.node_id || actor.login !== reviewer.login || actor.type !== reviewer.type)
    fail("GITHUB_REVIEW_EVENT_REVIEWER_CHANGED");
  if (repository?.id !== repo.node_id || repository.nameWithOwner !== repo.owner + "/" + repo.name
    || p?.baseRepository?.id !== repo.node_id || p.headRepository?.id !== repo.node_id || subject.repository_id !== repo.node_id
    || p.id !== subject.pull_request_id || p.number !== subject.pull_request_number
    || p.headRefOid !== request.head || p.headRefOid !== subject.head_oid || node.commit?.oid !== subject.head_oid
    || p.headRefName !== request.branch || p.headRefName !== subject.head_ref || p.baseRefName !== subject.base_ref
    || p.isDraft !== false) fail("GITHUB_REVIEW_EVENT_SUBJECT_CHANGED");
  if (!["APPROVED", "COMMENTED", "CHANGES_REQUESTED"].includes(node.state) || node.isMinimized !== false
    || typeof node.body !== "string" || Buffer.byteLength(node.body) > githubObservationLimits.commentBytes
    || typeof node.submittedAt !== "string" || typeof node.updatedAt !== "string") fail("GITHUB_REVIEW_EVENT_NOT_SUBMITTED");
  const submitted = providerDate(node.submittedAt), updated = providerDate(node.updatedAt);
  if (!Number.isSafeInteger(submitted) || !Number.isSafeInteger(updated) || updated < submitted || updated > end
    || subject.not_before_ms !== undefined && submitted < subject.not_before_ms) fail("GITHUB_REVIEW_EVENT_TIME_INVALID");
  const { pull_request: pr } = mergeObservation({ node_id: repo.node_id, owner: repo.owner, name: repo.name }, p, start, end);
  if (pr.state === "OPEN") {
    if (p.baseRefOid !== subject.base_oid || pr.observed_base_tip_oid !== subject.base_oid)
      fail("GITHUB_REVIEW_EVENT_SUBJECT_CHANGED");
  } else if (!pr.merged || !Number.isSafeInteger(subject.pre_merge_observed_until_ms)
    || pr.merge_parent_oids[0] !== subject.base_oid
    || Date.parse(pr.merged_at) < Math.max(subject.pre_merge_observed_until_ms, submitted, updated)) {
    fail("GITHUB_REVIEW_EVENT_HISTORICAL_SUBJECT_UNPROVEN");
  }
  const revision = { state: node.state, updated_at: node.updatedAt, body_sha256: sha(node.body) };
  if (subject.reviews && !subject.reviews.some(row => row.node_id === node.id && row.commit_oid === node.commit.oid
    && row.submitted_at === node.submittedAt && shadowHash(row.author) === shadowHash(actor)
    && row.state === revision.state && row.updated_at === revision.updated_at && row.body_sha256 === revision.body_sha256))
    fail("GITHUB_REVIEW_EVENT_COLLECTION_CHANGED");
  return assertControlReviewEvent({
    contract_version: "github-pr-review-event.v1", authority_id: "github_review",
    source_event_id: "review-" + shadowHash(node.id), repository_id: repository.id, pull_request_id: p.id, pull_request_number: p.number,
    head_oid: p.headRefOid, base_oid: pr.merged ? pr.merge_parent_oids[0] : p.baseRefOid, head_ref: p.headRefName, base_ref: p.baseRefName,
    event_key: "review_snapshot", revision: shadowHash(revision),
    occurred_at: node.submittedAt, actor,
  });
}
// The embedding host pins the executable/repository. The runner is a test seam,
// never configuration, an IR binding parameter or an authenticated-result flag.
function createGithubWorkflowProtocol({ executable, executableSha256, workingDirectory, repository, reviewer, environment = process.env }, { run = spawnSync, now = Date.now } = {}, view = "review") {
  const reviewEffects = view === "review-effects", includeContent = view === "content" || reviewEffects;
  const mergeOnly = view === "merge", eventOnly = view === "review-event";
  const threadQueries = reviewEffects ? reviewEffectsQueries : includeContent ? contentQueries : queries;
  const observationSchema = reviewEffects ? reviewEffectsSchema : includeContent ? contentSchema : outputSchema;
  const rowSchema = reviewEffects ? reviewEffectsCommentSchema : includeContent ? contentCommentSchema : commentSchema;
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
  return function* observePullRequest(request) {
    const start = now(), mono = performance.now(); let requests = 0, threadPages = 0, commentPages = 0, totalComments = 0, totalBytes = 0;
    if (!Number.isSafeInteger(start) || start < 0) fail("GITHUB_PR_OBSERVATION_CLOCK_INVALID");
    function* call(kind, variables) {
      pinned();
      const elapsed = Math.max(now() - start, performance.now() - mono), remaining = Math.floor(githubObservationLimits.deadlineMs - elapsed);
      if (!Number.isFinite(elapsed) || elapsed < 0 || remaining <= 0) fail("GITHUB_PR_OBSERVATION_DEADLINE");
      if (++requests > githubObservationLimits.requests) fail("GITHUB_PR_OBSERVATION_LIMIT");
      let result;
      try { result = yield [binary, ["api", "graphql", "--hostname", "github.com", "--input", "-"], {
        cwd, env, shell: false, windowsHide: true, encoding: "utf8", input: JSON.stringify({ query: eventOnly ? reviewEventQuery : mergeOnly ? mergeQuery : threadQueries[kind], variables }), timeout: remaining, maxBuffer: 4194304,
      }]; } catch { fail("GITHUB_PR_OBSERVATION_UNAVAILABLE"); }
      if (result?.error || result?.status !== 0 || result?.signal) fail("GITHUB_PR_OBSERVATION_UNAVAILABLE");
      let response;
      try { response = JSON.parse(result.stdout); } catch { fail("GITHUB_PR_OBSERVATION_UNAVAILABLE"); }
      if (!response || typeof response !== "object" || response.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length)
        || !response.data || typeof response.data !== "object") fail("GITHUB_PR_OBSERVATION_UNAVAILABLE");
      return response.data;
    }
    if (eventOnly) {
      assertControlRequest(request.request);
      if (!request.request.event_keys.includes("review_snapshot") || !request.subject || typeof request.sourceRef !== "string"
        || !/^[A-Za-z0-9_=-]{1,256}$/.test(request.sourceRef)) fail("GITHUB_REVIEW_EVENT_REQUEST_INVALID");
      const data = yield* call("event", { id: request.sourceRef });
      pinned();
      const end = now();
      if (!Number.isSafeInteger(end) || end < start || Math.max(end - start, performance.now() - mono) > githubObservationLimits.deadlineMs)
        fail("GITHUB_PR_OBSERVATION_DEADLINE");
      return normalizeReviewEvent(data.node, request, repo, reviewer, start, end);
    }
    if (!valid(request, includeContent || mergeOnly ? contentRequestSchema : requestSchema)) fail("GITHUB_PR_OBSERVATION_REQUEST_INVALID");
    const variables = { owner: repo.owner, name: repo.name, number: request.pull_request_number };
    function metadata(data) {
      const r = data?.repository, p = r?.pullRequest;
      if (!identifier(r?.id) || typeof r.nameWithOwner !== "string" || r.nameWithOwner.toLowerCase() !== (repo.owner + "/" + repo.name).toLowerCase()
        || repo.node_id != null && r.id !== repo.node_id || p?.id !== request.expected_pull_request_id || p.number !== request.pull_request_number
        || p.headRefOid !== request.expected_head_oid || !oid(p.headRefOid)) fail("GITHUB_PR_SOURCE_CHANGED");
      if (includeContent && (p.baseRefOid !== request.expected_base_oid || p.headRefName !== request.expected_head_ref
        || p.baseRefName !== request.expected_base_ref)) fail("GITHUB_PR_SOURCE_CHANGED");
      if (reviewEffects && (p.headRepository?.id !== r.id || p.state !== "OPEN" || p.isDraft !== false))
        fail("GITHUB_PR_SOURCE_CHANGED");
      const [owner, name] = r.nameWithOwner.split("/");
      return { repository: { host: "github.com", owner, name, node_id: r.id }, pull_request: { node_id: p.id, number: p.number,
        head_oid: p.headRefOid, head_ref: p.headRefName, base_ref: p.baseRefName, state: p.state, is_draft: p.isDraft,
        ...(includeContent ? { base_oid: p.baseRefOid } : {}), merged: p.merged, merge_oid: p.mergeCommit?.oid ?? null, updated_at: p.updatedAt } };
    }
    if (mergeOnly) {
      const data = yield* call("metadata", variables), identity = metadata(data), p = data.repository.pullRequest;
      const pr = identity.pull_request;
      if (pr.head_ref !== request.expected_head_ref || pr.base_ref !== request.expected_base_ref)
        fail("GITHUB_PR_SOURCE_CHANGED");
      pinned();
      const end = now();
      if (!Number.isSafeInteger(end) || end < start || Math.max(end - start, performance.now() - mono) > githubObservationLimits.deadlineMs)
        fail("GITHUB_PR_OBSERVATION_DEADLINE");
      const observed = mergeObservation({ node_id: identity.repository.node_id, owner: identity.repository.owner, name: identity.repository.name }, p, start, end);
      if (pr.state === "OPEN" && observed.pull_request.observed_base_tip_oid !== request.expected_base_oid
        || pr.merged && observed.pull_request.merge_parent_oids[0] !== request.expected_base_oid) fail("GITHUB_PR_SOURCE_CHANGED");
      return observed;
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
      const normalized = { node_id: row.id, ...(includeContent ? { author_node_id: row.author === null ? null : row.author?.id } : {}), author_login: row.author?.login ?? null, author_type: row.author?.__typename ?? null,
        body_chunks: chunks(row.body), body_sha256: sha(row.body), created_at: row.createdAt, updated_at: row.updatedAt,
        commit_oid: row.commit?.oid ?? null, original_commit_oid: row.originalCommit?.oid ?? null };
      if (reviewEffects) Object.assign(normalized, {
        reply_to_node_id: row.replyTo === null ? null : row.replyTo?.id,
        state: row.state, is_minimized: row.isMinimized, published_at: row.publishedAt,
      });
      if (!valid(normalized, rowSchema)) fail("GITHUB_PR_OBSERVATION_INVALID");
      return normalized;
    }
    const threads = [], seenThreads = new Set(), threadCursors = new Set(); let cursor = null, expectedTotal = null, original = null;
    do {
      const data = yield* call("threads", { ...variables, cursor }); threadPages++;
      const current = metadata(data); if (original && shadowHash(current) !== shadowHash(original)) fail("GITHUB_PR_SOURCE_CHANGED"); original ??= current;
      const page = connection(data.repository.pullRequest.reviewThreads, githubObservationLimits.threads, seenThreads, expectedTotal); expectedTotal = page.total;
      for (const row of page.nodes) {
        const seen = new Set(), cursors = new Set(); let pageComments = connection(row.comments, githubObservationLimits.comments, seen, null), next = pageComments.next;
        const count = pageComments.total, comments = pageComments.nodes.map(normalizeComment);
        while (next !== null) {
          if (cursors.has(next)) fail("GITHUB_PR_PAGINATION_INVALID"); cursors.add(next);
          const data = yield* call("comments", { id: row.id, cursor: next }); commentPages++;
          if (data.node?.id !== row.id || data.node?.pullRequest?.id !== request.expected_pull_request_id || data.node.pullRequest.headRefOid !== request.expected_head_oid) fail("GITHUB_PR_SOURCE_CHANGED");
          if (includeContent && (data.node.pullRequest.baseRefOid !== request.expected_base_oid || data.node.pullRequest.headRefName !== request.expected_head_ref
            || data.node.pullRequest.baseRefName !== request.expected_base_ref)) fail("GITHUB_PR_SOURCE_CHANGED");
          pageComments = connection(data.node.comments, githubObservationLimits.comments, seen, count); comments.push(...pageComments.nodes.map(normalizeComment)); next = pageComments.next;
        }
        if (comments.length !== count) fail("GITHUB_PR_PAGINATION_INVALID");
        comments.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || compareId(a.node_id, b.node_id));
        threads.push({ node_id: row.id, path: row.path, line: row.line, is_resolved: row.isResolved, is_outdated: row.isOutdated, comments });
      }
      cursor = page.next; if (cursor !== null) { if (threadCursors.has(cursor)) fail("GITHUB_PR_PAGINATION_INVALID"); threadCursors.add(cursor); }
    } while (cursor !== null);
    if (threads.length !== expectedTotal) fail("GITHUB_PR_PAGINATION_INVALID");
    if (shadowHash(metadata(yield* call("metadata", variables))) !== shadowHash(original)) fail("GITHUB_PR_SOURCE_CHANGED");
    pinned(); const end = now(); if (!Number.isSafeInteger(end) || end < start || Math.max(end - start, performance.now() - mono) > githubObservationLimits.deadlineMs) fail("GITHUB_PR_OBSERVATION_DEADLINE");
    threads.sort((a, b) => compareId(a.node_id, b.node_id));
    const observation = { contract_version: observationSchema.properties.contract_version.const, ...original, threads, observed_from: new Date(start).toISOString(), observed_until: new Date(end).toISOString(),
      pagination: { requests, thread_pages: threadPages, comment_pages: commentPages, complete: true }, consistency: "head-and-pr-metadata-rechecked" };
    return assertObservation({ ...observation, observation_sha256: shadowHash(content(observation)) }, observationSchema);
  };
}

export function createGithubWorkflowAdapter(configuration, { run = spawnSync, now = Date.now } = {}) {
  const observe = createGithubWorkflowProtocol(configuration, { run, now });
  return Object.freeze({ observePullRequest: request => driveGithubObservation(observe(request), run) });
}
export function createGithubWorkflowAsyncAdapter(configuration, { run = runGithubObservationCommand, now = Date.now } = {}) {
  const observe = createGithubWorkflowProtocol(configuration, { run, now });
  return Object.freeze({ observePullRequest: (request, { signal } = {}) => driveGithubObservationAsync(observe(request), run, signal) });
}

export function createGithubPrMergeAsyncAdapter(configuration, { run = runGithubObservationCommand, now = Date.now } = {}) {
  const observe = createGithubWorkflowProtocol(configuration, { run, now }, "merge");
  return Object.freeze({ observePrMerge: (request, { signal } = {}) => driveGithubObservationAsync(observe(request), run, signal) });
}

export function createGithubPrReviewEventAsyncAdapter(configuration, { run = runGithubObservationCommand, now = Date.now } = {}) {
  const observe = createGithubWorkflowProtocol(configuration, { run, now }, "review-event");
  return Object.freeze({ readEvent: (request, { signal } = {}) => driveGithubObservationAsync(observe(request), run, signal) });
}

export function createGithubPrReviewEffectsAsyncAdapter(configuration, { run = runGithubObservationCommand, now = Date.now } = {}) {
  const observe = createGithubWorkflowProtocol(configuration, { run, now }, "review-effects");
  return Object.freeze({ observePrReviewEffects: (request, { signal } = {}) => driveGithubObservationAsync(observe(request), run, signal) });
}

export function createGithubPrContentAsyncAdapter(configuration, { run = runGithubObservationCommand, now = Date.now } = {}) {
  const observe = createGithubWorkflowProtocol(configuration, { run, now }, "content");
  return Object.freeze({ observePullRequest: (request, { signal } = {}) => driveGithubObservationAsync(observe(request), run, signal) });
}
