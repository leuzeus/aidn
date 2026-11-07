import { createHash } from 'node:crypto';
import { assertGithubPrReviewReplyResult, githubPrReviewReplyBasis } from '../../adapters/git-provider/github-pr-review-reply.mjs';
import { assertStandardOperationOutput } from '../../core/workflow/standard-operation-contracts.mjs';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { createStandardPrReviewEffectsReader } from './standard-session-pr-review-effects.mjs';

const select = 'session_pr_review_reply_select';
const publish = 'session_pr_review_reply_publish';
const limit = 31; // The 32nd loop iteration can attest that no reply is missing.
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const reasonCode = cause => /^[A-Z][A-Z0-9_]{0,127}$/.test(cause?.code ?? '') ? cause.code : 'STANDARD_PR_REPLY_UNAVAILABLE';
function output(operation, outcome, effect_status, facts, observations, evidence_refs = []) {
  return assertStandardOperationOutput({ contract_version: operation === select ? 'standard-pr-review-reply-select-output.v1'
    : 'standard-pr-review-reply-publish-output.v1', operation_ref: operation, outcome, effect_status, facts, observations, evidence_refs });
}

export function createStandardPrReviewReply({ readAcceptedReplies, ...ports }) {
  const reader = createStandardPrReviewEffectsReader(ports);
  const port = ports.reviewPort?.reply;

  async function inspect(instance, source, input, signal) {
    const observed = await reader.observe(instance, source, { signal });
    if (observed.reason) return observed;
    const prior = readAcceptedReplies(instance, input.triage_operation_id);
    const proofs = new Map(observed.replies.map(proof => [proof.target_id, proof]));
    for (const reply of prior) {
      const proof = proofs.get(reply.target_comment_id);
      if (!proof || proof.reply_id !== reply.reply_id || proof.published_at !== reply.published_at)
        return { reason: 'STANDARD_PR_REPLY_RETAINED_POSTIMAGE_CHANGED' };
    }
    if (prior.length + observed.missing.length > limit) return { reason: 'STANDARD_PR_REPLY_ITERATION_BOUND' };
    if (!observed.missing.length) return observed;
    // Check every outstanding obligation before granting any individual write.
    const threads = new Map(observed.last.threads.map(thread => [thread.node_id, thread]));
    for (const item of observed.missing) {
      const thread = threads.get(item.thread_id);
      const root = thread?.comments.find(comment => comment.node_id === item.node_id);
      if (!root || root.reply_to_node_id !== null || root.is_minimized || thread.is_resolved
        || thread.comments.filter(comment => comment.reply_to_node_id === null).length !== 1
        || typeof item.proposed_response !== 'string' || !item.proposed_response.trim())
        return { reason: 'STANDARD_PR_REPLY_TARGET_UNSUPPORTED' };
    }
    if (!port || !['prepare', 'apply', 'recover'].every(method => typeof port[method] === 'function'))
      return { reason: 'STANDARD_PR_REPLY_PORT_REQUIRED' };
    return observed;
  }

  function selection(source, observed) {
    const item = observed.missing[0];
    if (!item) return null;
    return { source_sha256: source.sha256, thread_id: item.thread_id, target_comment_id: item.node_id,
      basis_sha256: githubPrReviewReplyBasis(observed.last, item.thread_id) };
  }

  function validateResult(plan, value, recovering) {
    const result = assertGithubPrReviewReplyResult(value), { request, operation_id } = plan.provider.plan, pr = request.pull_request;
    if (result.operation_id !== operation_id || result.repository_id !== plan.repository_id
      || result.pull_request_id !== pr.expected_pull_request_id || result.head_oid !== pr.expected_head_oid || result.base_oid !== pr.expected_base_oid
      || result.thread_id !== request.thread_id || result.target_comment_id !== request.target_comment_id
      || result.actor_id !== plan.actor.node_id || result.body_sha256 !== sha(request.body)
      || Date.parse(result.published_at) < request.not_before_ms || recovering && result.action !== 'recovered')
      fail('STANDARD_PR_REPLY_POSTIMAGE_CHANGED');
    return output(publish, 'completed', recovering || result.action === 'published' ? 'confirmed' : 'no_effect',
      {}, { reply: result }, [{ ref: 'github:pr-review-reply/' + result.reply_id, sha256: shadowHash(result) }]);
  }

  function checkPrepared(prepared, input) {
    const plan = prepared?.plan;
    if (prepared?.can_apply !== true || !plan || plan.selection_operation_id !== input.selection_operation_id
      || shadowHash(plan) !== prepared.plan_sha256) fail('STANDARD_PR_REPLY_PLAN_INVALID');
    return plan;
  }

  async function fence(instance, input, plan, signal) {
    const source = reader.source(instance, input);
    if (source.sha256 !== plan.source_sha256 || source.pullRequest.repository_id !== plan.repository_id)
      fail('STANDARD_PR_REPLY_SOURCE_CHANGED');
    const observed = await inspect(instance, source, input, signal);
    if (observed.reason) fail(observed.reason);
    const { request, basis_sha256 } = plan.provider.plan;
    const proof = observed.replies.find(reply => reply.target_id === request.target_comment_id);
    if (shadowHash(observed.actor) !== shadowHash(plan.actor)
      || githubPrReviewReplyBasis(observed.last, request.thread_id, proof?.reply_id) !== basis_sha256)
      fail('STANDARD_PR_REPLY_REVIEW_CHANGED');
    return proof;
  }

  return Object.freeze({
    prepareSelection(instance, input) {
      return { can_apply: true, source_sha256: reader.source(instance, input).sha256 };
    },
    async select(instance, input, prepared, { signal } = {}) {
      try {
        const source = reader.source(instance, input);
        if (source.sha256 !== prepared.source_sha256) fail('STANDARD_PR_REPLY_SOURCE_CHANGED');
        const observed = await inspect(instance, source, input, signal);
        if (observed.reason) return output(select, 'deferred', 'no_effect', {}, { reason_code: observed.reason });
        const chosen = selection(source, observed);
        return output(select, 'completed', 'no_effect', { session_pr_replies_observed: chosen === null }, { selection: chosen });
      } catch (cause) {
        return output(select, 'blocked', 'no_effect', {}, { reason_code: reasonCode(cause) });
      }
    },
    async prepare(instance, input, operationId) {
      const accepted = ports.readAccepted(instance, input.selection_operation_id, select);
      const chosen = accepted.output.observations.selection;
      if (!chosen || accepted.record.preview.input.triage_operation_id !== input.triage_operation_id)
        fail('STANDARD_PR_REPLY_SELECTION_REQUIRED');
      const source = reader.source(instance, input), observed = await inspect(instance, source, input);
      if (observed.reason) fail(observed.reason);
      const known = observed.replies.find(reply => reply.target_id === chosen.target_comment_id);
      const basis = githubPrReviewReplyBasis(observed.last, chosen.thread_id, known?.reply_id);
      if (source.sha256 !== chosen.source_sha256 || basis !== chosen.basis_sha256
        || !known && shadowHash(selection(source, observed)) !== shadowHash(chosen)) fail('STANDARD_PR_REPLY_SELECTION_CHANGED');
      const item = source.triage.output.observations.dispositions.find(row => row.node_id === chosen.target_comment_id);
      const target = observed.last.threads.find(thread => thread.node_id === chosen.thread_id)
        .comments.find(comment => comment.node_id === chosen.target_comment_id);
      const request = { contract_version: 'github-pr-review-reply-request.v1', pull_request: observed.request,
        thread_id: chosen.thread_id, target_comment_id: chosen.target_comment_id, target_body_sha256: target.body_sha256,
        body: item.proposed_response, not_before_ms: source.notBefore };
      if (!port) fail('STANDARD_PR_REPLY_PORT_REQUIRED');
      const provider = await port.prepare(request, operationId);
      if (provider.plan.basis_sha256 !== chosen.basis_sha256 || provider.plan.operation_id !== operationId
        || shadowHash(provider.plan.request) !== shadowHash(request)) fail('STANDARD_PR_REPLY_SELECTION_CHANGED');
      const plan = { source_sha256: source.sha256, selection_operation_id: input.selection_operation_id,
        repository_id: source.pullRequest.repository_id, actor: observed.actor, provider };
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    },
    async apply(instance, input, prepared, { assertAuthorized, signal }) {
      const plan = checkPrepared(prepared, input);
      const result = await port.apply(plan.provider, { write: true, expectPlan: plan.provider.plan_sha256, signal,
        assertAuthorized: async phase => {
          if (phase === 'before-transport') await fence(instance, input, plan, signal);
          await assertAuthorized();
        } });
      try {
        const proof = await fence(instance, input, plan, signal);
        if (proof?.reply_id !== result?.reply_id || proof.published_at !== result.published_at) fail('STANDARD_PR_REPLY_POSTIMAGE_CHANGED');
        return validateResult(plan, result, false);
      } catch {
        // The port may already have dispatched when a result cannot be bound.
        throw Object.assign(Error('STANDARD_PR_REPLY_POSTIMAGE_CHANGED'), { code: 'STANDARD_PR_REPLY_POSTIMAGE_CHANGED', effect_status: 'unknown' });
      }
    },
    async recover(instance, input, prepared, { signal } = {}) {
      try {
        const plan = checkPrepared(prepared, input);
        const before = await fence(instance, input, plan, signal);
        if (!before) return null;
        const result = await port.recover(plan.provider, { expectPlan: plan.provider.plan_sha256, signal });
        if (result?.reply_id !== before.reply_id || result.published_at !== before.published_at) return null;
        return validateResult(plan, result, true);
      } catch (cause) {
        return { reason_code: reasonCode(cause) };
      }
    },
  });
}
