import assert from 'node:assert/strict';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { assertNativeAllocationAssessment } from '../../src/core/workflow/native-allocation-assessment.mjs';
import { assertNativePostAssignmentAssessment, nativePostAssignmentEvidenceProfile } from '../../src/core/workflow/native-post-assignment-assessment.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

// Closed-data cases only. The caller supplies the ordinary synthetic failed
// fixture observation. This function creates no Native resource or authority.
export function verifyNativePostAssignmentAssessmentContracts(original, check) {
  const signer = createOperationJournalSigner(() => Buffer.alloc(32, 119));
  const { authentication, key_id, ...inventoryBody } = structuredClone(original.inventory);
  const allocation = inventoryBody.resources.find(r => r.kind === 'native_allocation');
  const journal = inventoryBody.resources.find(r => r.ref === 'native:' + original.assessment.journal_id);
  const dispatch = inventoryBody.resources.find(r => r.ref === 'native-dispatch:' + original.assessment.dispatch_id);
  allocation.ref = 'native:' + original.assessment.journal_id + '/2';
  allocation.details.generation = 2;
  allocation.details.initial_instance_sha256 = H('synthetic-initial-prefix-before-accepted-native-work');
  const inventory = signer.seal(inventoryBody);
  const { authentication: ignoredAuth, key_id: ignoredKey, ...body } = structuredClone(original.assessment);
  const base = signer.seal({ ...body, generation: 2, inventory_sha256: H(inventory),
    journal_sha256: journal.sha256, dispatch_sha256: dispatch.sha256, allocation_sha256: allocation.sha256,
    initial_instance_sha256: allocation.details.initial_instance_sha256, assignment_status: 'unknown',
    checkpoint: { ...body.checkpoint, responses_observed: 1, resources: 3, results: 4 } });
  assertNativeAllocationAssessment(base, inventory);
  const work = { prefix_relation: 'match', checkpoint_event_count: 9, current_event_count: 9,
    prior_checkpoint_sha256: H('synthetic-admitted-previous-checkpoint'),
    prior_resources: 2, total_resources: 3, generation_resources: 1,
    prior_results: 3, total_results: 4, generation_results: 1, generation_assignments: 1,
    unresolved_assignments: 0, history_preserved: true, worker_checkpoint_matches: true,
    worker_parent_closed: true, worker_generation_resources: 1, consumption_matches: true };
  const seal = (b, w) => signer.seal({ contract_version: 'native-post-assignment-assessment.v1', base_assessment: b,
    checkpoint_work: w, evidence_profile: nativePostAssignmentEvidenceProfile(b, w), business_effect: 'unknown',
    complete_resource_closure: false, permits_effects: false, permits_resume: false,
    permits_native_renewal: false, permits_owner_retirement: false, written: false });
  const valid = seal(base, work);
  assertNativePostAssignmentAssessment(valid, inventory);
  assert.equal(valid.evidence_profile, 'admitted_closed_checkpoint');
  check('post-assignment data retains cumulative resources3/results4 and generation-local closure1');
  for (const [name, mutate] of [
    ['effects', v => { v.permits_effects = true; }], ['resume', v => { v.permits_resume = true; }],
    ['renewal', v => { v.permits_native_renewal = true; }], ['retirement', v => { v.permits_owner_retirement = true; }],
    ['complete closure', v => { v.complete_resource_closure = true; }], ['write', v => { v.written = true; }],
    ['business success', v => { v.business_effect = 'confirmed'; }], ['JSON callback', v => { v.observer = {}; }],
    ['foreign key', v => { v.key_id = H('foreign-key'); }], ['foreign prefix', v => { v.base_assessment.instance_sha256 = H('foreign-prefix'); }],
    ['missing work property', v => { delete v.checkpoint_work.worker_parent_closed; }],
    ['resource refund', v => { v.checkpoint_work.generation_resources = 0; }],
    ['result refund', v => { v.checkpoint_work.generation_results = 0; }],
    ['ahead checkpoint', v => { v.checkpoint_work.current_event_count = 8; }],
    ['false extension', v => { v.checkpoint_work.prefix_relation = 'canonical_extension'; }],
    ['missing prior generation', v => { v.checkpoint_work.prior_checkpoint_sha256 = null; }],
  ]) {
    const value = structuredClone(valid); mutate(value);
    assert.throws(() => assertNativePostAssignmentAssessment(value, inventory), e => /NATIVE_.*ASSESSMENT_/.test(e.code));
    check('post-assignment data refuses ' + name);
  }
  for (const [name, mutate] of [
    ['missing worker checkpoint', w => { w.worker_checkpoint_matches = false; }],
    ['missing worker closure', w => { w.worker_parent_closed = false; }],
    ['cumulative closure count', w => { w.worker_generation_resources = 3; }],
    ['unknown closure count', w => { w.worker_generation_resources = null; }],
    ['unknown consumption', w => { w.consumption_matches = false; }],
    ['changed history', w => { w.history_preserved = false; }],
    ['unresolved assignment', w => { w.unresolved_assignments = 1; }],
    ['no generation assignment', w => { w.generation_assignments = 0; }],
  ]) {
    const changed = structuredClone(work); mutate(changed);
    const value = seal(base, changed);
    assertNativePostAssignmentAssessment(value, inventory); assert.equal(value.evidence_profile, 'unknown');
    const forged = { ...value, evidence_profile: 'admitted_closed_checkpoint' };
    assert.throws(() => assertNativePostAssignmentAssessment(forged, inventory), { code: 'NATIVE_POST_ASSIGNMENT_ASSESSMENT_INVALID' });
    check('post-assignment incomplete ' + name + ' stays unknown and cannot claim complete evidence');
  }
  assert.equal(assertNativePostAssignmentAssessment(seal(base, null), inventory).evidence_profile, 'unknown');
  check('post-assignment missing admitted work remains unknown');
  assert.throws(() => assertNativeAllocationAssessment(valid, inventory), { code: 'NATIVE_ALLOCATION_ASSESSMENT_INVALID' });
  check('legacy no-assignment assessment does not reinterpret the new profile');
  return { checks: 27, native_calls: 0, authority: 'synthetic_closed_data_only' };
}
