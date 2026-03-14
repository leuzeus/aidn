function normalizeScalar(value) {
  return String(value ?? "").trim().toLowerCase();
}

function clampNonNegativeInteger(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function evaluateCoordinatorEscalation({
  recommendation,
  loopStatus,
  history,
  summaryAlignment,
} = {}) {
  const repeatedDispatchCount = clampNonNegativeInteger(history?.repeated_dispatch_count);
  const recentFailureCount = clampNonNegativeInteger(history?.recent_failure_count);
  const summaryStatus = normalizeScalar(summaryAlignment?.status || "unknown");
  const normalizedLoopStatus = normalizeScalar(loopStatus || "unknown");

  if (history?.arbitration_applied === true) {
    return {
      status: "resolved_by_user_arbitration",
      level: "none",
      reason: "a newer user arbitration event resolved the current escalation path",
      stop_required: false,
    };
  }

  if (normalizedLoopStatus === "repeat_detected" && repeatedDispatchCount >= 5) {
    return {
      status: "repeat_escalation",
      level: "user_arbitration_required",
      reason: `the same relay was repeated ${repeatedDispatchCount} times without resolution`,
      stop_required: true,
    };
  }

  if (normalizedLoopStatus === "reanchor_after_failure" && recentFailureCount >= 2) {
    return {
      status: "failure_escalation",
      level: "user_arbitration_required",
      reason: `${recentFailureCount} recent coordinator dispatches failed or became non-runnable`,
      stop_required: true,
    };
  }

  if (summaryStatus === "missing" || summaryStatus === "mismatch") {
    return {
      status: "summary_desync",
      level: "watch",
      reason: String(summaryAlignment?.reason ?? "coordination summary is not aligned with history"),
      stop_required: false,
    };
  }

  if (Boolean(recommendation?.stop_required)) {
    return {
      status: "guarded",
      level: "watch",
      reason: "the current recommendation is already gated by a stop requirement",
      stop_required: true,
    };
  }

  return {
    status: "none",
    level: "none",
    reason: "no escalation is currently required",
    stop_required: false,
  };
}
