import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertGithubPrReviewEffects } from './github-workflow-adapter.mjs';
import requestSchema from '../../core/contracts/workflow-definition/github-pr-review-resolution-request.v1.schema.json' with { type: 'json' };
import planSchema from '../../core/contracts/workflow-definition/github-pr-review-resolution-plan.v1.schema.json' with { type: 'json' };
import resultSchema from '../../core/contracts/workflow-definition/github-pr-review-resolution-result.v1.schema.json' with { type: 'json' };

const query = 'mutation AidnPrReviewResolution($input:ResolveReviewThreadInput!) { resolveReviewThread(input:$input) { clientMutationId thread { id isResolved } } }';
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
const fail = (code, effect_status = 'no_effect') => { throw Object.assign(Error(code), { code, effect_status }); };

export function assertGithubPrReviewResolutionResult(value) {
  if (!valid(value, resultSchema) || value.effect_status !== (value.action === 'resolved' ? 'confirmed' : 'no_effect'))
    fail('GITHUB_PR_RESOLUTION_RESULT_INVALID');
  return value;
}

export function githubPrReviewResolutionBasis(observation, threadId) {
  const { updated_at, ...pr } = observation.pull_request;
  const threads = observation.threads.map(thread => thread.node_id === threadId ? { ...thread, is_resolved: false } : thread);
  return shadowHash({ repository: observation.repository, pr, threads });
}

export function createGithubPrReviewResolution({ repository, actor, hostContextSha256, observe, runMutation, now = Date.now }) {
  const repo = structuredClone(repository), principal = structuredClone(actor);
  const active = signal => {
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('GITHUB_PR_RESOLUTION_SIGNAL_INVALID');
    if (signal?.aborted) fail('GITHUB_PR_RESOLUTION_ABORTED');
  };
  const fresh = at => {
    const age = now() - at;
    if (!Number.isSafeInteger(age) || age < 0 || age > 300000) fail('GITHUB_PR_RESOLUTION_PLAN_EXPIRED');
  };
  async function read(request, signal) {
    active(signal);
    const start = now(), expected = request.pull_request;
    const value = assertGithubPrReviewEffects(await observe(expected, { signal }));
    active(signal);
    const pr = value.pull_request;
    const { host, ...repository } = value.repository;
    if (host !== 'github.com' || shadowHash(repository) !== shadowHash(repo) || pr.node_id !== expected.expected_pull_request_id
      || pr.number !== expected.pull_request_number || pr.head_oid !== expected.expected_head_oid || pr.base_oid !== expected.expected_base_oid
      || pr.head_ref !== expected.expected_head_ref || pr.base_ref !== expected.expected_base_ref || pr.state !== 'OPEN' || pr.is_draft || pr.merged)
      fail('GITHUB_PR_RESOLUTION_SUBJECT_CHANGED');
    const from = Date.parse(value.observed_from), until = Date.parse(value.observed_until), end = now();
    if (![start, end].every(Number.isSafeInteger) || !(request.not_before_ms <= start && start <= from && from <= until && until <= end)
      || end - start > 60000) fail('GITHUB_PR_RESOLUTION_OBSERVATION_STALE');
    const thread = value.threads.find(row => row.node_id === request.thread_id);
    if (!thread || githubPrReviewResolutionBasis(value, thread.node_id) !== request.basis_sha256)
      fail('GITHUB_PR_RESOLUTION_OBSERVATION_CHANGED');
    return { thread, observed_until: value.observed_until };
  }
  function checked(prepared, expectPlan) {
    const { plan, plan_sha256 } = prepared ?? {};
    if (prepared?.can_apply !== true || !valid(plan, planSchema) || plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan
      || plan.host_context_sha256 !== hostContextSha256 || plan.repository_id !== repo.node_id || shadowHash(plan.actor) !== shadowHash(principal)
      || !Number.isSafeInteger(plan.prepared_at_ms) || !Number.isSafeInteger(plan.request.not_before_ms)) fail('GITHUB_PR_RESOLUTION_PLAN_INVALID');
    return structuredClone(plan);
  }
  function result(plan, current, action) {
    const { request } = plan, pr = request.pull_request;
    return assertGithubPrReviewResolutionResult({ contract_version: 'github-pr-review-resolution-result.v1',
      action, effect_status: action === 'resolved' ? 'confirmed' : 'no_effect', operation_id: plan.operation_id,
      repository_id: repo.node_id, pull_request_id: pr.expected_pull_request_id, head_oid: pr.expected_head_oid, base_oid: pr.expected_base_oid,
      thread_id: request.thread_id, actor_id: principal.node_id, basis_sha256: request.basis_sha256, observed_until: current.observed_until });
  }
  return Object.freeze({
    async prepare(request, operationId, { signal } = {}) {
      if (!valid(request, requestSchema) || !Number.isSafeInteger(request.not_before_ms)) fail('GITHUB_PR_RESOLUTION_REQUEST_INVALID');
      request = structuredClone(request);
      const plan = { contract_version: 'github-pr-review-resolution-plan.v1', operation_id: operationId, request,
        prepared_at_ms: now(), host_context_sha256: hostContextSha256, repository_id: repo.node_id, actor: structuredClone(principal) };
      if (!valid(plan, planSchema)) fail('GITHUB_PR_RESOLUTION_PLAN_INVALID');
      if ((await read(request, signal)).thread.is_resolved) fail('GITHUB_PR_RESOLUTION_ALREADY_RESOLVED');
      fresh(plan.prepared_at_ms);
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    },
    async recover(prepared, { expectPlan, signal } = {}) {
      const plan = checked(prepared, expectPlan), current = await read(plan.request, signal);
      return current.thread.is_resolved ? result(plan, current, 'recovered') : null;
    },
    async apply(prepared, { write = false, expectPlan, assertAuthorized, signal } = {}) {
      if (write !== true || typeof assertAuthorized !== 'function') fail('GITHUB_PR_RESOLUTION_EXPLICIT_EFFECT_REQUIRED');
      const plan = checked(prepared, expectPlan), { request, operation_id: nonce } = plan;
      active(signal);
      fresh(plan.prepared_at_ms);
      try {
        await assertAuthorized();
        if ((await read(request, signal)).thread.is_resolved) fail('GITHUB_PR_RESOLUTION_ALREADY_RESOLVED');
      } catch (cause) {
        fail(/^[A-Z][A-Z0-9_]{0,127}$/.test(cause?.code ?? '') ? cause.code : 'GITHUB_PR_RESOLUTION_PRECONDITION_REQUIRED');
      }

      // The nonce correlates the acknowledgement. The provider has no HEAD CAS.
      let acknowledged = false;
      try {
        const response = await runMutation({ query, variables: { input: { threadId: request.thread_id, clientMutationId: nonce } } },
          { signal, assertAuthorized: async () => {
            await assertAuthorized('before-transport');
            active(signal);
            fresh(plan.prepared_at_ms);
          } });
        acknowledged = true;
        const payload = response?.data?.resolveReviewThread;
        if (response?.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length)
          || payload?.clientMutationId !== nonce || payload.thread?.id !== request.thread_id || payload.thread.isResolved !== true)
          fail('GITHUB_PR_RESOLUTION_ACK_UNCONFIRMED');
        const after = await read(request, signal);
        if (!after.thread.is_resolved) fail('GITHUB_PR_RESOLUTION_POSTIMAGE_UNCONFIRMED');
        await assertAuthorized();
        active(signal);
        fresh(plan.prepared_at_ms);
        return result(plan, after, 'resolved');
      } catch (cause) {
        if (!acknowledged && cause?.effect_status === 'no_effect') throw cause;
        fail('GITHUB_PR_RESOLUTION_RECONCILIATION_REQUIRED', 'unknown');
      }
    },
  });
}
