export const SHARED_COORDINATION_STORE_METHODS = Object.freeze([
  "describeContract",
  "bootstrap",
  "registerWorkspace",
  "registerWorktreeHeartbeat",
  "upsertPlanningState",
  "appendHandoffRelay",
  "appendCoordinationRecord",
  "getPlanningState",
  "getLatestHandoffRelay",
  "listCoordinationRecords",
  "healthcheck",
]);

export function hasSharedCoordinationStoreMethods(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return SHARED_COORDINATION_STORE_METHODS.every((method) => typeof value[method] === "function");
}

export function assertSharedCoordinationStore(value, name = "SharedCoordinationStore") {
  if (!hasSharedCoordinationStoreMethods(value)) {
    throw new TypeError(`${name} must implement methods: ${SHARED_COORDINATION_STORE_METHODS.join(", ")}`);
  }
  return value;
}
