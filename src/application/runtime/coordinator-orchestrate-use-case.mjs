export function buildCoordinatorResumeOptions(args, execute) {
  return {
    targetRoot: args.target,
    agent: args.agent,
    currentStateFile: args.currentStateFile,
    runtimeStateFile: args.runtimeStateFile,
    packetFile: args.packetFile,
    agentRosterFile: args.agentRosterFile,
    historyFile: args.historyFile,
    summaryFile: args.summaryFile,
    coordinationLogFile: args.coordinationLogFile,
    coordinationSummaryFile: args.coordinationSummaryFile,
    coordinationHistoryFile: args.coordinationHistoryFile,
    execute,
    sharedCoordination: args.sharedCoordination ?? null,
    sharedCoordinationOptions: args.sharedCoordinationOptions ?? {},
  };
}

export function sameCoordinatorDispatch(left, right) {
  const leftRecommendation = left?.dispatch?.coordinator_recommendation;
  const rightRecommendation = right?.dispatch?.coordinator_recommendation;
  return String(leftRecommendation?.role ?? "").trim() === String(rightRecommendation?.role ?? "").trim()
    && String(leftRecommendation?.action ?? "").trim() === String(rightRecommendation?.action ?? "").trim()
    && String(leftRecommendation?.goal ?? "").trim() === String(rightRecommendation?.goal ?? "").trim();
}

export function buildCoordinatorArbitrationSurface(preview) {
  return {
    arbitration_required: Boolean(preview?.arbitration_required),
    preferred_decision: preview?.preferred_decision ?? preview?.arbitration_suggestions?.preferred_decision ?? null,
    arbitration_suggestions: preview?.arbitration_suggestions ?? null,
    preferred_dispatch_source: preview?.preferred_dispatch_source ?? "workflow",
    shared_planning_candidate: preview?.shared_planning_candidate ?? null,
  };
}

function buildBaseResult({
  args,
  effectiveStateMode,
  dbBackedMode,
  executeRequested,
  orchestrationStatus,
  stopReason,
  iterationsCompleted,
  canContinue,
  initialPreview,
  lastPreview,
  runs,
}) {
  return {
    target_root: args.target,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
    orchestration_status: orchestrationStatus,
    stop_reason: stopReason,
    execute_requested: executeRequested,
    max_iterations: args.maxIterations,
    iterations_completed: iterationsCompleted,
    can_continue: canContinue,
    initial_preview: initialPreview,
    last_preview: lastPreview,
    ...buildCoordinatorArbitrationSurface(lastPreview),
    runs,
  };
}

export function buildCoordinatorOrchestrationDryRunResult({
  args,
  effectiveStateMode,
  dbBackedMode,
  initialPreview,
}) {
  return buildBaseResult({
    args,
    effectiveStateMode,
    dbBackedMode,
    executeRequested: false,
    orchestrationStatus: initialPreview.can_resume ? "dry_run" : "blocked",
    stopReason: initialPreview.can_resume
      ? "dry_run_only"
      : "resume_blocked_until_user_arbitration",
    iterationsCompleted: 0,
    canContinue: initialPreview.can_resume,
    initialPreview,
    lastPreview: initialPreview,
    runs: [],
  });
}

export function buildCoordinatorOrchestrationInitialBlockedResult({
  args,
  effectiveStateMode,
  dbBackedMode,
  initialPreview,
}) {
  return buildBaseResult({
    args,
    effectiveStateMode,
    dbBackedMode,
    executeRequested: true,
    orchestrationStatus: "blocked",
    stopReason: "resume_blocked_until_user_arbitration",
    iterationsCompleted: 0,
    canContinue: false,
    initialPreview,
    lastPreview: initialPreview,
    runs: [],
  });
}

export function buildCoordinatorOrchestrationResult({
  args,
  effectiveStateMode,
  dbBackedMode,
  orchestrationStatus,
  stopReason,
  initialPreview,
  lastPreview,
  runs,
}) {
  return buildBaseResult({
    args,
    effectiveStateMode,
    dbBackedMode,
    executeRequested: true,
    orchestrationStatus,
    stopReason,
    iterationsCompleted: runs.length,
    canContinue: orchestrationStatus === "executed" || orchestrationStatus === "paused",
    initialPreview,
    lastPreview,
    runs,
  });
}
