import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createGithubWorkflowAdapter, assertGithubPrObservation } from "../../src/adapters/git-provider/github-workflow-adapter.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import requestSchema from "../../src/core/contracts/workflow-definition/github-pr-observation-request.v1.schema.json" with { type: "json" };
import outputSchema from "../../src/core/contracts/workflow-definition/github-pr-observation-output.v1.schema.json" with { type: "json" };
const sha = data => createHash("sha256").update(data).digest("hex"), parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, "aidn-github-observation-"));
const head = "a".repeat(40), date = "2026-11-03T00:00:00Z", request = { contract_version: "github-pr-observation-request.v1", pull_request_number: 7, expected_pull_request_id: "PR_fixture", expected_head_oid: head };
const config = { executable: process.execPath, executableSha256: sha(fs.readFileSync(process.execPath)), workingDirectory: root, repository: { owner: "fixture", name: "repository", node_id: "R_fixture" }, environment: { GH_DEBUG: "api", GH_HOST: "foreign.invalid", GH_TOKEN: "fixture-not-a-token" } };
const comment = id => ({ id, author: { login: "review-bot", __typename: "Bot" }, body: "Review finding", createdAt: date, updatedAt: date, commit: { oid: head }, originalCommit: { oid: head } });
const connection = (nodes, cursor = null, total = nodes.length) => ({ nodes, totalCount: total, pageInfo: { hasNextPage: cursor !== null, endCursor: cursor } });
const thread = (id, comments = [comment("C_" + id)]) => ({ id, path: "src/example.mjs", line: 1, isResolved: false, isOutdated: false, comments: connection(comments) });
const metadata = () => ({ id: "R_fixture", nameWithOwner: "fixture/repository", pullRequest: { id: "PR_fixture", number: 7, headRefOid: head, headRefName: "S001-example", baseRefName: "dev", state: "OPEN", isDraft: false, merged: false, mergeCommit: null, updatedAt: date } });
function response(threads = [thread("T_one")]) { const repository = metadata(); repository.pullRequest.reviewThreads = connection(threads); return { data: { repository } }; }
function adapter(handler = null, options = {}) {
  let calls = 0; const requests = [];
  return { requests, instance: createGithubWorkflowAdapter(config, { ...options, run(executable, args, input) {
    calls++; const body = JSON.parse(input.input), kind = /query Aidn(\w+)/.exec(body.query)?.[1]; requests.push({ kind, variables: body.variables });
    assert.equal(executable, fs.realpathSync(process.execPath)); assert.deepEqual(args, ["api", "graphql", "--hostname", "github.com", "--input", "-"]);
    assert.equal(input.shell, false); assert.equal(input.windowsHide, true); assert.equal(input.env.GH_DEBUG, ""); assert.equal(input.env.GH_PROMPT_DISABLED, "1");
    assert.match(body.query, /^query /); assert.ok(!body.query.includes("mutation"));
    const value = handler ? handler({ kind, variables: body.variables, calls }) : kind === "ReviewMetadata" ? { data: { repository: metadata() } } : response();
    return value?.status !== undefined ? value : { status: 0, signal: null, stdout: JSON.stringify(value), stderr: "" };
  } }) };
}
const checks = []; const check = (name, fn) => { fn(); checks.push(name); console.log("PASS " + name); };
try {
  check("closed private contracts use supported vocabulary", () => { for (const s of [requestSchema, outputSchema]) assert.deepEqual(validateJsonSchemaDefinition(s, "#", { contractKind: "workflow-definition" }), []); });
  check("actual adapter emits a complete typed observation through fixed read-only query requests", () => { const f = adapter(), r = f.instance.observePullRequest(request); assert.equal(r.threads.length, 1); assert.equal(r.threads[0].is_resolved, false); assert.equal(r.pull_request.head_oid, head); assert.equal(r.pagination.requests, 2); assert.equal(r.pagination.complete, true); assert.equal(r.observation_sha256.length, 64); assertGithubPrObservation(r); assert.equal(fs.readdirSync(root).length, 0); });
  check("observation digest is stable across polling time and cannot authorize merge", () => { const a = adapter(null, { now: () => 1793664000000 }).instance.observePullRequest(request), b = adapter(null, { now: () => 1793665000000 }).instance.observePullRequest(request); assert.equal(a.observation_sha256, b.observation_sha256); assert.notEqual(a.observed_until, b.observed_until); for (const key of ["approved", "can_merge", "authorized"]) assert.equal(Object.hasOwn(a, key), false); });
  check("outdated unresolved threads remain explicitly unresolved", () => { const f = adapter(({ kind }) => { if (kind === "ReviewMetadata") return { data: { repository: metadata() } }; const r = response(); r.data.repository.pullRequest.reviewThreads.nodes[0].isOutdated = true; return r; }); const r = f.instance.observePullRequest(request); assert.equal(r.threads[0].is_outdated, true); assert.equal(r.threads[0].is_resolved, false); });
  check("both thread and nested comment pagination are exhausted", () => {
    const f = adapter(({ kind, variables }) => {
      if (kind === "ReviewMetadata") return { data: { repository: metadata() } };
      if (kind === "ReviewComments") return { data: { node: { id: "T_one", pullRequest: { id: "PR_fixture", headRefOid: head }, comments: connection([comment("C_two")], null, 2) } } };
      const r = response([thread(variables.cursor ? "T_two" : "T_one")]);
      r.data.repository.pullRequest.reviewThreads = connection(r.data.repository.pullRequest.reviewThreads.nodes, variables.cursor ? null : "thread_next", 2);
      if (!variables.cursor) r.data.repository.pullRequest.reviewThreads.nodes[0].comments = connection([comment("C_one")], "comment_next", 2); return r;
    }); const r = f.instance.observePullRequest(request); assert.equal(r.threads.length, 2); assert.equal(r.threads[0].comments.length, 2); assert.equal(r.pagination.thread_pages, 2); assert.equal(r.pagination.comment_pages, 1);
  });
  check("deleted authors and nullable diff anchors remain observed data", () => {
    const r = adapter(({ kind }) => { if (kind === "ReviewMetadata") return { data: { repository: metadata() } }; const r = response(), t = r.data.repository.pullRequest.reviewThreads.nodes[0]; t.line = null; t.comments.nodes[0].author = null; t.comments.nodes[0].commit = null; t.comments.nodes[0].originalCommit = null; return r; }).instance.observePullRequest(request);
    assert.equal(r.threads[0].line, null); assert.equal(r.threads[0].comments[0].author_login, null); assert.equal(r.threads[0].comments[0].commit_oid, null);
  });
  check("content digest ignores provider page order through explicit ordinal sorting", () => {
    const observations = [false, true].map(reverse => adapter(({ kind }) => { if (kind === "ReviewMetadata") return { data: { repository: metadata() } }; const rows = [thread("T_a"), thread("T_A")]; return response(reverse ? rows.reverse() : rows); }).instance.observePullRequest(request));
    assert.deepEqual(observations[0].threads.map(row => row.node_id), ["T_A", "T_a"]); assert.equal(observations[0].observation_sha256, observations[1].observation_sha256);
  });
  check("partial GraphQL errors and unsuccessful transport never become empty successful review", () => { for (const data of [{ errors: [{ message: "fixture denied" }], ...response() }, { status: 1, stdout: "", stderr: "fixture secret must not escape" }, { status: 0, stdout: "not JSON" }]) assert.throws(() => adapter(() => data).instance.observePullRequest(request), { code: "GITHUB_PR_OBSERVATION_UNAVAILABLE" }); });
  check("foreign repository, PR and changed head refuse the observation", () => { for (const mutate of [r => r.data.repository.id = "R_other", r => r.data.repository.nameWithOwner = "other/repository", r => r.data.repository.pullRequest.id = "PR_other", r => r.data.repository.pullRequest.headRefOid = "b".repeat(40)]) { assert.throws(() => adapter(() => { const r = response(); mutate(r); return r; }).instance.observePullRequest(request), { code: "GITHUB_PR_SOURCE_CHANGED" }); } });
  check("metadata and head are rechecked after the complete review collection", () => { assert.throws(() => adapter(({ kind }) => { const r = response(); if (kind === "ReviewMetadata") r.data.repository.pullRequest.headRefOid = "b".repeat(40); return r; }).instance.observePullRequest(request), { code: "GITHUB_PR_SOURCE_CHANGED" }); });
  check("duplicate pages and count drift fail instead of truncating", () => { for (const mutate of [r => r.data.repository.pullRequest.reviewThreads.nodes.push(thread("T_one")), r => r.data.repository.pullRequest.reviewThreads.totalCount = 2, r => r.data.repository.pullRequest.reviewThreads.totalCount = 501]) { assert.throws(() => adapter(({ kind }) => { if (kind === "ReviewMetadata") return { data: { repository: metadata() } }; const r = response(); mutate(r); return r; }).instance.observePullRequest(request), { code: "GITHUB_PR_PAGINATION_INVALID" }); } });
  check("repeated cursors cannot trigger an unbounded provider loop", () => { assert.throws(() => adapter(({ calls }) => { const r = response([thread("T_" + calls)]); r.data.repository.pullRequest.reviewThreads.pageInfo = { hasNextPage: true, endCursor: "same" }; r.data.repository.pullRequest.reviewThreads.totalCount = 3; return r; }).instance.observePullRequest(request), { code: "GITHUB_PR_PAGINATION_INVALID" }); });
  check("complete Unicode comment bodies survive bounded chunks", () => { const body = "é🧵".repeat(3000), f = adapter(({ kind }) => { if (kind === "ReviewMetadata") return { data: { repository: metadata() } }; const r = response(); r.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0].body = body; return r; }), r = f.instance.observePullRequest(request); assert.equal(r.threads[0].comments[0].body_chunks.join(""), body); assert.ok(r.threads[0].comments[0].body_chunks.length > 1); });
  check("oversized or malformed comments refuse without shortened evidence", () => { for (const mutate of [c => c.body = "a".repeat(65537), c => delete c.createdAt]) assert.throws(() => adapter(({ kind }) => { if (kind === "ReviewMetadata") return { data: { repository: metadata() } }; const r = response(); mutate(r.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0]); return r; }).instance.observePullRequest(request), error => ["GITHUB_PR_OBSERVATION_LIMIT", "GITHUB_PR_OBSERVATION_INVALID"].includes(error.code)); });
  check("closed without merge stays closed and merged identity must be coherent", () => {
    const f = adapter(({ kind }) => { const r = kind === "ReviewMetadata" ? { data: { repository: metadata() } } : response(); r.data.repository.pullRequest.state = "CLOSED"; return r; }); assert.equal(f.instance.observePullRequest(request).pull_request.merged, false);
    assert.throws(() => adapter(({ kind }) => { const r = kind === "ReviewMetadata" ? { data: { repository: metadata() } } : response(); r.data.repository.pullRequest.state = "MERGED"; return r; }).instance.observePullRequest(request), { code: "GITHUB_PR_OBSERVATION_INVALID" });
  });
  check("a global observation deadline covers all provider pages", () => { let clock = 1793664000000; assert.throws(() => adapter(() => { clock += 60001; return response(); }, { now: () => clock }).instance.observePullRequest(request), { code: "GITHUB_PR_OBSERVATION_DEADLINE" }); });
  check("requests cannot supply executable GraphQL or authorize themselves", () => { for (const extra of [{ query: "mutation{}" }, { authorized: true }, { executable: "other" }]) assert.throws(() => adapter().instance.observePullRequest({ ...request, ...extra }), { code: "GITHUB_PR_OBSERVATION_REQUEST_INVALID" }); });
  check("host executable pin and content hashes remain checked", () => { assert.throws(() => createGithubWorkflowAdapter({ ...config, executableSha256: "0".repeat(64) }), { code: "GITHUB_PR_HOST_PIN_CHANGED" }); const r = adapter().instance.observePullRequest(request); r.threads[0].comments[0].body_chunks[0] += "changed"; assert.throws(() => assertGithubPrObservation(r), { code: "GITHUB_PR_OBSERVATION_INVALID" }); });
  console.log(JSON.stringify({ status: "PASS", checks: checks.length, proof_class: "actual-read-only-adapter-with-fixture-GitHub-transport", actual_network: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN", standard_ir_binding: "NOT_IMPLEMENTED" }));
} finally { const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith("aidn-github-observation-")); fs.rmSync(resolved, { recursive: true, force: true }); }
