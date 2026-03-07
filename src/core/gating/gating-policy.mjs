export function shouldSkipGateOnNoSignal({
  autoSkipGateOnNoSignal,
  skipGateEvaluate,
  reload,
  hasWorkingTreeChanges,
}) {
  return autoSkipGateOnNoSignal
    && !skipGateEvaluate
    && reload.decision === "incremental"
    && reload.fallback !== true
    && Array.isArray(reload.reason_codes)
    && reload.reason_codes.length === 0
    && !hasWorkingTreeChanges;
}

export function deriveGatingAction(levels) {
  if (levels.level3.required) {
    return {
      action: "stop_and_triage_incident",
      result: "stop",
      gates_triggered: ["R10"],
      reason_code: levels.level3.reason === "blocking_l1_reason"
        ? "L3_BLOCKING"
        : (levels.level3.reason === "index_sync_high_drift" ? "L3_INDEX_SYNC_DRIFT" : "L3_REPEATED_FALLBACK"),
    };
  }
  if (levels.level2.required) {
    return {
      action: "run_conditional_drift_check",
      result: "warn",
      gates_triggered: ["R05"],
      reason_code: "L2_SIGNAL_TRIGGERED",
    };
  }
  return {
    action: "proceed_l1_fast_checks_only",
    result: "ok",
    gates_triggered: ["R03", "R04"],
    reason_code: null,
  };
}
