// Run-owned local Git resources. Discovery/assertion never launches Git.
export const AGENT_GIT_INTEGRATION_METHODS = Object.freeze([
  "allocateAttemptWorkspace", "initializeIntegration", "prepareAttemptWorkspace", "captureBaseline",
  "captureTaskChanges", "createTaskCommit", "prepareIntegration", "compareAndSwapIntegration", "inspectIntegration",
]);
// Local recovery never becomes an implicit admission or cleanup operation.
export const AGENT_GIT_RECOVERY_METHODS = Object.freeze(["inspectGitOperations", "reconcileGitOperation",
  "allocateIntegrationWorkspace", "inspectLocalIntegration", "prepareVerificationSnapshot", "inspectVerificationSnapshot",
  "prepareUnassignedWorkspace", "sealPreparedAttemptWorkspace", "inspectPreparedAttemptWorkspace", "inspectCleanup", "inspectCleanupBatch", "previewCleanupRetention", "prepareCleanupRetention", "removeOwnedWorktree", "reconcileOwnedWorktreeRemoval"]);
export function assertAgentGitIntegration(port) {
  if (!port || AGENT_GIT_INTEGRATION_METHODS.some(name => typeof port[name] !== "function")) {
    throw new TypeError("AgentGitIntegration requires the complete run-owned Git port");
  }
  if (AGENT_GIT_RECOVERY_METHODS.some(name => port[name] !== undefined && typeof port[name] !== "function")) throw new TypeError("AgentGitIntegration recovery methods must be functions");
  return port;
}
