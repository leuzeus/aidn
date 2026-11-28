import { agenticProcessPrefixSha256, inspectAgenticProcess } from '../../core/workflow/agentic-process.mjs';
import { processFrameNode, processFrameModel } from '../../core/workflow/process-call-model.mjs';
import { assertNativeDispatchRecord, nativeDispatchPath } from '../../core/workflow/native-dispatch-record.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { observeLocalProcessOwner } from '../../adapters/runtime/local-process-identity.mjs';
import { readNativeAllocationCheckpoint } from './native-allocation-evidence.mjs';
import { observeNativePostAssignmentCheckpoint } from './standard-native-post-assignment-assessment.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';

// One closed, read-only R05 assignment whose answer was rejected. This private
// witness supports physical-owner retirement only. The old assignment, failure
// and accounting remain unresolved; no accepted report or retry is manufactured.
export function observeReadOnlyNativeRejectedAnswer({ instance, journal, configuration, signer, artifacts, productSha256, assessment }) {
  const entry = journal?.allocations.at(-1), index = instance.events.length - 1, event = instance.events[index];
  if (!entry || entry.phase !== 'failed' || entry.first_failure !== 'PROCESS_SESSION_ANSWER_INVALID'
    || !entry.tree_closed || entry.owned_status !== 'FAILED' || !entry.tree_proof_sha256 || !entry.owned_result_sha256
    || entry.checkpoint === null || entry.closure_ref === null || entry.consumption === null
    || journal.allocations.slice(0, -1).some(row => row.phase !== 'closed')
    || assessment.return_binding !== 'matched' || !assessment.checkpoint?.parent_closed || !assessment.checkpoint.os_tree_confirmed
    || assessment.journal_sha256 !== H(journal) || assessment.allocation_sha256 !== H(entry)
    || assessment.instance_sha256 !== instance.instance_sha256 || assessment.configuration_sha256 !== H(configuration)
    || event?.kind !== 'assign' || entry.initial_instance_sha256 !== agenticProcessPrefixSha256(instance, index)) return null;
  signer.verify(journal); signer.verify(assessment);
  const frame = inspectAgenticProcess(instance).occurrences.find(row => row.occurrence_id === event.occurrence_id);
  const node = frame && processFrameNode(instance.model, frame), model = frame && processFrameModel(instance.model, frame);
  const role = model?.roles.find(row => row.id === node?.role_ref), policy = model?.policies.find(row => row.id === node?.policy_ref);
  if (node?.kind !== 'activity' || frame.status !== 'RUNNING' || role?.role !== 'auditor' || role.action !== 'analyze'
    || configuration.activity_outputs?.[frame.node_id] !== 'standard-drift-report.v1'
    || H(policy?.allowed_permissions) !== H(['read:product']) || H(policy.required_permissions) !== H(['read:product'])
    || event.request.artifact_sha256 !== productSha256) return null;

  const work = observeNativePostAssignmentCheckpoint({ journal, entry, current: instance, configuration, productSha256 });
  if (!work || work.prefix_relation !== 'match' || !work.history_preserved || !work.worker_checkpoint_matches
    || !work.worker_parent_closed || work.worker_generation_resources !== 1 || !work.consumption_matches
    || work.generation_assignments !== 1 || work.generation_resources !== 1 || work.generation_results !== 0
    || work.unresolved_assignments !== 1) return null;
  const checkpoint = readNativeAllocationCheckpoint(entry, configuration, { scopeId: journal.scope_id, modelSha256: journal.model_sha256 });
  if (checkpoint.state.resources[work.prior_resources]?.executor.execution_id !== event.decision.execution_id) return null;

  const intent = instance.events.slice(0, index).findLast(row => row.kind === 'operation_intent');
  if (!intent) return null;
  const source = createProcessOperationJournalStore({ targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode })
    .read(intent.intent.operation_id).record;
  if (!source) return null;
  signer.verify(source); signer.verify(source.preview);
  if (H(source.intent) !== H(intent.intent) || source.phase !== 'receipted'
    || source.preview.snapshot.native?.product_sha256 !== productSha256
    || source.preview.snapshot.native.configuration_sha256 !== H(configuration)
    || !instance.events.slice(0, index).some(row => row.kind === 'operation_result'
      && source.results.some(result => H(result.receipt) === H(row.receipt)))) return null;

  const dispatch = assertNativeDispatchRecord(JSON.parse(artifacts.read(nativeDispatchPath(assessment.dispatch_id), { required: true }).content));
  signer.verify(dispatch);
  if (H(dispatch) !== assessment.dispatch_sha256 || dispatch.kind !== 'allocation' || dispatch.phase !== 'returned'
    || dispatch.instance_id !== instance.instance_id || dispatch.journal_id !== journal.journal_id
    || dispatch.native_journal_after_sha256 !== H(journal) || dispatch.instance_sha256 !== entry.initial_instance_sha256
    || dispatch.configuration_sha256 !== H(configuration) || dispatch.scope_id !== instance.scope_id
    || dispatch.model_sha256 !== instance.model_sha256 || dispatch.physical_root_sha256 !== H(artifacts.root)
    || dispatch.intent.authorization_sha256 !== entry.authorization_sha256 || dispatch.leases.length !== 1
    || dispatch.leases[0].status !== 'held' || observeLocalProcessOwner(dispatch.process_identity) !== 'terminated') return null;
  return { dispatch_id: dispatch.dispatch_id, dispatch_sha256: H(dispatch), journal_sha256: H(journal),
    instance_sha256: instance.instance_sha256, initial_instance_sha256: entry.initial_instance_sha256,
    assignment_index: index, assignment_sha256: H(event), checkpoint_sha256: entry.checkpoint.sha256,
    work_sha256: H(work), product_sha256: productSha256, product_source_sha256: H(source),
    failure_preserved: true, accounting_known: false };
}
