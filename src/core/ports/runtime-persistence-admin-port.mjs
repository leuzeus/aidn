export const RUNTIME_PERSISTENCE_ADMIN_METHODS = Object.freeze([
  "describeBackend",
  "inspectSchema",
  "migrateSchema",
  "backupPersistence",
]);

export function hasRuntimePersistenceAdminMethods(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return RUNTIME_PERSISTENCE_ADMIN_METHODS.every((method) => typeof value[method] === "function");
}

export function assertRuntimePersistenceAdmin(value, name = "RuntimePersistenceAdmin") {
  if (!hasRuntimePersistenceAdminMethods(value)) {
    throw new TypeError(`${name} must implement methods: ${RUNTIME_PERSISTENCE_ADMIN_METHODS.join(", ")}`);
  }
  return value;
}
