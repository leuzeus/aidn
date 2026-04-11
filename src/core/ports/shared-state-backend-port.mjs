export const SHARED_STATE_BACKEND_METHODS = Object.freeze([
  "describeBackend",
  "loadSnapshot",
]);

export function hasSharedStateBackendMethods(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return SHARED_STATE_BACKEND_METHODS.every((method) => typeof value[method] === "function");
}

export function assertSharedStateBackend(value, name = "SharedStateBackend") {
  if (!hasSharedStateBackendMethods(value)) {
    throw new TypeError(`${name} must implement methods: ${SHARED_STATE_BACKEND_METHODS.join(", ")}`);
  }
  return value;
}
