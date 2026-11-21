import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import { createStandardHostAuthority } from "../../src/adapters/runtime/standard-host-authority.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { createStandardPrReviewControlSource } from "../../src/application/runtime/standard-session-pr-review-control-source.mjs";
import { createStandardSessionPrReviewContentObservation } from "../../src/application/runtime/standard-session-pr-review-observe.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { createGithubReviewFixture } from "./github-review-evidence-fixture-lib.mjs";

const updateId = "op_" + "a".repeat(40);
const eventRef = "REVIEW_fixture";
const savedFile = base => path.join(base, "review-event-component.json");

function reopen(data) {
  const { configuration, binding, p, submittedAt, reviewSubject } = data;
  const targetRoot = configuration.target_root, instanceId = configuration.instance_id;
  const transport = createGithubReviewFixture({ workingDirectory: configuration.control_root, pullRequest: p });
  Object.assign(transport.state.reviews[0], { submittedAt, updatedAt: submittedAt, author: {
    id: binding.reviewer.node_id, login: binding.reviewer.login, __typename: binding.reviewer.type,
  } });
  const node = () => {
    const { reviews, pullRequest: pr } = transport.state;
    return { __typename: "PullRequestReview", ...structuredClone(reviews[0]), isMinimized: false,
      repository: { id: pr.repository_id, nameWithOwner: "fixture/repository" },
      pullRequest: { id: pr.node_id, number: pr.number, headRefOid: pr.head_oid, baseRefOid: pr.base_oid,
        headRefName: pr.head_branch, baseRefName: pr.base_branch, isDraft: pr.draft, state: "OPEN",
        merged: false, mergedAt: null, mergeCommit: null, baseRef: { target: { oid: pr.base_oid } },
        headRepository: { id: pr.repository_id }, baseRepository: { id: pr.repository_id } } };
  };
  const state = { node: node(), calls: [], onRead: null };
  const ok = value => ({ status: 0, stdout: typeof value === "string" ? value : JSON.stringify(value) });
  const providerTransport = {
    runGithub() { assert.fail("unexpected GitHub effect transport"); },
    runRemoteGit() { assert.fail("unexpected Git remote transport"); },
    async runGithubRead(binary, args, options) {
      await setImmediate();
      assert.equal(binary, binding.gh.path);
      assert.equal(options.shell, false);
      state.calls.push(args);
      if (args[0] === "auth") {
        assert.equal(options.env.GH_TOKEN, undefined);
        return ok("fixture-event-read-token");
      }
      assert.equal(options.env.GH_TOKEN, "fixture-event-read-token");
      if (args.at(-1) === "user") return ok({ node_id: binding.actor.node_id, login: binding.actor.login });
      if (args.at(-1) === "repos/fixture/repository") return ok({ node_id: binding.repository.node_id, full_name: "fixture/repository" });
      assert.deepEqual(args, ["api", "graphql", "--hostname", "github.com", "--input", "-"]);
      const { query, variables } = JSON.parse(options.input);
      assert.match(query, /^query /);
      if (!query.startsWith("query AidnPrReviewEvent")) return transport.run(binary, args, options);
      assert.deepEqual(variables, { id: eventRef });
      for (const field of ["submittedAt", "updatedAt", "isMinimized", "commit { oid }", "headRepository",
        "baseRepository", "baseRefOid", "mergeCommit", "... on PullRequestReview"]) assert.ok(query.includes(field));
      const response = structuredClone(state.node);
      state.onRead?.();
      return ok({ data: { node: response } });
    },
  };
  const authority = createStandardHostAuthority({ configuration }, { providerTransport });
  const provider = authority.githubProvider;
  authority.ensureKey();
  const signer = createOperationJournalSigner(authority.readKey);
  // The narrow component starts at an event wait. Its pre-wait signed business
  // subject is seeded by the fixture. It dispatches no push or review operation.
  const receipt = signer.seal({ subject: reviewSubject, pull_request: p, update_operation_id: updateId });
  const model = { contract_version: "agentic-process-model.v2", model_id: "github-review-event-component", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [], operation_pins: {}, entry: "wait", nodes: [
      { id: "wait", kind: "event", participant_ref: "project", branches: [
        { flow_id: "review", node_id: "reviewed", event_key: "review_snapshot" },
        { flow_id: "checks", node_id: "checked", event_key: "checks_snapshot" },
      ] },
      ...["reviewed", "checked"].map(id => ({ id, kind: "sequence", participant_ref: "project", children: [] })),
    ] };
  let host;
  const observerFor = reviewPort => createStandardSessionPrReviewContentObservation({ readCurrent: id => host.inspect(id).record,
    reviewPort,
    async readConfirmedHead() {
      const retained = signer.verify(receipt);
      return { update_operation_id: retained.update_operation_id, session_id: "S001", head: retained.pull_request.head_oid,
        material_sha256: shadowHash(retained), pull_request: retained.pull_request };
    } });
  const source = createStandardPrReviewControlSource({ ...provider.sessionReviewEventPort, observerFor, observer: observerFor(provider.sessionReviewPort),
    async readContext({ request }) {
      const instance = host.inspect(instanceId).record;
      const fresh = host.prepareControl({ instanceId, expectedSha256: instance.instance_sha256, occurrenceId: request.occurrence_id });
      return { instance, request_sha256: shadowHash(fresh), reviewSubject: signer.verify(receipt).subject,
        input: { contract_version: "standard-session-pr-review-observe-input.v1", update_operation_id: updateId } };
    },
  });
  host = createStandardWorkflowOperationHost({ targetRoot, model, readSigningKey: authority.readKey, controlSource: source,
    authorize: () => assert.fail("unexpected operation authorization") });
  return { host, provider, source, signer, state, node };
}

export async function verifyGithubReviewEventComponent({ base, configuration, binding, git }) {
  const instanceId = configuration.instance_id;
  const p = { repository_id: binding.repository.node_id, node_id: "PR_fixture", number: 7,
    head_oid: git("rev-parse", "HEAD").toString().trim(), base_oid: "b".repeat(40),
    head_branch: git("branch", "--show-current").toString().trim(), base_branch: "main", state: "OPEN", draft: false };
  const submittedAt = new Date().toISOString();
  const reviewSubject = { repository_id: p.repository_id, pull_request_id: p.node_id, pull_request_number: p.number,
    head_oid: p.head_oid, base_oid: p.base_oid, head_ref: p.head_branch, base_ref: p.base_branch, not_before_ms: Date.parse(submittedAt) - 1000 };
  const data = { configuration, binding, p, submittedAt, reviewSubject };
  const { host, provider, state, node, signer } = reopen(data);
  const initial = host.initialize({ instanceId });
  host.initialize({ instanceId, write: true, expectedResultSha256: initial.record.instance_sha256 });
  const before = host.inspect(instanceId), occurrenceId = before.cursor.occurrences.find(row => row.wait_reason === "event").occurrence_id;
  const waiting = { instanceId, expectedSha256: before.record.instance_sha256, occurrenceId };
  const request = host.prepareControl(waiting);
  const capture = () => host.captureControl({ ...waiting, captureKind: "pr-review-content", sourceRef: eventRef, write: true });
  const input = { request, sourceRef: eventRef, subject: reviewSubject };
  const read = () => provider.sessionReviewEventPort.readEvent(input);
  const fresh = await read();
  assert.deepEqual(fresh.actor, binding.reviewer);
  assert.equal(fresh.base_oid, p.base_oid);
  await assert.rejects(provider.sessionReviewEventPort.readEvent({ ...input, sourceRef: '{"reviewer":"fixture"}' }),
    { code: "GITHUB_REVIEW_EVENT_REQUEST_INVALID" });
  for (const [change, code] of [
    [n => { n.__typename = "Issue"; }, "GITHUB_REVIEW_EVENT_NODE_CHANGED"],
    [n => { n.author.id = "U_wrong"; }, "GITHUB_REVIEW_EVENT_REVIEWER_CHANGED"],
    [n => { n.commit.oid = "c".repeat(40); }, "GITHUB_REVIEW_EVENT_SUBJECT_CHANGED"],
    [n => { n.pullRequest.headRefOid = "c".repeat(40); }, "GITHUB_REVIEW_EVENT_SUBJECT_CHANGED"],
    [n => { n.repository.id = "R_wrong"; }, "GITHUB_REVIEW_EVENT_SUBJECT_CHANGED"],
    [n => { n.pullRequest.id = "PR_wrong"; }, "GITHUB_REVIEW_EVENT_SUBJECT_CHANGED"],
    [n => { n.pullRequest.headRepository.id = "R_fork"; }, "GITHUB_REVIEW_EVENT_SUBJECT_CHANGED"],
    [n => { n.pullRequest.baseRefName = "other"; }, "GITHUB_REVIEW_EVENT_SUBJECT_CHANGED"],
    [n => { n.pullRequest.baseRef.target.oid = "c".repeat(40); }, "GITHUB_REVIEW_EVENT_SUBJECT_CHANGED"],
    [n => { n.state = "PENDING"; n.submittedAt = null; }, "GITHUB_REVIEW_EVENT_NOT_SUBMITTED"],
    [n => { n.state = "DISMISSED"; }, "GITHUB_REVIEW_EVENT_NOT_SUBMITTED"],
    [n => { n.submittedAt = new Date(Date.parse(submittedAt) - 5000).toISOString(); }, "GITHUB_REVIEW_EVENT_TIME_INVALID"],
  ]) {
    state.node = node();
    change(state.node);
    await assert.rejects(capture(), { code });
  }
  state.node = null;
  assert.equal((await capture()).status, "waiting_for_control");
  state.node = node();
  state.onRead = () => { state.node.body += " changed"; };
  await assert.rejects(capture(), { code: "GITHUB_REVIEW_EVENT_CHANGED" });
  state.onRead = null;
  state.node = node();
  assert.equal(host.inspect(instanceId).record.instance_sha256, waiting.expectedSha256);
  console.log("PASS authenticated GitHub node read refuses wrong type, reviewer, head, repository, PR, branch/base, unsubmitted/stale review and changed revision");

  const start = performance.now(), callsBefore = state.calls.length;
  const reserved = await capture().catch(cause => {
    console.error(JSON.stringify({ stage: "reserve_review", code: cause.code, elapsed_ms: Math.round(performance.now() - start),
      transport_commands: state.calls.length - callsBefore }));
    throw cause;
  });
  assert.equal(reserved.status, "reserved");
  const retained = signer.verify(host.readControl(reserved.inbox_id));
  assert.equal(retained.contract_version, "process-control-inbox.v2");
  assert.equal(retained.phase, "reserved");
  assert.equal(host.inspect(instanceId).record.instance_sha256, waiting.expectedSha256);
  assert.deepEqual(retained.payload.event, fresh);
  fs.writeFileSync(savedFile(base), JSON.stringify({ ...data, inboxId: reserved.inbox_id, before: waiting.expectedSha256 }));
  const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--deliver", base],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 120000 }));
  const delivered = host.inspect(instanceId).record;
  assert.equal(delivered.instance_sha256, result.instance_sha256);
  assert.equal(delivered.events.length, 1);
  assert.equal(delivered.events[0].kind, "control");
  assert.equal(result.historical_verified, true);
  const callCount = state.calls.length;
  assert.equal((await host.deliverControl(reserved.inbox_id, { write: true })).retained, true);
  assert.equal(simulateAgenticProcess({ instanceId, model: delivered.model, scopeId: delivered.scope_id,
    policyPins: delivered.policy_pins, events: delivered.events }).trace.at(-1).instance_sha256, delivered.instance_sha256);
  assert.equal(state.calls.length, callCount);
  console.log("PASS application v2 reserve, cold delivery, idempotent acknowledgement and historical review verification with distinct base/tip");
}

if (process.argv[2] === "--deliver") {
  const data = JSON.parse(fs.readFileSync(savedFile(process.argv[3]), "utf8"));
  const { host, signer, source, state } = reopen(data);
  const { inboxId, before, configuration, p } = data;
  assert.equal(host.inspect(configuration.instance_id).record.instance_sha256, before);
  assert.equal(signer.verify(host.readControl(inboxId)).phase, "reserved");
  const result = await host.deliverControl(inboxId, { write: true });
  const saved = signer.verify(host.readControl(inboxId));
  assert.equal(saved.phase, "delivered");
  assert.equal(saved.delivered_instance_sha256, result.record.instance_sha256);
  const mergedAt = new Date().toISOString();
  Object.assign(state.node.pullRequest, { state: "MERGED", merged: true, mergedAt, baseRefOid: "c".repeat(40),
    baseRef: { target: { oid: "c".repeat(40) } }, mergeCommit: { oid: "d".repeat(40),
      parents: { totalCount: 2, nodes: [{ oid: p.base_oid }, { oid: p.head_oid }], pageInfo: { hasNextPage: false } } } });
  await source.verifyCapturedEvent(saved);
  state.node.pullRequest.mergeCommit.parents.nodes[0].oid = "e".repeat(40);
  await assert.rejects(source.verifyCapturedEvent(saved), { code: "GITHUB_REVIEW_EVENT_HISTORICAL_SUBJECT_UNPROVEN" });
  assert.equal(signer.verify(host.readControl(inboxId)).payload.event.base_oid, p.base_oid);
  console.log(JSON.stringify({ instance_sha256: result.record.instance_sha256, historical_verified: true }));
}
