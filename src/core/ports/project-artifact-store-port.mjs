// Explicit artifact commands are separate from bulk index projection/adoption.
export function assertProjectArtifactStore(store) {
  for (const name of ['upsertArtifact', 'getArtifact', 'listArtifacts', 'materializeArtifacts', 'close']) {
    if (typeof store?.[name] !== 'function') throw new TypeError(`ProjectArtifactStore requires ${name}`);
  }
  return store;
}
