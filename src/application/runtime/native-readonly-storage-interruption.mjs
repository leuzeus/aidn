import { agenticProcessPrefixSha256, inspectAgenticProcess } from '../../core/workflow/agentic-process.mjs';
import { processFrameNode, processFrameModel } from '../../core/workflow/process-call-model.mjs';
import { assertNativeDispatchRecord } from '../../core/workflow/native-dispatch-record.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { observeLocalProcessOwner } from '../../adapters/runtime/local-process-identity.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';

// Private diagnostic evidence for retiring one abandoned physical owner. It
// supplies no checkpoint, response debit, accepted result or execution grant.
export function observeReadOnlyNativeStorageStop({ instance, journal, configuration, signer, artifacts, productSha256 }) {
  const entry = journal?.allocations.at(-1), index = instance.events.length - 1, event = instance.events[index];
  if (!entry || entry.phase !== 'failed' || entry.first_failure !== 'PROCESS_EXECUTION_STORAGE_LIMIT'
    || !entry.tree_closed || entry.owned_status !== 'FAILED' || !entry.tree_proof_sha256 || !entry.owned_result_sha256
    || entry.checkpoint !== null || entry.closure_ref !== null || entry.consumption !== null
    || journal.allocations.length < 2 || journal.allocations.slice(0, -1).some(row => row.phase !== 'closed')
    || event?.kind !== 'assign' || entry.configuration_sha256 !== H(configuration)
    || entry.initial_instance_sha256 !== agenticProcessPrefixSha256(instance, index)) return null;
  signer.verify(journal);
  const frame = inspectAgenticProcess(instance).occurrences.find(row => row.occurrence_id === event.occurrence_id);
  const node = frame && processFrameNode(instance.model, frame), model = frame && processFrameModel(instance.model, frame);
  const role = model?.roles.find(row => row.id === node?.role_ref), policy = model?.policies.find(row => row.id === node?.policy_ref);
  if (node?.kind !== 'activity' || frame.status !== 'RUNNING' || role?.role !== 'auditor'
    || !['analyze', 'audit'].includes(role.action) || H(policy?.allowed_permissions) !== H(['read:product'])
    || H(policy.required_permissions) !== H(['read:product']) || event.request.artifact_sha256 !== productSha256) return null;

  const intent = instance.events.slice(0, index).findLast(row => row.kind === 'operation_intent');
  if (!intent) return null;
  const source = createProcessOperationJournalStore({ targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode }).read(intent.intent.operation_id).record;
  if (!source) return null;
  signer.verify(source); signer.verify(source.preview);
  if (H(source.intent) !== H(intent.intent) || source.phase !== 'receipted'
    || source.preview.snapshot.native?.product_sha256 !== productSha256
    || source.preview.snapshot.native.configuration_sha256 !== H(configuration)
    || !instance.events.slice(0, index).some(row => row.kind === 'operation_result'
      && source.results.some(result => H(result.receipt) === H(row.receipt)))) return null;

  const paths = artifacts.inventory().paths.filter(name => name.startsWith('workflows/native-dispatches/'));
  const matches = [];
  for (const row of artifacts.readMany(paths, { required: paths })) {
    const dispatch = JSON.parse(row.content);
    if (dispatch.instance_id !== instance.instance_id || dispatch.journal_id !== journal.journal_id
      || dispatch.kind !== 'allocation' || dispatch.phase !== 'returned'
      || dispatch.native_journal_after_sha256 !== H(journal)) continue;
    assertNativeDispatchRecord(dispatch); signer.verify(dispatch);
    if (dispatch.instance_sha256 !== entry.initial_instance_sha256
      || dispatch.configuration_sha256 !== H(configuration) || dispatch.scope_id !== instance.scope_id
      || dispatch.model_sha256 !== instance.model_sha256 || dispatch.physical_root_sha256 !== H(artifacts.root)
      || dispatch.intent.authorization_sha256 !== entry.authorization_sha256 || dispatch.leases.length !== 1
      || dispatch.leases[0].status !== 'held' || observeLocalProcessOwner(dispatch.process_identity) !== 'terminated') continue;
    matches.push({ dispatch_id: dispatch.dispatch_id, dispatch_sha256: H(dispatch), journal_sha256: H(journal),
      instance_sha256: instance.instance_sha256, initial_instance_sha256: entry.initial_instance_sha256,
      assignment_index: index, assignment_sha256: H(event), product_sha256: productSha256,
      product_source_sha256: H(source), failure_preserved: true, accounting_known: false });
  }
  return matches.length === 1 ? matches[0] : null;
}
