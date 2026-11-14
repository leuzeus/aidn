import { randomUUID } from 'node:crypto';
import { createWorkflowRecordStore } from '../../adapters/runtime/workflow-record-store.mjs';
import { observeLocalProcess } from '../../adapters/runtime/local-process-identity.mjs';
import { assertNativeDispatchRecord, nativeDispatchId, nativeDispatchPath, nativeDispatchContextHash } from '../../core/workflow/native-dispatch-record.mjs';
import { shadowHash, checkShadowJson } from '../../core/workflow/shadow-json.mjs';
import { withStandardDispatchContext } from './standard-dispatch-context.mjs';
import { agentRunPhysicalPath } from './agent-run-configuration-service.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
const bodyOf = ({ authentication, key_id, ...body }) => body;
const safeCode = error => /^[A-Z][A-Z0-9_]{0,127}$/.test(error?.code ?? '') ? error.code : 'NATIVE_DISPATCH_ACTION_FAILED';

// Reuse the canonical workflow adapter and the existing private dispatch
// capability. Neither configuration nor process JSON selects this writer.
export function createNativeDispatchProvenance({ configuration, options, signer, journalId, processAuthority, readJournal, readInstance, projectionRequired = false },
  { onBoundary = () => {} } = {}) {
  const store = createWorkflowRecordStore({ ...options, descriptor: { pathForId: nativeDispatchPath,
    validate: assertNativeDispatchRecord, idOf: value => value.dispatch_id, hashOf: shadowHash, kind: 'native_allocation_journal' } });
  const configurationSha = shadowHash(configuration), root = agentRunPhysicalPath(configuration.target_root);
  const projection = options.stateMode === 'dual' || options.stateMode === 'files' && projectionRequired === true;
  const journalHash = () => { const value = readJournal().record; return value ? shadowHash(value) : null; };
  const boundary = (name, id) => { if (onBoundary(name, id) !== undefined) fail('NATIVE_DISPATCH_BOUNDARY_INVALID'); };
  const read = id => { const value = store.read(id); if (value.record) signer.verify(value.record); return value; };
  const save = (body, expected) => {
    const record = signer.seal(body); assertNativeDispatchRecord(record);
    store.compareAndSwap(record, expected);
    if (projection) store.materialize(record.dispatch_id, { write: true });
    const after = read(record.dispatch_id);
    if (!after.record || shadowHash(after.record) !== shadowHash(record)) fail('NATIVE_DISPATCH_RECORD_CHANGED');
    return after;
  };
  return Object.freeze({
    async withOwner(suppliedIntent, effect) {
      if (checkShadowJson(suppliedIntent) || !suppliedIntent || typeof suppliedIntent !== 'object'
        || Array.isArray(suppliedIntent) || typeof effect !== 'function') fail('NATIVE_DISPATCH_INTENT_INVALID');
      const intent = structuredClone(suppliedIntent), authority = processAuthority.read();
      const processIdentity = observeLocalProcess(process.pid);
      if (!processIdentity) fail('PROCESS_IDENTITY_UNAVAILABLE');
      const kind = Object.hasOwn(intent, 'authorization_sha256') ? 'allocation' : 'authorization_epoch';
      const instance = readInstance();
      const body = { contract_version: 'native-dispatch-record.v1', nonce: randomUUID(), revision: 1, journal_id: journalId,
        instance_id: configuration.instance_id, scope_id: authority.scope_id, model_sha256: authority.model_sha256,
        configuration_sha256: configurationSha, authority, intent, kind, owner_plan_sha256: shadowHash({ authority, ...intent }),
        physical_root_sha256: shadowHash(root), local_owner_scope_sha256: shadowHash({ physical_root: root }),
        process_identity: processIdentity, instance_sha256: instance?.instance_sha256 ?? null, instance_revision: instance?.revision ?? null,
        native_journal_before_sha256: journalHash(), native_journal_after_sha256: null, phase: 'reserved',
        local_owner_intentions: [], leases: [], result_sha256: null, error_code: null,
        permits_effects: false, complete_resource_closure: false };
      body.dispatch_id = nativeDispatchId(body);
      let current = save(body, null);
      boundary('native_dispatch_reserved', body.dispatch_id);
      const exact = () => {
        const actual = read(body.dispatch_id);
        if (actual.content_sha256 !== current.content_sha256) fail('NATIVE_DISPATCH_RECORD_CHANGED');
        return actual;
      };
      const update = fields => {
        const before = exact();
        current = save({ ...bodyOf(before.record), revision: before.record.revision + 1, ...fields }, before.content_sha256);
      };
      const beforeEffect = () => {
        if (shadowHash(processAuthority.read()) !== shadowHash(authority) || journalHash() !== body.native_journal_before_sha256)
          fail('NATIVE_DISPATCH_SUBJECT_CHANGED');
      };
      const capability = Object.freeze({
        reserveLocalOwner(owner, resource_fence) {
          beforeEffect(); const record = exact().record;
          if (record.phase !== 'reserved' || record.local_owner_intentions.length) fail('NATIVE_DISPATCH_OWNER_CHANGED');
          update({ local_owner_intentions: [{ owner, lock_path: '.aidn/runtime/standard-workflow/effects.lock',
            resource_fence, context_sha256: nativeDispatchContextHash(record) }] });
          boundary('native_owner_reserved', body.dispatch_id);
        },
        localFenceAcquired(owner, lease) {
          beforeEffect(); const record = exact().record;
          const intention = record.local_owner_intentions.find(row => shadowHash(row.owner) === shadowHash(owner));
          if (!intention || shadowHash(intention.resource_fence.record) !== shadowHash(lease.record)) fail('NATIVE_DISPATCH_OWNER_CHANGED');
          boundary('native_fence_acquired', body.dispatch_id);
        },
        declareLocalOwner(owner, physical_identity, resource_fence) {
          beforeEffect(); const record = exact().record;
          if (record.phase !== 'reserved' || record.leases.length) fail('NATIVE_DISPATCH_OWNER_CHANGED');
          update({ phase: 'running', leases: [{ owner, physical_identity, resource_fence, status: 'held' }] });
          boundary('native_owner_declared', body.dispatch_id);
        },
        releaseLocalOwner(owner) {
          const record = exact().record, at = record.leases.findIndex(row => shadowHash(row.owner) === shadowHash(owner));
          if (at < 0 || record.leases[at].status !== 'held') fail('NATIVE_DISPATCH_OWNER_CHANGED');
          const leases = structuredClone(record.leases); leases[at].status = 'released';
          update({ leases });
          boundary('native_owner_released', body.dispatch_id);
        },
      });
      let value;
      try { value = await withStandardDispatchContext(capability, () => processAuthority.withNativeOwner(intent, effect)); }
      catch (error) {
        // Keep the action failure if retaining its diagnostic also fails. This
        // never changes the action's UNKNOWN/no-effect classification or owner.
        try { update({ phase: 'threw', error_code: safeCode(error), native_journal_after_sha256: journalHash() }); }
        catch { /* The earlier signed prefix remains the recovery evidence. */ }
        throw error;
      }
      update({ phase: 'returned', result_sha256: shadowHash(value), native_journal_after_sha256: journalHash() });
      boundary('native_dispatch_returned', body.dispatch_id);
      return value;
    },
  });
}
