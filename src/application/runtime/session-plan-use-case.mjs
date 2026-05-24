function normalizeScalar(value) {
  const normalized = String(value ?? "").trim();
  if (normalized.startsWith("`") && normalized.endsWith("`") && normalized.length >= 2) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

export function buildSessionPlanDiagnostic(output) {
  const payload = output?.payload ?? {};
  const syncDiagnostic = output?.shared_coordination_sync?.diagnostic ?? null;
  return {
    scope: "runtime-session-plan",
    promoted: output?.promoted === true,
    state_mode: normalizeScalar(output?.state_mode) || "unknown",
    session_id: normalizeScalar(payload?.session_id) || "unknown",
    planning_status: normalizeScalar(payload?.planning_status) || "unknown",
    backlog_operation: normalizeScalar(output?.backlog_operation) || "draft-only",
    db_first_applied: output?.db_first_applied === true,
    shared_sync_status: normalizeScalar(syncDiagnostic?.sync_status || output?.shared_coordination_sync?.status) || "not-attempted",
    summary: output?.promoted === true
      ? `session plan ${normalizeScalar(output?.backlog_operation) || "promoted"} for ${normalizeScalar(payload?.session_id) || "unknown"}`
      : `session plan draft refreshed for ${normalizeScalar(payload?.session_id) || "unknown"}`,
    recommended_action: output?.promoted === true
      ? "review backlog, current-state, and shared sync outputs before dispatching work"
      : "promote the session plan when the backlog is ready to become the active coordination surface",
  };
}
