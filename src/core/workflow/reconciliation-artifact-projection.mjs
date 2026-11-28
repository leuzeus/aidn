import { artifactContentHash, artifactMetadataHash } from './artifact-compare-swap.mjs';
import { assertOperationJournal } from './process-operation-journal.mjs';
import { assertNativeAllocationJournal } from './native-allocation-journal.mjs';
import { assertNativeReconciliationRecord, nativeReconciliationPath } from './native-allocation-reconciliation-record.mjs';
import { assertNativeOwnerDispositionRecord, nativeOwnerDispositionPath } from './native-owner-disposition.mjs';
import { assertNativeDispatchRecord, nativeDispatchPath } from './native-dispatch-record.mjs';
import { assertProcessDispatchRecord, dispatchRecordPath } from './process-dispatch-record.mjs';

const fail = code => { throw Error(code); };
const namespaces = {
  'operation-records': [assertOperationJournal, r => `workflows/operation-records/${r.operation_id}.json`, r => r.intent.instance_id],
  'native-allocations': [assertNativeAllocationJournal, r => `workflows/native-allocations/${r.journal_id}.json`, r => r.instance_id],
  'native-allocation-reconciliations': [assertNativeReconciliationRecord, r => nativeReconciliationPath(r.reconciliation_id), r => r.instance_id],
  'native-owner-dispositions': [assertNativeOwnerDispositionRecord, r => nativeOwnerDispositionPath(r.dispatch_id), r => r.plan.instance_id],
  'native-dispatches': [assertNativeDispatchRecord, r => nativeDispatchPath(r.dispatch_id), r => r.instance_id],
  'dispatch-records': [assertProcessDispatchRecord, r => dispatchRecordPath(r.operation_id), r => r.instance_id],
};

// One canonical statement supplies all rows. Preserve every artifact identity
// and metadata digest; only the bodies already excluded by instance selection
// in the reconciliation reader are omitted across the worker boundary.
// Inbox bodies remain present: their owner is resolved through operation links.
export function projectReconciliationArtifacts(rows, instanceId) {
  if (!/^[a-z][a-z0-9_-]{0,95}$/.test(instanceId ?? '') || !Array.isArray(rows)) fail('ARTIFACT_RECONCILIATION_SCOPE_INVALID');
  return rows.map(row => {
    if (typeof row.path !== 'string' || row.content_format !== 'utf8' || typeof row.content !== 'string'
      || artifactContentHash(row.content) !== row.sha256) fail('ARTIFACT_RECONCILIATION_INTEGRITY_INVALID');
    const namespace = /^workflows\/([^/]+)\//.exec(row.path)?.[1];
    let retain = ['decision-inbox', 'control-inbox'].includes(namespace);
    if (Object.hasOwn(namespaces, namespace ?? '')) {
      const [validate, expectedPath, owner] = namespaces[namespace];
      let record;
      try { record = validate(JSON.parse(row.content)); }
      catch { fail('ARTIFACT_RECONCILIATION_RECORD_INVALID'); }
      if (row.path !== expectedPath(record)) fail('ARTIFACT_RECONCILIATION_RECORD_INVALID');
      retain = owner(record) === instanceId;
    }
    return { path: row.path, sha256: row.sha256, content: retain ? row.content : null,
      metadata_sha256: Object.hasOwn(row, 'metadata_sha256') ? row.metadata_sha256 : artifactMetadataHash(row) };
  });
}
