import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertStandardOperationOutput } from '../../core/workflow/standard-operation-contracts.mjs';
import { createStandardSessionPrReviewContentObservation } from './standard-session-pr-review-observe.mjs';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };

// This component has no caller-supplied report, provider or self-authenticated
// payload. Its capabilities must be bound by the trusted operation host.
export function createStandardPrCorrectionAuthority({ readAcceptedOperation, reevaluateTriage, readControl, verifyEvent,
  observeProduct, inspectPush, observeOwnedPush, observeRemote, readCurrent, reviewPort, now = Date.now }) {
  if (![readAcceptedOperation, reevaluateTriage, readControl, verifyEvent, observeProduct, inspectPush, readCurrent].every(fn => typeof fn === 'function'))
    fail('STANDARD_PR_CORRECTION_AUTHORITY_REQUIRED');
  const active = signal => { if (signal?.aborted) fail('STANDARD_PR_CORRECTION_ABORTED'); };
  function immutable(instance, input) {
    const triage = readAcceptedOperation(instance, input.triage_operation_id, 'session_pr_triage_evaluate'), output = assertStandardOperationOutput(triage.output);
    const o = output.observations;
    if (output.outcome !== 'completed' || output.effect_status !== 'no_effect' || output.facts.session_pr_findings_classified !== true
      || output.facts.session_pr_corrections_required !== true || !o.corrections?.length || o.dispositions.some(row => row.disposition === 'uncertain')
      || o.triage_completion !== 'pending-effects-and-verification' || observeProduct() !== o.product_sha256) fail('STANDARD_PR_CORRECTION_TRIAGE_REQUIRED');
    const selection = readAcceptedOperation(instance, o.selection_operation_id, 'session_pr_triage_select');
    const received = readAcceptedOperation(instance, o.received_operation_id, 'session_pr_review_receive');
    const selected = selection.output.observations, payload = selected.payload;
    const update = readAcceptedOperation(instance, payload.observation.observations.update_operation_id, 'session_pr_update_push');
    const p = update.output.observations.pull_request, capture = readControl(received.output.observations.inbox_id);
    if (selection.output.outcome !== 'completed' || selection.output.facts.session_pr_triage_source_selected !== true
      || received.output.outcome !== 'completed' || received.output.facts.session_pr_review_event_received !== true
      || update.output.outcome !== 'completed' || update.output.facts.session_pr_head_confirmed !== true
      || selection.record.preview.input.received_operation_id !== received.record.operation_id
      || selected.received_operation_id !== received.record.operation_id
      || selected.payload_sha256 !== o.payload_sha256 || selected.product_sha256 !== o.product_sha256
      || shadowHash(payload) !== o.payload_sha256 || shadowHash(received.output.observations.payload) !== o.payload_sha256
      || capture.phase !== 'delivered' || shadowHash(capture.payload) !== o.payload_sha256
      || payload.event.head_oid !== o.head_oid || payload.event.base_oid !== o.base_oid
      || p.head_oid !== o.head_oid || p.base_oid !== o.base_oid || p.node_id !== payload.event.pull_request_id
      || p.repository_id !== payload.event.repository_id || p.state !== 'OPEN' || p.draft) fail('STANDARD_PR_CORRECTION_SOURCE_CHANGED');
    return { source: { triage_operation_id: input.triage_operation_id, triage_output_sha256: shadowHash(output),
      session_id: payload.observation.observations.session_id, selection_operation_id: selection.record.operation_id,
      received_operation_id: received.record.operation_id, update_operation_id: update.record.operation_id,
      payload_sha256: o.payload_sha256, product_sha256: o.product_sha256, pull_request: p,
      corrections: o.corrections, source_material_sha256: shadowHash([triage.output, selection.output, received.output, update.output, capture]) }, capture, payload, triage };
  }
  async function verify(instance, expected, { signal, assertLocal } = {}, localHeadRequired = true, continuation = false) {
    // Only a trusted component can supply this function. IR inputs remain
    // closed operation identities and never carry local cleanliness claims.
    if (assertLocal !== undefined && (typeof assertLocal !== 'function' || !continuation && typeof observeOwnedPush !== 'function'))
      fail('STANDARD_PR_CORRECTION_OWNED_OBSERVATION_REQUIRED');
    if (continuation && (typeof assertLocal !== 'function' || typeof observeRemote !== 'function')) fail('STANDARD_PR_CORRECTION_OWNED_OBSERVATION_REQUIRED');
    const inspect = continuation ? branch => observeRemote(branch, { signal, assertLocal }) : assertLocal ? branch => observeOwnedPush(branch, { signal, assertLocal }) : branch => inspectPush(branch, { signal });
    active(signal); const before = immutable(instance, { triage_operation_id: expected.triage_operation_id });
    if (shadowHash(before.source) !== shadowHash(expected)) fail('STANDARD_PR_CORRECTION_SOURCE_CHANGED');
    await verifyEvent(before.capture, { signal }); active(signal);
    const gitBefore = await inspect(expected.pull_request.head_branch); active(signal);
    if (localHeadRequired && gitBefore.head !== expected.pull_request.head_oid || gitBefore.remote_head !== expected.pull_request.head_oid)
      fail('STANDARD_PR_CORRECTION_REMOTE_CHANGED');
    const observer = createStandardSessionPrReviewContentObservation({ now, reviewPort, readCurrent,
      readConfirmedHead(current, input) {
        const fresh = immutable(current, { triage_operation_id: expected.triage_operation_id });
        if (shadowHash(fresh.source) !== shadowHash(expected) || input.update_operation_id !== expected.update_operation_id) fail('STANDARD_PR_CORRECTION_SOURCE_CHANGED');
        return { update_operation_id: expected.update_operation_id, session_id: expected.session_id, head: expected.pull_request.head_oid,
          pull_request: expected.pull_request, material_sha256: expected.source_material_sha256 };
      } });
    const fresh = await observer.observe(instance, { contract_version: 'standard-session-pr-review-observe-input.v1', update_operation_id: expected.update_operation_id }, { signal });
    active(signal); const old = before.payload.observation.observations, observed = fresh.observations;
    if (fresh.outcome !== 'completed' || observed.head_oid !== old.head_oid || observed.base_oid !== old.base_oid
      || observed.evidence.evidence_sha256 !== old.evidence.evidence_sha256 || observed.threads.observation_sha256 !== old.threads.observation_sha256)
      fail('STANDARD_PR_CORRECTION_PROVIDER_CHANGED');
    await verifyEvent(before.capture, { signal }); active(signal);
    const gitAfter = await inspect(expected.pull_request.head_branch); active(signal);
    if (localHeadRequired && gitAfter.head !== expected.pull_request.head_oid || gitAfter.remote_head !== expected.pull_request.head_oid)
      fail('STANDARD_PR_CORRECTION_REMOTE_CHANGED');
    if (shadowHash(immutable(instance, { triage_operation_id: expected.triage_operation_id }).source) !== shadowHash(expected)) fail('STANDARD_PR_CORRECTION_SOURCE_CHANGED');
    return { origin_source_sha256: shadowHash(expected), event_sha256: shadowHash(before.payload.event),
      fresh_observation_sha256: shadowHash(fresh), git_before_sha256: shadowHash(gitBefore), git_after_sha256: shadowHash(gitAfter),
      canonical_transition: continuation ? 'local-cycle-owner-verified-separately' : localHeadRequired ? 'verified-separately-by-exact-plan-postimages' : 'local-checkpoint-proof-required' };
  }
  const verifySource = (instance, expected, options) => verify(instance, expected, options);
  return Object.freeze({ verifySource,
    // Local current-cycle invariants are supplied by the trusted owner capability;
    // unchanged provider/event/product evidence is still fully reauthenticated.
    verifyContinuationSource: (instance, expected, options) => verify(instance, expected, options, false, true),
    // This narrower observation grants no local continuation authority. Its
    // consumer must separately prove the exact authenticated checkpoint commit.
    verifyProviderSource: (instance, expected, options) => verify(instance, expected, options, false),
    async readSource(instance, input, { signal } = {}) {
    active(signal); const selected = immutable(instance, input);
    const fresh = await reevaluateTriage(instance, selected.triage.record.preview.input, { signal }); active(signal);
    if (shadowHash(fresh) !== selected.source.triage_output_sha256) fail('STANDARD_PR_CORRECTION_TRIAGE_STALE');
    await verifySource(instance, selected.source, { signal }); return structuredClone(selected.source);
  } });
}
