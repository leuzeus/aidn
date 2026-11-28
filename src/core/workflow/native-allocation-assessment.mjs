import schema from '../contracts/workflow-definition/native-allocation-assessment.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';
import { assertProcessReconciliationInventory } from './process-reconciliation-inventory.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };

export function nativeCheckpointHasNoNewWork(checkpoint) {
  return checkpoint.inherited_checkpoint_sha256 === undefined
    ? checkpoint.resources === 0 && checkpoint.results === 0
    : checkpoint.inherited_checkpoint_sha256 !== null;
}

// This reader checks DATA consistency. The fixed runtime host separately
// authenticates the original journal, checkpoint, dispatch and inventory MACs.
export function assertNativeAllocationAssessment(value, inventory) {
  assertProcessReconciliationInventory(inventory);
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    fail('NATIVE_ALLOCATION_ASSESSMENT_INVALID');
  const journal = inventory.resources.find(row => row.ref === 'native:' + value.journal_id);
  const allocation = inventory.resources.find(row => row.ref === `native:${value.journal_id}/${value.generation}`);
  const dispatch = inventory.resources.find(row => row.ref === 'native-dispatch:' + value.dispatch_id);
  if (value.instance_id !== inventory.instance_id || value.instance_sha256 !== inventory.instance_sha256
    || value.inventory_sha256 !== shadowHash(inventory) || value.key_id !== inventory.key_id
    || value.observed_at_ms !== inventory.observed_at_ms || value.configuration_sha256 !== inventory.configuration_sha256
    || value.journal_sha256 !== journal?.sha256 || value.allocation_sha256 !== allocation?.sha256
    || value.allocation_phase !== allocation?.details.phase || value.dispatch_sha256 !== dispatch?.sha256
    || journal?.kind !== 'native_journal' || allocation?.kind !== 'native_allocation' || dispatch?.kind !== 'native_journal'
    || value.initial_instance_sha256 !== allocation?.details.initial_instance_sha256
    || dispatch?.details.record_kind !== 'native_dispatch' || dispatch.details.kind !== 'allocation'
    || dispatch.details.journal_id !== value.journal_id || value.native_accounting_known !== inventory.accounting.native_known
    || shadowHash(value.lease_statuses) !== shadowHash(dispatch.details.leases.map(row => row.status)))
    fail('NATIVE_ALLOCATION_ASSESSMENT_SUBJECT_CHANGED');
  const checkpoint = value.checkpoint, inherited = checkpoint?.inherited_checkpoint_sha256;
  if (inherited !== undefined && value.generation === 1) fail('NATIVE_ALLOCATION_ASSESSMENT_INVALID');
  if (inherited != null) {
    const previous = inventory.resources.find(row => row.ref === 'native:' + value.journal_id + '/' + (value.generation - 1));
    if (previous?.kind !== 'native_allocation' || previous.details.generation !== value.generation - 1
      || previous.details.checkpoint?.sha256 !== inherited || !previous.details.closure_ref?.sha256
      || !previous.details.tree_closed || !previous.details.accounting_known)
      fail('NATIVE_ALLOCATION_ASSESSMENT_SUBJECT_CHANGED');
  }
  const noAssignment = value.allocation_phase === 'failed' && dispatch.details.phase === 'returned'
    && value.return_binding === 'matched' && checkpoint !== null && checkpoint.parent_closed
    && checkpoint.os_tree_confirmed && checkpoint.instance_sha256 === value.initial_instance_sha256
    && checkpoint.responses_observed === 0 && nativeCheckpointHasNoNewWork(checkpoint);
  if ((value.assignment_status === 'no_assignment') !== noAssignment
    || value.return_binding === 'matched' && (value.allocation_phase !== 'failed' || checkpoint === null
      || dispatch.details.phase !== 'returned')
    || checkpoint !== null && (checkpoint.sha256 !== allocation.details.checkpoint?.sha256
      || checkpoint.state_sha256 !== allocation.details.checkpoint?.state_sha256
      || checkpoint.instance_sha256 !== allocation.details.checkpoint?.instance_sha256
      || checkpoint.closure_sha256 !== allocation.details.closure_ref?.sha256))
    fail('NATIVE_ALLOCATION_ASSESSMENT_INVALID');
  return value;
}
