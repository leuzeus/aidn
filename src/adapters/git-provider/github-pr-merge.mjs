import { createHash, randomBytes } from 'node:crypto';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { mergeSendWindowExhausted } from '../../core/workflow/standard-pr-merge-execute.mjs';
import { assertGithubPrMergeEffectObservation } from './github-workflow-adapter.mjs';
import planSchema from '../../core/contracts/workflow-definition/github-pr-merge-plan.v1.schema.json' with { type: 'json' };

import currentPlanSchema from '../../core/contracts/workflow-definition/github-pr-merge-plan.v2.schema.json' with { type: 'json' };

export const githubPrMergePlanVersion = 'github-pr-merge-plan.v2';
const legacyPlan = plan => plan?.contract_version === 'github-pr-merge-plan.v1';
const query = 'mutation AidnMergePullRequest($input:MergePullRequestInput!) { mergePullRequest(input:$input) { clientMutationId pullRequest { id merged mergeCommit { oid } } } }';
const commitBody = plan => 'AIDN-Merge: ' + plan.correlation_id;
const fail = (code, effect_status = 'no_effect') => { throw Object.assign(Error(code), { code, effect_status }); };
const same = (left, right) => shadowHash(left) === shadowHash(right);

export function assertGithubPrMergePlan(plan) {
  if (checkShadowJson(plan) || validateJsonSchema(plan, legacyPlan(plan) ? planSchema : currentPlanSchema, '$', { contractKind: 'workflow-definition' }).length
    || legacyPlan(plan) && (plan.expires_at_ms <= plan.prepared_at_ms || plan.expires_at_ms - plan.prepared_at_ms > 300000))
    fail('GITHUB_PR_MERGE_PLAN_INVALID');
  return plan;
}

export function assertGithubPrMergePostimage(plan, observation) {
  const value = assertGithubPrMergeEffectObservation(observation), pr = value.pull_request, request = plan.request;
  if (!pr.merged || pr.is_draft || !same(value.repository, plan.repository) || pr.head_repository_id !== plan.repository.node_id
    || pr.node_id !== request.expected_pull_request_id || pr.number !== request.pull_request_number
    || pr.head_oid !== request.expected_head_oid || pr.head_ref !== request.expected_head_ref || pr.base_ref !== request.expected_base_ref
    || !same(pr.merge_parent_oids, [request.expected_base_oid, request.expected_head_oid]) || !same(pr.merged_by, plan.actor)
    || pr.commit_body_sha256 !== createHash('sha256').update(commitBody(plan)).digest('hex')
    || Date.parse(pr.merged_at) < Math.floor(plan.prepared_at_ms / 1000) * 1000
    || legacyPlan(plan) && Date.parse(pr.merged_at) >= plan.expires_at_ms)
    fail('GITHUB_PR_MERGE_POSTIMAGE_UNCONFIRMED');
  return value;
}

export function createGithubPrMerge({ repository, actor, method, hostContextSha256, observe, runMutation, now = Date.now }) {
  const repo = structuredClone(repository), principal = structuredClone(actor);
  function active(signal) {
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('GITHUB_PR_MERGE_SIGNAL_INVALID');
    if (signal?.aborted) fail('GITHUB_PR_MERGE_ABORTED');
  }
  function checked(prepared, expectPlan) {
    const plan = assertGithubPrMergePlan(prepared?.plan);
    if (prepared.can_apply !== true || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan
      || !same(plan.repository, repo) || !same(plan.actor, principal)
      || plan.host_context_sha256 !== hostContextSha256 || plan.method !== method) fail('GITHUB_PR_MERGE_PLAN_INVALID');
    return structuredClone(plan);
  }
  function fresh(plan) {
    const time = now();
    if (!Number.isSafeInteger(time) || time < plan.prepared_at_ms || legacyPlan(plan) && time >= plan.expires_at_ms)
      fail('STANDARD_PLAN_EXPIRED');
    return time;
  }
  async function read(plan, signal) {
    active(signal);
    const request = plan.request, start = now();
    const value = assertGithubPrMergeEffectObservation(await observe(request, { signal }));
    active(signal);
    const pr = value.pull_request, end = now();
    if (!same(value.repository, repo) || pr.head_repository_id !== repo.node_id || pr.node_id !== request.expected_pull_request_id
      || pr.number !== request.pull_request_number || pr.head_oid !== request.expected_head_oid || pr.is_draft
      || pr.head_ref !== request.expected_head_ref || pr.base_ref !== request.expected_base_ref)
      fail('GITHUB_PR_MERGE_SUBJECT_CHANGED');
    if (![start, end].every(Number.isSafeInteger) || start < plan.prepared_at_ms || end - start > 60000
      || Date.parse(value.observed_from) < start || Date.parse(value.observed_until) > end)
      fail('GITHUB_PR_MERGE_OBSERVATION_STALE');
    return value;
  }
  async function assertOpen(plan, signal) {
    const { pull_request: pr } = await read(plan, signal);
    if (pr.state !== 'OPEN' || pr.merged || pr.observed_base_tip_oid !== plan.request.expected_base_oid)
      fail('GITHUB_PR_MERGE_PREIMAGE_CHANGED');
  }
  async function postimage(plan, signal) {
    const first = assertGithubPrMergePostimage(plan, await read(plan, signal));
    const last = assertGithubPrMergePostimage(plan, await read(plan, signal));
    if (!same(first.pull_request, last.pull_request)) fail('GITHUB_PR_MERGE_POSTIMAGE_CHANGED');
    return last;
  }
  return Object.freeze({
    async prepare(request, operationId, { expiresAt, signal } = {}) {
      const plan = assertGithubPrMergePlan({ contract_version: expiresAt === undefined ? githubPrMergePlanVersion : 'github-pr-merge-plan.v1', request: structuredClone(request),
        operation_id: operationId, repository: structuredClone(repo), actor: structuredClone(principal), method,
        prepared_at_ms: now(), ...(expiresAt === undefined ? {} : { expires_at_ms: expiresAt }), host_context_sha256: hostContextSha256,
        correlation_id: randomBytes(16).toString('hex') });
      await assertOpen(plan, signal);
      fresh(plan);
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    },
    async recover(prepared, { expectPlan, signal } = {}) {
      return postimage(checked(prepared, expectPlan), signal);
    },
    async apply(prepared, { write = false, expectPlan, assertAuthorized, assertReviewFresh, assertConsentCurrent, assertReviewGrantCurrent, signal } = {}) {
      if (write !== true || typeof assertAuthorized !== 'function' || typeof assertReviewFresh !== 'function')
        fail('GITHUB_PR_MERGE_EXPLICIT_EFFECT_REQUIRED');
      const plan = checked(prepared, expectPlan), { request, correlation_id: nonce } = plan;
      const legacy = legacyPlan(plan);
      if (!legacy && (typeof assertConsentCurrent !== 'function' || typeof assertReviewGrantCurrent !== 'function'))
        fail('GITHUB_PR_MERGE_EXPLICIT_EFFECT_REQUIRED');
      active(signal);
      fresh(plan);
      let acknowledged = false;
      try {
        const response = await runMutation({ query, variables: { input: { pullRequestId: request.expected_pull_request_id,
          expectedHeadOid: request.expected_head_oid, mergeMethod: plan.method, commitBody: commitBody(plan), clientMutationId: nonce } } },
        { signal, assertSendFresh: timeout => {
          const time = fresh(plan);
          if (!legacy) {
            assertReviewGrantCurrent(time);
            return;
          }
          if (!Number.isSafeInteger(timeout) || timeout <= 0) fail('GITHUB_PR_MERGE_SEND_WINDOW_INVALID');
          if (plan.expires_at_ms - time <= timeout) fail(mergeSendWindowExhausted);
        }, assertAuthorized: async () => {
          await assertReviewFresh();
          await assertOpen(plan, signal);
          await assertAuthorized();
          if (!legacy) await assertConsentCurrent();
          active(signal);
          fresh(plan);
        } });
        acknowledged = true;
        const payload = response?.data?.mergePullRequest, pr = payload?.pullRequest;
        if (response?.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length)
          || payload?.clientMutationId !== nonce || pr?.id !== request.expected_pull_request_id || pr.merged !== true
          || !/^[a-f0-9]{40}$/.test(pr.mergeCommit?.oid ?? '')) fail('GITHUB_PR_MERGE_ACK_UNCONFIRMED');
        const observed = await postimage(plan, signal);
        if (observed.pull_request.merge_oid !== pr.mergeCommit.oid) fail('GITHUB_PR_MERGE_ACK_UNCONFIRMED');
        await assertAuthorized();
        active(signal);
        return observed;
      } catch (cause) {
        if (!acknowledged && cause?.effect_status === 'no_effect') throw cause;
        fail('GITHUB_PR_MERGE_RECONCILIATION_REQUIRED', 'unknown');
      }
    },
  });
}
