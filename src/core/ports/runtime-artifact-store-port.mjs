export const RUNTIME_ARTIFACT_STORE_METHODS = Object.freeze([
  "describeBackend",
  "loadSnapshot",
  "loadRuntimeHeads",
  "writeIndexProjection",
]);

export function hasRuntimeArtifactStoreMethods(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return RUNTIME_ARTIFACT_STORE_METHODS.every((method) => typeof value[method] === "function");
}

export function assertRuntimeArtifactStore(value, name = "RuntimeArtifactStore") {
  if (!hasRuntimeArtifactStoreMethods(value)) {
    throw new TypeError(`${name} must implement methods: ${RUNTIME_ARTIFACT_STORE_METHODS.join(", ")}`);
  }
  return value;
}
