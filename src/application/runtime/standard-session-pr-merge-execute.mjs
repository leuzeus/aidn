import { assertGithubPrMergePlan, assertGithubPrMergePostimage, githubPrMergePlanVersion } from '../../adapters/git-provider/github-pr-merge.mjs';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertMergeQualification, assertMergeQualificationProof, checksOperation, mergeApprovalSubject, mergeConsentOperation, mergeConsentQuestion,
  mergeConsentQuestionVersion } from '../../core/workflow/standard-pr-merge-consent.mjs';
import { assertMergeExecuteOutput, assertPostMergeWaitOutput, mergeCompletedFact, mergeExecuteOperation, mergeExecuteOutputVersion,
  mergeSendWindowExhausted, postMergeWaitOperation } from '../../core/workflow/standard-pr-merge-execute.mjs';
import { createStandardPrReviewEffectsReader, prObservationRequest, reviewEffectsOutputVersion } from './standard-session-pr-review-effects.mjs';

const fail = (code, effect_status = 'no_effect') => { throw Object.assign(Error(code), { code, effect_status }); };
const same = (left, right) => shadowHash(left) === shadowHash(right);
const receiptHash = record => shadowHash(record.results.at(-1).receipt);

export function createStandardPrMergeExecute({ now, reviewPort, readAccepted, readCurrent, verifyFreshDecision, assertConsentFresh, observeMergeQualification, ...ports }) {
  const { source: readSource } = createStandardPrReviewEffectsReader({ ...ports, now, reviewPort, readAccepted, readCurrent });
  const port = reviewPort?.merge;
  function basis(instance, input) {
    for (const [binding, id] of [[mergeConsentOperation, input.consent_operation_id], [checksOperation, input.checks_operation_id]]) {
      if (instance.events.findLast(row => row.kind === 'operation_intent' && row.intent.binding_ref === binding)?.intent.operation_id !== id)
        fail('STANDARD_PR_MERGE_LATEST_CONSENT_REQUIRED');
    }
    const consent = readAccepted(instance, input.consent_operation_id, mergeConsentOperation);
    const checks = readAccepted(instance, input.checks_operation_id, checksOperation);
    const question = mergeConsentQuestion(consent.record), source = readSource(instance, input);
    const current = question.contract_version === mergeConsentQuestionVersion;
    const approved = current ? question.qualification : question.subject;
    const approvedChecks = question.checks_operation_id === input.checks_operation_id
      ? checks : readAccepted(instance, question.checks_operation_id, checksOperation);
    const qualification = checks.output.observations.subject;
    if (consent.output.facts.session_pr_merge_consent_accepted !== true
      || consent.output.observations.choice !== 'approve_merge'
      || consent.output.observations.question_sha256 !== shadowHash(question)
      || consent.output.observations.subject_sha256 !== shadowHash(question.subject)
      || consent.output.observations.expires_at_ms !== question.expires_at_ms
      || approvedChecks.output.facts.session_pr_required_checks_accepted !== true
      || !same(approvedChecks.output.observations.subject, approved)
      || checks.output.facts.session_pr_required_checks_accepted !== true
      || current && !same(mergeApprovalSubject(qualification), question.subject)
      || !current && question.checks_operation_id !== input.checks_operation_id)
      fail('STANDARD_PR_MERGE_CONSENT_SUBJECT_CHANGED');
    const b = { current, consent: consent.record, question, source,
      consent_receipt_sha256: receiptHash(consent.record), checks_receipt_sha256: receiptHash(checks.record) };
    assertQualification(instance, input, b, qualification);
    return b;
  }
  function assertQualification(instance, input, b, subject, live) {
    assertMergeQualification(subject);
    const { source } = b, p = source.pullRequest;
    if (source.correctionsRequired || subject.triage_operation_id !== input.triage_operation_id
      || subject.source_sha256 !== source.sha256 || subject.update_operation_id !== source.updateId
      || subject.repository_id !== p.repository_id || subject.pull_request_id !== p.node_id || subject.pull_request_number !== p.number
      || subject.head_oid !== p.head_oid || subject.head_ref !== p.head_branch || subject.base_ref !== p.base_branch
      || live === undefined && subject.base_oid !== p.base_oid)
      fail('STANDARD_PR_MERGE_CONSENT_SUBJECT_CHANGED');
    const resolutionBinding = subject.resolution_expires_at_ms === null
      ? 'session_pr_review_effects_verify' : 'session_pr_review_resolution_exception';
    const resolution = readAccepted(instance, subject.resolution_operation_id, resolutionBinding);
    if (receiptHash(resolution.record) !== subject.resolution_receipt_sha256) fail('STANDARD_PR_MERGE_RESOLUTION_CHANGED');
    if (live !== undefined) {
      assertMergeQualificationProof(live);
      const accepted = resolution.output.observations.proof;
      if (!b.current || subject.resolution_expires_at_ms !== null || resolution.output.contract_version !== reviewEffectsOutputVersion
        || live.prior_base_oid !== p.base_oid || live.observed_base_oid !== subject.base_oid
        || live.threads_sha256 !== accepted.threads_sha256 || live.reviews_sha256 !== accepted.reviews_sha256
        || live.reply_proof_sha256 !== accepted.reply_proof_sha256) fail('STANDARD_PR_MERGE_RESOLUTION_CHANGED');
    }
  }
  async function observeQualification(instance, input, b, signal) {
    const observed = await observeMergeQualification(instance, input, signal);
    assertQualification(instance, input, b, observed.subject, observed.qualificationProof);
    return observed;
  }
  const requestFor = (b, qualification) => prObservationRequest({ ...b.source.pullRequest, base_oid: qualification.base_oid });
  function assertContext(instance) {
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail('STANDARD_PR_MERGE_CONTEXT_CHANGED');
  }
  function consentExpired(b) {
    const time = now();
    if (!Number.isSafeInteger(time) || time < b.question.issued_at_ms) fail('STANDARD_PLAN_EXPIRED');
    return !b.current && time >= b.question.expires_at_ms;
  }
  function assertAge(b) {
    if (consentExpired(b)) fail('STANDARD_PLAN_EXPIRED');
  }
  function expiredBeforeSend(cause, b) {
    return cause.effect_status === 'no_effect'
      && ['STANDARD_PLAN_EXPIRED', 'STANDARD_PR_MERGE_CONSENT_EXPIRED'].includes(cause.code) && consentExpired(b);
  }
  function renewal(reason = 'STANDARD_PLAN_EXPIRED') {
    return assertMergeExecuteOutput({ contract_version: mergeExecuteOutputVersion, operation_ref: mergeExecuteOperation,
      outcome: 'completed', effect_status: 'no_effect', facts: { [mergeCompletedFact]: false },
      observations: { reason_code: reason }, evidence_refs: [] });
  }
  function assertProvider(provider, b, id, qualification) {
    const plan = assertGithubPrMergePlan(provider?.plan);
    const url = new URL(b.source.pullRequest.url), request = requestFor(b, qualification);
    if (url.origin !== 'https://github.com' || url.pathname.toLowerCase() !==
      ('/' + plan.repository.owner + '/' + plan.repository.name + '/pull/' + request.pull_request_number).toLowerCase())
      fail('STANDARD_PR_MERGE_REPOSITORY_CHANGED');
    if (provider.can_apply !== true || provider.plan_sha256 !== shadowHash(plan) || plan.operation_id !== id
      || (plan.contract_version === githubPrMergePlanVersion) !== b.current
      || plan.repository.node_id !== b.question.subject.repository_id
      || plan.actor.node_id !== qualification.actor_id
      || plan.prepared_at_ms < b.question.issued_at_ms || plan.expires_at_ms !== b.question.expires_at_ms
      || !same(plan.request, request)) fail('STANDARD_PR_MERGE_PLAN_CHANGED');
  }
  function checked(instance, input, prepared, id) {
    const plan = prepared?.plan, b = basis(instance, input);
    if (prepared?.can_apply !== true || prepared.plan_sha256 !== shadowHash(plan) || !same(plan.input, input)
      || plan.consent_receipt_sha256 !== b.consent_receipt_sha256 || plan.checks_receipt_sha256 !== b.checks_receipt_sha256)
      fail('STANDARD_PR_MERGE_PLAN_CHANGED');
    const qualification = b.current ? plan.qualification : b.question.subject;
    if (b.current) assertQualification(instance, input, b, qualification, plan.qualification_proof);
    if (plan.provider !== null) assertProvider(plan.provider, b, id, qualification);
    return { plan, b };
  }
  function output(prepared, value, confirmation) {
    const providerPlan = prepared.plan.provider.plan;
    const provider = assertGithubPrMergePostimage(providerPlan, value), p = provider.pull_request;
    const merge = { operation_id: providerPlan.operation_id, plan_sha256: prepared.plan_sha256,
      consent_receipt_sha256: prepared.plan.consent_receipt_sha256, checks_receipt_sha256: prepared.plan.checks_receipt_sha256,
      method: providerPlan.method, confirmation, provider };
    return assertMergeExecuteOutput({ contract_version: mergeExecuteOutputVersion, operation_ref: mergeExecuteOperation,
      outcome: 'completed', effect_status: confirmation === 'acknowledged' ? 'confirmed' : 'no_effect',
      facts: { [mergeCompletedFact]: true }, observations: { merge }, evidence_refs: [{ ref: 'github:pr-merge/' + p.node_id, sha256: shadowHash(merge) }] });
  }
  return Object.freeze({
    async prepare(instance, input, id) {
      if (!['prepare', 'apply', 'recover'].every(method => typeof port?.[method] === 'function'))
        fail('STANDARD_PR_MERGE_METHOD_AUTHORITY_REQUIRED');
      const b = basis(instance, input);
      let provider = null;
      const { subject: qualification, qualificationProof } = b.current
        ? await observeQualification(instance, input, b) : { subject: b.question.subject };
      if (!consentExpired(b)) {
        await verifyFreshDecision(b.consent);
        if (!consentExpired(b)) {
          try { provider = await port.prepare(requestFor(b, qualification), id, { expiresAt: b.question.expires_at_ms }); }
          catch (cause) { if (!expiredBeforeSend(cause, b)) throw cause; }
          if (provider !== null) assertProvider(provider, b, id, qualification);
        }
      }
      assertContext(instance);
      const plan = { input: structuredClone(input), consent_receipt_sha256: b.consent_receipt_sha256,
        checks_receipt_sha256: b.checks_receipt_sha256, ...(b.current ? { qualification } : {}),
        ...(qualificationProof ? { qualification_proof: qualificationProof } : {}), provider };
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    },
    async apply(instance, input, prepared, { signal, assertAuthorized, operationId }) {
      const { plan, b } = checked(instance, input, prepared, operationId);
      if (consentExpired(b)) return renewal();
      if (plan.provider === null) fail('STANDARD_PR_MERGE_PLAN_CHANGED');
      let value, consentGrantExpiresAt;
      try {
        value = await port.apply(plan.provider, { write: true, expectPlan: plan.provider.plan_sha256, signal, assertAuthorized,
          assertReviewFresh: async () => {
            if (b.current) {
              const fresh = await observeQualification(instance, input, b, signal);
              if (!same(fresh.subject, plan.qualification) || !same(fresh.qualificationProof ?? null, plan.qualification_proof ?? null))
                fail('STANDARD_PR_MERGE_QUALIFICATION_CHANGED');
              return;
            }
            assertAge(b);
            await assertConsentFresh(instance, b.consent, signal);
            await verifyFreshDecision(b.consent, signal);
            assertAge(b);
          },
          ...(b.current ? {
            assertConsentCurrent: async () => {
              const proof = await verifyFreshDecision(b.consent, signal);
              consentGrantExpiresAt = proof.grant_expires_at_ms;
              assertContext(instance);
            },
            assertGrantsCurrent: time => {
              if (!Number.isSafeInteger(consentGrantExpiresAt) || time >= consentGrantExpiresAt)
                fail('STANDARD_PR_MERGE_CONSENT_GRANT_EXPIRED');
              const expires = plan.qualification.resolution_expires_at_ms;
              if (expires !== null && time >= expires) fail('STANDARD_PR_RESOLUTION_EXCEPTION_STALE');
            },
          } : {}) });
      } catch (cause) {
        if (cause.effect_status === 'no_effect' && cause.code === mergeSendWindowExhausted) return renewal(cause.code);
        if (expiredBeforeSend(cause, b)) return renewal();
        throw cause;
      }
      try { return output(prepared, value, 'acknowledged'); }
      catch { fail('STANDARD_PR_MERGE_POSTIMAGE_CHANGED', 'unknown'); }
    },
    async recover(instance, input, prepared, { signal, operationId }) {
      try {
        // The frozen accepted evidence identifies the original attempt. A later
        // observation may settle it without reopening review or renewing consent.
        const { plan } = checked(instance, input, prepared, operationId);
        if (plan.provider === null) fail('STANDARD_PR_MERGE_PLAN_CHANGED');
        const value = await port.recover(plan.provider, { expectPlan: plan.provider.plan_sha256, signal });
        return output(prepared, value, 'observed');
      } catch {
        return { reason_code: 'STANDARD_PR_MERGE_POSTIMAGE_UNAVAILABLE' };
      }
    },
    waitForSync(instance, input) {
      const { record, output } = readAccepted(instance, input.merge_operation_id, mergeExecuteOperation);
      if (output.observations.merge?.operation_id !== record.operation_id) fail('STANDARD_PR_MERGE_RESULT_REQUIRED');
      return assertPostMergeWaitOutput({ contract_version: 'standard-pr-post-merge-wait-output.v1', operation_ref: postMergeWaitOperation,
        outcome: 'deferred', effect_status: 'no_effect', facts: {}, observations: { reason_code: 'STANDARD_PR_POST_MERGE_SYNC_REQUIRED',
          merge_receipt_sha256: receiptHash(record) }, evidence_refs: [] });
    },
  });
}
