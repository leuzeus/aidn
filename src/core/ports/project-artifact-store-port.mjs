// Explicit artifact commands are separate from bulk index projection/adoption.
export function assertProjectArtifactStore(store) {
  for (const name of ['upsertArtifact', 'getArtifact', 'listArtifacts', 'materializeArtifacts', 'close']) {
    if (typeof store?.[name] !== 'function') throw new TypeError(`ProjectArtifactStore requires ${name}`);
  }
  return store;
}

// Additive capability for durable checkpoints. Existing callers and doubles
// retain the original port; no fallback to read-then-upsert is safe.
export function assertProjectArtifactCompareSwap(store) {
  assertProjectArtifactStore(store);
  if (typeof store.compareAndSwapArtifact !== 'function') throw new TypeError('ProjectArtifactStore requires compareAndSwapArtifact');
  return store;
}

// Locked read/replace/write, with the same revision and metadata guarantees.
// request = { path, replacements, expectedSha256, expectedMetadataSha256? }.
// Replacement requests cannot supply stale ownership/classification to restore.
// Never emulate this capability using an unlocked read followed by an upsert.
export function assertProjectArtifactReplacements(store) {
  assertProjectArtifactStore(store);
  if (typeof store.replaceArtifact !== 'function') throw new TypeError('ProjectArtifactStore requires replaceArtifact');
  return store;
}

// Optional targeted deletion. Callers must first establish their own lifecycle,
// authorization, resume and retained-trace evidence. There is no read/unlink or
// read/delete fallback when an adapter lacks this transactional capability.
export function assertProjectArtifactCompareDelete(store) {
  assertProjectArtifactStore(store);
  if (typeof store.compareAndDeleteArtifact !== 'function') throw new TypeError('ProjectArtifactStore requires compareAndDeleteArtifact');
  return store;
}
