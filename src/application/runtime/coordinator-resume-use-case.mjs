function normalizeScalar(value) {
  return String(value ?? "").trim();
}

export function deriveCoordinatorSharedPlanningCandidate(dispatch) {
  const sharedPlanning = dispatch?.shared_planning ?? {};
  const recommendation = dispatch?.coordinator_recommendation ?? {};
  const dispatchScope = normalizeScalar(dispatch?.dispatch_scope?.scope_type ?? "none") || "none";
  const nextDispatchScope = normalizeScalar(sharedPlanning.next_dispatch_scope ?? "none") || "none";
  const nextDispatchAction = normalizeScalar(sharedPlanning.next_dispatch_action ?? "none") || "none";
  const recommendationAction = normalizeScalar(recommendation.action ?? "");
  const recommendationRole = normalizeScalar(recommendation.role ?? "");
  const candidateReady = Boolean(sharedPlanning.enabled) && sharedPlanning.dispatch_ready === true;
  const actionAligned = candidateReady && nextDispatchAction !== "none"
    && (
      nextDispatchAction === recommendationAction
      || (recommendationRole === "coordinator" && nextDispatchAction === "coordinate")
    );
  const scopeAligned = candidateReady && nextDispatchScope !== "none"
    && (
      nextDispatchScope === dispatchScope
      || (recommendationRole === "coordinator" && nextDispatchScope === "session")
    );
  const candidateAligned = actionAligned && scopeAligned;
  return {
    enabled: Boolean(sharedPlanning.enabled),
    candidate_ready: candidateReady,
    candidate_aligned: candidateAligned,
    preferred_source: candidateAligned ? "shared_planning" : "workflow",
    next_dispatch_scope: nextDispatchScope,
    next_dispatch_action: nextDispatchAction,
    backlog_next_step: normalizeScalar(sharedPlanning.backlog_next_step ?? "unknown") || "unknown",
  };
}

export function buildCoordinatorResumeBlockedResult({
  absoluteTargetRoot,
  effectiveStateMode,
  dbBackedMode,
  dispatch,
  loopState,
  arbitrationSuggestions,
  executeRequested,
}) {
  const sharedPlanningCandidate = deriveCoordinatorSharedPlanningCandidate(dispatch);
  const escalationReason = arbitrationSuggestions?.arbitration_reason
    || loopState.loop?.escalation?.reason
    || "user arbitration is required before resuming this escalated dispatch";
  return {
    target_root: absoluteTargetRoot,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
    resume_status: "blocked",
    resume_reason: escalationReason,
    arbitration_required: true,
    arbitration_satisfied: false,
    preferred_decision: arbitrationSuggestions?.preferred_decision ?? null,
    preferred_dispatch_source: sharedPlanningCandidate.preferred_source,
    arbitration_suggestions: arbitrationSuggestions,
    shared_planning_candidate: sharedPlanningCandidate,
    execute_requested: Boolean(executeRequested),
    can_resume: false,
    loop: loopState.loop,
    context: loopState.context,
    handoff: loopState.handoff,
    dispatch,
    execution_status: "blocked",
    executed: false,
    execution: null,
  };
}

export function deriveCoordinatorResumeState({ loopState, dispatch }) {
  const arbitrationSatisfied = Boolean(loopState.loop?.history?.arbitration_applied);
  const sharedPlanningCandidate = deriveCoordinatorSharedPlanningCandidate(dispatch);
  const resumeStatus = arbitrationSatisfied ? "resumed_after_arbitration" : "ready";
  const resumeReason = sharedPlanningCandidate.candidate_aligned
    ? (
      arbitrationSatisfied
        ? "shared planning dispatch candidate is ready after user arbitration"
        : "shared planning dispatch candidate is ready"
    )
    : (
      arbitrationSatisfied
        ? "user arbitration is newer than the last escalated dispatch"
        : "no pending escalation blocks this dispatch"
    );
  return {
    arbitration_satisfied: arbitrationSatisfied,
    shared_planning_candidate: sharedPlanningCandidate,
    resume_status: resumeStatus,
    resume_reason: resumeReason,
  };
}

export function buildCoordinatorResumeResult({
  absoluteTargetRoot,
  effectiveStateMode,
  dbBackedMode,
  loopState,
  dispatch,
  resumeState,
  executeRequested,
  execution = null,
}) {
  return {
    target_root: absoluteTargetRoot,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
    resume_status: resumeState.resume_status,
    resume_reason: resumeState.resume_reason,
    arbitration_required: false,
    arbitration_satisfied: resumeState.arbitration_satisfied,
    preferred_dispatch_source: resumeState.shared_planning_candidate.preferred_source,
    shared_planning_candidate: resumeState.shared_planning_candidate,
    execute_requested: Boolean(executeRequested),
    can_resume: true,
    loop: loopState.loop,
    context: loopState.context,
    handoff: loopState.handoff,
    dispatch,
    execution_status: execution ? execution.execution_status : "dry_run",
    executed: Boolean(execution?.executed),
    execution,
  };
}
