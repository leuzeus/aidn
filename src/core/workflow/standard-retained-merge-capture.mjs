import entrySchema from '../contracts/workflow-definition/standard-retained-merge-capture-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-merge-capture-proof.v1.schema.json' with { type: 'json' };
import selectionSchemaV2 from '../contracts/workflow-definition/standard-retained-merge-capture-selection.v2.schema.json' with { type: 'json' };
import selectionSchema from '../contracts/workflow-definition/standard-retained-merge-capture-selection.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import { inspectAgenticProcess } from './agentic-process.mjs';
import { assertControlInbox, controlReservationId, controlSelectionDigest } from './process-control-inbox.mjs';
import { assertExternalMergeControl, externalMergeMaxAgeMs } from './standard-pr-external-merge.mjs';
const require = (ok, code = 'STANDARD_RETAINED_MERGE_CAPTURE_BOUNDARY_CHANGED') => { if (!ok) throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => {
  require(!checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length,
    'STANDARD_RETAINED_MERGE_CAPTURE_CONTRACT_INVALID'); return value;
};
export const assertRetainedMergeCaptureEntry = value => valid(value, entrySchema);
export const assertRetainedMergeCaptureProof = value => valid(value, proofSchema);
export function assertRetainedMergeCaptureSelection(value) {
  const current = value?.contract_version === 'standard-retained-merge-capture-selection.v2';
  valid(value, current ? selectionSchemaV2 : selectionSchema);
  if (current) require(value.facts.retained_post_merge_requested === (value.observations.fetch_operation_id !== null)
    && !(value.facts.retained_post_merge_requested && value.facts.retained_external_merge_capture_requested),
    'STANDARD_RETAINED_MERGE_CAPTURE_CONTRACT_INVALID');
  return value;
}
export const retainedMergeCaptureSelection = (captured, fetchId = null) => assertRetainedMergeCaptureSelection({
  contract_version: 'standard-retained-merge-capture-selection.v2', operation_ref: 'session_pr_retained_merge_select',
  outcome: 'completed', effect_status: 'no_effect', facts: { retained_external_merge_capture_requested: captured, retained_post_merge_requested: fetchId !== null }, observations: { fetch_operation_id: fetchId }, evidence_refs: [] });
export const retainedMergeCaptureContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, update_operation_id: proof.update_operation_id,
  capture_id: proof.capture_id, proof_sha256: H(assertRetainedMergeCaptureProof(proof)) });

// This authenticates structure, not signatures. The fixed source owns the
// original signer, current provider and canonical-state checks.
export function assertRetainedMergeCaptureBoundary({ instance, records, capture, reservation, entry, now }) {
  assertRetainedMergeCaptureEntry(entry); assertControlInbox(capture); assertControlInbox(reservation);
  const intents = instance.events.filter(row => row.kind === 'operation_intent'), record = records[0], result = record?.results[0];
  require(instance.initial_parameters?.entry_point?.kind === 'retained_external_merge'
    && intents.length === 1 && records.length === 1 && record.intent.binding_ref === 'workflow_entry_select'
    && H(record.intent) === H(intents[0].intent) && record.intent.instance_id === instance.instance_id
    && record.intent.scope_id === instance.scope_id && record.intent.model_sha256 === instance.model_sha256
    && record.phase === 'receipted' && record.results.length === 1 && result.receipt.outcome === 'completed'
    && result.output.outcome === 'completed' && result.output.effect_status === 'no_effect' && result.receipt.effect_status === 'no_effect'
    && result.receipt.output_sha256 === H(result.output)
    && instance.events.some(row => row.kind === 'operation_result' && H(row.receipt) === H(result.receipt))
    && !instance.events.some(row => row.kind === 'control'));
  const cursor = inspectAgenticProcess(instance), waits = cursor.occurrences.filter(row => row.node_id === 'session_pr_review_wait' && row.status === 'WAITING');
  require(waits.length === 1 && cursor.occurrences.find(row => row.occurrence_id === waits[0].call_scope_id)?.node_id === 'retained_pr_merge_capture');
  require(capture.contract_version === 'process-control-inbox.v3' && capture.inbox_id === entry.capture_id
    && capture.phase === 'reserved' && capture.delivered_instance_sha256 === null
    && capture.request.instance_id === instance.instance_id && capture.request.instance_sha256 === instance.instance_sha256
    && capture.request.model_sha256 === instance.model_sha256 && capture.request.scope_id === instance.scope_id
    && capture.request.instance_revision === instance.revision && capture.request.occurrence_id === waits[0].occurrence_id
    && reservation.contract_version === 'process-control-reservation.v1' && reservation.inbox_id === controlReservationId(capture.request)
    && reservation.capture_id === capture.inbox_id && reservation.selection_sha256 === controlSelectionDigest(capture)
    && H(reservation.request) === H(capture.request) && reservation.source_ref === capture.source_ref);
  assertExternalMergeControl(capture.payload, capture.source, capture.request);
  require(Number.isSafeInteger(now) && now >= Date.parse(capture.payload.provider.observed_until) + externalMergeMaxAgeMs,
    'STANDARD_RETAINED_MERGE_CAPTURE_STILL_LIVE');
  return { wait: waits[0], entryRecord: record };
}
