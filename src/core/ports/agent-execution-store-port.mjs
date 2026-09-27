// Internal async supervision port. Construction and assertion never probe a
// backend. checkReadiness/getRun/readCanonicalDigest are read-only; migration is
// an independent administrative operation. All mutation methods require a
// PostgreSQL transaction; no transient or local authority implements this port.
export const AGENT_EXECUTION_STORE_METHODS = Object.freeze([
  "checkReadiness", "readCanonicalDigest", "getRun", "reserveRun", "claimAttempt",
  "recordLaunchIntent", "observeRunner", "renewAttempt", "appendEvent", "recordResult", "admitDelegatedRequest",
  "expireAttempts", "invalidateRun", "reconcileAttempt", "finishRun",
]);
export const AGENT_EXECUTION_TABLES = Object.freeze([
  "execution_runs", "execution_tasks", "execution_attempts", "execution_events",
  "execution_supervisors", "execution_acceptances", "execution_integrations", "execution_run_validations",
]);
export const AGENT_EXECUTION_LEASE_MS = 60000;
export const AGENT_EXECUTION_HEARTBEAT_MS = 10000;

export function assertAgentExecutionStore(store) {
  if (!store || AGENT_EXECUTION_STORE_METHODS.some(method => typeof store[method] !== "function")) {
    throw new TypeError("AgentExecutionStore requires the complete PostgreSQL supervision port");
  }
  return store;
}

// Additive port: existing qualification doubles keep the historical contract.
// Advanced methods require persistent supervisor ownership; construction never probes.
// recordPreparation stores only {request_sha256,evidence:{ref,sha256,bytes}}.
// recordIntegrationApplied({reconciliation:true}) may record an already applied
// immutable prepared result after the run deadline or canonical revocation. It
// requires recovery state, retained reservation, live supervisor generation and
// fresh Git observation; it never authorizes Git, preparation or execution.
export const AGENT_SUPERVISED_EXECUTION_STORE_METHODS = Object.freeze([
  ...AGENT_EXECUTION_STORE_METHODS, "recordPreparation", "claimSupervisor", "renewSupervisor",
  "expireSupervisor", "reconcileSupervisor", "resumeRun", "recordAcceptance",
  "prepareIntegration", "recordIntegrationApplied", "recordRunValidation",
]);
export function assertAgentSupervisedExecutionStore(store) {
  if (!store || AGENT_SUPERVISED_EXECUTION_STORE_METHODS.some(method => typeof store[method] !== "function")) {
    throw new TypeError("AgentSupervisedExecutionStore requires the complete durable supervision port");
  }
  return store;
}
