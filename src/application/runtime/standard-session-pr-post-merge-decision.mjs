import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertPostMergeMeasureOutput, divergentReason, postMergeMeasureOperation } from '../../core/workflow/standard-pr-post-merge-fetch.mjs';
import { postMergeDecisionMaxAgeMs } from '../../core/workflow/standard-pr-post-merge-decision.mjs';
import { assertPostMergeSessionLink, postMergeSessionSource } from './standard-session-pr-post-merge-completion.mjs';

const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const required = 'STANDARD_PR_POST_MERGE_DIVERGENCE_REQUIRED';

export function createStandardPostMergeDecision({ postMerge, readAccepted, artifacts, scopeSha, now }) {
  async function observe(instance, input, signal) {
    const started = now();
    const { record, output } = readAccepted(instance, input.measurement_operation_id, postMergeMeasureOperation, required);
    const measured = assertPostMergeMeasureOutput(output).observations;
    if (measured.reason_code !== divergentReason) fail(required);
    const fetchInput = record.preview.input, fetch = postMerge.alignmentSource(instance, fetchInput);
    if (measured.alignment.fetch_operation_id !== fetchInput.fetch_operation_id
      || measured.alignment.fetch_receipt_sha256 !== fetch.receiptSha
      || record.preview.prepared.fetch_receipt_sha256 !== fetch.receiptSha) fail(required);

    const alignment = await postMerge.measure(instance, fetchInput, fetch, signal);
    const session = postMergeSessionSource({ instance, readAccepted, artifacts });
    const { merge } = fetch, pull = merge.provider.pull_request;
    assertPostMergeSessionLink(session, merge, alignment);
    const subject = { project_scope_sha256: scopeSha(), session_id: session.sessionId, opening_operation_id: session.openId,
      measurement_operation_id: record.operation_id, measurement_receipt_sha256: shadowHash(record.results.at(-1).receipt),
      merge_operation_id: fetch.fetch.merge_operation_id, merge_receipt_sha256: fetch.fetch.merge_receipt_sha256,
      repository_id: merge.provider.repository.node_id, pull_request_id: pull.node_id, pull_request_number: pull.number,
      head_oid: pull.head_oid, head_ref: pull.head_ref, alignment };
    const observedAt = now();
    if (signal?.aborted || !Number.isSafeInteger(observedAt) || observedAt < started || observedAt - started >= postMergeDecisionMaxAgeMs)
      fail('STANDARD_PR_POST_MERGE_DECISION_EXPIRED');
    return { subject, observedAt };
  }

  function assertAge(prepared) {
    const time = now();
    if (!Number.isSafeInteger(time) || time < prepared.prepared_at_ms || time >= prepared.expires_at_ms)
      fail('STANDARD_PR_POST_MERGE_DECISION_EXPIRED');
  }

  return Object.freeze({
    async prepare(instance, input, signal) {
      const { subject, observedAt } = await observe(instance, input, signal);
      if (!subject.alignment.ahead && !subject.alignment.behind) fail(required);
      return { can_apply: true, subject, prepared_at_ms: observedAt, expires_at_ms: observedAt + postMergeDecisionMaxAgeMs };
    },
    assertAge,
    async assertFresh(instance, input, prepared, signal) {
      assertAge(prepared);
      const { subject } = await observe(instance, input, signal);
      if (shadowHash(subject) !== shadowHash(prepared.subject)) fail('STANDARD_PR_POST_MERGE_DECISION_SUBJECT_CHANGED');
      assertAge(prepared);
    },
  });
}
