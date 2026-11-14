import requestSchema from '../contracts/workflow-definition/native-allocation-reconciliation-request.v1.schema.json' with { type: 'json' };
import grantSchema from '../contracts/workflow-definition/native-allocation-reconciliation-grant.v1.schema.json' with { type: 'json' };
import receiptSchema from '../contracts/workflow-definition/native-allocation-reconciliation-receipt.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema, code) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length) fail(code);
  return value;
};
export function assertNativeReconciliationRequest(value) {
  valid(value, requestSchema, 'NATIVE_RECONCILIATION_REQUEST_INVALID');
  const allocation = value.resources.find(row => row.kind === 'allocation'), scope = value.resources.find(row => row.kind === 'native_scope');
  if (value.resources.length !== 2 || !allocation || !scope || allocation.generation !== value.generation
    || allocation.closure_sha256 !== value.closure_sha256 || allocation.checkpoint_sha256 !== value.checkpoint_sha256
    || scope.instance_id !== value.instance_id || scope.scope_id !== value.scope_id
    || scope.configuration_sha256 !== value.configuration_sha256) fail('NATIVE_RECONCILIATION_INVENTORY_CHANGED');
  return value;
}
export function assertNativeReconciliationGrant(value, request) {
  assertNativeReconciliationRequest(request); valid(value, grantSchema, 'NATIVE_RECONCILIATION_GRANT_INVALID');
  const closure = value.closure;
  if (value.request_sha256 !== H(request) || closure.request_sha256 !== H(request)
    || closure.inventory_sha256 !== H(request.resources) || closure.resources.length !== request.resources.length
    || H(closure.resources.map(row => row.resource_sha256).sort()) !== H(request.resources.map(H).sort())
    || closure.observed_at_ms < request.prepared_at_ms
    || value.consumption.storage_debit_bytes < request.minimum_consumption.storage_debit_bytes)
    fail('NATIVE_RECONCILIATION_GRANT_UNBOUND');
  return value;
}
// Closed data does not authenticate a source or establish live closure. The
// trusted writer must verify the independent source and current subject before
// sealing a receipt; readers must authenticate the containing journal/receipt.
export function assertNativeReconciliationReceipt(value, { journal, entry } = {}) {
  valid(value, receiptSchema, 'NATIVE_RECONCILIATION_RECEIPT_INVALID');
  const request = assertNativeReconciliationRequest(value.request), grant = assertNativeReconciliationGrant(value.grant, request), proof = value.verification;
  if (proof.authority_id !== grant.authority_id || proof.request_sha256 !== H(request) || proof.grant_sha256 !== H(grant)
    || proof.evidence_class !== grant.closure.evidence_class || value.confirmed_at_ms < grant.closure.observed_at_ms)
    fail('NATIVE_RECONCILIATION_SOURCE_UNBOUND');
  if (journal && (request.journal_id !== journal.journal_id || request.instance_id !== journal.instance_id
    || request.scope_id !== journal.scope_id || request.model_sha256 !== journal.model_sha256
    || request.allocations_sha256 !== H(journal.allocations.slice(0, request.generation))))
    fail('NATIVE_RECONCILIATION_SUBJECT_CHANGED');
  if (entry) {
    const minimum = entry.consumption ?? { responses_observed: 0, response_sha256: [], storage_debit_bytes: 0, native_usage_sha256: null };
    const allocation = request.resources.find(row => row.kind === 'allocation');
    if (entry.generation !== request.generation || entry.phase !== 'failed' || !entry.tree_closed
      || H(entry) !== request.allocation_sha256 || entry.configuration_sha256 !== request.configuration_sha256
      || entry.initial_instance_sha256 !== request.instance_sha256 || request.prepared_at_ms < entry.limits.authorized_at_ms
      || entry.checkpoint === null || entry.closure_ref === null
      || entry.checkpoint.instance_sha256 !== entry.initial_instance_sha256 || entry.checkpoint.sha256 !== request.checkpoint_sha256
      || entry.checkpoint.state_sha256 !== request.checkpoint_state_sha256 || entry.closure_ref.sha256 !== request.closure_sha256
      || allocation.owner_id !== entry.owner_id || H(minimum) !== H(request.minimum_consumption))
      fail('NATIVE_RECONCILIATION_SUBJECT_CHANGED');
  }
  return value;
}
export function nativeAllocationResolution(entry, reconciliations = []) {
  if (entry.phase === 'closed') return entry.consumption ? { kind: 'ordinary', consumption: entry.consumption } : null;
  const matches = reconciliations.filter(row => row.request?.generation === entry.generation);
  if (!matches.length) return null;
  if (matches.length !== 1) fail('NATIVE_RECONCILIATION_DUPLICATE');
  const receipt = assertNativeReconciliationReceipt(matches[0], { entry });
  return { kind: 'reconciled_no_assignment', consumption: receipt.grant.consumption };
}
