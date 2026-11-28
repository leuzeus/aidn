import { assertNativeAllocationAssessment, nativeCheckpointHasNoNewWork } from '../../core/workflow/native-allocation-assessment.mjs';
import { assertNativeAllocationJournal, nativeJournalId } from '../../core/workflow/native-allocation-journal.mjs';
import { assertNativeDispatchRecord, nativeDispatchPath } from '../../core/workflow/native-dispatch-record.mjs';
import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { readNativeAllocationCheckpoint } from './native-allocation-evidence.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { observeNativeInheritedCheckpoint } from './standard-native-post-assignment-assessment.mjs';
import { observeReadOnlyNativeStorageStop } from './native-readonly-storage-interruption.mjs';
import { observeReadOnlyNativeRejectedAnswer } from './native-readonly-rejected-answer.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const stableInventory = ({ authentication, observed_at_ms, ...material }) => shadowHash(material);

// Constructor capabilities come only from the fixed common host. This returned
// observation has no writer, executor, grant, lease retirement or renewal port.
export function createStandardNativeAllocationAssessment({ artifacts, configuration, signer, capture }) {
  function readSubject(instance, inventory, dispatchId, generation) {
    const id = nativeJournalId(instance);
    const journalRow = artifacts.read(`workflows/native-allocations/${id}.json`, { required: true });
    const journal = assertNativeAllocationJournal(JSON.parse(journalRow.content)); signer.verify(journal);
    const dispatchRow = artifacts.read(nativeDispatchPath(dispatchId), { required: true });
    const dispatch = assertNativeDispatchRecord(JSON.parse(dispatchRow.content)); signer.verify(dispatch);
    const entry = journal.allocations.at(-1), journalHash = shadowHash(journal);
    if (!entry || entry.phase === 'closed' || entry.generation !== generation
      || journal.instance_id !== instance.instance_id || journal.scope_id !== instance.scope_id
      || journal.model_sha256 !== instance.model_sha256 || dispatch.kind !== 'allocation'
      || dispatch.journal_id !== journal.journal_id || dispatch.instance_id !== instance.instance_id
      || dispatch.scope_id !== journal.scope_id || dispatch.model_sha256 !== journal.model_sha256
      || dispatch.physical_root_sha256 !== shadowHash(artifacts.root)
      || dispatch.configuration_sha256 !== shadowHash(configuration) || entry.configuration_sha256 !== shadowHash(configuration)
      || dispatch.intent.authorization_sha256 !== entry.authorization_sha256
      || dispatch.instance_sha256 !== entry.initial_instance_sha256
      || dispatch.native_journal_after_sha256 !== null && dispatch.native_journal_after_sha256 !== journalHash
      || !inventory.resources.some(row => row.ref === 'native:' + id && row.sha256 === journalHash)
      || !inventory.resources.some(row => row.ref === 'native-dispatch:' + dispatchId && row.sha256 === shadowHash(dispatch)))
      fail('NATIVE_ALLOCATION_ASSESSMENT_SUBJECT_CHANGED');
    let checkpoint = null, closure = null;
    if (entry.checkpoint !== null && entry.closure_ref !== null) {
      const data = readNativeAllocationCheckpoint(entry, configuration, { scopeId: journal.scope_id, modelSha256: journal.model_sha256 });
      closure = readAgentRunFile(entry.closure_ref.path, { maxBytes: 262144 });
      if (closure.sha256 !== entry.closure_ref.sha256 || shadowHash(closure.value) !== entry.owned_result_sha256)
        fail('NATIVE_ALLOCATION_EVIDENCE_CHANGED');
      checkpoint = { sha256: entry.checkpoint.sha256, state_sha256: entry.checkpoint.state_sha256,
        instance_sha256: data.state.instance.instance_sha256, closure_sha256: closure.sha256,
        parent_closed: data.state.parent_closed, responses_observed: data.responses_observed,
        resources: data.state.resources.length, results: data.state.results.length,
        os_tree_confirmed: closure.value.process_tree?.termination_state === 'confirmed'
          && closure.value.process_tree?.termination_proof?.active_processes === 0
          && closure.value.global_deadline_ms === entry.limits.global_deadline_ms
          && closure.value.authorized_at_ms === entry.limits.authorized_at_ms };
    }
    // The allocator's normal failed return happens only after closing its human
    // controller. Matching that signed return is distinct from Job/PID absence.
    const returned = checkpoint && entry.phase === 'failed' && dispatch.phase === 'returned'
      && dispatch.native_journal_after_sha256 === journalHash
      && dispatch.result_sha256 === shadowHash({ contract_version: 'journaled-native-allocation-result.v1',
        owned_result: closure.value, journal_id: journal.journal_id, generation: entry.generation,
        journal_phase: 'failed', journal_sha256: journalHash, status: 'FAILED', first_failure: entry.first_failure, retry: false });
    const closedBeforeAssignment = returned && checkpoint.parent_closed && checkpoint.os_tree_confirmed
      && checkpoint.instance_sha256 === entry.initial_instance_sha256 && checkpoint.responses_observed === 0;
    if (closedBeforeAssignment && generation > 1) {
      const inheritedCheckpoint = observeNativeInheritedCheckpoint({ journal, entry, current: instance, configuration, inventory });
      // Preserve the original shape when the empty-checkpoint test gives the same answer.
      if ((inheritedCheckpoint !== null) !== nativeCheckpointHasNoNewWork(checkpoint))
        checkpoint.inherited_checkpoint_sha256 = inheritedCheckpoint;
    }
    const noAssignment = Boolean(closedBeforeAssignment && nativeCheckpointHasNoNewWork(checkpoint));
    return { journal_id: id, journal_sha256: journalHash, allocation_sha256: shadowHash(entry), generation: entry.generation,
      allocation_phase: entry.phase, initial_instance_sha256: entry.initial_instance_sha256,
      dispatch_id: dispatchId, dispatch_sha256: shadowHash(dispatch), checkpoint,
      return_binding: returned ? 'matched' : 'not_proven', assignment_status: noAssignment ? 'no_assignment' : 'unknown',
      native_accounting_known: inventory.accounting.native_known, lease_statuses: dispatch.leases.map(row => row.status) };
  }
  return Object.freeze({
    prepare(instanceId, input) {
      if (configuration === null || typeof capture !== 'function') fail('NATIVE_ALLOCATION_ASSESSMENT_AUTHORITY_REQUIRED');
      if (checkShadowJson(input) || !input || Array.isArray(input)
        || Object.keys(input).length !== 3 || !/^[a-f0-9]{64}$/.test(input.expectedSha256 ?? '')
        || !/^native_dispatch_[a-f0-9]{40}$/.test(input.dispatchId ?? '')
        || !Number.isSafeInteger(input.generation) || input.generation < 1)
        fail('NATIVE_ALLOCATION_ASSESSMENT_INPUT_INVALID');
      const before = capture(instanceId, input.expectedSha256);
      const material = readSubject(before.instance, before.inventory, input.dispatchId, input.generation);
      const after = capture(instanceId, input.expectedSha256);
      if (stableInventory(before.inventory) !== stableInventory(after.inventory)) fail('NATIVE_ALLOCATION_ASSESSMENT_OBSERVATION_CHANGED');
      const repeated = readSubject(after.instance, after.inventory, input.dispatchId, input.generation);
      if (shadowHash(material) !== shadowHash(repeated)) fail('NATIVE_ALLOCATION_ASSESSMENT_OBSERVATION_CHANGED');
      const assessment = assertNativeAllocationAssessment(signer.seal({ contract_version: 'native-allocation-assessment.v1',
        instance_id: after.instance.instance_id, instance_sha256: after.instance.instance_sha256,
        configuration_sha256: shadowHash(configuration), inventory_sha256: shadowHash(after.inventory),
        observed_at_ms: after.inventory.observed_at_ms, ...material, business_effect: 'unknown', complete_resource_closure: false,
        permits_effects: false, permits_resume: false, permits_native_renewal: false, permits_owner_retirement: false, written: false }), after.inventory);
      const diagnostic = { instance: after.instance, journal: JSON.parse(artifacts.read(
        'workflows/native-allocations/' + material.journal_id + '.json', { required: true }).content),
        configuration, signer, artifacts, productSha256: after.context.native.product_sha256, assessment };
      const readOnlyStorageStop = observeReadOnlyNativeStorageStop(diagnostic);
      const readOnlyRejectedAnswer = observeReadOnlyNativeRejectedAnswer(diagnostic);
      return { inventory: after.inventory, assessment, ...(readOnlyStorageStop ? { readOnlyStorageStop } : {}),
        ...(readOnlyRejectedAnswer ? { readOnlyRejectedAnswer } : {}) };
    },
  });
}
