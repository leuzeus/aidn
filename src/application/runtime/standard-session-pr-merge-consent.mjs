import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertRequiredChecksOutput, checksOperation, mergeConsentMaxAgeMs } from '../../core/workflow/standard-pr-merge-consent.mjs';
import { prObservationRequest } from './standard-session-pr-review-effects.mjs';

const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const unavailable = 'STANDARD_PR_CHECKS_UNAVAILABLE';
const reasonCode = cause => /^[A-Z][A-Z0-9_]{0,127}$/.test(cause?.code ?? '') ? cause.code : unavailable;

export function createStandardPrMergeConsent({ now, reviewPort, resolution, readAccepted, readCurrent, verifyFreshDecision }) {
  async function observe(instance, input, signal) {
    const started = now();
    if (!Number.isSafeInteger(started) || signal?.aborted) fail(unavailable);
    if (typeof reviewPort?.observeRequiredChecks !== 'function') fail('STANDARD_PR_CHECK_POLICY_REQUIRED');
    // The two inventory samples surround a fresh observation of the exact R08 proof.
    const { source, observed, before, decision, operationId, receiptSha256, expires } = await resolution.readGate(instance, input, {
      signal, beforeReview: p => reviewPort.observeRequiredChecks(prObservationRequest(p), { signal }),
    });
    const second = await reviewPort.observeRequiredChecks(observed.request, { signal });
    if (decision) await verifyFreshDecision(decision, signal);
    const end = now();
    if (signal?.aborted || !Number.isSafeInteger(end) || end < started || end - started >= mergeConsentMaxAgeMs
      || expires !== null && end >= expires || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
      fail('STANDARD_PR_CHECK_CONTEXT_CHANGED');
    if (second.actor_id !== observed.actor.node_id || shadowHash(before) !== shadowHash(second))
      fail('STANDARD_PR_CHECK_EVIDENCE_CHANGED');
    const p = source.pullRequest;
    const subject = { triage_operation_id: input.triage_operation_id, update_operation_id: source.updateId, source_sha256: source.sha256,
      repository_id: p.repository_id, pull_request_id: p.node_id, pull_request_number: p.number, head_oid: p.head_oid, base_oid: p.base_oid,
      head_ref: p.head_branch, base_ref: p.base_branch, actor_id: second.actor_id, resolution_operation_id: operationId,
      resolution_receipt_sha256: receiptSha256, resolution_expires_at_ms: expires, policy_sha256: second.policy_sha256, checks: second.checks };
    return { subject, observed_at_ms: end };
  }

  async function consentBasis(instance, input, signal) {
    const accepted = readAccepted(instance, input.checks_operation_id, checksOperation);
    const basis = accepted.output.observations;
    if (accepted.output.facts.session_pr_required_checks_accepted !== true || basis.subject.triage_operation_id !== input.triage_operation_id)
      fail('STANDARD_PR_CHECK_ACCEPTANCE_REQUIRED');
    const fresh = await observe(instance, input, signal);
    if (shadowHash(basis.subject) !== shadowHash(fresh.subject)) fail('STANDARD_PR_MERGE_CONSENT_SUBJECT_CHANGED');
    return fresh;
  }

  return Object.freeze({
    async acceptChecks(instance, input, signal) {
      const body = { contract_version: 'standard-pr-checks-accept-output.v1', operation_ref: checksOperation, effect_status: 'no_effect' };
      try {
        const observations = await observe(instance, input, signal);
        return assertRequiredChecksOutput({ ...body, outcome: 'completed', facts: { session_pr_required_checks_accepted: true },
          observations, evidence_refs: [{ ref: 'github:pr-required-checks/' + observations.subject.pull_request_id, sha256: shadowHash(observations) }] });
      } catch (cause) {
        const reason = reasonCode(cause);
        const deferred = ['STANDARD_PR_CHECK_POLICY_REQUIRED', 'STANDARD_PR_CHECK_MISSING', 'STANDARD_PR_CHECK_PENDING', 'STANDARD_PR_CHECK_FAILED'];
        return assertRequiredChecksOutput({ ...body, outcome: deferred.includes(reason) ? 'deferred' : 'blocked', facts: {},
          observations: { reason_code: reason }, evidence_refs: [] });
      }
    },
    async prepare(instance, input, signal) {
      const { subject, observed_at_ms: observedAt } = await consentBasis(instance, input, signal);
      return { can_apply: true, subject, prepared_at_ms: observedAt,
        expires_at_ms: Math.min(observedAt + mergeConsentMaxAgeMs, subject.resolution_expires_at_ms ?? Infinity) };
    },
    async assertFresh(instance, input, prepared, signal) {
      function assertAge() {
        const time = now();
        if (!Number.isSafeInteger(time) || time < prepared.prepared_at_ms || time >= prepared.expires_at_ms)
          fail('STANDARD_PR_MERGE_CONSENT_EXPIRED');
      }
      assertAge();
      const { subject } = await consentBasis(instance, input, signal);
      if (shadowHash(subject) !== shadowHash(prepared.subject)) fail('STANDARD_PR_MERGE_CONSENT_SUBJECT_CHANGED');
      assertAge();
    },
  });
}
