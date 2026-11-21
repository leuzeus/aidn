import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../core/workflow/standard-operation-contracts.mjs';
import { evaluateStandardPrTriage } from '../../core/workflow/standard-pr-triage.mjs';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };

// These capabilities are composed by the host. IR inputs carry only the
// accepted source identity; neither a provider port nor report body is accepted.
export function createStandardPrTriageSource({ readReceived, observeReceived, observeProduct, readNative }) {
  if (![readReceived, observeReceived, observeProduct, readNative].every(fn => typeof fn === 'function')) fail('STANDARD_PR_TRIAGE_AUTHORITY_REQUIRED');
  const active = signal => { if (signal?.aborted) fail('STANDARD_PR_TRIAGE_ABORTED'); };
  async function select(instance, input, { signal } = {}) {
    assertStandardOperationInput('session_pr_triage_select', input); active(signal);
    const received = readReceived(instance, input.received_operation_id), before = observeProduct();
    if (!/^[a-f0-9]{64}$/.test(before ?? '')) fail('STANDARD_PR_TRIAGE_PRODUCT_REQUIRED');
    const fresh = await observeReceived(instance, received.record.preview.input, { signal }); active(signal);
    if (received.output.outcome !== 'completed' || received.output.facts.session_pr_review_event_received !== true
      || received.output.facts.session_pr_triage_required !== true || received.output.effect_status !== 'no_effect'
      || shadowHash(fresh) !== shadowHash(received.output) || observeProduct() !== before)
      fail('STANDARD_PR_TRIAGE_SOURCE_CHANGED');
    const payload = received.output.observations.payload;
    return assertStandardOperationOutput({ contract_version: 'standard-pr-triage-select-output.v1', operation_ref: 'session_pr_triage_select',
      outcome: 'completed', effect_status: 'no_effect', facts: { session_pr_triage_source_selected: true },
      observations: { received_operation_id: input.received_operation_id, received_output_sha256: shadowHash(received.output),
        payload, payload_sha256: shadowHash(payload), product_sha256: before }, evidence_refs: received.output.evidence_refs });
  }
  return Object.freeze({ select, async evaluate(instance, input, { signal } = {}) {
    assertStandardOperationInput('session_pr_triage_evaluate', input); active(signal);
    const native = readNative(instance, input);
    const fresh = await select(instance, native.selection.record.preview.input, { signal });
    if (shadowHash(fresh) !== shadowHash(native.selection.output) || fresh.observations.product_sha256 !== native.context.product_sha256
      || fresh.observations.payload_sha256 !== native.context.payload_sha256) fail('STANDARD_PR_TRIAGE_CONTEXT_STALE');
    const output = evaluateStandardPrTriage({ report: native.authenticated.report, context: native.context,
      producer: native.authenticated.producer, evidenceRefs: native.evidence_refs });
    active(signal);
    if (observeProduct() !== native.context.product_sha256) fail('STANDARD_PR_TRIAGE_PRODUCT_CHANGED');
    return assertStandardOperationOutput(output);
  } });
}
