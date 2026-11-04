import { assertWorkProductSnapshot } from '../../core/workflow/standard-cycle-work.mjs';
import { standardPrTriageItems } from '../../core/workflow/standard-pr-triage.mjs';
import { shadowHash, checkShadowJson } from '../../core/workflow/shadow-json.mjs';
const fail = code => { throw Object.assign(Error(code), { code }); };

// Selection is a signed accepted host operation. Its provider observations were
// collected by actual application ports, never supplied by the authored IR.
export function buildStandardPrTriageContext({ selection, resolution, productSha256, productSnapshot, scope }) {
  assertWorkProductSnapshot(productSnapshot);
  const selected = selection.output.observations;
  if (selection.output.outcome !== 'completed' || selection.output.facts.session_pr_triage_source_selected !== true
    || selection.output.effect_status !== 'no_effect' || selected.product_sha256 !== productSha256
    || selected.received_operation_id !== selection.record.preview.input.received_operation_id
    || resolution.input.selection_operation_id !== selection.record.operation_id
    || shadowHash(productSnapshot) !== productSha256 || selected.payload_sha256 !== shadowHash(selected.payload)
    || scope.context.head !== selected.payload.event.head_oid || scope.context.branch !== selected.payload.event.head_ref)
    fail('STANDARD_PR_TRIAGE_SELECTION_STALE');
  const evidence = [...productSnapshot.filter(row => row.present).map(row => ({ ref: 'product:' + row.path, sha256: row.sha256 })),
    { ref: 'process:pr-review-payload', sha256: selected.payload_sha256 },
    ...standardPrTriageItems(selected.payload).map(row => ({ ref: 'github:' + row.kind + '/' + row.node_id, sha256: row.body_sha256 }))];
  if (new Set(evidence.map(row => row.ref)).size !== evidence.length) fail('STANDARD_PR_TRIAGE_EVIDENCE_AMBIGUOUS');
  const context = { contract_version: 'standard-pr-triage-context.v1', selection_operation_id: selection.record.operation_id,
    received_operation_id: selected.received_operation_id, payload_sha256: selected.payload_sha256,
    payload: selected.payload, product_sha256: productSha256, product_files: productSnapshot,
    input_resolution: resolution, evidence_refs: evidence };
  if (checkShadowJson(context) || Buffer.byteLength(JSON.stringify(context)) > 196608) fail('STANDARD_PR_TRIAGE_CONTEXT_LIMIT');
  return { context, context_sha256: shadowHash(context) };
}
