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

export const SHARED_COORDINATION_TABLES = Object.freeze([
  "workspace_registry",
  "worktree_registry",
  "planning_states",
  "handoff_relays",
  "coordination_records",
]);

export const SHARED_COORDINATION_METHOD_TABLE = Object.freeze({
  registerWorkspace: "workspace_registry",
  registerWorktreeHeartbeat: "worktree_registry",
  upsertPlanningState: "planning_states",
  getPlanningState: "planning_states",
  appendHandoffRelay: "handoff_relays",
  getLatestHandoffRelay: "handoff_relays",
  appendCoordinationRecord: "coordination_records",
  listCoordinationRecords: "coordination_records",
});

export const NON_SHARED_PROJECT_SURFACES = Object.freeze([
  "docs/audit/*",
  "AGENTS.md",
  ".agents/*",
  ".codex/*",
  ".aidn/config.json",
  ".aidn/runtime/index/workflow-index.sqlite",
  ".aidn/runtime/context/*",
  "repair_findings",
  "incident",
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
