export const RUNTIME_CANONICAL_SNAPSHOT_READER_METHODS = Object.freeze([
  "describeBackend",
  "readCanonicalSnapshot",
]);

export function hasRuntimeCanonicalSnapshotReaderMethods(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return RUNTIME_CANONICAL_SNAPSHOT_READER_METHODS.every((method) => typeof value[method] === "function");
}

export function assertRuntimeCanonicalSnapshotReader(value, name = "RuntimeCanonicalSnapshotReader") {
  if (!hasRuntimeCanonicalSnapshotReaderMethods(value)) {
    throw new TypeError(`${name} must implement methods: ${RUNTIME_CANONICAL_SNAPSHOT_READER_METHODS.join(", ")}`);
  }
  return value;
}
