import { assertGithubPrMergePlan, assertGithubPrMergePostimage } from '../../adapters/git-provider/github-pr-merge.mjs';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { checksOperation, mergeConsentOperation, mergeConsentQuestion } from '../../core/workflow/standard-pr-merge-consent.mjs';
import { assertMergeExecuteOutput, assertPostMergeWaitOutput, mergeExecuteOperation, postMergeWaitOperation } from '../../core/workflow/standard-pr-merge-execute.mjs';
import { createStandardPrReviewEffectsReader, prObservationRequest } from './standard-session-pr-review-effects.mjs';

const fail = (code, effect_status = 'no_effect') => { throw Object.assign(Error(code), { code, effect_status }); };
const same = (left, right) => shadowHash(left) === shadowHash(right);
const receiptHash = record => shadowHash(record.results.at(-1).receipt);

export function createStandardPrMergeExecute({ now, reviewPort, readAccepted, readCurrent, verifyFreshDecision, assertConsentFresh, ...ports }) {
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
    const { subject } = question, p = source.pullRequest;
    if (consent.output.facts.session_pr_merge_consent_accepted !== true
      || consent.output.observations.choice !== 'approve_merge'
      || consent.output.observations.question_sha256 !== shadowHash(question)
      || consent.output.observations.subject_sha256 !== shadowHash(subject)
      || consent.output.observations.expires_at_ms !== question.expires_at_ms
      || question.checks_operation_id !== input.checks_operation_id
      || checks.output.facts.session_pr_required_checks_accepted !== true || !same(checks.output.observations.subject, subject)
      || source.correctionsRequired || subject.triage_operation_id !== input.triage_operation_id
      || subject.source_sha256 !== source.sha256 || subject.update_operation_id !== source.updateId
      || subject.repository_id !== p.repository_id || subject.pull_request_id !== p.node_id || subject.pull_request_number !== p.number
      || subject.head_oid !== p.head_oid || subject.base_oid !== p.base_oid || subject.head_ref !== p.head_branch || subject.base_ref !== p.base_branch)
      fail('STANDARD_PR_MERGE_CONSENT_SUBJECT_CHANGED');
    const resolutionBinding = subject.resolution_expires_at_ms === null
      ? 'session_pr_review_effects_verify' : 'session_pr_review_resolution_exception';
    const resolution = readAccepted(instance, subject.resolution_operation_id, resolutionBinding);
    if (receiptHash(resolution.record) !== subject.resolution_receipt_sha256) fail('STANDARD_PR_MERGE_RESOLUTION_CHANGED');
    return { consent: consent.record, question, request: prObservationRequest(p), source,
      consent_receipt_sha256: receiptHash(consent.record), checks_receipt_sha256: receiptHash(checks.record) };
  }
  function assertAge(b) {
    const time = now();
    if (!Number.isSafeInteger(time) || time < b.question.issued_at_ms || time >= b.question.expires_at_ms)
      fail('STANDARD_PLAN_EXPIRED');
  }
  function assertProvider(provider, b, id) {
    const plan = assertGithubPrMergePlan(provider?.plan);
    const url = new URL(b.source.pullRequest.url);
    if (url.origin !== 'https://github.com' || url.pathname.toLowerCase() !==
      ('/' + plan.repository.owner + '/' + plan.repository.name + '/pull/' + b.request.pull_request_number).toLowerCase())
      fail('STANDARD_PR_MERGE_REPOSITORY_CHANGED');
    if (provider.can_apply !== true || provider.plan_sha256 !== shadowHash(plan) || plan.operation_id !== id
      || plan.repository.node_id !== b.question.subject.repository_id || plan.actor.node_id !== b.question.subject.actor_id
      || plan.prepared_at_ms < b.question.issued_at_ms || plan.expires_at_ms !== b.question.expires_at_ms
      || !same(plan.request, b.request)) fail('STANDARD_PR_MERGE_PLAN_CHANGED');
  }
  function checked(instance, input, prepared, id) {
    const plan = prepared?.plan, b = basis(instance, input);
    if (prepared?.can_apply !== true || prepared.plan_sha256 !== shadowHash(plan) || !same(plan.input, input)
      || plan.consent_receipt_sha256 !== b.consent_receipt_sha256 || plan.checks_receipt_sha256 !== b.checks_receipt_sha256)
      fail('STANDARD_PR_MERGE_PLAN_CHANGED');
    assertProvider(plan.provider, b, id);
    return { plan, b };
  }
  function output(prepared, value, confirmation) {
    const providerPlan = prepared.plan.provider.plan;
    const provider = assertGithubPrMergePostimage(providerPlan, value), p = provider.pull_request;
    const merge = { operation_id: providerPlan.operation_id, plan_sha256: prepared.plan_sha256,
      consent_receipt_sha256: prepared.plan.consent_receipt_sha256, checks_receipt_sha256: prepared.plan.checks_receipt_sha256,
      method: providerPlan.method, confirmation, provider };
    return assertMergeExecuteOutput({ contract_version: 'standard-pr-merge-execute-output.v1', operation_ref: mergeExecuteOperation,
      outcome: 'completed', effect_status: confirmation === 'acknowledged' ? 'confirmed' : 'no_effect',
      facts: {}, observations: { merge }, evidence_refs: [{ ref: 'github:pr-merge/' + p.node_id, sha256: shadowHash(merge) }] });
  }
  return Object.freeze({
    async prepare(instance, input, id) {
      if (!['prepare', 'apply', 'recover'].every(method => typeof port?.[method] === 'function'))
        fail('STANDARD_PR_MERGE_METHOD_AUTHORITY_REQUIRED');
      const b = basis(instance, input);
      assertAge(b);
      await verifyFreshDecision(b.consent);
      const provider = await port.prepare(b.request, id, { expiresAt: b.question.expires_at_ms });
      assertProvider(provider, b, id);
      if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail('STANDARD_PR_MERGE_CONTEXT_CHANGED');
      const plan = { input: structuredClone(input), consent_receipt_sha256: b.consent_receipt_sha256,
        checks_receipt_sha256: b.checks_receipt_sha256, provider };
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    },
    async apply(instance, input, prepared, { signal, assertAuthorized, operationId }) {
      const { plan, b } = checked(instance, input, prepared, operationId);
      assertAge(b);
      const value = await port.apply(plan.provider, { write: true, expectPlan: plan.provider.plan_sha256, signal, assertAuthorized,
        assertReviewFresh: async () => {
          assertAge(b);
          await assertConsentFresh(instance, b.consent, signal);
          await verifyFreshDecision(b.consent, signal);
          assertAge(b);
        } });
      try { return output(prepared, value, 'acknowledged'); }
      catch { fail('STANDARD_PR_MERGE_POSTIMAGE_CHANGED', 'unknown'); }
    },
    async recover(instance, input, prepared, { signal, operationId }) {
      try {
        // The frozen accepted evidence identifies the original attempt. A later
        // observation may settle it without reopening review or renewing consent.
        const { plan } = checked(instance, input, prepared, operationId);
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
