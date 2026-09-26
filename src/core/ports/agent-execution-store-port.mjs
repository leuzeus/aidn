// Internal async supervision port. Construction and assertion never probe a
// backend. checkReadiness/getRun/readCanonicalDigest are read-only; migration is
// an independent administrative operation. All mutation methods require a
// PostgreSQL transaction; no transient or local authority implements this port.
export const AGENT_EXECUTION_STORE_METHODS = Object.freeze([
  "checkReadiness", "readCanonicalDigest", "getRun", "reserveRun", "claimAttempt",
  "recordLaunchIntent", "observeRunner", "renewAttempt", "appendEvent", "recordResult",
  "expireAttempts", "invalidateRun", "reconcileAttempt", "finishRun",
]);
export const AGENT_EXECUTION_TABLES = Object.freeze([
  "execution_runs", "execution_tasks", "execution_attempts", "execution_events",
]);
export const AGENT_EXECUTION_LEASE_MS = 60000;
export const AGENT_EXECUTION_HEARTBEAT_MS = 10000;

export function assertAgentExecutionStore(store) {
  if (!store || AGENT_EXECUTION_STORE_METHODS.some(method => typeof store[method] !== "function")) {
    throw new TypeError("AgentExecutionStore requires the complete PostgreSQL supervision port");
  }
  return store;
}
