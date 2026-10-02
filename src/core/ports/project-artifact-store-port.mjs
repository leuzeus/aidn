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
