import { shadowHash } from '../../core/workflow/shadow-json.mjs';

const updateBindings = new Set(['session_pr_update_push', 'session_pr_redelivery_push']);

export function createStandardPrAcceptedReviewSource({ readAccepted, readAcceptedUpdate, readDelivered, sourceChanged }) {
  return function readSource(instance, input) {
    const triage = readAccepted(instance, input.triage_operation_id, 'session_pr_triage_evaluate');
    const o = triage.output.observations;
    const selection = readAccepted(instance, o.selection_operation_id, 'session_pr_triage_select');
    const received = readAccepted(instance, o.received_operation_id, 'session_pr_review_receive');
    const payload = received.output.observations.payload, review = payload.observation.observations;
    const latest = instance.events.findLast(row => row.kind === 'operation_intent' && updateBindings.has(row.intent.binding_ref));
    const update = readAcceptedUpdate(instance, review.update_operation_id);
    const p = update.output.observations.pull_request, event = payload.event;
    const capture = readDelivered(instance, { contract_version: 'standard-session-pr-review-receive-input.v1', update_operation_id: review.update_operation_id });
    const preMergeObservedUntil = Math.max(Date.parse(review.threads.observed_until), Date.parse(review.evidence.observed_until), Date.parse(event.occurred_at));
    if (triage.output.facts.session_pr_findings_classified !== true
      || o.triage_completion !== 'pending-effects-and-verification' || o.merge_authorization !== 'not-established'
      || received.output.facts.session_pr_review_event_received !== true || selection.output.facts.session_pr_triage_source_selected !== true
      || selection.record.preview.input.received_operation_id !== o.received_operation_id
      || selection.output.observations.received_operation_id !== o.received_operation_id
      || selection.output.observations.payload_sha256 !== o.payload_sha256
      || shadowHash(selection.output.observations.payload) !== o.payload_sha256 || shadowHash(payload) !== o.payload_sha256
      || capture.inbox_id !== received.output.observations.inbox_id || shadowHash(capture.payload) !== o.payload_sha256
      || shadowHash(capture.delivery) !== received.output.observations.delivery_sha256
      || latest?.intent.operation_id !== review.update_operation_id || update.output.facts.session_pr_head_confirmed !== true
      || p.state !== 'OPEN' || p.draft || p.repository_id !== event.repository_id || p.node_id !== event.pull_request_id
      || p.number !== event.pull_request_number
      || p.head_branch !== event.head_ref || p.base_branch !== event.base_ref || p.head_oid !== event.head_oid || p.base_oid !== event.base_oid
      || p.head_oid !== o.head_oid || p.base_oid !== o.base_oid || !Number.isSafeInteger(preMergeObservedUntil))
      throw Object.assign(Error(sourceChanged), { code: sourceChanged, effect_status: 'no_effect' });
    return { capture, review, triage, pullRequest: p, updateId: review.update_operation_id, preMergeObservedUntil,
      correctionsRequired: triage.output.facts.session_pr_corrections_required,
      sha256: shadowHash([triage.output, selection.output, received.output, update.output, capture]) };
  };
}
