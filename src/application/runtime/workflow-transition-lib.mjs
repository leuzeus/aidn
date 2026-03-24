import { AIDN_BRANCH_KIND } from "../../lib/workflow/branch-kind-lib.mjs";
import {
  listSessionCandidateCycles,
  toCycleSummary,
  toSessionSummary,
} from "../../lib/workflow/branch-mapping-lib.mjs";
import { normalizeSessionPrStatus } from "../../lib/workflow/session-context-lib.mjs";
import {
  WORKFLOW_ACTION,
  WORKFLOW_ADMISSION_STATUS,
  WORKFLOW_REASON,
  WORKFLOW_REPAIR_HINT,
} from "./workflow-transition-constants.mjs";

export function evaluateLatestSessionContinuation(latestSession, sourceBranch) {
  if (!latestSession || !sourceBranch) {
    return null;
  }
  if (latestSession.metadata.close_gate_satisfied !== true) {
    return {
      action: WORKFLOW_ACTION.BLOCKED_SESSION_BASE_GATE,
      reason_code: WORKFLOW_REASON.START_SESSION_PREVIOUS_SESSION_NOT_RESOLVED,
      blocking_reasons: [
        `Latest session ${latestSession.session_id ?? "unknown"} is not marked closed; do not chain a new session branch by default.`,
      ],
      required_user_choice: ["continue_existing_session_branch", "override_new_session_with_rationale"],
      recommended_next_action: "Resolve or explicitly override the previous session before opening a new session branch.",
    };
  }
  const prStatus = normalizeSessionPrStatus(latestSession.metadata.pr_status);
  const postMergeSyncStatus = String(latestSession.metadata.post_merge_sync_status ?? "not_needed");

  if (prStatus === "open") {
    return {
      action: WORKFLOW_ACTION.RESUME_CURRENT_SESSION,
      reason_code: WORKFLOW_REASON.START_SESSION_PREVIOUS_SESSION_PR_OPEN,
      mapped_session: toSessionSummary(latestSession),
      blocking_reasons: [
        `Latest session ${latestSession.session_id ?? "unknown"} still has an open PR.`,
      ],
      required_user_choice: ["continue_existing_session_branch", "override_new_session_with_rationale"],
      recommended_next_action: `Continue ${latestSession.session_id ?? "the latest session"} on ${latestSession.metadata.session_branch ?? "its session branch"} until review/merge is resolved.`,
    };
  }

  if (prStatus === "closed_not_merged") {
    return {
      action: WORKFLOW_ACTION.BLOCKED_SESSION_BASE_GATE,
      reason_code: WORKFLOW_REASON.START_SESSION_PREVIOUS_SESSION_PR_CLOSED_NOT_MERGED,
      mapped_session: toSessionSummary(latestSession),
      blocking_reasons: [
        `Latest session ${latestSession.session_id ?? "unknown"} was closed without merge.`,
      ],
      required_user_choice: ["override_new_session_with_rationale", "resume_previous_session"],
      recommended_next_action: "Decide whether to resume, replace, or abandon the previous session before opening a new one.",
    };
  }

  if (prStatus === "merged" && postMergeSyncStatus === "required") {
    return {
      action: WORKFLOW_ACTION.BLOCKED_SESSION_BASE_GATE,
      reason_code: WORKFLOW_REASON.START_SESSION_POST_MERGE_SYNC_REQUIRED,
      mapped_session: toSessionSummary(latestSession),
      blocking_reasons: [
        `Latest session ${latestSession.session_id ?? "unknown"} is merged but still requires post-merge source-branch reconciliation.`,
      ],
      required_user_choice: ["run_pr_orchestrate", "sync_source_branch_now"],
      recommended_next_action: "Run pr-orchestrate or reconcile the source branch before opening a new session.",
    };
  }

  if (prStatus === "merged") {
    return null;
  }

  return {
    action: WORKFLOW_ACTION.BLOCKED_SESSION_BASE_GATE,
    reason_code: WORKFLOW_REASON.START_SESSION_PREVIOUS_SESSION_PR_STATUS_UNKNOWN,
    mapped_session: toSessionSummary(latestSession),
    blocking_reasons: [
      `Latest session ${latestSession.session_id ?? "unknown"} is closed but its PR status is not recorded.`,
    ],
    required_user_choice: ["run_pr_orchestrate", "override_new_session_with_rationale"],
    recommended_next_action: "Record the previous session PR state before opening a new session branch.",
  };
}

export function evaluateSourceBranchTransition({
  activeSessionArtifact,
  latestSession,
  openCycleTopology,
  openCycles,
  resumableOpenCycles,
  sourceBranch,
  staleOpenCycles,
}) {
  if (openCycles.length > 0 || activeSessionArtifact) {
    if (resumableOpenCycles.length > 1) {
      return {
        action: WORKFLOW_ACTION.CHOOSE_CYCLE,
        reason_code: WORKFLOW_REASON.START_SESSION_MULTIPLE_OPEN_CYCLES,
        blocking_reasons: [
          "Several open cycles already exist in the active workflow context.",
        ],
        candidate_cycles: resumableOpenCycles.map((cycle) => toCycleSummary(cycle)),
        required_user_choice: ["choose_existing_cycle", "relaunch_by_agent"],
        recommended_next_action: "Select the cycle to resume before creating any new session or cycle.",
      };
    }
    if (resumableOpenCycles.length === 1) {
      return {
        action: WORKFLOW_ACTION.RESUME_CURRENT_CYCLE,
        reason_code: WORKFLOW_REASON.START_SESSION_RESUME_OPEN_CYCLE,
        mapped_cycle: toCycleSummary(resumableOpenCycles[0]),
        blocking_reasons: [
          "An open cycle already exists and must be resumed or resolved before creating new workflow state.",
        ],
        recommended_next_action: `Resume ${resumableOpenCycles[0].cycle_id} before creating another session or cycle.`,
      };
    }
    if (resumableOpenCycles.length === 0 && staleOpenCycles.length > 0) {
      const firstStaleCycle = staleOpenCycles[0];
      const staleTopology = openCycleTopology.get(firstStaleCycle.cycle_id);
      return {
        action: WORKFLOW_ACTION.BLOCKED_STALE_OPEN_CYCLE_STATE,
        reason_code: staleTopology?.status === "stale_merged_into_source"
          ? WORKFLOW_REASON.START_SESSION_STALE_OPEN_CYCLE_MERGED_INTO_SOURCE
          : WORKFLOW_REASON.START_SESSION_STALE_OPEN_CYCLE_MERGED_INTO_SESSION,
        mapped_cycle: toCycleSummary(firstStaleCycle),
        blocking_reasons: staleOpenCycles.map((cycle) => openCycleTopology.get(cycle.cycle_id)?.blocking_reason).filter(Boolean),
        recommended_next_action: "Regularize the stale merged cycle in workflow artifacts before opening a new session or cycle.",
      };
    }
    if (activeSessionArtifact) {
      return {
        action: WORKFLOW_ACTION.RESUME_CURRENT_SESSION,
        reason_code: WORKFLOW_REASON.START_SESSION_RESUME_OPEN_SESSION,
        mapped_session: toSessionSummary(activeSessionArtifact),
        blocking_reasons: [
          "An active session already exists and must be resumed on its session branch before creating a new session.",
        ],
        required_user_choice: ["continue_existing_session_branch", "override_new_session_with_rationale"],
        recommended_next_action: `Continue ${activeSessionArtifact.session_id} on ${activeSessionArtifact.metadata.session_branch ?? "its session branch"}.`,
      };
    }
  }

  const latestSessionBlock = evaluateLatestSessionContinuation(latestSession, sourceBranch);
  if (latestSessionBlock) {
    return latestSessionBlock;
  }

  return {
    action: WORKFLOW_ACTION.CREATE_SESSION_ALLOWED,
    reason_code: null,
    recommended_next_action: `Create the next session branch from ${sourceBranch ?? "the configured source branch"} before writing workflow artifacts.`,
  };
}

export function evaluateMappedBranchTransition({ baseBranch, branchKind, mapping, openCycles, sessions, mode }) {
  if (mapping.ambiguous) {
    return {
      action: WORKFLOW_ACTION.BLOCKED_AMBIGUOUS_TOPOLOGY,
      reason_code: WORKFLOW_REASON.START_SESSION_MAPPING_AMBIGUOUS,
      blocking_reasons: [
        `Current branch ${baseBranch} maps to several workflow artifacts.`,
      ],
      required_user_choice: ["select_mapping", "repair_mapping"],
      recommended_next_action: "Resolve branch ownership ambiguity before continuing.",
    };
  }

  if (mapping.missing) {
    return {
      action: WORKFLOW_ACTION.BLOCKED_NON_COMPLIANT_BRANCH,
      reason_code: WORKFLOW_REASON.START_SESSION_MAPPING_MISSING,
      blocking_reasons: [
        `Current branch ${baseBranch} does not map to the expected workflow artifact.`,
      ],
      required_user_choice: ["repair_mapping", "ignore_with_rationale"],
      recommended_next_action: "Restore a valid branch-to-session/cycle mapping before continuing.",
    };
  }

  if (branchKind === AIDN_BRANCH_KIND.SESSION && mapping.mapped_session) {
    const sessionCandidateCycles = listSessionCandidateCycles(mapping.mapped_session, openCycles);
    if (sessionCandidateCycles.length > 1 && !mapping.mapped_session.metadata.primary_focus_cycle) {
      return {
        action: WORKFLOW_ACTION.CHOOSE_CYCLE,
        reason_code: WORKFLOW_REASON.START_SESSION_MULTIPLE_SESSION_CYCLES,
        mapped_session: toSessionSummary(mapping.mapped_session),
        candidate_cycles: sessionCandidateCycles.map((cycle) => toCycleSummary(cycle)),
        blocking_reasons: [
          `Session ${mapping.mapped_session.session_id} has several open cycles and no explicit primary focus cycle.`,
        ],
        required_user_choice: ["choose_existing_cycle", "relaunch_by_agent"],
        recommended_next_action: "Choose the cycle to continue before proceeding in the session.",
      };
    }
    return {
      action: WORKFLOW_ACTION.RESUME_CURRENT_SESSION,
      reason_code: null,
      mapped_session: toSessionSummary(mapping.mapped_session),
      mapped_cycle: sessionCandidateCycles.length === 1 ? toCycleSummary(sessionCandidateCycles[0]) : null,
      candidate_cycles: sessionCandidateCycles.map((cycle) => toCycleSummary(cycle)),
      recommended_next_action: `Resume session ${mapping.mapped_session.session_id}.`,
      warnings: mode === "COMMITTING"
        ? ["Session-branch COMMITTING work should stay limited to integration, handoff, or orchestration unless an explicit exception is documented."]
        : [],
    };
  }

  if ((branchKind === AIDN_BRANCH_KIND.CYCLE || branchKind === AIDN_BRANCH_KIND.INTERMEDIATE) && mapping.mapped_cycle) {
    const ownerSession = sessions.find((session) => session.session_id === String(mapping.mapped_cycle.session_owner ?? "").toUpperCase()) ?? null;
    return {
      action: WORKFLOW_ACTION.RESUME_CURRENT_CYCLE,
      reason_code: null,
      mapped_cycle: toCycleSummary(mapping.mapped_cycle),
      mapped_session: ownerSession ? toSessionSummary(ownerSession) : null,
      recommended_next_action: `Resume cycle ${mapping.mapped_cycle.cycle_id}.`,
    };
  }

  return {
    action: WORKFLOW_ACTION.BLOCKED_AMBIGUOUS_TOPOLOGY,
    reason_code: WORKFLOW_REASON.START_SESSION_UNRESOLVED_CONTINUITY,
    blocking_reasons: [
      "The workflow continuity could not be resolved from the current branch and workflow state.",
    ],
    required_user_choice: ["repair_mapping", "ignore_with_rationale"],
    recommended_next_action: "Re-anchor the workflow state and resolve continuity before continuing.",
  };
}

export function resolveTargetSessionArtifact({ activeSessionArtifact, branchKind, currentState, mapping, sessions }) {
  if (activeSessionArtifact) {
    return activeSessionArtifact;
  }
  if (branchKind === AIDN_BRANCH_KIND.SESSION && mapping.mapped_session) {
    return mapping.mapped_session;
  }
  const currentSessionId = String(currentState.active_session ?? "none").toUpperCase();
  return sessions.find((session) => session.session_id === currentSessionId) ?? null;
}

export function buildCloseSessionDecisionContext({
  classifyCycleTopology,
  openCycles,
  sourceBranch,
  targetSession,
  targetSessionText,
  sessions,
}) {
  const cycleDecisions = classifyCycleTopology.parseSessionCloseCycleDecisions(targetSessionText);
  const sessionOpenCycles = targetSession ? listSessionCandidateCycles(targetSession, openCycles) : [];
  const sessionsById = new Map(sessions.map((session) => [session.session_id, session]));
  const cycleTopology = new Map(sessionOpenCycles.map((cycle) => [
    cycle.cycle_id,
    classifyCycleTopology.classifyOpenCycleTopology({
      targetRoot: classifyCycleTopology.targetRoot,
      cycle,
      sessionsById,
      sourceBranch,
    }),
  ]));
  const unresolvedCycles = sessionOpenCycles.filter((cycle) => !cycleDecisions.some((item) => item.cycle_id === cycle.cycle_id));
  const staleReportedCycles = cycleDecisions
    .filter((item) => item.decision === "report")
    .map((item) => ({
      decision: item,
      cycle: sessionOpenCycles.find((cycle) => cycle.cycle_id === item.cycle_id) ?? null,
      topology: cycleTopology.get(item.cycle_id) ?? null,
    }))
    .filter((item) => item.cycle && classifyCycleTopology.isStaleMergedOpenCycle(item.topology));
  const staleUnresolvedCycles = unresolvedCycles.filter((cycle) => classifyCycleTopology.isStaleMergedOpenCycle(cycleTopology.get(cycle.cycle_id)));
  return { cycleDecisions, cycleTopology, sessionOpenCycles, staleReportedCycles, staleUnresolvedCycles, unresolvedCycles };
}

export function evaluateCloseSessionTransition({
  branchKind,
  cycleDecisions,
  cycleTopology,
  staleReportedCycles,
  staleUnresolvedCycles,
  targetSession,
  unresolvedCycles,
}) {
  if (!targetSession) {
    return {
      action: WORKFLOW_ACTION.BLOCKED_MISSING_ACTIVE_SESSION,
      reason_code: WORKFLOW_REASON.CLOSE_SESSION_ACTIVE_SESSION_MISSING,
      blocking_reasons: [
        "No active session artifact could be resolved for session close.",
      ],
      required_user_choice: ["reanchor_session", "repair_mapping"],
      recommended_next_action: "Resolve the active session before attempting close-session.",
    };
  }

  if (unresolvedCycles.length > 0) {
    if (staleUnresolvedCycles.length > 0) {
      return {
        action: WORKFLOW_ACTION.BLOCKED_STALE_OPEN_CYCLES_REQUIRE_REGULARIZATION,
        reason_code: WORKFLOW_REASON.CLOSE_SESSION_STALE_OPEN_CYCLE_DECISION_MISSING,
        unresolved_cycles: staleUnresolvedCycles.map((cycle) => toCycleSummary(cycle)),
        cycle_decisions: cycleDecisions,
        blocking_reasons: staleUnresolvedCycles.map((cycle) => cycleTopology.get(cycle.cycle_id)?.blocking_reason).filter(Boolean),
        required_user_choice: ["integrate_to_session", "close_non_retained", "cancel_close"],
        recommended_next_action: "Regularize merged cycle state in the session close report before closing the session.",
      };
    }
    return {
      action: WORKFLOW_ACTION.BLOCKED_OPEN_CYCLES_REQUIRE_RESOLUTION,
      reason_code: WORKFLOW_REASON.CLOSE_SESSION_OPEN_CYCLE_DECISIONS_MISSING,
      unresolved_cycles: unresolvedCycles.map((cycle) => toCycleSummary(cycle)),
      cycle_decisions: cycleDecisions,
      blocking_reasons: [
        `Session ${targetSession.session_id} still has open cycles without explicit close decisions.`,
      ],
      required_user_choice: ["integrate_to_session", "report", "close_non_retained", "cancel_close"],
      recommended_next_action: "Record one explicit close decision per open cycle in the session close report before closing the session.",
    };
  }

  if (staleReportedCycles.length > 0) {
    return {
      action: WORKFLOW_ACTION.BLOCKED_STALE_REPORTED_CYCLES_REQUIRE_REGULARIZATION,
      reason_code: WORKFLOW_REASON.CLOSE_SESSION_STALE_REPORTED_CYCLE_ALREADY_MERGED,
      cycle_decisions: cycleDecisions,
      blocking_reasons: staleReportedCycles.map((item) => item.topology?.blocking_reason).filter(Boolean),
      unresolved_cycles: staleReportedCycles.map((item) => toCycleSummary(item.cycle)),
      required_user_choice: ["integrate_to_session", "close_non_retained", "cancel_close"],
      recommended_next_action: "Replace stale `report` decisions for already merged cycles before closing the session.",
    };
  }

  return {
    action: WORKFLOW_ACTION.CLOSE_SESSION_ALLOWED,
    reason_code: null,
    cycle_decisions: cycleDecisions,
    warnings: branchKind !== AIDN_BRANCH_KIND.SESSION
      ? ["close-session is being admitted outside a session branch; verify branch alignment before mutating artifacts."]
      : [],
    recommended_next_action: `Close session ${targetSession.session_id}, refresh snapshot/current state, then run pr-orchestrate before opening a new session.`,
  };
}

export function evaluateRepairRouting({ status, advice, blocking }) {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  const normalizedAdvice = String(advice ?? "").trim();
  const isBlocked = normalizedStatus === "block" || blocking === true;
  const isWarning = normalizedStatus === "warn";
  const isClear = normalizedStatus === "ok" || normalizedStatus === "clean";

  if (isBlocked) {
    return {
      repair_status: normalizedStatus || "block",
      routing_hint: WORKFLOW_REPAIR_HINT.REPAIR,
      routing_reason: "blocking repair findings require repair-first routing before any implementation handoff",
      severity: "blocked",
    };
  }

  if (isWarning) {
    return {
      repair_status: normalizedStatus,
      routing_hint: WORKFLOW_REPAIR_HINT.AUDIT_FIRST,
      routing_reason: normalizedAdvice && normalizedAdvice !== "unknown"
        ? normalizedAdvice
        : "repair warnings require an audit-first relay before implementation",
      severity: "warning",
    };
  }

  if (isClear) {
    return {
      repair_status: normalizedStatus,
      routing_hint: WORKFLOW_REPAIR_HINT.EXECUTION_OR_AUDIT,
      routing_reason: "repair layer reports no blocking findings for the current relay",
      severity: "clear",
    };
  }

  return {
    repair_status: normalizedStatus || "unknown",
    routing_hint: WORKFLOW_REPAIR_HINT.REANCHOR,
    routing_reason: "repair routing is unknown, so the next agent should reanchor before acting",
    severity: "unknown",
  };
}

export function buildWorkflowRoute({
  role,
  action,
  goal = "unknown",
  source = "workflow",
  reason = "unknown",
  stop_required = false,
}) {
  return {
    role: String(role ?? "").trim() || "coordinator",
    action: String(action ?? "").trim() || "coordinate",
    goal: String(goal ?? "").trim() || "unknown",
    source: String(source ?? "").trim() || "workflow",
    reason: String(reason ?? "").trim() || "unknown",
    stop_required: stop_required === true,
  };
}

export function buildWorkflowStatus({
  admission_status = WORKFLOW_ADMISSION_STATUS.ADMITTED,
  admitted = true,
  issues = [],
  warnings = [],
}) {
  return {
    admission_status: String(admission_status ?? "").trim() || WORKFLOW_ADMISSION_STATUS.ADMITTED,
    admitted: admitted === true,
    issues: Array.isArray(issues) ? issues : [],
    warnings: Array.isArray(warnings) ? warnings : [],
  };
}
