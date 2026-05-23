import { WORKFLOW_REPAIR_HINT } from "./workflow-transition-constants.mjs";
import { buildWorkflowRoute } from "./workflow-transition-lib.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function canonicalNone(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return normalized === "none" || normalized === "(none)";
}

function canonicalUnknown(value) {
  return normalizeScalar(value).toLowerCase() === "unknown";
}

export function deriveCoordinatorFallbackRecommendation(currentState, runtimeMap, nextActions) {
  const mode = normalizeScalar(currentState?.mode ?? "unknown") || "unknown";
  const activeSession = normalizeScalar(currentState?.active_session ?? "none") || "none";
  const activeCycle = normalizeScalar(currentState?.active_cycle ?? "none") || "none";
  const dorState = normalizeScalar(currentState?.dor_state ?? "unknown") || "unknown";
  const firstPlanStep = normalizeScalar(currentState?.first_plan_step ?? "unknown") || "unknown";
  const activeBacklog = normalizeScalar(currentState?.active_backlog ?? "none") || "none";
  const backlogNextStep = normalizeScalar(currentState?.backlog_next_step ?? "unknown") || "unknown";
  const sharedPlanningSource = normalizeScalar(currentState?.shared_planning_source ?? "current-state") || "current-state";
  const repairRouting = normalizeScalar(runtimeMap.get("repair_routing_hint") ?? runtimeMap.get("repair_layer_status") ?? "unknown").toLowerCase();
  const repairAdvice = normalizeScalar(runtimeMap.get("repair_routing_reason") ?? runtimeMap.get("repair_layer_advice") ?? "");
  const sharedPlanningGoal = !canonicalNone(activeBacklog) && !canonicalUnknown(activeBacklog) && backlogNextStep && !canonicalUnknown(backlogNextStep)
    ? backlogNextStep
    : "";
  const sharedPlanningRouteSource = sharedPlanningGoal && sharedPlanningSource === "shared-coordination"
    ? "current-state-shared-planning"
    : "current-state";

  if (repairRouting === "repair" || repairRouting === "block") {
    return buildWorkflowRoute({
      role: "repair",
      action: "repair",
      goal: repairAdvice || "resolve blocking repair findings before continuing",
      source: "runtime-state",
      reason: "runtime repair routing is blocking",
      stop_required: true,
    });
  }
  if (repairRouting === WORKFLOW_REPAIR_HINT.AUDIT_FIRST) {
    return buildWorkflowRoute({
      role: "auditor",
      action: "audit",
      goal: repairAdvice || "review runtime warnings before continuing implementation",
      source: "runtime-state",
      reason: "runtime repair routing requires an audit-first pass",
      stop_required: false,
    });
  }
  if (mode === "COMMITTING" && !canonicalNone(activeCycle) && !canonicalUnknown(activeCycle) && dorState === "READY" && firstPlanStep && !canonicalUnknown(firstPlanStep)) {
    return buildWorkflowRoute({
      role: "executor",
      action: "implement",
      goal: firstPlanStep,
      source: "current-state",
      reason: "current state is ready for committing execution",
      stop_required: false,
    });
  }
  if (mode === "EXPLORING") {
    return buildWorkflowRoute({
      role: "auditor",
      action: "analyze",
      goal: sharedPlanningGoal || nextActions[0] || "continue analysis and validate the next hypothesis",
      source: sharedPlanningRouteSource,
      reason: sharedPlanningGoal
        ? "shared session backlog defines the next planning step for analysis"
        : "exploring mode favors audit/analyze routing",
      stop_required: false,
    });
  }
  if (mode === "THINKING") {
    return buildWorkflowRoute({
      role: "coordinator",
      action: "coordinate",
      goal: sharedPlanningGoal || nextActions[0] || "restate the objective and smallest compliant next step",
      source: sharedPlanningRouteSource,
      reason: sharedPlanningGoal
        ? "shared session backlog defines the next coordination step"
        : "thinking mode favors coordination before execution",
      stop_required: false,
    });
  }
  if (canonicalNone(activeSession) && canonicalNone(activeCycle)) {
    return buildWorkflowRoute({
      role: "coordinator",
      action: "reanchor",
      goal: "reload the active session, cycle, and runtime facts before acting",
      source: "current-state",
      reason: "no active session or cycle is declared",
      stop_required: false,
    });
  }
  return buildWorkflowRoute({
    role: "coordinator",
    action: "coordinate",
    goal: nextActions[0] ?? "review the active artifacts and select the smallest compliant next step",
    source: "current-state",
    reason: "fallback coordination path",
    stop_required: false,
  });
}

export function deriveCoordinatorFallbackScope(currentMap) {
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
  const cycleBranch = normalizeScalar(currentMap.get("cycle_branch") ?? "none") || "none";
  const sessionBranch = normalizeScalar(currentMap.get("session_branch") ?? "none") || "none";
  if (!canonicalNone(activeCycle) && !canonicalUnknown(activeCycle)) {
    return {
      scope_type: "cycle",
      scope_id: activeCycle,
      target_branch: !canonicalNone(cycleBranch) && !canonicalUnknown(cycleBranch) ? cycleBranch : "none",
    };
  }
  if (!canonicalNone(activeSession) && !canonicalUnknown(activeSession)) {
    return {
      scope_type: "session",
      scope_id: activeSession,
      target_branch: !canonicalNone(sessionBranch) && !canonicalUnknown(sessionBranch) ? sessionBranch : "none",
    };
  }
  return {
    scope_type: "none",
    scope_id: "none",
    target_branch: "none",
  };
}

export function deriveCoordinatorSharedPlanningCandidate(handoff) {
  return {
    preferred_dispatch_source: normalizeScalar(handoff?.preferred_dispatch_source ?? "workflow") || "workflow",
    shared_planning_candidate_ready: normalizeScalar(handoff?.shared_planning_candidate_ready ?? "no") || "no",
    shared_planning_candidate_aligned: normalizeScalar(handoff?.shared_planning_candidate_aligned ?? "no") || "no",
    shared_planning_dispatch_scope: normalizeScalar(handoff?.shared_planning_dispatch_scope ?? "none") || "none",
    shared_planning_dispatch_action: normalizeScalar(handoff?.shared_planning_dispatch_action ?? "none") || "none",
  };
}

export function buildCoordinatorNextActionResult({
  targetRoot,
  currentStateResolution,
  runtimeStateResolution,
  packetResolution,
  packetResolutionInfo,
  handoff,
  sharedRelay,
  recommendation,
  scope,
  currentMap,
  runtimeMap,
  nextActions,
  sharedPlanning,
} = {}) {
  return {
    target_root: targetRoot,
    current_state_file: currentStateResolution.exists ? currentStateResolution.logicalPath : "none",
    runtime_state_file: runtimeStateResolution.exists ? runtimeStateResolution.logicalPath : "none",
    packet_file: handoff?.source === "shared-coordination"
      ? (normalizeScalar(sharedRelay?.handoff_packet_ref) || "shared-coordination://handoff_relays")
      : (packetResolution.exists ? packetResolution.logicalPath : "none"),
    packet_resolution: packetResolutionInfo,
    handoff,
    preferred_dispatch_source: handoff
      ? (normalizeScalar(handoff.preferred_dispatch_source ?? "workflow") || "workflow")
      : "workflow",
    shared_planning_candidate: handoff ? deriveCoordinatorSharedPlanningCandidate(handoff) : null,
    recommendation,
    scope,
    context: {
      mode: normalizeScalar(currentMap.get("mode") ?? "unknown") || "unknown",
      active_session: normalizeScalar(currentMap.get("active_session") ?? "none") || "none",
      active_cycle: normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none",
      dor_state: normalizeScalar(currentMap.get("dor_state") ?? "unknown") || "unknown",
      repair_routing_hint: normalizeScalar(runtimeMap.get("repair_routing_hint") ?? runtimeMap.get("repair_layer_status") ?? "unknown") || "unknown",
      next_actions: nextActions,
      current_state_source: currentStateResolution.source,
      runtime_state_source: runtimeStateResolution.source,
      shared_planning_source: sharedPlanning.shared_planning_source,
      shared_planning_read_status: sharedPlanning.shared_planning_read_status,
      active_backlog: sharedPlanning.active_backlog,
      backlog_next_step: sharedPlanning.backlog_next_step,
      planning_arbitration_status: sharedPlanning.planning_arbitration_status,
      packet_source: handoff?.source === "shared-coordination"
        ? "shared-coordination"
        : packetResolution.source,
      packet_resolution: packetResolutionInfo,
    },
  };
}
