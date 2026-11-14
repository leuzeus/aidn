import { createHash } from 'node:crypto';
import { assertGithubPrReviewEffects } from '../../adapters/git-provider/github-workflow-adapter.mjs';
import { assertGithubReviewContent } from '../../adapters/git-provider/github-review-evidence.mjs';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../core/workflow/standard-operation-contracts.mjs';
import { createStandardPrAcceptedReviewSource } from './standard-session-pr-review-source.mjs';

const operation = 'session_pr_review_effects_verify';
export const reviewEffectsOutputVersion = 'standard-session-pr-review-effects-output.v2';
const sourceChanged = 'STANDARD_PR_EFFECTS_SOURCE_CHANGED';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };

function originalComment({ reply_to_node_id, state, is_minimized, published_at, ...comment }) {
  return comment;
}

function inspectStandardPrReviewReplies(original, current, dispositions, actor, notBefore) {
  const previous = new Map(original.threads.map(thread => [thread.node_id, thread]));
  if (previous.size !== current.threads.length) return { reason: 'STANDARD_PR_EFFECTS_REVIEW_CHANGED' };
  const expected = new Map(dispositions.filter(item => item.disposition === 'invalid').map(item => [item.node_id, item]));
  const proofs = new Map();
  let unresolved = false;
  for (const thread of current.threads) {
    const baseline = previous.get(thread.node_id);
    if (!baseline || baseline.path !== thread.path || baseline.line !== thread.line || baseline.is_outdated !== thread.is_outdated)
      return { reason: 'STANDARD_PR_EFFECTS_REVIEW_CHANGED' };
    const comments = new Map(thread.comments.map(comment => [comment.node_id, comment]));
    for (const item of baseline.comments) {
      const actual = comments.get(item.node_id);
      if (!actual || shadowHash(originalComment(actual)) !== shadowHash(item))
        return { reason: 'STANDARD_PR_EFFECTS_REVIEW_CHANGED' };
      if (actual.state !== 'SUBMITTED') return { reason: 'STANDARD_PR_EFFECTS_REPLY_REQUIRED' };
      comments.delete(item.node_id);
    }
    for (const comment of comments.values()) {
      const item = expected.get(comment.reply_to_node_id);
      if (!item || item.thread_id !== thread.node_id || comment.author_node_id !== actor.node_id || comment.author_login !== actor.login
        || comment.author_type !== 'User' || comment.body_sha256 !== createHash('sha256').update(item.proposed_response).digest('hex'))
        return { reason: 'STANDARD_PR_EFFECTS_REVIEW_CHANGED' };
      if (comment.state !== 'SUBMITTED' || comment.is_minimized || !(Date.parse(comment.published_at) >= notBefore))
        return { reason: 'STANDARD_PR_EFFECTS_REPLY_REQUIRED' };
      if (proofs.has(item.node_id)) return { reason: 'STANDARD_PR_EFFECTS_REPLY_AMBIGUOUS' };
      proofs.set(item.node_id, { thread_id: thread.node_id, target_id: item.node_id, reply_id: comment.node_id,
        author_id: actor.node_id, body_sha256: comment.body_sha256, published_at: comment.published_at });
    }
    unresolved ||= !thread.is_resolved;
  }
  return { replies: [...proofs.values()], missing: [...expected.values()].filter(item => !proofs.has(item.node_id)), unresolved };
}

export function prObservationRequest(p) {
  return { contract_version: 'github-pr-observation-request.v2', pull_request_number: p.number,
    expected_pull_request_id: p.node_id, expected_head_oid: p.head_oid, expected_base_oid: p.base_oid,
    expected_head_ref: p.head_branch, expected_base_ref: p.base_branch };
}

export function createStandardPrReviewEffectsReader({ readAccepted, readAcceptedUpdate, readDelivered, verifyEvent, readCurrent, reviewPort, readAcceptedReplies = () => [], now = Date.now }) {
  const readSource = createStandardPrAcceptedReviewSource({ readAccepted, readAcceptedUpdate, readDelivered, sourceChanged });
  function source(instance, input) {
    const review = readSource(instance, input);
    const preparedAt = review.triage.record.preview.prepared_at_ms;
    if (!Number.isSafeInteger(preparedAt)) fail(sourceChanged);
    return { ...review, notBefore: Math.max(preparedAt, review.preMergeObservedUntil),
      sha256: shadowHash([review.sha256, preparedAt]) };
  }
  async function observe(instance, before, { signal, openBaseOid } = {}) {
    const active = () => { if (signal?.aborted) fail('STANDARD_PR_EFFECTS_ABORTED'); };
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('STANDARD_PR_EFFECTS_SIGNAL_INVALID');
    active();
    const p = openBaseOid === undefined ? before.pullRequest : { ...before.pullRequest, base_oid: openBaseOid };
    const start = now();
    if (!Number.isSafeInteger(start) || start < before.notBefore) fail('STANDARD_PR_EFFECTS_STALE_OBSERVATION');
    const { dispositions } = before.triage.output.observations;
    if (before.correctionsRequired || dispositions.some(item => ['valid', 'uncertain'].includes(item.disposition)))
      return { reason: 'STANDARD_PR_EFFECTS_CORRECTION_OR_TRIAGE_REQUIRED' };
    if (dispositions.some(item => item.disposition === 'invalid' && (item.kind !== 'comment' || !item.thread_id)))
      return { reason: 'STANDARD_PR_EFFECTS_REPLY_CHANNEL_REQUIRED' };
    const actor = reviewPort?.reviewEffectActor;
    if (!actor?.node_id || !actor.login || typeof reviewPort.observePrReviewEffects !== 'function'
      || typeof reviewPort.observeReviewContent !== 'function') return { reason: 'STANDARD_PR_EFFECTS_PROVIDER_REQUIRED' };
    await verifyEvent(before.capture, { signal, openBaseOid });
    active();
    const request = prObservationRequest(p);
    const url = new URL(p.url);
    function checkSubject(observed) {
      active();
      const pr = observed.pull_request, repo = observed.repository, from = Date.parse(observed.observed_from), until = Date.parse(observed.observed_until);
      if (repo.node_id !== p.repository_id || url.origin !== 'https://github.com'
        || url.pathname.toLowerCase() !== ('/' + repo.owner + '/' + repo.name + '/pull/' + p.number).toLowerCase()
        || pr.node_id !== p.node_id || pr.number !== p.number || pr.head_oid !== p.head_oid || pr.base_oid !== p.base_oid
        || pr.head_ref !== p.head_branch || pr.base_ref !== p.base_branch || pr.state !== 'OPEN' || pr.is_draft !== false)
        fail(sourceChanged);
      if (!(start <= from && from <= until && until <= now())) fail('STANDARD_PR_EFFECTS_STALE_OBSERVATION');
      return observed;
    }
    const readThreads = async () => checkSubject(assertGithubPrReviewEffects(await reviewPort.observePrReviewEffects(request, { signal })));
    const first = await readThreads();
    const reviewRequest = { ...request, contract_version: 'github-review-evidence-request.v1' };
    const evidence = checkSubject(assertGithubReviewContent(await reviewPort.observeReviewContent(reviewRequest, { signal })));
    const last = await readThreads();
    await verifyEvent(before.capture, { signal, openBaseOid });
    active();
    const end = now();
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || source(instance, { triage_operation_id: before.triage.record.operation_id }).sha256 !== before.sha256)
      fail(sourceChanged);
    if (!Number.isSafeInteger(end) || end < Date.parse(last.observed_until) || end - start > 300000)
      fail('STANDARD_PR_EFFECTS_STALE_OBSERVATION');
    if (first.observation_sha256 !== last.observation_sha256 || shadowHash(evidence.reviews) !== shadowHash(before.review.evidence.reviews))
      return { reason: 'STANDARD_PR_EFFECTS_REVIEW_CHANGED' };
    const inspected = inspectStandardPrReviewReplies(before.review.threads, last, dispositions, actor, before.notBefore);
    if (inspected.reason) return inspected;
    const prior = readAcceptedReplies(instance, before.triage.record.operation_id);
    const proofs = new Map(inspected.replies.map(proof => [proof.target_id, proof]));
    for (const reply of prior) {
      const proof = proofs.get(reply.target_comment_id);
      if (!proof || proof.reply_id !== reply.reply_id || proof.published_at !== reply.published_at)
        return { reason: 'STANDARD_PR_REPLY_RETAINED_POSTIMAGE_CHANGED' };
    }
    return { first, last, evidence, actor, request, acceptedReplyCount: prior.length, ...inspected };
  }
  return { source, observe };
}

export function createStandardPrReviewEffectsVerification(ports) {
  const reader = createStandardPrReviewEffectsReader(ports);
  function emit(version, outcome, reason, proof) {
    return assertStandardOperationOutput({ contract_version: version, operation_ref: operation,
      outcome, effect_status: 'no_effect', facts: proof ? { session_pr_review_effects_verified: true } : {},
      observations: proof ? { proof } : { reason_code: reason },
      evidence_refs: proof ? [{ ref: 'github:pr-review-effects/' + proof.pull_request_id, sha256: shadowHash(proof) }] : [] });
  }
  const source = (instance, input) => {
    assertStandardOperationInput(operation, input);
    return reader.source(instance, input);
  };
  return Object.freeze({
    prepare(instance, input) {
      return { can_apply: true, input, source_sha256: source(instance, input).sha256 };
    },
    async observe(instance, input, { signal, sourceSha256, outputContract = 'standard-session-pr-review-effects-output.v1' } = {}) {
      const emitResult = (outcome, reason, proof) => emit(outputContract, outcome, reason, proof);
      try {
        const before = source(instance, input), p = before.pullRequest;
        if (before.sha256 !== sourceSha256) fail(sourceChanged);
        const { reason, first, last, evidence, replies, missing, unresolved } = await reader.observe(instance, before, { signal });
        if (reason) return emitResult('deferred', reason);
        if (missing.length) return emitResult('deferred', 'STANDARD_PR_EFFECTS_REPLY_REQUIRED');
        if (unresolved) return emitResult('deferred', 'STANDARD_PR_EFFECTS_RESOLUTION_REQUIRED');
        return emitResult('completed', null, { triage_operation_id: input.triage_operation_id, update_operation_id: before.updateId,
          source_sha256: before.sha256, repository_id: p.repository_id, pull_request_id: p.node_id, head_oid: p.head_oid, base_oid: p.base_oid,
          observed_from: first.observed_from, observed_until: last.observed_until, thread_observation_sha256: last.observation_sha256,
          review_evidence_sha256: evidence.evidence_sha256, reply_proof_sha256: shadowHash(replies),
          reply_count: replies.length, resolved_thread_count: last.threads.length,
          ...(outputContract === reviewEffectsOutputVersion ? { threads_sha256: shadowHash(last.threads), reviews_sha256: shadowHash(evidence.reviews) } : {}) });
      } catch (cause) {
        return emitResult('blocked', /^[A-Z][A-Z0-9_]{0,127}$/.test(cause?.code ?? '') ? cause.code : 'STANDARD_PR_EFFECTS_UNAVAILABLE');
      }
    },
  });
}
