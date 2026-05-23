export const COORDINATOR_ALLOWED_ARBITRATION_DECISIONS = new Set([
  "continue",
  "reanchor",
  "repair",
  "audit",
  "integration_cycle",
  "report_forward",
  "rework_from_example",
]);

export function buildCoordinatorArbitrationAppendedMarkdown(current, entry, header) {
  const normalizedCurrent = String(current ?? "");
  const base = normalizedCurrent.length > 0 ? normalizedCurrent : header;
  return base.endsWith("\n\n") || base.length === 0
    ? `${base}${entry}`
    : `${base}\n${entry}`;
}

export function buildCoordinatorArbitrationEvent({ decision, note, goal }) {
  return {
    ts: new Date().toISOString(),
    event: "user_arbitration",
    decision,
    note,
    goal: goal || "",
    resolved: true,
  };
}

export function buildCoordinatorArbitrationLogEntry(event) {
  const lines = [];
  lines.push(`## Arbitration ${event.ts}`);
  lines.push("");
  lines.push(`timestamp: ${event.ts}`);
  lines.push(`decision: ${event.decision}`);
  lines.push(`note: ${event.note}`);
  lines.push(`goal_override: ${event.goal || "none"}`);
  lines.push(`resolved: ${event.resolved ? "yes" : "no"}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function buildCoordinatorRecordArbitrationResult({
  absoluteTargetRoot,
  workspace,
  sharedCoordinationBackend,
  sharedCoordinationSync,
  effectiveStateMode,
  arbitrationPath,
  historyPath,
  summaryPath,
  arbitrationLogAppended,
  arbitrationDbFirst,
  summary,
  event,
}) {
  return {
    target_root: absoluteTargetRoot,
    workspace,
    shared_coordination_backend: sharedCoordinationBackend,
    shared_coordination_sync: sharedCoordinationSync,
    state_mode: effectiveStateMode,
    arbitration_file: arbitrationPath,
    coordination_history_file: historyPath,
    coordination_summary_file: summaryPath,
    arbitration_log_appended: arbitrationLogAppended,
    arbitration_db_first_applied: Boolean(arbitrationDbFirst),
    arbitration_db_first_materialized: Boolean(arbitrationDbFirst?.materialized),
    coordination_history_appended: true,
    coordination_summary_written: Boolean(summary?.written),
    arbitration_event: event,
    coordination_summary: summary,
  };
}
