import { assertGithubPrReviewResolutionResult, githubPrReviewResolutionBasis } from '../../adapters/git-provider/github-pr-review-resolution.mjs';
import { assertStandardOperationOutput } from '../../core/workflow/standard-operation-contracts.mjs';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { createStandardPrReviewEffectsReader, reviewEffectsOutputVersion } from './standard-session-pr-review-effects.mjs';
import { assertMergeQualificationProof, mergeQualificationProofVersion } from '../../core/workflow/standard-pr-merge-consent.mjs';
import { assertResolutionExceptionSubject, resolutionExceptionMaxAgeMs, resolutionExceptionOperation, resolutionExceptionQuestion } from '../../core/workflow/standard-pr-resolution-exception.mjs';

const select = 'session_pr_review_resolution_select';
const resolve = 'session_pr_review_thread_resolve';
const exceptionRequired = 'STANDARD_PR_RESOLUTION_EXCEPTION_OR_REVIEW_REQUIRED';
const limit = 31; // Reserve one iteration to attest that no thread remains open.
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const reasonCode = cause => /^[A-Z][A-Z0-9_]{0,127}$/.test(cause?.code ?? '') ? cause.code : 'STANDARD_PR_RESOLUTION_UNAVAILABLE';

function output(operation, outcome, effect_status, facts, observations, evidence_refs = []) {
  return assertStandardOperationOutput({ contract_version: operation === select ? 'standard-pr-review-resolution-select-output.v2'
    : 'standard-pr-review-thread-resolve-output.v1', operation_ref: operation, outcome, effect_status, facts, observations, evidence_refs });
}

export function createStandardPrReviewResolution({ readAcceptedResolutions, ...ports }) {
  const reader = createStandardPrReviewEffectsReader(ports), port = ports.reviewPort?.resolution;

  async function inspect(instance, source, input, signal, openBaseOid) {
    const observed = await reader.observe(instance, source, { signal, openBaseOid });
    if (observed.reason) return observed;
    if (observed.missing.length) return { reason: 'STANDARD_PR_EFFECTS_REPLY_REQUIRED' };
    const prior = readAcceptedResolutions(instance, input.triage_operation_id);
    const threads = new Map(observed.last.threads.map(thread => [thread.node_id, thread]));
    if (prior.some(row => !threads.get(row.thread_id)?.is_resolved))
      return { reason: 'STANDARD_PR_RESOLUTION_RETAINED_POSTIMAGE_CHANGED' };
    const outstanding = observed.last.threads.filter(thread => !thread.is_resolved);
    if (prior.length + outstanding.length > limit) return { reason: 'STANDARD_PR_RESOLUTION_ITERATION_BOUND' };
    const eligible = new Set(source.review.threads.threads.filter(thread => !thread.is_resolved).map(thread => thread.node_id));
    // Only delivered open threads with an explicit, visibly answered inline
    // obligation are eligible. A reopened or unclassified thread needs review.
    const answered = new Set(observed.replies.map(reply => reply.thread_id));
    if (observed.replies.some(reply => !threads.get(reply.thread_id)?.comments.some(comment =>
      comment.node_id === reply.target_id && !comment.is_minimized)))
      return { reason: 'STANDARD_PR_EFFECTS_REPLY_REQUIRED' };
    if (outstanding.some(thread => !eligible.has(thread.node_id) || !answered.has(thread.node_id)))
      return { ...observed, outstanding, exceptionRequired: true };
    if (outstanding.length && !['prepare', 'apply', 'recover'].every(method => typeof port?.[method] === 'function')) return { reason: 'STANDARD_PR_RESOLUTION_PORT_REQUIRED' };
    return { ...observed, outstanding };
  }

  const replyProof = (observed, id) => shadowHash(observed.replies.filter(reply => reply.thread_id === id));

  function exceptionSubject(source, observed) {
    const p = source.pullRequest;
    return assertResolutionExceptionSubject({ triage_operation_id: source.triage.record.operation_id,
      update_operation_id: source.updateId, source_sha256: source.sha256, repository_id: p.repository_id,
      pull_request_id: p.node_id, pull_request_number: p.number, head_oid: p.head_oid, base_oid: p.base_oid,
      head_ref: p.head_branch, base_ref: p.base_branch, unresolved_thread_ids: observed.outstanding.map(thread => thread.node_id).sort(),
      thread_observation_sha256: observed.last.observation_sha256, review_evidence_sha256: observed.evidence.evidence_sha256,
      reply_proof_sha256: shadowHash(observed.replies), actor_id: observed.actor.node_id });
  }

  async function readException(instance, input, signal) {
    const accepted = ports.readAccepted(instance, input.selection_operation_id, select);
    const basis = accepted.output.observations.exception_subject_sha256;
    if (!basis || accepted.output.facts.session_pr_resolution_exception_required !== true
      || accepted.record.preview.input.triage_operation_id !== input.triage_operation_id) fail(exceptionRequired);
    const source = reader.source(instance, input);
    const observed = await inspect(instance, source, input, signal);
    if (!observed.exceptionRequired) fail(observed.reason ?? 'STANDARD_PR_RESOLUTION_EXCEPTION_STALE');
    const subject = exceptionSubject(source, observed);
    if (shadowHash(subject) !== basis) fail('STANDARD_PR_RESOLUTION_EXCEPTION_STALE');
    return subject;
  }

  function selection(source, observed) {
    const thread = observed.outstanding[0];
    if (!thread) return null;
    return { source_sha256: source.sha256, thread_id: thread.node_id, basis_sha256: githubPrReviewResolutionBasis(observed.last, thread.node_id), reply_proof_sha256: replyProof(observed, thread.node_id) };
  }

  function checked(prepared, input) {
    const plan = prepared?.plan;
    if (prepared?.can_apply !== true || !plan || plan.selection_operation_id !== input.selection_operation_id
      || shadowHash(plan) !== prepared.plan_sha256) fail('STANDARD_PR_RESOLUTION_PLAN_INVALID');
    return plan;
  }

  async function fence(instance, input, plan, signal) {
    const source = reader.source(instance, input);
    if (source.sha256 !== plan.source_sha256) fail('STANDARD_PR_RESOLUTION_SOURCE_CHANGED');
    const observed = await inspect(instance, source, input, signal);
    if (observed.reason || observed.exceptionRequired) fail(observed.reason ?? exceptionRequired);
    const { request, actor, repository_id } = plan.provider.plan;
    if (source.pullRequest.repository_id !== repository_id || shadowHash(observed.actor) !== shadowHash(actor)
      || shadowHash(observed.request) !== shadowHash(request.pull_request)
      || githubPrReviewResolutionBasis(observed.last, request.thread_id) !== request.basis_sha256
      || replyProof(observed, request.thread_id) !== plan.reply_proof_sha256)
      fail('STANDARD_PR_RESOLUTION_REVIEW_CHANGED');
    return observed.last.threads.find(row => row.node_id === request.thread_id)?.is_resolved === true;
  }

  function confirmed(plan, value, recovering) {
    const result = assertGithubPrReviewResolutionResult(value), provider = plan.provider.plan;
    const { request } = provider, pr = request.pull_request;
    if (result.operation_id !== provider.operation_id || result.repository_id !== provider.repository_id
      || result.pull_request_id !== pr.expected_pull_request_id || result.head_oid !== pr.expected_head_oid || result.base_oid !== pr.expected_base_oid
      || result.thread_id !== request.thread_id || result.actor_id !== provider.actor.node_id || result.basis_sha256 !== request.basis_sha256
      || Date.parse(result.observed_until) < request.not_before_ms || result.action !== (recovering ? 'recovered' : 'resolved'))
      fail('STANDARD_PR_RESOLUTION_POSTIMAGE_CHANGED');
    return output(resolve, 'completed', 'confirmed', {}, { resolution: result },
      [{ ref: 'github:pr-review-thread/' + result.thread_id, sha256: shadowHash(result) }]);
  }

  return Object.freeze({
    async readGate(instance, input, { signal, beforeReview, qualifyBase = false }) {
      const readLatest = binding => {
        const id = instance.events.findLast(row => row.kind === 'operation_intent' && row.intent.binding_ref === binding)?.intent.operation_id;
        if (!id) fail('STANDARD_PR_RESOLUTION_GATE_REQUIRED');
        return ports.readAccepted(instance, id, binding);
      };
      const selection = readLatest(select);
      if (selection.record.preview.input.triage_operation_id !== input.triage_operation_id)
        fail('STANDARD_PR_RESOLUTION_GATE_REQUIRED');
      const source = reader.source(instance, input);
      const p = source.pullRequest;
      const { base_oid: baseOid = p.base_oid, base_ahead_by: ahead = 0, ...before } = await beforeReview(p);
      const advanced = baseOid !== p.base_oid;
      if (!/^[a-f0-9]{40}$/.test(baseOid) || !Number.isSafeInteger(ahead) || ahead < 0
        || ahead > 2147483647 || advanced !== (ahead > 0) || advanced && !qualifyBase)
        fail('STANDARD_PR_TARGET_ADVANCE_UNPROVEN');
      if (advanced && selection.output.facts.session_pr_resolution_exception_required === true)
        fail('STANDARD_PR_RESOLUTION_EXCEPTION_BASE_CHANGED');
      const observed = await inspect(instance, source, input, signal, advanced ? baseOid : undefined);
      if (observed.reason) fail(observed.reason);
      let accepted, qualificationProof, expires = null;
      if (observed.exceptionRequired) {
        if (advanced) fail('STANDARD_PR_RESOLUTION_EXCEPTION_BASE_CHANGED');
        accepted = readLatest(resolutionExceptionOperation);
        const question = resolutionExceptionQuestion(accepted.record), subject = exceptionSubject(source, observed);
        expires = question.expires_at_ms;
        if (accepted.output.facts.session_pr_resolution_exception_accepted !== true
          || question.selection_operation_id !== selection.record.operation_id
          || selection.output.observations.exception_subject_sha256 !== shadowHash(subject)
          || shadowHash(question.subject) !== shadowHash(subject)
          || accepted.output.observations.question_sha256 !== shadowHash(question)
          || (ports.now ?? Date.now)() >= expires) fail('STANDARD_PR_RESOLUTION_EXCEPTION_STALE');
      } else {
        if (observed.outstanding.length || selection.output.facts.session_pr_threads_observed_resolved !== true)
          fail('STANDARD_PR_RESOLUTION_GATE_REQUIRED');
        accepted = readLatest('session_pr_review_effects_verify');
        const proof = accepted.output.observations.proof;
        if (accepted.output.facts.session_pr_review_effects_verified !== true || proof.triage_operation_id !== input.triage_operation_id
          || proof.source_sha256 !== source.sha256 || proof.reply_proof_sha256 !== shadowHash(observed.replies))
          fail('STANDARD_PR_RESOLUTION_PROOF_CHANGED');
        if (qualifyBase && accepted.output.contract_version === reviewEffectsOutputVersion) {
          const threadsSha = shadowHash(observed.last.threads), reviewsSha = shadowHash(observed.evidence.reviews);
          if (proof.base_oid !== p.base_oid || proof.head_oid !== p.head_oid || proof.repository_id !== p.repository_id
            || proof.pull_request_id !== p.node_id || proof.update_operation_id !== source.updateId
            || proof.threads_sha256 !== threadsSha || proof.reviews_sha256 !== reviewsSha)
            fail('STANDARD_PR_RESOLUTION_PROOF_CHANGED');
          qualificationProof = assertMergeQualificationProof({ contract_version: mergeQualificationProofVersion, prior_base_oid: p.base_oid,
            observed_base_oid: baseOid, base_ahead_by: ahead, threads_sha256: threadsSha, reviews_sha256: reviewsSha,
            reply_proof_sha256: proof.reply_proof_sha256, thread_observation_sha256: observed.last.observation_sha256,
            review_evidence_sha256: observed.evidence.evidence_sha256 });
        } else if (advanced || proof.thread_observation_sha256 !== observed.last.observation_sha256
          || proof.review_evidence_sha256 !== observed.evidence.evidence_sha256) {
          fail('STANDARD_PR_RESOLUTION_PROOF_CHANGED');
        }
      }
      return { source, observed, before, qualificationProof, decision: expires === null ? null : accepted.record, operationId: accepted.record.operation_id,
        receiptSha256: shadowHash(accepted.record.results.at(-1).receipt), expires };
    },
    prepareSelection(instance, input) {
      return { can_apply: true, source_sha256: reader.source(instance, input).sha256 };
    },
    async select(instance, input, prepared, { signal } = {}) {
      try {
        const source = reader.source(instance, input);
        if (source.sha256 !== prepared.source_sha256) fail('STANDARD_PR_RESOLUTION_SOURCE_CHANGED');
        const observed = await inspect(instance, source, input, signal);
        if (observed.reason) return output(select, 'deferred', 'no_effect', {}, { reason_code: observed.reason });
        if (observed.exceptionRequired)
          return output(select, 'completed', 'no_effect', { session_pr_resolution_exception_required: true,
            session_pr_threads_observed_resolved: false, session_pr_resolution_gate_met: false },
          { exception_subject_sha256: shadowHash(exceptionSubject(source, observed)) });
        const chosen = selection(source, observed), resolved = chosen === null;
        return output(select, 'completed', 'no_effect', { session_pr_threads_observed_resolved: resolved,
          session_pr_resolution_exception_required: false, session_pr_resolution_gate_met: resolved }, { selection: chosen });
      } catch (cause) {
        return output(select, 'blocked', 'no_effect', {}, { reason_code: reasonCode(cause) });
      }
    },
    async prepareException(instance, input) {
      const subject = await readException(instance, input);
      return { can_apply: true, subject, prepared_at_ms: (ports.now ?? Date.now)() };
    },
    async assertExceptionFresh(instance, input, prepared, signal) {
      const assertAge = () => {
        const age = (ports.now ?? Date.now)() - prepared.prepared_at_ms;
        if (!Number.isSafeInteger(age) || age < 0 || age > resolutionExceptionMaxAgeMs) fail('STANDARD_PR_RESOLUTION_EXCEPTION_EXPIRED');
      };
      assertAge();
      if (shadowHash(await readException(instance, input, signal)) !== shadowHash(prepared.subject))
        fail('STANDARD_PR_RESOLUTION_EXCEPTION_STALE');
      assertAge();
    },
    async prepare(instance, input, operationId) {
      const accepted = ports.readAccepted(instance, input.selection_operation_id, select);
      const chosen = accepted.output.observations.selection;
      if (!chosen || accepted.record.preview.input.triage_operation_id !== input.triage_operation_id)
        fail('STANDARD_PR_RESOLUTION_SELECTION_REQUIRED');
      const source = reader.source(instance, input), observed = await inspect(instance, source, input);
      if (observed.reason || observed.exceptionRequired) fail(observed.reason ?? exceptionRequired);
      if (shadowHash(selection(source, observed)) !== shadowHash(chosen)) fail('STANDARD_PR_RESOLUTION_SELECTION_CHANGED');
      const request = { contract_version: 'github-pr-review-resolution-request.v1', pull_request: observed.request,
        thread_id: chosen.thread_id, basis_sha256: chosen.basis_sha256, not_before_ms: source.notBefore };
      const provider = await port.prepare(request, operationId);
      if (provider.plan.operation_id !== operationId || shadowHash(provider.plan.request) !== shadowHash(request)
        || provider.plan.repository_id !== source.pullRequest.repository_id || shadowHash(provider.plan.actor) !== shadowHash(observed.actor))
        fail('STANDARD_PR_RESOLUTION_SELECTION_CHANGED');
      const plan = { source_sha256: source.sha256, selection_operation_id: input.selection_operation_id,
        reply_proof_sha256: chosen.reply_proof_sha256, provider };
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    },
    async apply(instance, input, prepared, { signal, assertAuthorized }) {
      const plan = checked(prepared, input);
      const result = await port.apply(plan.provider, { write: true, expectPlan: plan.provider.plan_sha256, signal,
        assertAuthorized: async phase => {
          if (phase === 'before-transport' && await fence(instance, input, plan, signal)) fail('STANDARD_PR_RESOLUTION_ALREADY_RESOLVED');
          await assertAuthorized();
        } });
      try {
        if (!await fence(instance, input, plan, signal)) fail('STANDARD_PR_RESOLUTION_POSTIMAGE_CHANGED');
        await assertAuthorized();
        return confirmed(plan, result, false);
      } catch {
        throw Object.assign(Error('STANDARD_PR_RESOLUTION_POSTIMAGE_CHANGED'), { code: 'STANDARD_PR_RESOLUTION_POSTIMAGE_CHANGED', effect_status: 'unknown' });
      }
    },
    async recover(instance, input, prepared, { signal } = {}) {
      try {
        const plan = checked(prepared, input);
        const result = await port.recover(plan.provider, { expectPlan: plan.provider.plan_sha256, signal });
        if (!result || !await fence(instance, input, plan, signal)) return null;
        return confirmed(plan, result, true);
      } catch (cause) {
        return { reason_code: reasonCode(cause) };
      }
    },
  });
}
