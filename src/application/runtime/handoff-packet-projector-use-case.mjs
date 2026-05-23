export function buildHandoffPacketMarkdown(packet) {
  const lines = [];
  lines.push("# Handoff Packet");
  lines.push("");
  lines.push("Purpose:");
  lines.push("");
  lines.push("- provide a short, deterministic handoff digest between agents");
  lines.push("- reduce restart cost for long sessions or multi-window work");
  lines.push("- point the next agent to the minimum artifact set before acting");
  lines.push("");
  lines.push("Rule/State boundary:");
  lines.push("");
  lines.push("- this file is a state digest, not a canonical workflow rules file");
  lines.push("- keep canonical workflow rules in `docs/audit/SPEC.md`");
  lines.push("- keep local policy extensions in `docs/audit/WORKFLOW.md`");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`updated_at: ${packet.updated_at}`);
  lines.push(`project_id: ${packet.project_id}`);
  lines.push(`project_id_source: ${packet.project_id_source}`);
  lines.push(`project_root: ${packet.project_root}`);
  lines.push(`workspace_id: ${packet.workspace_id}`);
  lines.push(`workspace_id_source: ${packet.workspace_id_source}`);
  lines.push(`worktree_id: ${packet.worktree_id}`);
  lines.push(`is_linked_worktree: ${packet.is_linked_worktree}`);
  lines.push(`shared_runtime_mode: ${packet.shared_runtime_mode}`);
  lines.push(`shared_runtime_validation_status: ${packet.shared_runtime_validation_status}`);
  lines.push(`shared_runtime_locator_ref: ${packet.shared_runtime_locator_ref}`);
  lines.push(`shared_backend_kind: ${packet.shared_backend_kind}`);
  lines.push(`handoff_status: ${packet.handoff_status}`);
  lines.push(`handoff_from_agent_role: ${packet.handoff_from_agent_role}`);
  lines.push(`handoff_from_agent_action: ${packet.handoff_from_agent_action}`);
  lines.push(`recommended_next_agent_role: ${packet.recommended_next_agent_role}`);
  lines.push(`recommended_next_agent_action: ${packet.recommended_next_agent_action}`);
  lines.push(`next_agent_goal: ${packet.next_agent_goal}`);
  lines.push(`scope_type: ${packet.scope_type}`);
  lines.push(`scope_id: ${packet.scope_id}`);
  lines.push(`target_branch: ${packet.target_branch}`);
  lines.push(`backlog_refs: ${packet.backlog_refs}`);
  lines.push(`planning_arbitration_status: ${packet.planning_arbitration_status}`);
  lines.push(`preferred_dispatch_source: ${packet.preferred_dispatch_source}`);
  lines.push(`shared_planning_candidate_ready: ${packet.shared_planning_candidate_ready}`);
  lines.push(`shared_planning_candidate_aligned: ${packet.shared_planning_candidate_aligned}`);
  lines.push(`shared_planning_dispatch_scope: ${packet.shared_planning_dispatch_scope}`);
  lines.push(`shared_planning_dispatch_action: ${packet.shared_planning_dispatch_action}`);
  lines.push(`shared_planning_freshness: ${packet.shared_planning_freshness}`);
  lines.push(`shared_planning_freshness_basis: ${packet.shared_planning_freshness_basis}`);
  lines.push(`shared_planning_gate_status: ${packet.shared_planning_gate_status}`);
  lines.push(`shared_planning_gate_reason: ${packet.shared_planning_gate_reason}`);
  lines.push(`transition_policy_status: ${packet.transition_policy_status}`);
  lines.push(`transition_policy_reason: ${packet.transition_policy_reason}`);
  lines.push("");
  lines.push("## Active Context");
  lines.push("");
  lines.push(`mode: ${packet.mode}`);
  lines.push(`branch_kind: ${packet.branch_kind}`);
  lines.push(`active_session: ${packet.active_session}`);
  lines.push(`active_cycle: ${packet.active_cycle}`);
  lines.push(`dor_state: ${packet.dor_state}`);
  lines.push(`first_plan_step: ${packet.first_plan_step}`);
  lines.push(`active_backlog: ${packet.active_backlog}`);
  lines.push(`backlog_status: ${packet.backlog_status}`);
  lines.push(`backlog_next_step: ${packet.backlog_next_step}`);
  lines.push(`linked_backlog_cycles: ${packet.linked_backlog_cycles.length > 0 ? packet.linked_backlog_cycles.join(", ") : "none"}`);
  lines.push("");
  lines.push("## Runtime Signals");
  lines.push("");
  lines.push(`runtime_state_mode: ${packet.runtime_state_mode}`);
  lines.push(`repair_layer_status: ${packet.repair_layer_status}`);
  lines.push(`repair_primary_reason: ${packet.repair_primary_reason}`);
  lines.push(`repair_routing_hint: ${packet.repair_routing_hint}`);
  lines.push(`current_state_freshness: ${packet.current_state_freshness}`);
  lines.push("");
  lines.push("## Blocking Findings");
  lines.push("");
  lines.push("blocking_findings:");
  if (packet.blocking_findings.length === 0) {
    lines.push("- none");
  } else {
    for (const item of packet.blocking_findings) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("");
  lines.push("## Prioritized Reads");
  lines.push("");
  lines.push("prioritized_artifacts:");
  for (const item of packet.prioritized_artifacts) {
    lines.push(`- \`${item}\``);
  }
  lines.push("");
  lines.push("## Handoff Guidance");
  lines.push("");
  lines.push("- `ready`: the next agent can resume from the prioritized artifacts and restate the workflow context before writing");
  lines.push("- `refresh_required`: the next agent must reload session/cycle facts before any durable write");
  lines.push("- `blocked`: the next agent must resolve runtime blocking findings or workflow contradictions before continuing");
  lines.push("- stale shared planning is a warning signal; reload the referenced backlog before replacing the relay intent");
  lines.push("");
  lines.push("## Handoff Intent");
  lines.push("");
  lines.push(`handoff_note: ${packet.handoff_note}`);
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(`- Current-state consistency: ${packet.consistency_status}`);
  lines.push(`- Session file: ${packet.session_file}`);
  lines.push(`- Cycle status: ${packet.cycle_status_file}`);
  lines.push("- Refresh this packet after significant session/cycle state changes when work is likely to continue in another agent.");
  lines.push("- In `dual` / `db-only`, refresh this packet after refreshing `docs/audit/RUNTIME-STATE.md`.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

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

function uniqueItems(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeScalar(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseListSection(text, header) {
  const lines = String(text).split(/\r?\n/);
  const items = [];
  let active = false;
  for (const line of lines) {
    if (line.trim() === `${header}:`) {
      active = true;
      continue;
    }
    if (active && (/^[A-Za-z0-9_]+:\s*/.test(line) || /^##\s+/.test(line))) {
      break;
    }
    if (active) {
      const match = line.match(/^\s*-\s+(.+)$/);
      if (match) {
        const item = normalizeArtifactRef(match[1]);
        if (item && item.toLowerCase() !== "none") {
          items.push(item);
        }
      }
    }
  }
  return items;
}

function normalizeArtifactRef(value) {
  const normalized = normalizeScalar(value).replace(/^`+|`+$/g, "");
  return normalized;
}

function normalizeBacklogRef(value) {
  const normalized = normalizeScalar(value);
  if (!normalized || canonicalNone(normalized) || canonicalUnknown(normalized)) {
    return "none";
  }
  if (normalized.startsWith("docs/audit/")) {
    return normalized;
  }
  if (normalized.startsWith("backlog/")) {
    return `docs/audit/${normalized}`;
  }
  return normalized;
}

export function deriveHandoffStatus({ consistency, runtimeMap, currentMap }) {
  const repairStatus = normalizeScalar(runtimeMap.get("repair_layer_status") ?? "unknown").toLowerCase();
  const freshness = normalizeScalar(runtimeMap.get("current_state_freshness") ?? "unknown").toLowerCase();
  const mode = normalizeScalar(currentMap.get("mode") ?? "unknown").toLowerCase();
  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none").toLowerCase();
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none").toLowerCase();
  if (repairStatus === "block") {
    return "blocked";
  }
  if (mode === "unknown" || (activeSession === "none" && activeCycle === "none")) {
    return "refresh_required";
  }
  if (freshness === "stale" || consistency.pass === false) {
    return "refresh_required";
  }
  return "ready";
}

export function deriveNextAgentRouting({ handoffStatus, mode, repairStatus, repairHints }) {
  const normalizedRepair = normalizeScalar(repairStatus).toLowerCase();
  if (
    handoffStatus === "blocked"
    || normalizedRepair === "block"
    || normalizedRepair === repairHints.REPAIR
  ) {
    return { role: "repair", action: "repair" };
  }
  if (normalizedRepair === repairHints.AUDIT_FIRST) {
    return { role: "auditor", action: "audit" };
  }
  if (handoffStatus === "refresh_required") {
    return { role: "coordinator", action: "reanchor" };
  }
  if (mode === "COMMITTING") {
    return { role: "executor", action: "implement" };
  }
  if (mode === "EXPLORING") {
    return { role: "auditor", action: "analyze" };
  }
  return { role: "coordinator", action: "coordinate" };
}

export function deriveNextAgentGoal({
  explicitGoal,
  handoffStatus,
  mode,
  repairStatus,
  repairHints,
  repairAdvice,
  firstPlanStep,
  backlogNextStep,
  blockingFindings,
}) {
  const manualGoal = normalizeScalar(explicitGoal);
  if (manualGoal) {
    return manualGoal;
  }
  if (
    handoffStatus === "blocked"
    || repairStatus === "block"
    || repairStatus === repairHints.REPAIR
  ) {
    const topFinding = normalizeScalar(blockingFindings[0] ?? "");
    if (topFinding) {
      return `resolve blocking finding: ${topFinding}`;
    }
    return "resolve blocking repair-layer or workflow findings before continuing";
  }
  if (repairStatus === repairHints.AUDIT_FIRST) {
    const normalizedAdvice = normalizeScalar(repairAdvice);
    if (normalizedAdvice && normalizedAdvice.toLowerCase() !== "unknown") {
      return `review runtime warnings first: ${normalizedAdvice}`;
    }
    return "review runtime warnings and validate the relay before implementation";
  }
  if (handoffStatus === "refresh_required") {
    return "reanchor current session, cycle, and runtime facts before any durable write";
  }
  if (backlogNextStep && !canonicalUnknown(backlogNextStep) && !canonicalNone(backlogNextStep)) {
    return backlogNextStep;
  }
  if (mode === "COMMITTING" && firstPlanStep && !canonicalUnknown(firstPlanStep) && !canonicalNone(firstPlanStep)) {
    return firstPlanStep;
  }
  if (mode === "EXPLORING") {
    return "continue analysis and validate the next hypothesis before durable write";
  }
  if (mode === "THINKING") {
    return "restate the objective, active constraints, and the smallest compliant next step";
  }
  return "reload the prioritized artifacts and choose the next compliant action";
}

export function buildHandoffPrioritizedArtifacts({
  runtimeStateText,
  sessionArtifact,
  cycleStatusArtifact,
  planArtifact,
  activeBacklog,
  firstPlanStep,
}) {
  const items = [
    "docs/audit/CURRENT-STATE.md",
    "docs/audit/WORKFLOW-KERNEL.md",
    "docs/audit/RUNTIME-STATE.md",
    "docs/audit/WORKFLOW_SUMMARY.md",
  ];
  const runtimeArtifacts = parseListSection(runtimeStateText, "prioritized_artifacts");
  const normalizedBacklog = normalizeBacklogRef(activeBacklog);
  if (normalizedBacklog !== "none") {
    items.push(normalizedBacklog);
  }
  if (sessionArtifact?.exists) {
    items.push(sessionArtifact.logicalPath);
  }
  if (cycleStatusArtifact?.exists) {
    items.push(cycleStatusArtifact.logicalPath);
  }
  if (firstPlanStep && planArtifact?.exists) {
    items.push(planArtifact.logicalPath);
  }
  return uniqueItems([...items, ...runtimeArtifacts]);
}

export function prepareHandoffPacketProjection({
  workspace,
  sharedRuntimeValidation,
  repairHints,
  nextAgentGoal = "",
  handoffNote = "",
  handoffFromAgentRole = "coordinator",
  handoffFromAgentAction = "relay",
  mode = "unknown",
  branchKind = "unknown",
  activeSession = "none",
  activeCycle = "none",
  dorState = "unknown",
  firstPlanStep = "unknown",
  backlogStatus = "unknown",
  backlogNextStep = "unknown",
  runtimeStateMode = "unknown",
  repairStatus = "unknown",
  repairPrimaryReason = "unknown",
  repairRoutingHint = "unknown",
  repairRoutingReason = "unknown",
  planningArbitrationStatus = "none",
  activeBacklog = "none",
  currentStateFreshness = "unknown",
  runtimeStateText = "",
  currentMap,
  runtimeMap,
  sharedPlanning,
  consistency,
  sessionResolution,
  cycleStatusResolution,
  planResolution,
  currentStateResolution,
  runtimeStateResolution,
  transitionEvaluator,
} = {}) {
  const handoffStatus = deriveHandoffStatus({ consistency, runtimeMap, currentMap });
  const blockingFindings = uniqueItems(parseListSection(runtimeStateText, "blocking_findings").slice(0, 5));
  const nextRouting = deriveNextAgentRouting({
    handoffStatus,
    mode,
    repairStatus: repairRoutingHint,
    repairHints,
  });
  const transition = transitionEvaluator({
    mode,
    fromRole: handoffFromAgentRole,
    fromAction: handoffFromAgentAction,
    toRole: nextRouting.role,
    toAction: nextRouting.action,
  });
  return buildHandoffPacketPayload({
    workspace,
    sharedRuntimeValidation,
    handoffStatus,
    handoffFromAgentRole,
    handoffFromAgentAction,
    nextRouting,
    nextAgentGoal: deriveNextAgentGoal({
      explicitGoal: nextAgentGoal,
      handoffStatus,
      mode,
      repairStatus: repairRoutingHint,
      repairHints,
      repairAdvice: repairRoutingReason,
      firstPlanStep,
      backlogNextStep: sharedPlanning.artifact_found && !canonicalUnknown(sharedPlanning.backlog_next_step)
        ? sharedPlanning.backlog_next_step
        : backlogNextStep,
      blockingFindings,
    }),
    scope: deriveDispatchScope({ currentMap, nextRouting }),
    activeBacklog,
    planningArbitrationStatus,
    sharedPlanning,
    handoffNote: normalizeScalar(handoffNote) || "none",
    mode,
    branchKind,
    activeSession,
    activeCycle,
    dorState,
    firstPlanStep,
    backlogStatus,
    backlogNextStep: sharedPlanning.artifact_found && !canonicalUnknown(sharedPlanning.backlog_next_step)
      ? sharedPlanning.backlog_next_step
      : backlogNextStep,
    runtimeStateMode,
    repairStatus,
    repairPrimaryReason,
    repairRoutingHint,
    currentStateFreshness,
    transition,
    blockingFindings,
    prioritizedArtifacts: buildHandoffPrioritizedArtifacts({
      runtimeStateText,
      sessionArtifact: sessionResolution,
      cycleStatusArtifact: cycleStatusResolution,
      planArtifact: planResolution,
      activeBacklog,
      firstPlanStep,
    }),
    consistency,
    sessionResolution,
    cycleStatusResolution,
    currentStateResolution,
    runtimeStateResolution,
  });
}

function deriveDispatchScope({ currentMap, nextRouting }) {
  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
  const sessionBranch = normalizeScalar(currentMap.get("session_branch") ?? "none") || "none";
  const cycleBranch = normalizeScalar(currentMap.get("cycle_branch") ?? "none") || "none";
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
  if (nextRouting.role === "coordinator") {
    return {
      scope_type: "session",
      scope_id: !canonicalNone(activeSession) && !canonicalUnknown(activeSession) ? activeSession : "none",
      target_branch: !canonicalNone(sessionBranch) && !canonicalUnknown(sessionBranch) ? sessionBranch : "none",
    };
  }
  return {
    scope_type: "none",
    scope_id: "none",
    target_branch: "none",
  };
}

export function buildHandoffPacketPayload({
  updatedAt,
  workspace,
  sharedRuntimeValidation,
  handoffStatus,
  handoffFromAgentRole,
  handoffFromAgentAction,
  nextRouting,
  nextAgentGoal,
  scope,
  activeBacklog,
  planningArbitrationStatus,
  sharedPlanning,
  handoffNote,
  mode,
  branchKind,
  activeSession,
  activeCycle,
  dorState,
  firstPlanStep,
  backlogStatus,
  backlogNextStep,
  runtimeStateMode,
  repairStatus,
  repairPrimaryReason,
  repairRoutingHint,
  currentStateFreshness,
  transition,
  blockingFindings = [],
  prioritizedArtifacts = [],
  consistency,
  sessionResolution,
  cycleStatusResolution,
  currentStateResolution,
  runtimeStateResolution,
} = {}) {
  return {
    updated_at: updatedAt ?? new Date().toISOString(),
    project_id: workspace.project_id,
    project_id_source: workspace.project_id_source,
    project_root: workspace.project_root,
    workspace_id: workspace.workspace_id,
    workspace_id_source: workspace.workspace_id_source,
    worktree_id: workspace.worktree_id,
    is_linked_worktree: workspace.is_linked_worktree ? "yes" : "no",
    shared_runtime_mode: workspace.shared_runtime_mode,
    shared_runtime_validation_status: sharedRuntimeValidation.status,
    shared_runtime_locator_ref: workspace.shared_runtime_locator_ref,
    shared_backend_kind: workspace.shared_backend_kind,
    handoff_status: handoffStatus,
    handoff_from_agent_role: handoffFromAgentRole,
    handoff_from_agent_action: handoffFromAgentAction,
    recommended_next_agent_role: nextRouting.role,
    recommended_next_agent_action: nextRouting.action,
    next_agent_goal: nextAgentGoal,
    scope_type: scope.scope_type,
    scope_id: scope.scope_id,
    target_branch: scope.target_branch,
    backlog_refs: activeBacklog,
    planning_arbitration_status: planningArbitrationStatus,
    preferred_dispatch_source: sharedPlanning.preferred_dispatch_source,
    shared_planning_candidate_ready: sharedPlanning.candidate_ready ? "yes" : "no",
    shared_planning_candidate_aligned: sharedPlanning.candidate_aligned ? "yes" : "no",
    shared_planning_dispatch_scope: sharedPlanning.next_dispatch_scope,
    shared_planning_dispatch_action: sharedPlanning.next_dispatch_action,
    shared_planning_freshness: sharedPlanning.freshness_status,
    shared_planning_freshness_basis: sharedPlanning.freshness_basis,
    shared_planning_gate_status: sharedPlanning.gate_status,
    shared_planning_gate_reason: sharedPlanning.gate_reason,
    handoff_note: handoffNote,
    mode,
    branch_kind: branchKind,
    active_session: activeSession,
    active_cycle: activeCycle,
    dor_state: dorState,
    first_plan_step: firstPlanStep,
    active_backlog: activeBacklog,
    backlog_status: backlogStatus,
    backlog_next_step: backlogNextStep,
    linked_backlog_cycles: sharedPlanning.linked_cycles,
    runtime_state_mode: runtimeStateMode,
    repair_layer_status: repairStatus,
    repair_primary_reason: repairPrimaryReason,
    repair_routing_hint: repairRoutingHint,
    current_state_freshness: currentStateFreshness,
    transition_policy_status: transition.status,
    transition_policy_reason: transition.reason,
    blocking_findings: blockingFindings,
    prioritized_artifacts: prioritizedArtifacts,
    consistency_status: consistency.pass ? "pass" : "fail",
    session_file: sessionResolution.exists ? sessionResolution.logicalPath : "none",
    cycle_status_file: cycleStatusResolution.exists ? cycleStatusResolution.logicalPath : "none",
    current_state_source: currentStateResolution.source,
    runtime_state_source: runtimeStateResolution.source,
    shared_planning_artifact_source: sharedPlanning.backlog_artifact_source,
  };
}
