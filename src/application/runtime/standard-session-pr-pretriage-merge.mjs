import { agenticProcessPrefixSha256, inspectAgenticProcess } from '../../core/workflow/agentic-process.mjs';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertExternalMergeControl, externalMergeControlClaim, externalMergeControlRef, externalMergeMaxAgeMs,
  externalMergeEventKey, externalMergeMaterial } from '../../core/workflow/standard-pr-external-merge.mjs';
import { observeStandardPrMerge } from './standard-session-pr-merge-observe.mjs';

const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const changed = 'STANDARD_PR_EXTERNAL_MERGE_POSTIMAGE_CHANGED';

export function createPretriageMergeControl({ readContext, reviewPort, now }) {
  async function observe(subject, signal) {
    const provider = await observeStandardPrMerge({ reviewPort, pullRequest: subject.pullRequest,
      notBefore: subject.notBefore, now, signal });
    if (provider.pull_request.state === 'OPEN') return null;
    return { update_operation_id: subject.updateId, pre_merge_base_oid: subject.pullRequest.base_oid,
      source_sha256: subject.sha256, provider };
  }
  function fresh(proof) {
    const age = now() - Date.parse(proof.provider.observed_until);
    if (!Number.isSafeInteger(age) || age < 0 || age >= externalMergeMaxAgeMs) fail('STANDARD_PR_EXTERNAL_MERGE_CAPTURE_EXPIRED');
  }
  return Object.freeze({
    assertCaptureFresh: fresh,
    async readMerge({ request, sourceRef, signal }) {
      if (sourceRef !== externalMergeControlRef) fail('PROCESS_CONTROL_SOURCE_REF_INVALID');
      const before = readContext(request);
      const payload = await observe(before, signal);
      if (readContext(request).sha256 !== before.sha256) fail(changed);
      if (!payload) return null;
      fresh(payload);
      const source = externalMergeControlClaim(request, payload);
      assertExternalMergeControl(payload, source, request);
      return { source, payload };
    },
    async verifyMerge({ request, source, payload, signal }) {
      assertExternalMergeControl(payload, source, request);
      fresh(payload);
      const before = readContext(request), observed = await observe(before, signal);
      if (!observed || shadowHash(externalMergeMaterial(observed)) !== source.subject_sha256
        || readContext(request).sha256 !== before.sha256) fail(changed);
      fresh(payload);
      return { outcome: 'verified', authority_id: source.authority_id, source_sha256: shadowHash(source) };
    },
    async assertPostimage(subject, proof, signal) {
      const observed = await observe(subject, signal);
      if (!observed || shadowHash(externalMergeMaterial(observed)) !== shadowHash(externalMergeMaterial(proof))) fail(changed);
    },
  });
}

// The operation host and the independent R09 admission reader authenticate
// the same accepted delivery and inbox event. Neither needs a triage receipt.
export function createPretriageMergeSource({ readAcceptedUpdate, readControl }) {
  function reviewCaptureCall(cursor, wait) {
    return cursor.occurrences.find(row => row.occurrence_id === wait?.call_scope_id
      && ['session_pr_review_capture', 'correction_pr_review_capture'].includes(row.node_id));
  }
  function readPretriageDelivery({ record: instance, cursor }, wait) {
    const call = reviewCaptureCall(cursor, wait);
    if (!call) fail('STANDARD_PR_EXTERNAL_MERGE_DELIVERY_REQUIRED');
    const corrective = call.node_id === 'correction_pr_review_capture';
    const binding = corrective ? 'session_pr_redelivery_push' : 'session_pr_update_push';
    const nodeId = corrective ? 'correction_pr_redelivery_push' : 'session_pr_update_push';
    const occurrence = cursor.occurrences.filter(row => row.node_id === nodeId && row.parent_id === call.parent_id
      && row.status === 'COMPLETED' && row.operation?.intent.binding_ref === binding);
    const latest = instance.events.findLast(row => row.kind === 'operation_intent'
      && ['session_pr_update_push', 'session_pr_redelivery_push'].includes(row.intent.binding_ref));
    const updateId = occurrence.length === 1 && occurrence[0].operation.intent.operation_id;
    if (!updateId || latest?.intent.operation_id !== updateId) fail('STANDARD_PR_EXTERNAL_MERGE_DELIVERY_REQUIRED');
    const { record, output } = readAcceptedUpdate(instance, updateId, binding), pullRequest = output.observations.pull_request;
    const notBefore = record.preview.prepared.plan.prepared_at_ms;
    if (output.facts.session_pr_head_confirmed !== true || pullRequest.state !== 'OPEN' || pullRequest.draft
      || !['confirmed', 'no_effect'].includes(output.effect_status) || !Number.isSafeInteger(notBefore)) fail('STANDARD_PR_EXTERNAL_MERGE_DELIVERY_REQUIRED');
    return { updateId, pullRequest, notBefore, sha256: shadowHash({ intent: record.intent, result: record.results.at(-1) }) };
  }
  function readPretriageEvent(instance, parentId, cursor) {
    if (!parentId) fail('STANDARD_PR_REVIEW_WAIT_REQUIRED');
    const wait = cursor.occurrences.filter(row => row.node_id === 'session_pr_review_wait'
      && reviewCaptureCall(cursor, row)?.parent_id === parentId);
    if (wait.length !== 1 || wait[0].status !== 'COMPLETED') fail('STANDARD_PR_REVIEW_WAIT_REQUIRED');
    const events = instance.events.filter(row => row.kind === 'control' && row.occurrence_id === wait[0].occurrence_id);
    if (events.length !== 1) fail('STANDARD_PR_REVIEW_WAIT_REQUIRED');
    const [event] = events, index = instance.events.indexOf(event), capture = readControl(event.delivery.delivery_id);
    if (shadowHash(capture.delivery) !== shadowHash(event.delivery)
      || capture.request.instance_sha256 !== agenticProcessPrefixSha256(instance, index)
      || capture.phase === 'delivered' && capture.delivered_instance_sha256 !== agenticProcessPrefixSha256(instance, index + 1))
      fail('STANDARD_HOST_CONTROL_HISTORY_NOT_AUTHENTICATED');
    return { wait: wait[0], event, capture };
  }
  function readPretriage(instance, input, occurrenceId) {
    const cursor = inspectAgenticProcess(instance);
    const frame = cursor.occurrences.find(row => row.occurrence_id === occurrenceId);
    const call = cursor.occurrences.find(row => row.occurrence_id === frame?.call_scope_id);
    const route = cursor.occurrences.find(row => row.occurrence_id === call?.parent_id);
    if (frame?.node_id !== 'pr_pretriage_external_disposition' || !['session_pr_pretriage_route', 'correction_pr_pretriage_route'].includes(route?.node_id))
      fail('STANDARD_PR_EXTERNAL_MERGE_DELIVERY_REQUIRED');
    const { wait, event, capture } = readPretriageEvent(instance, route.parent_id, cursor);
    const delivery = readPretriageDelivery({ record: instance, cursor }, wait);
    if (capture.contract_version !== 'process-control-inbox.v3' || event.delivery.event_key !== externalMergeEventKey
      || input.update_operation_id !== delivery.updateId || capture.payload.update_operation_id !== delivery.updateId
      || capture.payload.source_sha256 !== delivery.sha256 || capture.payload.pre_merge_base_oid !== delivery.pullRequest.base_oid)
      fail('STANDARD_PR_EXTERNAL_MERGE_DELIVERY_REQUIRED');
    const merge_observation = assertExternalMergeControl(capture.payload, capture.source, capture.request);
    return { delivery, subject: { update_operation_id: delivery.updateId, delivery_id: capture.inbox_id,
      delivery_sha256: shadowHash(event.delivery), merge_observation, incident: 'R08_PREMERGE_CONTROLS_UNESTABLISHED' } };
  }
  return Object.freeze({ readPretriageDelivery, readPretriageEvent, readPretriage });
}
