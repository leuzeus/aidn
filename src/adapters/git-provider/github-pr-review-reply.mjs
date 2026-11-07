import { createHash } from 'node:crypto';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertGithubPrReviewEffects } from './github-workflow-adapter.mjs';
import requestSchema from '../../core/contracts/workflow-definition/github-pr-review-reply-request.v1.schema.json' with { type: 'json' };
import planSchema from '../../core/contracts/workflow-definition/github-pr-review-reply-plan.v1.schema.json' with { type: 'json' };

import resultSchema from '../../core/contracts/workflow-definition/github-pr-review-reply-result.v1.schema.json' with { type: 'json' };

const sha = value => createHash('sha256').update(value).digest('hex');
const digest = /^[a-f0-9]{64}$/;
const id = /^[A-Za-z0-9_=-]{1,256}$/;
const operation = /^op_[a-f0-9]{40}$/;
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
const fail = (code, effect_status = 'no_effect') => { throw Object.assign(Error(code), { code, effect_status }); };
const query = 'mutation AidnPrReviewReply($input:AddPullRequestReviewThreadReplyInput!) { addPullRequestReviewThreadReply(input:$input) { clientMutationId comment { id replyTo { id } } } }';

export function assertGithubPrReviewReplyResult(value) {
  if (!valid(value, resultSchema) || value.reply_id === value.target_comment_id
    || value.effect_status !== (value.action === 'published' ? 'confirmed' : 'no_effect')
    || !(Date.parse(value.published_at) <= Date.parse(value.observed_until))) fail('GITHUB_PR_REPLY_RESULT_INVALID');
  return value;
}

export function createGithubPrReviewReply({ repository, actor, hostContextSha256, observe, runMutation, now = Date.now }) {
  if (!id.test(repository?.node_id ?? '') || typeof repository.owner !== 'string' || typeof repository.name !== 'string'
    || !id.test(actor?.node_id ?? '') || typeof actor.login !== 'string' || !actor.login || !digest.test(hostContextSha256 ?? '')
    || ![observe, runMutation, now].every(fn => typeof fn === 'function')) fail('GITHUB_PR_REPLY_HOST_INVALID');
  const repo = structuredClone(repository), principal = structuredClone(actor);
  function assertSignal(signal) {
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('GITHUB_PR_REPLY_SIGNAL_INVALID');
    if (signal?.aborted) fail('GITHUB_PR_REPLY_ABORTED');
  }
  function assertRequest(request) {
    if (!valid(request, requestSchema) || !request.body.trim() || Buffer.byteLength(request.body) > 32768
      || !Number.isSafeInteger(request.not_before_ms)) fail('GITHUB_PR_REPLY_REQUEST_INVALID');
  }
  function assertFresh(at) {
    const age = now() - at;
    if (!Number.isSafeInteger(age) || age < 0 || age > 300000) fail('GITHUB_PR_REPLY_PLAN_EXPIRED');
  }
  async function read(request, signal) {
    assertSignal(signal);
    const start = now(), expected = request.pull_request;
    const value = assertGithubPrReviewEffects(await observe(expected, { signal }));
    assertSignal(signal);
    const { updated_at, ...pr } = value.pull_request;
    const repository = value.repository;
    if (repository.node_id !== repo.node_id || repository.owner !== repo.owner || repository.name !== repo.name
      || pr.node_id !== expected.expected_pull_request_id || pr.number !== expected.pull_request_number
      || pr.head_oid !== expected.expected_head_oid || pr.base_oid !== expected.expected_base_oid
      || pr.head_ref !== expected.expected_head_ref || pr.base_ref !== expected.expected_base_ref
      || pr.state !== 'OPEN' || pr.is_draft || pr.merged) fail('GITHUB_PR_REPLY_SUBJECT_CHANGED');
    const until = Date.parse(value.observed_until), from = Date.parse(value.observed_from), end = now();
    if (![start, end].every(Number.isSafeInteger) || !(request.not_before_ms <= start && start <= from && from <= until && until <= end)
      || end - start > 60000) fail('GITHUB_PR_REPLY_OBSERVATION_STALE');
    const thread = value.threads.find(row => row.node_id === request.thread_id);
    const target = thread?.comments.find(row => row.node_id === request.target_comment_id);
    if (!target || target.reply_to_node_id !== null || target.body_sha256 !== request.target_body_sha256 || target.state !== 'SUBMITTED'
      || target.is_minimized || thread.comments.filter(row => row.reply_to_node_id === null).length !== 1)
      fail('GITHUB_PR_REPLY_TARGET_CHANGED');
    const bodySha = sha(request.body);
    const matches = thread.comments.filter(row => row.reply_to_node_id === target.node_id && row.author_node_id === principal.node_id
      && row.author_login === principal.login && row.author_type === 'User' && row.body_sha256 === bodySha);
    if (matches.length > 1) fail('GITHUB_PR_REPLY_AMBIGUOUS');
    const [reply] = matches;
    if (reply && (reply.state !== 'SUBMITTED' || reply.is_minimized || !(Date.parse(reply.published_at) >= request.not_before_ms)))
      fail('GITHUB_PR_REPLY_EXISTING_UNPROVEN');
    const threads = value.threads.map(row => row !== thread || !reply ? row : { ...row, comments: row.comments.filter(comment => comment !== reply) });
    return { basis_sha256: shadowHash({ repository, pr, threads }), reply, thread, observed_until: value.observed_until };
  }
  function checked(prepared, expectPlan) {
    const { plan, plan_sha256 } = prepared ?? {};
    if (prepared?.can_apply !== true || !valid(plan, planSchema) || plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan
      || plan.host_context_sha256 !== hostContextSha256 || !Number.isSafeInteger(plan.prepared_at_ms)) fail('GITHUB_PR_REPLY_PLAN_INVALID');
    assertRequest(plan.request);
    return structuredClone(plan);
  }
  function verifyBasis(plan, current) {
    if (current.basis_sha256 !== plan.basis_sha256 || plan.existing_reply_id !== null && current.reply?.node_id !== plan.existing_reply_id)
      fail('GITHUB_PR_REPLY_OBSERVATION_CHANGED');
  }
  function result(plan, current, action) {
    const reply = current.reply;
    return assertGithubPrReviewReplyResult({ contract_version: 'github-pr-review-reply-result.v1', effect_status: action === 'published' ? 'confirmed' : 'no_effect', action, operation_id: plan.operation_id,
      repository_id: repo.node_id, pull_request_id: plan.request.pull_request.expected_pull_request_id,
      head_oid: plan.request.pull_request.expected_head_oid, base_oid: plan.request.pull_request.expected_base_oid,
      thread_id: plan.request.thread_id, target_comment_id: plan.request.target_comment_id, reply_id: reply.node_id,
      actor_id: principal.node_id, body_sha256: reply.body_sha256, published_at: reply.published_at, observed_until: current.observed_until });
  }
  return Object.freeze({
    async prepare(request, operationId, { signal } = {}) {
      assertRequest(request);
      request = structuredClone(request);
      if (!operation.test(operationId ?? '')) fail('GITHUB_PR_REPLY_OPERATION_INVALID');
      const preparedAt = now(), current = await read(request, signal);
      assertFresh(preparedAt);
      const plan = { contract_version: 'github-pr-review-reply-plan.v1', operation_id: operationId, request: structuredClone(request),
        prepared_at_ms: preparedAt, host_context_sha256: hostContextSha256, basis_sha256: current.basis_sha256, existing_reply_id: current.reply?.node_id ?? null };
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    },
    async recover(prepared, { expectPlan, signal } = {}) {
      const plan = checked(prepared, expectPlan), current = await read(plan.request, signal);
      verifyBasis(plan, current);
      return current.reply ? result(plan, current, 'recovered') : null;
    },
    async apply(prepared, { write = false, expectPlan, assertAuthorized, signal } = {}) {
      if (write !== true || typeof assertAuthorized !== 'function') fail('GITHUB_PR_REPLY_EXPLICIT_EFFECT_REQUIRED');
      const plan = checked(prepared, expectPlan);
      assertSignal(signal);
      assertFresh(plan.prepared_at_ms);
      await assertAuthorized();
      const before = await read(plan.request, signal);
      verifyBasis(plan, before);
      if (!before.reply && before.thread.is_resolved) fail('GITHUB_PR_REPLY_THREAD_RESOLVED');
      await assertAuthorized();
      assertSignal(signal);
      assertFresh(plan.prepared_at_ms);
      if (before.reply) return result(plan, before, 'recovered');

      const request = plan.request, nonce = plan.operation_id;
      // The nonce correlates the response. It supplies no server idempotency.
      // After dispatch even transport cancellation can leave a published reply.
      let acknowledged = false;
      try {
        const response = await runMutation({ query, variables: { input: { pullRequestReviewThreadId: request.thread_id, body: request.body,
          clientMutationId: nonce } } }, { signal, assertAuthorized: async () => {
          await assertAuthorized();
          assertSignal(signal);
          assertFresh(plan.prepared_at_ms);
        } });
        acknowledged = true;
        assertSignal(signal);
        const payload = response?.data?.addPullRequestReviewThreadReply;
        if (response.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length)
          || payload?.clientMutationId !== nonce || !id.test(payload?.comment?.id ?? '')
          || payload.comment.replyTo?.id !== request.target_comment_id) fail('GITHUB_PR_REPLY_ACK_UNCONFIRMED');
        const after = await read(request, signal);
        verifyBasis(plan, after);
        if (after.reply?.node_id !== payload.comment.id) fail('GITHUB_PR_REPLY_POSTIMAGE_UNCONFIRMED');
        await assertAuthorized();
        assertSignal(signal);
        assertFresh(plan.prepared_at_ms);
        return result(plan, after, 'published');
      } catch (cause) {
        if (!acknowledged && cause?.effect_status === 'no_effect') throw cause;
        fail('GITHUB_PR_REPLY_RECONCILIATION_REQUIRED', 'unknown');
      }
    },
  });
}
