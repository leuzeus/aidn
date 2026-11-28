import { createWorkflowRecordStore } from '../../adapters/runtime/workflow-record-store.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { assertNativeAllocationJournal } from '../../core/workflow/native-allocation-journal.mjs';
import { nativeAllocationResolution, isNativePostAssignmentReconciliation } from '../../core/workflow/native-allocation-reconciliation.mjs';
import { assertNativeReconciliationRecord, nativeReconciliationId, nativeReconciliationPath, retainedNativeReconciliationReceipt } from '../../core/workflow/native-allocation-reconciliation-record.mjs';
import { assertNativeOwnerDispositionRecord, nativeOwnerDispositionPath } from '../../core/workflow/native-owner-disposition.mjs';
import { assertNativeDispatchRecord, nativeDispatchPath } from '../../core/workflow/native-dispatch-record.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { inspectRetiredNativeOwnerWitness } from './local-native-owner-retirement.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };

// Both journals have been authenticated by the reader. The first v5
// reconciliation retains the entire v4 predecessor as its origin.
export function retainsNativeReconciliationProposal(journal, proposal) {
  const retained = journal.contract_version === 'native-allocation-journal.v5'
    && proposal.contract_version === 'native-allocation-journal.v4' ? journal.origin_journal : journal;
  return retained.contract_version === proposal.contract_version
    && H(retained.origin_journal) === H(proposal.origin_journal)
    && H(retained.initial_authorization) === H(proposal.initial_authorization)
    && H(retained.allocations.slice(0, proposal.allocations.length)) === H(proposal.allocations)
    && H(retained.epochs.slice(0, proposal.epochs.length)) === H(proposal.epochs)
    && H(retained.reconciliations.slice(0, proposal.reconciliations.length)) === H(proposal.reconciliations);
}

// Internal capabilities select the configured canonical store, or the exact
// rows of one inventory observation. Authored JSON cannot select these readers.
// The result describes resolved Native history; every later effect still needs
// its own current authority/fence and Native execution needs its finite grant.
export function createNativeReconciliationHistoryReader({ targetRoot, stateMode, configuration, signer, environment = process.env,
  artifacts: suppliedArtifacts, readRecord, readOwner }) {
  const artifacts = suppliedArtifacts ?? createStandardWorkflowArtifacts({ targetRoot, env: environment });
  const store = readRecord ? null : createWorkflowRecordStore({ targetRoot, stateMode, env: environment, descriptor: {
    pathForId: nativeReconciliationPath, validate: assertNativeReconciliationRecord, idOf: row => row.reconciliation_id, hashOf: H, kind: 'native_allocation_journal' } });
  function verifyJournal(journal) {
    assertNativeAllocationJournal(journal); signer.verify(journal);
    if (journal.origin_journal) verifyJournal(journal.origin_journal);
    for (const receipt of journal.reconciliations ?? []) { signer.verify(receipt); verifyRequest(receipt.request); }
  }
  function verifyRequest(q) {
    signer.verify(q);
    if (isNativePostAssignmentReconciliation(q)) {
      signer.verify(q.post_assignment_assessment); signer.verify(q.post_assignment_assessment.base_assessment);
    }
  }
  function read(id) {
    nativeReconciliationPath(id);
    const value = readRecord ? readRecord(id) : store.read(id).record;
    if (value === null || value === undefined) return null;
    const record = assertNativeReconciliationRecord(value);
    signer.verify(record); verifyRequest(record.request); signer.verify(record.inventory); verifyJournal(record.original_journal);
    for (const row of record.attempts) verifyJournal(row.proposal);
    return record;
  }
  function resolution(journal, entry) {
    const resolved = nativeAllocationResolution(entry, journal.reconciliations);
    if (resolved === null || resolved.kind === 'ordinary') return resolved;
    if (!configuration) return null;
    verifyJournal(journal);
    const record = read(nativeReconciliationId(journal.journal_id, entry.generation));
    if (!record || record.phase !== 'confirmed') return null;
    const q = record.request, receipt = retainedNativeReconciliationReceipt(record), proposal = record.attempts.find(row => row.attempt_id === record.commit.proposal_attempt_id).proposal;
    const actualReceipt = journal.reconciliations.find(row => row.request.generation === entry.generation);
    if (record.journal_id !== journal.journal_id || q.instance_id !== journal.instance_id || q.scope_id !== journal.scope_id || q.model_sha256 !== journal.model_sha256
      || q.configuration_sha256 !== H(configuration) || q.physical_root_sha256 !== H(artifacts.root)
      || H(entry) !== q.allocation_sha256 || H(receipt) !== H(actualReceipt)
      || !retainsNativeReconciliationProposal(journal, proposal))
      fail('NATIVE_RECONCILIATION_CONFIRMED_HISTORY_CHANGED');
    const owner = assertNativeOwnerDispositionRecord(readOwner ? readOwner(q.dispatch_id)
      : JSON.parse(artifacts.read(nativeOwnerDispositionPath(q.dispatch_id), { required: true }).content));
    signer.verify(owner); signer.verify(owner.plan); if (owner.receipt) signer.verify(owner.receipt);
    const witness = owner.receipt && owner.attempts.find(row => row.attempt_id === owner.receipt.attempt_id)?.retirement;
    const dispatch = assertNativeDispatchRecord(JSON.parse(artifacts.read(nativeDispatchPath(q.dispatch_id), { required: true }).content)); signer.verify(dispatch);
    if (owner.phase !== 'confirmed' || H(owner.receipt) !== q.owner_retirement_receipt_sha256
      || owner.plan.journal_sha256 !== q.journal_sha256 || owner.plan.allocation_sha256 !== q.allocation_sha256
      || owner.plan.instance_sha256 !== q.instance_sha256
      || isNativePostAssignmentReconciliation(q) && (owner.plan.contract_version !== 'native-owner-disposition-plan.v2'
        || owner.plan.post_assignment_sha256 !== q.post_assignment_sha256 || owner.plan.initial_instance_sha256 !== q.initial_instance_sha256
        || owner.plan.checkpoint_sha256 !== q.checkpoint_sha256 || owner.plan.checkpoint_state_sha256 !== q.checkpoint_state_sha256
        || owner.plan.checkpoint_instance_sha256 !== q.checkpoint_instance_sha256)
      || H(dispatch) !== q.dispatch_sha256 || !witness || dispatch.leases.length !== 1
      || H(dispatch.leases[0]) !== owner.plan.original_lease_sha256) fail('NATIVE_RECONCILIATION_RETIRED_OWNER_CHANGED');
    inspectRetiredNativeOwnerWitness({ targetRoot: artifacts.root, dispatchId: q.dispatch_id, originalLease: dispatch.leases[0],
      expectedLockSha256: owner.plan.lock_sha256 });
    return { ...resolved, receipt_sha256: H(receipt), record_sha256: H(record) };
  }
  return Object.freeze({ read, resolution });
}
