import path from 'node:path';
import { agenticProcessPrefixSha256, assertAgenticProcessInstance, inspectAgenticProcess } from '../../core/workflow/agentic-process.mjs';
import { assertNativeAllocationJournal } from '../../core/workflow/native-allocation-journal.mjs';
import { assertNativePostAssignmentAssessment, nativePostAssignmentEvidenceProfile } from '../../core/workflow/native-post-assignment-assessment.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { readNativeAllocationCheckpoint, nativeAllocationOutputId } from './native-allocation-evidence.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { CYCLE_TASK_WORK_CONTRACT } from '../../core/workflow/standard-cycle-work.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
const stable = ({ authentication, key_id, observed_at_ms, inventory_sha256, ...value }) => value;

// Caller authenticates the journal and canonical history. Protected readers bind
// the admitted file references; this function never imports a checkpoint.
export function observeNativePostAssignmentCheckpoint({ journal, entry, current, configuration, productSha256 = null }) {
  if (entry.checkpoint === null || entry.closure_ref === null) return null;
  const checkpoint = readNativeAllocationCheckpoint(entry, configuration, { scopeId: journal.scope_id, modelSha256: journal.model_sha256 });
  const state = checkpoint.state, original = state.instance;
  assertAgenticProcessInstance(current);
  if (current.instance_id !== original.instance_id || current.scope_id !== original.scope_id || current.model_sha256 !== original.model_sha256
    || H(current.initial_facts) !== H(original.initial_facts) || H(current.initial_parameters ?? null) !== H(original.initial_parameters ?? null)
    || H(current.policy_pins) !== H(original.policy_pins) || current.events.length < original.events.length
    || H(current.events.slice(0, original.events.length)) !== H(original.events)
    || current.events.length === original.events.length && current.instance_sha256 !== original.instance_sha256)
    fail('NATIVE_POST_ASSIGNMENT_CANONICAL_CHANGED');
  const previous = journal.allocations.find(row => row.generation === entry.generation - 1);
  if (entry.generation > 1 && (!previous || previous.checkpoint === null || previous.closure_ref === null)) return null;
  const prior = previous ? readNativeAllocationCheckpoint(previous, configuration, { scopeId: journal.scope_id, modelSha256: journal.model_sha256 }).state : null;
  if (prior && (original.events.length < prior.instance.events.length
    || H(original.events.slice(0, prior.instance.events.length)) !== H(prior.instance.events)))
    fail('NATIVE_POST_ASSIGNMENT_HISTORY_CHANGED');
  const beforeResources = prior?.resources.length ?? 0, beforeResults = prior?.results.length ?? 0;
  const historyPreserved = state.resources.length >= beforeResources && state.results.length >= beforeResults
    && H(state.resources.slice(0, beforeResources)) === H(prior?.resources ?? [])
    && H(state.results.slice(0, beforeResults)) === H(prior?.results ?? []);
  if (!historyPreserved) fail('NATIVE_POST_ASSIGNMENT_HISTORY_CHANGED');
  const assignments = original.events.filter(e => e.kind === 'assign' && typeof e.decision.execution_id === 'string');
  const generationEvents = original.events.slice(prior?.instance.events.length ?? 0);
  const generationAssignments = generationEvents.filter(e => e.kind === 'assign' && typeof e.decision.execution_id === 'string').length;
  const unresolved = assignments.filter(a => !original.events.some(e => e.kind === 'result' && e.occurrence_id === a.occurrence_id
    && e.result.execution_id === a.decision.execution_id && e.result.request_sha256 === H(a.request))).length;
  const closure = readAgentRunFile(entry.closure_ref.path, { maxBytes: 262144 }), worker = closure.value.worker_result;
  const parent = worker?.native_parent_closure;
  const output = nativeAllocationOutputId(configuration.instance_id, entry.generation);
  const workerCheckpointMatches = worker?.native_checkpoint?.ref === 'execution/' + output + '/' + path.basename(entry.checkpoint.path)
    && worker.native_checkpoint.sha256 === entry.checkpoint.sha256 && worker.instance_sha256 === original.instance_sha256
    && worker.responses_observed === checkpoint.responses_observed;
  let consumptionMatches = false;
  if (entry.consumption !== null && Number.isSafeInteger(worker?.storage_budget_debit_bytes) && worker.storage_budget_debit_bytes >= 0) {
    const footer = readAgentRunFile(path.join(configuration.control_root, output, 'RESULT.json'), { json: false, maxBytes: 131072 });
    const debit = worker.storage_budget_debit_bytes + footer.value.length + readAgentRunFile(entry.closure_ref.path, { json: false, maxBytes: 131072 }).value.length;
    consumptionMatches = Number.isSafeInteger(debit) && entry.consumption.storage_debit_bytes === debit
      && entry.consumption.responses_observed === checkpoint.responses_observed
      && H(entry.consumption.response_sha256) === H(checkpoint.response_sha256)
      && entry.consumption.native_usage_sha256 === (state.native_usage === null ? null : H(state.native_usage));
  }
  return { prefix_relation: current.instance_sha256 === original.instance_sha256 ? 'match' : 'canonical_extension',
    checkpoint_event_count: original.events.length, current_event_count: current.events.length,
    prior_checkpoint_sha256: previous?.checkpoint.sha256 ?? null,
    prior_resources: beforeResources, total_resources: state.resources.length,
    generation_resources: state.resources.length - beforeResources,
    prior_results: beforeResults, total_results: state.results.length,
    generation_results: state.results.length - beforeResults, generation_assignments: generationAssignments,
    unresolved_assignments: unresolved, history_preserved: historyPreserved,
    worker_checkpoint_matches: Boolean(workerCheckpointMatches), worker_parent_closed: parent?.closed === true,
    worker_generation_resources: Number.isSafeInteger(parent?.resources) && parent.resources >= 0 ? parent.resources : null,
    consumption_matches: consumptionMatches,
    ...interruptedAssignment({ original, current, entry, state, beforeResources, configuration, productSha256, worker }) };
}

function interruptedAssignment({ original, current, entry, state, beforeResources, configuration, productSha256, worker }) {
  // The closed recovery profile covers one scoped cycle implementation
  // interrupted by a response overrun. It grants resource reconciliation only.
  if (entry.first_failure !== 'PROCESS_EXECUTION_RESPONSE_LIMIT' || worker?.first_failure !== entry.first_failure
    || entry.consumption === null || entry.consumption.responses_observed <= entry.limits.max_responses
    || current.instance_sha256 !== original.instance_sha256 || !productSha256) return {};
  const event = original.events.at(-1);
  if (event?.kind !== 'assign' || event.request.role !== 'executor' || event.request.artifact_sha256 !== productSha256
    || agenticProcessPrefixSha256(original, original.events.length - 1) !== entry.initial_instance_sha256
    || state.resources[beforeResources]?.executor.execution_id !== event.decision.execution_id) return {};
  const frame = inspectAgenticProcess(original).occurrences.find(row => row.occurrence_id === event.occurrence_id);
  if (frame?.status !== 'RUNNING' || configuration.activity_outputs?.[frame.node_id] !== CYCLE_TASK_WORK_CONTRACT) return {};
  return { interrupted_assignment: { assignment_sha256: H(event), initial_instance_sha256: entry.initial_instance_sha256,
    product_preimage_sha256: event.request.artifact_sha256, observed_product_sha256: productSha256,
    authorized_responses: entry.limits.max_responses, reason_code: entry.first_failure } };
}

// Both no-assignment recovery steps require the same authenticated delta.
export function observeNativeInheritedCheckpoint({ journal, entry, current, configuration, inventory }) {
  const previous = inventory.resources.find(row => row.ref === 'native:' + journal.journal_id + '/' + (entry.generation - 1));
  if (previous?.kind !== 'native_allocation' || !previous.details.accounting_known || !previous.details.tree_closed) return null;
  const work = observeNativePostAssignmentCheckpoint({ journal, entry, current, configuration });
  if (work === null || !work.history_preserved || work.prior_checkpoint_sha256 !== previous.details.checkpoint?.sha256
    || work.generation_assignments !== 0 || work.generation_resources !== 0 || work.generation_results !== 0
    || work.unresolved_assignments !== 0 || !work.worker_checkpoint_matches || !work.worker_parent_closed
    || work.worker_generation_resources !== 0 || !work.consumption_matches) return null;
  return work.prior_checkpoint_sha256;
}

export function createStandardNativePostAssignmentAssessment({ artifacts, configuration, signer, baseAssessment, capture }) {
  return Object.freeze({
    prepare(instanceId, input) {
      if (typeof capture !== 'function') fail('NATIVE_POST_ASSIGNMENT_AUTHORITY_REQUIRED');
      const before = baseAssessment.prepare(instanceId, input), base = before.assessment;
      signer.verify(before.inventory); signer.verify(base);
      const journal = assertNativeAllocationJournal(JSON.parse(artifacts.read('workflows/native-allocations/' + base.journal_id + '.json', { required: true }).content));
      signer.verify(journal);
      if (H(journal) !== base.journal_sha256) fail('NATIVE_POST_ASSIGNMENT_SUBJECT_CHANGED');
      const entry = journal.allocations.at(-1);
      if (!entry || H(entry) !== base.allocation_sha256 || entry.generation !== base.generation) fail('NATIVE_POST_ASSIGNMENT_SUBJECT_CHANGED');
      // The diagnostic capture used by baseAssessment authenticates each current
      // operation/control event in addition to checking the Native prefix.
      const subject = capture(instanceId, input.expectedSha256);
      signer.verify(subject.inventory);
      if (H(subject.context) !== subject.inventory.context_sha256 || H(stable(before.inventory)) !== H(stable(subject.inventory)))
        fail('NATIVE_POST_ASSIGNMENT_OBSERVATION_CHANGED');
      const work = observeNativePostAssignmentCheckpoint({ journal, entry, current: subject.instance, configuration, productSha256: subject.context.native?.product_sha256 });
      const after = baseAssessment.prepare(instanceId, input);
      signer.verify(after.inventory); signer.verify(after.assessment);
      if (before.inventory.key_id !== after.inventory.key_id || base.key_id !== after.assessment.key_id
        || H(stable(before.inventory)) !== H(stable(after.inventory)) || H(stable(base)) !== H(stable(after.assessment)))
        fail('NATIVE_POST_ASSIGNMENT_OBSERVATION_CHANGED');
      return { inventory: after.inventory, assessment: assertNativePostAssignmentAssessment(signer.seal({
        contract_version: 'native-post-assignment-assessment.v1', base_assessment: after.assessment,
        checkpoint_work: work, evidence_profile: nativePostAssignmentEvidenceProfile(after.assessment, work),
        business_effect: 'unknown', complete_resource_closure: false, permits_effects: false, permits_resume: false,
        permits_native_renewal: false, permits_owner_retirement: false, written: false }), after.inventory) };
    },
  });
}
