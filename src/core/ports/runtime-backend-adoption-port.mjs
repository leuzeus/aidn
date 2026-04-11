export const RUNTIME_BACKEND_ADOPTION_METHODS = Object.freeze([
  "describeBackend",
  "planAdoption",
  "executeAdoption",
]);

export function hasRuntimeBackendAdoptionMethods(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return RUNTIME_BACKEND_ADOPTION_METHODS.every((method) => typeof value[method] === "function");
}

export function assertRuntimeBackendAdoption(value, name = "RuntimeBackendAdoption") {
  if (!hasRuntimeBackendAdoptionMethods(value)) {
    throw new TypeError(`${name} must implement methods: ${RUNTIME_BACKEND_ADOPTION_METHODS.join(", ")}`);
  }
  return value;
}
