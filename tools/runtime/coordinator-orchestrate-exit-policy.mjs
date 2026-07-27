export const COORDINATOR_ORCHESTRATE_EXIT_POLICY = Object.freeze({
  nonzero_failure_termination: "deferred-process-exit-code",
  immediate_nonzero_process_exit_allowed: false,
  help_exit_code: 0,
});

export function deferCoordinatorOrchestrateFailureExit() {
  process.exitCode = 1;
}
