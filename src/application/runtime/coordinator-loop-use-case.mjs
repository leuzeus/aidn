function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function parseSimpleMap(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_]+):\s*(.+)$/);
    if (!match) {
      continue;
    }
    map.set(match[1], normalizeScalar(match[2]));
  }
  return map;
}

function parseInteger(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

const FAILURE_STATUSES = new Set(["failed", "unsupported", "no_steps"]);

function sameDispatchIdentity(left, right) {
  return normalizeScalar(left?.recommended_role) === normalizeScalar(right?.recommended_role)
    && normalizeScalar(left?.recommended_action) === normalizeScalar(right?.recommended_action)
    && normalizeScalar(left?.goal) === normalizeScalar(right?.goal);
}

function sameRecommendation(entry, recommendation) {
  return normalizeScalar(entry?.recommended_role) === normalizeScalar(recommendation?.role)
    && normalizeScalar(entry?.recommended_action) === normalizeScalar(recommendation?.action)
    && normalizeScalar(entry?.goal) === normalizeScalar(recommendation?.goal);
}

function summarizeHistory(entries) {
  const dispatchEntries = entries.filter((entry) => normalizeScalar(entry?.event || "coordinator_dispatch") === "coordinator_dispatch");
  const arbitrationEntries = entries.filter((entry) => normalizeScalar(entry?.event) === "user_arbitration");
  const total = dispatchEntries.length;
  const last = total > 0 ? dispatchEntries[total - 1] : null;
  const lastArbitration = arbitrationEntries.length > 0 ? arbitrationEntries[arbitrationEntries.length - 1] : null;
  let repeatedDispatchCount = 0;
  if (last) {
    for (let index = dispatchEntries.length - 1; index >= 0; index -= 1) {
      if (!sameDispatchIdentity(dispatchEntries[index], last)) {
        break;
      }
      repeatedDispatchCount += 1;
    }
  }
  const recentFailureCount = dispatchEntries
    .slice(-5)
    .filter((entry) => FAILURE_STATUSES.has(normalizeScalar(entry?.execution_status).toLowerCase()))
    .length;
  const lastDispatchTs = Date.parse(String(last?.ts ?? ""));
  const lastArbitrationTs = Date.parse(String(lastArbitration?.ts ?? ""));
  const arbitrationApplied = Boolean(lastArbitration)
    && (Number.isNaN(lastDispatchTs) || (!Number.isNaN(lastArbitrationTs) && lastArbitrationTs >= lastDispatchTs));
  return {
    total_dispatches: total,
    last_dispatch: last
      ? {
        ts: normalizeScalar(last.ts || "unknown") || "unknown",
        recommended_role: normalizeScalar(last.recommended_role || "unknown") || "unknown",
        recommended_action: normalizeScalar(last.recommended_action || "unknown") || "unknown",
        goal: normalizeScalar(last.goal || "unknown") || "unknown",
        dispatch_status: normalizeScalar(last.dispatch_status || "unknown") || "unknown",
        execution_status: normalizeScalar(last.execution_status || "unknown") || "unknown",
        stop_required: Boolean(last.stop_required),
      }
      : null,
    repeated_dispatch_count: repeatedDispatchCount,
    recent_failure_count: recentFailureCount,
    history_status: total > 0 ? "available" : "empty",
    total_arbitrations: arbitrationEntries.length,
    last_arbitration: lastArbitration
      ? {
        ts: normalizeScalar(lastArbitration.ts || "unknown") || "unknown",
        decision: normalizeScalar(lastArbitration.decision || "unknown") || "unknown",
        note: normalizeScalar(lastArbitration.note || "unknown") || "unknown",
        goal: normalizeScalar(lastArbitration.goal || "") || "",
      }
      : null,
    arbitration_applied: arbitrationApplied,
  };
}

function parseCoordinationSummary(text) {
  if (!String(text).trim()) {
    return {
      status: "missing",
      total_dispatches: null,
      last_recommended_role: "unknown",
      last_recommended_action: "unknown",
      last_execution_status: "unknown",
    };
  }
  const map = parseSimpleMap(text);
  return {
    status: normalizeScalar(map.get("history_status") ?? "unknown") || "unknown",
    total_dispatches: parseInteger(map.get("total_dispatches")),
    last_recommended_role: normalizeScalar(map.get("last_recommended_role") ?? "unknown") || "unknown",
    last_recommended_action: normalizeScalar(map.get("last_recommended_action") ?? "unknown") || "unknown",
    last_execution_status: normalizeScalar(map.get("last_execution_status") ?? "unknown") || "unknown",
  };
}

function deriveSummaryAlignment(summary, history) {
  if (summary.status === "missing") {
    return {
      status: history.total_dispatches === 0 ? "not_required" : "missing",
      reason: history.total_dispatches === 0
        ? "no coordination history exists yet"
        : "coordination summary is missing while history entries exist",
    };
  }
  if (Number.isInteger(summary.total_dispatches) && summary.total_dispatches !== history.total_dispatches) {
    return {
      status: "mismatch",
      reason: `summary.total_dispatches=${summary.total_dispatches} history.total_dispatches=${history.total_dispatches}`,
    };
  }
  if (history.last_dispatch
    && (summary.last_recommended_role !== history.last_dispatch.recommended_role
      || summary.last_recommended_action !== history.last_dispatch.recommended_action
      || summary.last_execution_status !== history.last_dispatch.execution_status)) {
    return {
      status: "mismatch",
      reason: "summary last dispatch fields are not aligned with coordination history",
    };
  }
  return {
    status: "aligned",
    reason: "summary fields are aligned with coordination history",
  };
}

function buildFailureRecoveryRecommendation(lastDispatch) {
  const failedRole = normalizeScalar(lastDispatch?.recommended_role || "unknown") || "unknown";
  const failedAction = normalizeScalar(lastDispatch?.recommended_action || "unknown") || "unknown";
  const failedStatus = normalizeScalar(lastDispatch?.execution_status || "unknown") || "unknown";
  return {
    role: "coordinator",
    action: "reanchor",
    goal: `reanchor after ${failedStatus} relay for ${failedRole} + ${failedAction}`,
    source: "coordination-history",
    reason: "the latest coordinator dispatch did not complete successfully",
    stop_required: false,
  };
}

function buildRepeatRecoveryRecommendation(recommendation, repeatCount) {
  return {
    role: "coordinator",
    action: "coordinate",
    goal: `review repeated relay loop before rerunning ${recommendation.role} + ${recommendation.action}`,
    source: "coordination-history",
    reason: `the same relay was selected ${repeatCount} times in a row`,
    stop_required: false,
  };
}

function buildEscalationRecommendation(escalation) {
  return {
    role: "coordinator",
    action: "coordinate",
    goal: "request user arbitration before another coordinator dispatch",
    source: "coordination-escalation",
    reason: escalation.reason,
    stop_required: true,
  };
}

function buildArbitrationRecommendation(baseRecommendation, arbitration) {
  const decision = normalizeScalar(arbitration?.decision || "unknown");
  const goalOverride = normalizeScalar(arbitration?.goal || "");
  if (decision === "reanchor") {
    return {
      role: "coordinator",
      action: "reanchor",
      goal: goalOverride || "reanchor current session, cycle, and runtime facts before continuing",
      source: "user_arbitration",
      reason: "user arbitration redirected the loop to reanchor",
      stop_required: false,
    };
  }
  if (decision === "repair") {
    return {
      role: "repair",
      action: "repair",
      goal: goalOverride || "resume with repair-first routing after user arbitration",
      source: "user_arbitration",
      reason: "user arbitration redirected the loop to repair",
      stop_required: true,
    };
  }
  if (decision === "audit") {
    return {
      role: "auditor",
      action: "audit",
      goal: goalOverride || "run an audit pass after user arbitration",
      source: "user_arbitration",
      reason: "user arbitration redirected the loop to audit",
      stop_required: false,
    };
  }
  if (decision === "integration_cycle") {
    return {
      role: "coordinator",
      action: "coordinate",
      goal: goalOverride || "open a dedicated integration cycle for the candidate session cycles",
      source: "user_arbitration",
      reason: "user arbitration selected an explicit integration vehicle",
      stop_required: false,
    };
  }
  if (decision === "report_forward") {
    return {
      role: "coordinator",
      action: "coordinate",
      goal: goalOverride || "report the candidate cycles forward instead of integrating them now",
      source: "user_arbitration",
      reason: "user arbitration deferred the integration path",
      stop_required: false,
    };
  }
  if (decision === "rework_from_example") {
    return {
      role: "coordinator",
      action: "coordinate",
      goal: goalOverride || "open a dedicated integration vehicle and replay the selected cycles from example",
      source: "user_arbitration",
      reason: "user arbitration chose replay-based integration over mechanical merge",
      stop_required: false,
    };
  }
  return {
    ...baseRecommendation,
    goal: goalOverride || baseRecommendation.goal,
    source: "user_arbitration",
    reason: "user arbitration explicitly allowed the next relay to continue",
  };
}

function deriveCoordinatorLoopDiagnostic(result) {
  return {
    scope: "coordinator-loop",
    loop_status: String(result?.loop?.status ?? "unknown").trim() || "unknown",
    recommended_role: String(result?.recommendation?.role ?? "unknown").trim() || "unknown",
    recommended_action: String(result?.recommendation?.action ?? "unknown").trim() || "unknown",
    summary_alignment: String(result?.loop?.summary_alignment?.status ?? "unknown").trim() || "unknown",
    escalation_level: String(result?.loop?.escalation?.level ?? "unknown").trim() || "unknown",
    history_status: String(result?.loop?.history?.history_status ?? "unknown").trim() || "unknown",
    repeated_dispatch_count: Number(result?.loop?.history?.repeated_dispatch_count ?? 0) || 0,
    summary: `coordinator loop is ${String(result?.loop?.status ?? "unknown").trim() || "unknown"}`,
    recommended_command: "aidn runtime coordinator-dispatch-plan --json",
  };
}

export {
  buildArbitrationRecommendation,
  buildEscalationRecommendation,
  buildFailureRecoveryRecommendation,
  buildRepeatRecoveryRecommendation,
  deriveCoordinatorLoopDiagnostic,
  deriveSummaryAlignment,
  parseCoordinationSummary,
  sameRecommendation,
  summarizeHistory,
};
