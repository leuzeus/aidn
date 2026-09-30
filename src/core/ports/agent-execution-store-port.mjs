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
  "execution_integration_intents",
  "execution_cancel_requests", "execution_cleanup_operations", "execution_cleanup_resources",
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
// recordIntegrationIntent({runId,supervisor,expectedControlRevision,intent})
// returns {intent,intent_sha256,control_revision,idempotent} before Git effects.
// prepareIntegration binds intentSha256 to the immutable prepared document;
// reconciliation:true only attaches facts in recovery after prior producers
// and their Git descendants have proven termination. Expired absent intentions
// remain reserved; there is no automatic abandonment or purge.
// Plans carrying verification require an injected validationEvidenceVerifier
// with pure getDescriptor() and bounded verify(input,{signal}). Its externally
// configured Ed25519 public key must match the frozen plan pin; authenticated
// evidence observations and their hashes belong to acceptance/final validation.
// No document-supplied key, boolean approval or implicit key creation is valid.
// recordIntegrationApplied({reconciliation:true}) may record an already applied
// immutable prepared result after the run deadline or canonical revocation. It
// requires recovery state, retained reservation, live supervisor generation and
// fresh Git observation; it never authorizes Git, preparation or execution.
export const AGENT_SUPERVISED_EXECUTION_STORE_METHODS = Object.freeze([
  ...AGENT_EXECUTION_STORE_METHODS, "recordPreparation", "claimSupervisor", "renewSupervisor",
  "expireSupervisor", "reconcileSupervisor", "resumeRun", "recordAcceptance",
  "prepareIntegration", "recordIntegrationApplied", "recordRunValidation", "recordIntegrationIntent",
]);
export function assertAgentSupervisedExecutionStore(store) {
  if (!store || AGENT_SUPERVISED_EXECUTION_STORE_METHODS.some(method => typeof store[method] !== "function")) {
    throw new TypeError("AgentSupervisedExecutionStore requires the complete durable supervision port");
  }
  return store;
}

// Public lifecycle composition requires these additional durable methods.
// Existing historical/scheduler doubles retain their previous assertions.
// Cancel requests are immutable and bind both control revision and supervisor
// generation. They stop new work without invalidating terminal worker evidence.
// Cleanup is completed-run-only, with immutable exact resources, a separate
// database-timed owner and mandatory physical/termination inspectors. No takeover
// follows lease expiry alone; all previous cleaner generations must be stopped.
// inspectCleanupAuthority({reconciliation:true}) observes only an already absent
// journaled resource; it never grants a new removal. Normal authority requires
// the exact retained preimage still present. recordCleanupResult includes the
// retention reference as well as any removal observation, and rechecks absence.
// verification_worktree additionally binds snapshot_sha256 to a persisted signed
// evidence observation; the physical inspector verifies the exact run-owned
// descriptor and cwd. Evidence archives and integration/source refs are retained.
export const AGENT_RUN_LIFECYCLE_STORE_METHODS = Object.freeze([
  ...AGENT_SUPERVISED_EXECUTION_STORE_METHODS, "previewRunReservation", "requestCancel",
  "recordSupervisorStopped", "beginCleanup", "renewCleanup", "inspectCleanupAuthority",
  "recordCleanupResult", "reconcileCleanup",
]);
export function assertAgentRunLifecycleStore(store) {
  if (!store || AGENT_RUN_LIFECYCLE_STORE_METHODS.some(method=>typeof store[method]!=="function")) {
    throw new TypeError("AgentRunLifecycleStore requires durable cancellation and cleanup authority");
  }
  return store;
}
