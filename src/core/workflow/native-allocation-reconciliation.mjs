import requestSchema from '../contracts/workflow-definition/native-allocation-reconciliation-request.v1.schema.json' with { type: 'json' };
import grantSchema from '../contracts/workflow-definition/native-allocation-reconciliation-grant.v1.schema.json' with { type: 'json' };
import receiptSchema from '../contracts/workflow-definition/native-allocation-reconciliation-receipt.v1.schema.json' with { type: 'json' };
import requestSchemaV2 from '../contracts/workflow-definition/native-allocation-reconciliation-request.v2.schema.json' with { type: 'json' };
import grantSchemaV2 from '../contracts/workflow-definition/native-allocation-reconciliation-grant.v2.schema.json' with { type: 'json' };
import receiptSchemaV2 from '../contracts/workflow-definition/native-allocation-reconciliation-receipt.v2.schema.json' with { type: 'json' };
import { assertNativePostAssignmentEvidence, nativePostAssignmentCanReconcileResources } from './native-post-assignment-assessment.mjs';
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema, code) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length) fail(code);
  return value;
};
export const isNativePostAssignmentReconciliation = request => request?.contract_version === 'native-allocation-reconciliation-request.v2';
export const isInterruptedNativeReconciliation = request => isNativePostAssignmentReconciliation(request)
  && request.post_assignment_assessment?.evidence_profile === 'admitted_interrupted_checkpoint';
export function nativeReconciliationPostAssignmentSubject(assessment) {
  const { authentication, key_id, base_assessment, ...value } = assessment;
  const { authentication: baseAuthentication, key_id: baseKey, observed_at_ms, inventory_sha256, ...base } = base_assessment;
  return { ...value, base_assessment: base };
}
function consumption(value, code) {
  if (value.responses_observed !== value.response_sha256.length || new Set(value.response_sha256).size !== value.response_sha256.length) fail(code);
}
export function assertNativeReconciliationRequest(value) {
  if (checkShadowJson(value)) fail('NATIVE_RECONCILIATION_REQUEST_INVALID');
  const post = isNativePostAssignmentReconciliation(value);
  valid(value, post ? requestSchemaV2 : requestSchema, 'NATIVE_RECONCILIATION_REQUEST_INVALID');
  const allocation = value.resources.find(row => row.kind === 'allocation'), scope = value.resources.find(row => row.kind === 'native_scope');
  if ((!post && value.resources.length !== 2) || !allocation || !scope || allocation.generation !== value.generation
    || allocation.closure_sha256 !== value.closure_sha256 || allocation.checkpoint_sha256 !== value.checkpoint_sha256
    || scope.instance_id !== value.instance_id || scope.scope_id !== value.scope_id
    || scope.configuration_sha256 !== value.configuration_sha256) fail('NATIVE_RECONCILIATION_INVENTORY_CHANGED');
  if (post) {
    const assessment = assertNativePostAssignmentEvidence(value.post_assignment_assessment), base = assessment.base_assessment, checkpoint = base.checkpoint, work = assessment.checkpoint_work;
    const sessions = value.resources.filter(row => row.kind === 'native_session');
    consumption(value.minimum_consumption, 'NATIVE_RECONCILIATION_CONSUMPTION_CHANGED');
    if (!nativePostAssignmentCanReconcileResources(assessment)
      || base.assignment_status !== 'unknown'
      || value.post_assignment_sha256 !== H(nativeReconciliationPostAssignmentSubject(assessment))
      || assessment.key_id !== value.key_id || base.key_id !== value.key_id
      || ['instance_id', 'instance_sha256', 'configuration_sha256', 'inventory_sha256', 'journal_id', 'journal_sha256', 'allocation_sha256', 'generation', 'dispatch_id', 'dispatch_sha256', 'initial_instance_sha256'].some(key => value[key] !== base[key])
      || value.checkpoint_sha256 !== checkpoint.sha256 || value.checkpoint_state_sha256 !== checkpoint.state_sha256
      || value.checkpoint_instance_sha256 !== checkpoint.instance_sha256 || value.closure_sha256 !== checkpoint.closure_sha256
      || value.initial_instance_sha256 === value.instance_sha256 || value.initial_instance_sha256 === value.checkpoint_instance_sha256
      || value.checkpoint_resource_count !== checkpoint.resources || value.checkpoint_resource_count !== work.total_resources
      || value.minimum_consumption.responses_observed !== checkpoint.responses_observed
      || sessions.length !== value.checkpoint_resource_count || value.resources.length !== sessions.length + 2
      || new Set(value.resources.map(H)).size !== value.resources.length
      || new Set(sessions.map(row => row.execution_id)).size !== sessions.length
      || new Set(sessions.map(row => row.session_id)).size !== sessions.length)
      fail('NATIVE_RECONCILIATION_POST_ASSIGNMENT_CHANGED');
  }
  return value;
}
export function assertNativeReconciliationGrant(value, request) {
  assertNativeReconciliationRequest(request);
  const post = isNativePostAssignmentReconciliation(request);
  valid(value, post ? grantSchemaV2 : grantSchema, 'NATIVE_RECONCILIATION_GRANT_INVALID');
  const closure = value.closure;
  if (value.request_sha256 !== H(request) || closure.request_sha256 !== H(request)
    || closure.inventory_sha256 !== H(request.resources) || closure.resources.length !== request.resources.length
    || H(closure.resources.map(row => row.resource_sha256).sort()) !== H(request.resources.map(H).sort())
    || closure.observed_at_ms < request.prepared_at_ms
    || value.consumption.storage_debit_bytes < request.minimum_consumption.storage_debit_bytes)
    fail('NATIVE_RECONCILIATION_GRANT_UNBOUND');
  // A zero-response worker can still seal its empty usage observation. Keep
  // that exact digest through reconciliation instead of dropping its evidence.
  if (!post && value.consumption.native_usage_sha256 !== request.minimum_consumption.native_usage_sha256)
    fail('NATIVE_RECONCILIATION_CONSUMPTION_CHANGED');
  if (post) {
    const minimum = request.minimum_consumption, actual = value.consumption;
    consumption(actual, 'NATIVE_RECONCILIATION_CONSUMPTION_CHANGED');
    if (value.profile !== request.profile || value.post_assignment_sha256 !== request.post_assignment_sha256
      || actual.responses_observed < minimum.responses_observed
      || H(actual.response_sha256.slice(0, minimum.responses_observed)) !== H(minimum.response_sha256)
      || minimum.native_usage_sha256 !== null && actual.native_usage_sha256 === null)
      fail('NATIVE_RECONCILIATION_CONSUMPTION_CHANGED');
  }
  return value;
}
// Closed data does not authenticate a source or establish live closure. The
// trusted writer must verify the independent source and current subject before
// sealing a receipt; readers must authenticate the containing journal/receipt.
export function assertNativeReconciliationReceipt(value, { journal, entry } = {}) {
  if (checkShadowJson(value)) fail('NATIVE_RECONCILIATION_RECEIPT_INVALID');
  const post = value?.contract_version === 'native-allocation-reconciliation-receipt.v2';
  valid(value, post ? receiptSchemaV2 : receiptSchema, 'NATIVE_RECONCILIATION_RECEIPT_INVALID');
  const request = assertNativeReconciliationRequest(value.request), grant = assertNativeReconciliationGrant(value.grant, request), proof = value.verification;
  if (post !== isNativePostAssignmentReconciliation(request)
    || proof.authority_id !== grant.authority_id || proof.request_sha256 !== H(request) || proof.grant_sha256 !== H(grant)
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
      || entry.initial_instance_sha256 !== (post ? request.initial_instance_sha256 : request.instance_sha256) || request.prepared_at_ms < entry.limits.authorized_at_ms
      || entry.checkpoint === null || entry.closure_ref === null
      || entry.checkpoint.instance_sha256 !== (post ? request.checkpoint_instance_sha256 : entry.initial_instance_sha256) || entry.checkpoint.sha256 !== request.checkpoint_sha256
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
  const kind = isInterruptedNativeReconciliation(receipt.request) ? 'reconciled_interrupted_assignment'
    : isNativePostAssignmentReconciliation(receipt.request) ? 'reconciled_post_assignment' : 'reconciled_no_assignment';
  return { kind, consumption: receipt.grant.consumption };
}
