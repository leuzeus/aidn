function normalizeToken(value, fallback = "unknown") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function countItems(value) {
  return Array.isArray(value) ? value.length : 0;
}

function sharedSyncStatus(result) {
  return normalizeToken(
    result?.shared_coordination_sync?.diagnostic?.sync_status
      ?? result?.shared_coordination_sync?.status
      ?? "unknown",
  );
}

export function deriveCoordinatorNextActionDiagnostic(result) {
  const recommendation = result?.recommendation ?? {};
  const scope = result?.scope ?? {};
  return {
    scope: "coordinator-next-action",
    recommended_role: normalizeToken(recommendation?.role),
    recommended_action: normalizeToken(recommendation?.action),
    source: normalizeToken(recommendation?.source),
    stop_required: recommendation?.stop_required === true,
    scope_type: normalizeToken(scope?.scope_type, "none"),
    scope_id: normalizeToken(scope?.scope_id, "none"),
    summary: normalizeToken(recommendation?.reason, "coordinator recommendation unavailable"),
    recommended_command: "aidn runtime coordinator-dispatch-plan --json",
  };
}

export function deriveCoordinatorDispatchPlanDiagnostic(result) {
  return {
    scope: "coordinator-dispatch-plan",
    selected_agent: normalizeToken(result?.selected_agent?.id),
    recommended_role: normalizeToken(result?.coordinator_recommendation?.role),
    recommended_action: normalizeToken(result?.coordinator_recommendation?.action),
    dispatch_status: normalizeToken(result?.dispatch_status),
    entrypoint_kind: normalizeToken(result?.entrypoint_kind),
    entrypoint_name: normalizeToken(result?.entrypoint_name),
    command_count: countItems(result?.commands),
    summary: `coordinator dispatch plan is ${normalizeToken(result?.dispatch_status)}`,
    recommended_command: "aidn runtime coordinator-orchestrate --max-iterations 1 --json",
  };
}

export function deriveCoordinatorDispatchExecuteDiagnostic(result) {
  return {
    scope: "coordinator-dispatch-execute",
    dispatch_status: normalizeToken(result?.dispatch_status),
    execution_status: normalizeToken(result?.execution_status),
    executed: result?.executed === true,
    selected_agent: normalizeToken(result?.selected_agent?.id),
    recommended_role: normalizeToken(result?.coordinator_recommendation?.role),
    preferred_dispatch_source: normalizeToken(result?.preferred_dispatch_source),
    executed_step_count: countItems(result?.executed_steps),
    shared_sync_status: sharedSyncStatus(result),
    summary: `coordinator dispatch execute is ${normalizeToken(result?.execution_status)}`,
    recommended_command: result?.executed === true
      ? "aidn runtime coordinator-orchestrate --max-iterations 1 --json"
      : "aidn runtime coordinator-resume --json",
  };
}

export function deriveCoordinatorOrchestrationDiagnostic(result) {
  return {
    scope: "coordinator-orchestrate",
    orchestration_status: normalizeToken(result?.orchestration_status),
    execute_requested: result?.execute_requested === true,
    iterations_completed: Number(result?.iterations_completed ?? 0) || 0,
    max_iterations: Number(result?.max_iterations ?? 0) || 0,
    can_continue: result?.can_continue === true,
    stop_reason: normalizeToken(result?.stop_reason, ""),
    preferred_decision: normalizeToken(result?.preferred_decision, ""),
    summary: `coordinator orchestration is ${normalizeToken(result?.orchestration_status)}`,
    recommended_command: "aidn runtime coordinator-resume --json",
  };
}

export function deriveCoordinatorResumeDiagnostic(result) {
  return {
    scope: "coordinator-resume",
    resume_status: normalizeToken(result?.resume_status),
    execution_status: normalizeToken(result?.execution_status),
    arbitration_required: result?.arbitration_required === true,
    arbitration_satisfied: result?.arbitration_satisfied === true,
    preferred_decision: normalizeToken(result?.preferred_decision, "none"),
    preferred_dispatch_source: normalizeToken(result?.preferred_dispatch_source),
    can_resume: result?.can_resume === true,
    execute_requested: result?.execute_requested === true,
    summary: `coordinator resume is ${normalizeToken(result?.resume_status)}`,
    recommended_command: result?.can_resume === true
      ? "aidn runtime coordinator-resume --execute --json"
      : "aidn runtime coordinator-suggest-arbitration --json",
  };
}

export function deriveCoordinatorArbitrationSuggestionDiagnostic(result) {
  return {
    scope: "coordinator-suggest-arbitration",
    dispatch_status: normalizeToken(result?.dispatch_status),
    arbitration_required: result?.arbitration_required === true,
    preferred_decision: normalizeToken(result?.preferred_decision, "none"),
    suggestion_count: countItems(result?.suggestions),
    actionable_suggestion_count: Array.isArray(result?.suggestions)
      ? result.suggestions.filter((item) => item?.immediately_actionable === true).length
      : 0,
    recommended_suggestion_count: Array.isArray(result?.suggestions)
      ? result.suggestions.filter((item) => item?.recommended === true).length
      : 0,
    summary: `coordinator arbitration is ${result?.arbitration_required === true ? "required" : "not required"}`,
    recommended_command: "aidn runtime coordinator-record-arbitration --decision <decision> --note \"<note>\" --json",
  };
}

export function deriveCoordinatorSelectAgentDiagnostic(result) {
  return {
    scope: "coordinator-select-agent",
    requested_agent: normalizeToken(result?.requested_agent, "auto"),
    role: normalizeToken(result?.role),
    action: normalizeToken(result?.action),
    selected_agent: normalizeToken(result?.selection?.selected_agent),
    selection_status: normalizeToken(result?.selection?.status),
    candidate_count: countItems(result?.candidates),
    summary: `agent selection is ${normalizeToken(result?.selection?.status)}`,
    recommended_command: "aidn runtime coordinator-select-agent --role <role> --action <action> --json",
  };
}

export function deriveCoordinatorRecordArbitrationDiagnostic(result) {
  return {
    scope: "coordinator-record-arbitration",
    decision: normalizeToken(result?.arbitration_event?.decision),
    state_mode: normalizeToken(result?.state_mode),
    history_appended: result?.coordination_history_appended === true,
    arbitration_log_appended: result?.arbitration_log_appended === true,
    summary_written: result?.coordination_summary_written === true,
    db_first_applied: result?.arbitration_db_first_applied === true,
    shared_sync_status: sharedSyncStatus(result),
    summary: `user arbitration ${normalizeToken(result?.arbitration_event?.decision)} was recorded`,
    recommended_command: "aidn runtime coordinator-resume --json",
  };
}
