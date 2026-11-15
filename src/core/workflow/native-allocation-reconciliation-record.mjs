import schema from '../contracts/workflow-definition/native-allocation-reconciliation-record.v1.schema.json' with { type: 'json' };
import schemaV2 from '../contracts/workflow-definition/native-allocation-reconciliation-record.v2.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import { assertNativeAllocationJournal, nativeJournalPath } from './native-allocation-journal.mjs';
import { assertNativeAuthorization, nativeLimitsOf } from './native-authorization-epoch.mjs';
import { assertNativeReconciliationRequest, isNativePostAssignmentReconciliation } from './native-allocation-reconciliation.mjs';
import { assertNativePostAssignmentAssessment } from './native-post-assignment-assessment.mjs';
import { assertProcessReconciliationInventory } from './process-reconciliation-inventory.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
export function nativeReconciliationId(journalId, generation) {
  nativeJournalPath(journalId);
  if (!Number.isSafeInteger(generation) || generation < 1 || generation > 32) fail('NATIVE_RECONCILIATION_ID_INVALID');
  return journalId + '_g' + generation;
}
export function nativeReconciliationPath(id) {
  if (!/^native_[a-f0-9]{40}_g([1-9]|[12][0-9]|3[0-2])$/.test(id ?? '')) fail('NATIVE_RECONCILIATION_ID_INVALID');
  return 'workflows/native-allocation-reconciliations/' + id + '.json';
}
export function assertNativeReconciliationPreparation(value) {
  if (checkShadowJson(value) || !value || Object.keys(value).sort().join(',') !== 'inventory,request') fail('NATIVE_RECONCILIATION_PREPARATION_INVALID');
  const q = assertNativeReconciliationRequest(value.request), inventory = assertProcessReconciliationInventory(value.inventory);
  if (H(inventory) !== q.inventory_sha256 || ['instance_id', 'instance_sha256', 'scope_id', 'model_sha256', 'configuration_sha256', 'physical_root_sha256', 'key_id']
    .some(key => inventory[key] !== q[key])) fail('NATIVE_RECONCILIATION_PREPARATION_CHANGED');
  if (isNativePostAssignmentReconciliation(q)) assertNativePostAssignmentAssessment(q.post_assignment_assessment, inventory);
  return value;
}
export function assertNativeReconciliationRecord(value) {
  if (checkShadowJson(value)) fail('NATIVE_RECONCILIATION_RECORD_INVALID');
  const post = value?.contract_version === 'native-allocation-reconciliation-record.v2';
  if (validateJsonSchema(value, post ? schemaV2 : schema, '$', { contractKind: 'workflow-definition' }).length)
    fail('NATIVE_RECONCILIATION_RECORD_INVALID');
  const q = value.request, original = assertNativeAllocationJournal(value.original_journal), attempts = value.attempts, last = attempts.at(-1);
  assertNativeReconciliationPreparation({ request: q, inventory: value.inventory }); assertNativeAuthorization(value.initial_authorization);
  if (post !== isNativePostAssignmentReconciliation(q) || post && value.profile !== q.profile
    || value.reconciliation_id !== nativeReconciliationId(q.journal_id, q.generation)
    || ['journal_id', 'generation', 'instance_id', 'scope_id', 'model_sha256', 'key_id'].some(key => value[key] !== q[key])
    || H(original) !== q.journal_sha256 || original.allocations.length !== q.generation || original.allocations.at(-1).phase !== 'failed'
    || H(original.allocations) !== q.allocations_sha256 || H(original.allocations.at(-1)) !== q.allocation_sha256
    || original.initial_authorization && H(original.initial_authorization) !== H(value.initial_authorization)
    || !original.initial_authorization && (H(value.initial_authorization) !== original.allocations[0].authorization_sha256
      || H(nativeLimitsOf(value.initial_authorization)) !== H(original.allocations[0].limits))
    || new Set(attempts.map(row => row.attempt_id)).size !== attempts.length) fail('NATIVE_RECONCILIATION_RECORD_SUBJECT_CHANGED');
  for (const row of attempts) {
    const proposal = assertNativeAllocationJournal(row.proposal), receipt = proposal.reconciliations?.at(-1);
    const origin = post ? original.contract_version === 'native-allocation-journal.v5' ? original.origin_journal : original
      : original.contract_version === 'native-allocation-journal.v4' ? original.origin_journal : original;
    if (proposal.contract_version !== (post ? 'native-allocation-journal.v5' : 'native-allocation-journal.v4') || H(receipt?.request) !== H(q)
      || ['journal_id', 'instance_id', 'scope_id', 'model_sha256', 'key_id'].some(key => proposal[key] !== value[key])
      || proposal.revision !== original.revision + 1 || H(proposal.allocations) !== H(original.allocations)
      || H(proposal.epochs) !== H(original.epochs ?? []) || H(proposal.initial_authorization) !== H(value.initial_authorization)
      || H(proposal.origin_journal) !== H(origin)
      || proposal.reconciliations.length !== (original.reconciliations?.length ?? 0) + 1
      || H(proposal.reconciliations.slice(0, -1)) !== H(original.reconciliations ?? [])
      || row.operator_grant.request_sha256 !== H(q) || row.operator_verification.request_sha256 !== H(q)
      || row.operator_verification.grant_sha256 !== H(row.operator_grant) || row.operator_verification.authority_id !== row.operator_grant.authority_id
      || H(row.process_identity) !== H(row.fence_intention.record.process_identity)
      || row.fence_intention.record.state !== 'held' || row.fence_intention.record.physical_root_sha256 !== q.physical_root_sha256
      || row.lease !== null && (H(row.lease.record) !== H(row.fence_intention.record) || row.lease.previous_sha256 !== row.fence_intention.previous_sha256)
      || row.commit_sha256 !== null && (row.lease === null || row.commit_sha256 !== H(proposal))
      || row.released_fence !== null && (row.lease === null || row.commit_sha256 === null
        || H(row.released_fence.record) !== H({ ...row.lease.record, state: 'released', revision: row.lease.record.revision + 1 }))
      || row !== last && row.released_fence !== null || row.resource_source_ref === null && value.commit === null)
      fail('NATIVE_RECONCILIATION_RECORD_ATTEMPT_CHANGED');
  }
  const commit = value.commit, producer = commit === null ? null : attempts.find(row => row.attempt_id === commit.proposal_attempt_id);
  if (commit !== null && (!producer?.lease || H(producer.proposal) !== commit.proposal_sha256
      || H(producer.proposal.reconciliations.at(-1)) !== commit.receipt_sha256)
    || value.phase === 'intent' && last.lease !== null
    || value.phase === 'acquired' && (last.lease === null || last.commit_sha256 !== null)
    || ['committed', 'confirmed'].includes(value.phase) && (last.lease === null || last.commit_sha256 === null || commit === null)
    || last.commit_sha256 !== null && last.commit_sha256 !== commit?.proposal_sha256
    || value.phase === 'confirmed' !== (last.released_fence !== null)) fail('NATIVE_RECONCILIATION_RECORD_PHASE_CHANGED');
  return value;
}
export function retainedNativeReconciliationReceipt(record) {
  assertNativeReconciliationRecord(record);
  if (record.commit === null) return null;
  return record.attempts.find(row => row.attempt_id === record.commit.proposal_attempt_id).proposal.reconciliations.at(-1);
}
