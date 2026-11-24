import { assertNativeDispatchRecord, nativeDispatchPath } from '../../core/workflow/native-dispatch-record.mjs';
import { nativeJournalId } from '../../core/workflow/native-allocation-journal.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { observeLocalProcessOwner } from '../../adapters/runtime/local-process-identity.mjs';
import { inspectNativeOwnerLock } from './local-native-owner-retirement.mjs';

const fail = () => { throw Object.assign(Error('STANDARD_PROCESS_AUDIT_OWNER_CHANGED'), { code: 'STANDARD_PROCESS_AUDIT_OWNER_CHANGED' }); };

// Private read capability for the trusted worker. A reserved allocation alone
// does not exempt an arbitrary owner: authenticate its running dispatch, live
// parent, exact physical lock and current canonical fence on every observation.
// This neither acquires/retires an owner nor grants a write or a new allocation.
export function createRetainedAuditNativeOwnerAssertion({ configuration, instance, reservation, signer, artifacts, readJournal, readInstance, readAuthority }) {
  return () => {
    const journal = readJournal(); signer.verify(journal);
    const entry = journal.allocations.at(-1), id = nativeJournalId(instance);
    if (!reservation || reservation.journal_id !== id || journal.journal_id !== id
      || journal.instance_id !== instance.instance_id || journal.scope_id !== instance.scope_id || journal.model_sha256 !== instance.model_sha256
      || entry?.phase !== 'reserved' || entry.owner_id !== reservation.owner_id || entry.generation !== reservation.generation
      || entry.initial_instance_sha256 !== instance.instance_sha256 || entry.configuration_sha256 !== H(configuration)
      || readInstance()?.instance_sha256 !== instance.instance_sha256) fail();
    const inventory = artifacts.inventory();
    if (inventory.complete !== true) fail();
    const candidates = inventory.paths.filter(p => /^workflows\/native-dispatches\/native_dispatch_[a-f0-9]{40}\.json$/.test(p))
      .map(p => JSON.parse(artifacts.read(p, { required: true }).content))
      .filter(r => r.journal_id === id && r.phase === 'running');
    if (candidates.length !== 1) fail();
    const dispatch = assertNativeDispatchRecord(candidates[0]); signer.verify(dispatch);
    const authority = readAuthority();
    if (dispatch.kind !== 'allocation' || dispatch.instance_id !== instance.instance_id || dispatch.instance_sha256 !== instance.instance_sha256
      || dispatch.instance_revision !== instance.revision || dispatch.configuration_sha256 !== H(configuration)
      || dispatch.intent.authorization_sha256 !== entry.authorization_sha256 || H(dispatch.authority) !== H(authority)
      || dispatch.physical_root_sha256 !== H(artifacts.root) || dispatch.local_owner_scope_sha256 !== H({ physical_root: artifacts.root })
      || dispatch.local_owner_intentions.length !== 1 || dispatch.leases.length !== 1 || dispatch.leases[0].status !== 'held'
      || observeLocalProcessOwner(dispatch.process_identity) !== 'active') fail();
    const lease = dispatch.leases[0], currentFence = artifacts.resourceFence().read();
    if (currentFence.record?.state !== 'held' || H(currentFence.record) !== H(lease.resource_fence)) fail();
    inspectNativeOwnerLock({ targetRoot: artifacts.root, dispatchId: dispatch.dispatch_id,
      intention: dispatch.local_owner_intentions[0], lease });
    if (H(readJournal()) !== H(journal) || readInstance()?.instance_sha256 !== instance.instance_sha256
      || H(JSON.parse(artifacts.read(nativeDispatchPath(dispatch.dispatch_id), { required: true }).content)) !== H(dispatch)
      || artifacts.resourceFence().read().content_sha256 !== currentFence.content_sha256) fail();
  };
}
