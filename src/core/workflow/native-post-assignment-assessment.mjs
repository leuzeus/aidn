import schema from '../contracts/workflow-definition/native-post-assignment-assessment.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { assertNativeAllocationAssessment } from './native-allocation-assessment.mjs';
import { checkShadowJson } from './shadow-json.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };

// This is a data classification, not authority to retire resources or to resume.
export function nativePostAssignmentEvidenceProfile(base, work) {
  const closed = base.allocation_phase === 'failed' && base.return_binding === 'matched'
    && base.checkpoint !== null && base.checkpoint.parent_closed && base.checkpoint.os_tree_confirmed
    && base.checkpoint.responses_observed > 0 && work !== null && work.history_preserved
    && work.generation_resources > 0 && work.worker_checkpoint_matches && work.worker_parent_closed
    && work.worker_generation_resources === work.generation_resources && work.consumption_matches;
  if (!closed) return 'unknown';
  const interrupted = work.interrupted_assignment;
  if (interrupted) return work.prefix_relation === 'match' && work.generation_assignments === 1
    && work.generation_results === 0 && work.unresolved_assignments === 1 && work.generation_resources === 1
    && interrupted.initial_instance_sha256 === base.initial_instance_sha256
    && interrupted.product_preimage_sha256 === interrupted.observed_product_sha256
    && interrupted.authorized_responses < base.checkpoint.responses_observed
    ? 'admitted_interrupted_checkpoint' : 'unknown';
  return work.generation_assignments > 0 && work.generation_results === work.generation_assignments
    && work.unresolved_assignments === 0 ? 'admitted_closed_checkpoint' : 'unknown';
}

export function nativePostAssignmentCanReconcileResources(assessment) {
  return ['admitted_closed_checkpoint', 'admitted_interrupted_checkpoint'].includes(assessment.evidence_profile);
}

function assertWork(value) {
  const base = value.base_assessment, work = value.checkpoint_work;
  if (value.key_id !== base.key_id || value.evidence_profile !== nativePostAssignmentEvidenceProfile(base, work))
    fail('NATIVE_POST_ASSIGNMENT_ASSESSMENT_INVALID');
  if (work !== null && (base.checkpoint === null || work.total_resources !== base.checkpoint.resources
    || work.total_results !== base.checkpoint.results || work.total_resources < work.prior_resources
    || work.total_results < work.prior_results || work.generation_resources !== work.total_resources - work.prior_resources
    || work.generation_results !== work.total_results - work.prior_results
    || work.current_event_count < work.checkpoint_event_count
    || (work.prefix_relation === 'match') !== (base.instance_sha256 === base.checkpoint.instance_sha256)
    || (work.prefix_relation === 'match') !== (work.current_event_count === work.checkpoint_event_count)
    || (work.prior_checkpoint_sha256 === null) !== (base.generation === 1)
    || base.generation === 1 && (work.prior_resources !== 0 || work.prior_results !== 0)))
    fail('NATIVE_POST_ASSIGNMENT_ASSESSMENT_SUBJECT_CHANGED');
  return value;
}

// Closed retained DATA can check its own work counters without supplying an
// inventory capability. Preparation separately authenticates that inventory.
export function assertNativePostAssignmentEvidence(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    fail('NATIVE_POST_ASSIGNMENT_ASSESSMENT_INVALID');
  return assertWork(value);
}

export function assertNativePostAssignmentAssessment(value, inventory) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    fail('NATIVE_POST_ASSIGNMENT_ASSESSMENT_INVALID');
  assertNativeAllocationAssessment(value.base_assessment, inventory);
  return assertWork(value);
}
