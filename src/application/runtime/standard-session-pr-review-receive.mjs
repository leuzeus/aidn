import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../core/workflow/standard-operation-contracts.mjs';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };

// Compare business material, excluding observation clocks and their envelope.
export function standardPrReviewMaterial(output) {
  const { update_operation_id, source_sha256, head_oid, base_oid, evidence, threads } = output.observations;
  return shadowHash({ update_operation_id, source_sha256, head_oid, base_oid,
    evidence_sha256: evidence.evidence_sha256, observation_sha256: threads.observation_sha256 });
}

// The host authenticates the accepted control event and the signed full payload.
// A fresh application observation fences changed heads, bases and same-head edits.
// Receiving content establishes the input to triage, never its disposition.
export function createStandardPrReviewReceiver({ readDelivered, observer, verifyEvent }) {
  if (![readDelivered, observer?.observe, verifyEvent].every(fn => typeof fn === 'function')) fail('STANDARD_PR_RECEIVE_AUTHORITY_REQUIRED');
  async function read(instance, input, signal) {
    assertStandardOperationInput('session_pr_review_receive', input);
    if (signal?.aborted) fail('STANDARD_PR_RECEIVE_ABORTED');
    const capture = await readDelivered(instance, input);
    await verifyEvent(capture, { signal });
    const fresh = await observer.observe(instance, {
      contract_version: 'standard-session-pr-review-observe-input.v1',
      update_operation_id: capture.payload.observation.observations.update_operation_id,
    }, { signal });
    if (signal?.aborted) fail('STANDARD_PR_RECEIVE_ABORTED');
    if (fresh.outcome !== 'completed' || standardPrReviewMaterial(fresh) !== standardPrReviewMaterial(capture.payload.observation))
      fail('STANDARD_PR_RECEIVE_CONTENT_CHANGED');
    await verifyEvent(capture, { signal });
    if (signal?.aborted) fail('STANDARD_PR_RECEIVE_ABORTED');
    return capture;
  }
  return Object.freeze({
    async prepare(instance, input) {
      const capture = await readDelivered(instance, input);
      return { can_apply: true, input, capture_sha256: shadowHash(capture) };
    },
    async observe(instance, input, { signal } = {}) {
      let capture;
      try { capture = await read(instance, input, signal); }
      catch (cause) {
        return assertStandardOperationOutput({ contract_version: 'standard-session-pr-review-receive-output.v1',
          operation_ref: 'session_pr_review_receive', outcome: 'blocked', effect_status: 'no_effect', facts: {},
          observations: { reason_code: /^[A-Z][A-Z0-9_]{0,127}$/.test(cause.code ?? '') ? cause.code : 'STANDARD_PR_RECEIVE_UNAVAILABLE' }, evidence_refs: [] });
      }
      return assertStandardOperationOutput({ contract_version: 'standard-session-pr-review-receive-output.v1',
        operation_ref: 'session_pr_review_receive', outcome: 'completed', effect_status: 'no_effect',
        facts: { session_pr_review_event_received: true, session_pr_triage_required: true },
        observations: { inbox_id: capture.inbox_id, source_sha256: shadowHash(capture.source),
          delivery_sha256: shadowHash(capture.delivery), payload: capture.payload,
          acceptance: 'pending-triage-and-policy-evaluation', merge_authorization: 'not-established' },
        evidence_refs: [{ ref: 'process-control:' + capture.inbox_id, sha256: shadowHash(capture) },
          { ref: 'github:review-content/' + capture.payload.event.pull_request_id + '/' + capture.payload.event.head_oid, sha256: shadowHash(capture.payload) }] });
    },
  });
}
