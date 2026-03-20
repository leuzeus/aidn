import path from "node:path";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { AIDN_BRANCH_KIND, classifyAidnBranch } from "../../lib/workflow/branch-kind-lib.mjs";
import {
  listSessionCandidateCycles,
  parseLatestSessionArtifact,
  resolveBranchMapping,
  toCycleSummary,
  toSessionSummary,
} from "../../lib/workflow/branch-mapping-lib.mjs";
import {
  canonicalNone,
  canonicalUnknown,
  collectOpenCycles,
  findLatestSessionFile,
  listCycleStatuses,
  listSessionArtifacts,
  normalizeSessionPrStatus,
  parseSessionMetadata,
  readCurrentState,
  readSourceBranch,
  readTextIfExists,
} from "../../lib/workflow/session-context-lib.mjs";

function makeResult(base, overrides = {}) {
  const action = overrides.action ?? base.action ?? "blocked_non_compliant_branch";
  const result = overrides.result ?? (action.startsWith("create_") || action.startsWith("resume_") ? "ok" : "stop");
  const ok = overrides.ok ?? (result === "ok");
  return {
    ts: new Date().toISOString(),
    ok,
    result,
    action,
    reason_code: overrides.reason_code ?? null,
    branch: base.branch,
    branch_kind: base.branch_kind,
    source_branch: base.source_branch,
    mode: base.mode,
    active_session: base.active_session,
    active_cycle: base.active_cycle,
    mapped_session: overrides.mapped_session ?? base.mapped_session ?? null,
    mapped_cycle: overrides.mapped_cycle ?? base.mapped_cycle ?? null,
    open_cycles: overrides.open_cycles ?? base.open_cycles ?? [],
    candidate_sessions: overrides.candidate_sessions ?? base.candidate_sessions ?? [],
    candidate_cycles: overrides.candidate_cycles ?? base.candidate_cycles ?? [],
    required_user_choice: overrides.required_user_choice ?? [],
    blocking_reasons: overrides.blocking_reasons ?? [],
    warnings: overrides.warnings ?? [],
    recommended_next_action: overrides.recommended_next_action ?? null,
    workflow_state: {
      active_session: base.active_session,
      active_cycle: base.active_cycle,
      session_branch: base.session_branch,
      cycle_branch: base.cycle_branch,
      current_state_branch_kind: base.current_state_branch_kind,
      source_branch: base.source_branch,
    },
  };
}

function shouldBlockForLatestSession(latestSession, sourceBranch) {
  if (!latestSession || !sourceBranch) {
    return null;
  }
  if (latestSession.metadata.close_gate_satisfied !== true) {
    return {
      action: "blocked_session_base_gate",
      reason_code: "START_SESSION_PREVIOUS_SESSION_NOT_RESOLVED",
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
      action: "resume_current_session",
      reason_code: "START_SESSION_PREVIOUS_SESSION_PR_OPEN",
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
      action: "blocked_session_base_gate",
      reason_code: "START_SESSION_PREVIOUS_SESSION_PR_CLOSED_NOT_MERGED",
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
      action: "blocked_session_base_gate",
      reason_code: "START_SESSION_POST_MERGE_SYNC_REQUIRED",
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
    action: "blocked_session_base_gate",
    reason_code: "START_SESSION_PREVIOUS_SESSION_PR_STATUS_UNKNOWN",
    mapped_session: toSessionSummary(latestSession),
    blocking_reasons: [
      `Latest session ${latestSession.session_id ?? "unknown"} is closed but its PR status is not recorded.`,
    ],
    required_user_choice: ["run_pr_orchestrate", "override_new_session_with_rationale"],
    recommended_next_action: "Record the previous session PR state before opening a new session branch.",
  };
}

export function runStartSessionAdmitUseCase({ targetRoot, mode = "UNKNOWN" }) {
  const gitAdapter = createLocalGitAdapter();
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot);
  const currentState = readCurrentState(absoluteTargetRoot);
  const auditRoot = currentState.audit_root;
  const sourceBranch = readSourceBranch(absoluteTargetRoot);
  const branch = gitAdapter.getCurrentBranch(absoluteTargetRoot);
  const branchKind = classifyAidnBranch(branch, {
    sourceBranch,
    includeSource: true,
  });
  const sessions = listSessionArtifacts(auditRoot);
  const cycles = listCycleStatuses(auditRoot);
  const openCycles = collectOpenCycles(cycles);
  const mapping = resolveBranchMapping({
    branch,
    branchKind,
    sessions,
    cycles,
  });
  const activeSession = String(currentState.active_session ?? "none");
  const activeCycle = String(currentState.active_cycle ?? "none");
  const activeSessionArtifact = sessions.find((session) => session.session_id === activeSession) ?? null;
  const activeCycleArtifact = cycles.find((cycle) => cycle.cycle_id === activeCycle) ?? null;
  const latestSession = parseLatestSessionArtifact({
    findLatestSessionFile,
    parseSessionMetadata,
    readTextIfExists,
    auditRoot,
  });

  const base = {
    branch,
    branch_kind: branchKind,
    source_branch: sourceBranch,
    mode,
    active_session: activeSession,
    active_cycle: activeCycle,
    session_branch: currentState.session_branch,
    cycle_branch: currentState.cycle_branch,
    current_state_branch_kind: currentState.branch_kind,
    mapped_session: mapping.mapped_session ? toSessionSummary(mapping.mapped_session) : null,
    mapped_cycle: mapping.mapped_cycle ? toCycleSummary(mapping.mapped_cycle) : null,
    open_cycles: openCycles.map((cycle) => toCycleSummary(cycle)),
    candidate_sessions: mapping.candidate_sessions,
    candidate_cycles: mapping.candidate_cycles,
  };

  if (branchKind === AIDN_BRANCH_KIND.UNKNOWN || branchKind === AIDN_BRANCH_KIND.OTHER) {
    return makeResult(base, {
      action: "blocked_non_compliant_branch",
      reason_code: "START_SESSION_BRANCH_NOT_AIDN",
      blocking_reasons: [
        `Current branch ${branch || "unknown"} is not a workflow branch and is not the configured source branch.`,
      ],
      required_user_choice: ["merge_to_source_first", "ignore_with_rationale"],
      recommended_next_action: "Switch to the configured source/session/cycle branch or record an explicit override before continuing.",
    });
  }

  if (branchKind === AIDN_BRANCH_KIND.SOURCE) {
    if (!canonicalNone(activeSession) || !canonicalNone(activeCycle) || openCycles.length > 0) {
      if (openCycles.length > 1) {
        return makeResult(base, {
          action: "choose_cycle",
          reason_code: "START_SESSION_MULTIPLE_OPEN_CYCLES",
          blocking_reasons: [
            "Several open cycles already exist in the active workflow context.",
          ],
          candidate_cycles: openCycles.map((cycle) => toCycleSummary(cycle)),
          required_user_choice: ["choose_existing_cycle", "relaunch_by_agent"],
          recommended_next_action: "Select the cycle to resume before creating any new session or cycle.",
        });
      }
      if (openCycles.length === 1) {
        return makeResult(base, {
          action: "resume_current_cycle",
          reason_code: "START_SESSION_RESUME_OPEN_CYCLE",
          mapped_cycle: toCycleSummary(openCycles[0]),
          blocking_reasons: [
            "An open cycle already exists and must be resumed or resolved before creating new workflow state.",
          ],
          recommended_next_action: `Resume ${openCycles[0].cycle_id} before creating another session or cycle.`,
        });
      }
      if (activeSessionArtifact) {
        return makeResult(base, {
          action: "resume_current_session",
          reason_code: "START_SESSION_RESUME_OPEN_SESSION",
          mapped_session: toSessionSummary(activeSessionArtifact),
          blocking_reasons: [
            "An active session already exists and must be resumed on its session branch before creating a new session.",
          ],
          required_user_choice: ["continue_existing_session_branch", "override_new_session_with_rationale"],
          recommended_next_action: `Continue ${activeSessionArtifact.session_id} on ${activeSessionArtifact.metadata.session_branch ?? "its session branch"}.`,
        });
      }
    }

    const latestSessionBlock = shouldBlockForLatestSession(latestSession, sourceBranch);
    if (latestSessionBlock) {
      return makeResult(base, {
        ...latestSessionBlock,
      });
    }

    return makeResult(base, {
      action: "create_session_allowed",
      reason_code: null,
      recommended_next_action: `Create the next session branch from ${sourceBranch ?? "the configured source branch"} before writing workflow artifacts.`,
    });
  }

  if (mapping.ambiguous) {
    return makeResult(base, {
      action: "blocked_ambiguous_topology",
      reason_code: "START_SESSION_MAPPING_AMBIGUOUS",
      blocking_reasons: [
        `Current branch ${branch} maps to several workflow artifacts.`,
      ],
      required_user_choice: ["select_mapping", "repair_mapping"],
      recommended_next_action: "Resolve branch ownership ambiguity before continuing.",
    });
  }

  if (mapping.missing) {
    return makeResult(base, {
      action: "blocked_non_compliant_branch",
      reason_code: "START_SESSION_MAPPING_MISSING",
      blocking_reasons: [
        `Current branch ${branch} does not map to the expected workflow artifact.`,
      ],
      required_user_choice: ["repair_mapping", "ignore_with_rationale"],
      recommended_next_action: "Restore a valid branch-to-session/cycle mapping before continuing.",
    });
  }

  if (branchKind === AIDN_BRANCH_KIND.SESSION && mapping.mapped_session) {
    const sessionCandidateCycles = listSessionCandidateCycles(mapping.mapped_session, openCycles);
    if (sessionCandidateCycles.length > 1 && !mapping.mapped_session.metadata.primary_focus_cycle) {
      return makeResult(base, {
        action: "choose_cycle",
        reason_code: "START_SESSION_MULTIPLE_SESSION_CYCLES",
        mapped_session: toSessionSummary(mapping.mapped_session),
        candidate_cycles: sessionCandidateCycles.map((cycle) => toCycleSummary(cycle)),
        blocking_reasons: [
          `Session ${mapping.mapped_session.session_id} has several open cycles and no explicit primary focus cycle.`,
        ],
        required_user_choice: ["choose_existing_cycle", "relaunch_by_agent"],
        recommended_next_action: "Choose the cycle to continue before proceeding in the session.",
      });
    }
    return makeResult(base, {
      action: "resume_current_session",
      reason_code: null,
      mapped_session: toSessionSummary(mapping.mapped_session),
      mapped_cycle: sessionCandidateCycles.length === 1 ? toCycleSummary(sessionCandidateCycles[0]) : null,
      candidate_cycles: sessionCandidateCycles.map((cycle) => toCycleSummary(cycle)),
      recommended_next_action: `Resume session ${mapping.mapped_session.session_id}.`,
      warnings: mode === "COMMITTING"
        ? ["Session-branch COMMITTING work should stay limited to integration, handoff, or orchestration unless an explicit exception is documented."]
        : [],
    });
  }

  if ((branchKind === AIDN_BRANCH_KIND.CYCLE || branchKind === AIDN_BRANCH_KIND.INTERMEDIATE) && mapping.mapped_cycle) {
    const ownerSession = sessions.find((session) => session.session_id === String(mapping.mapped_cycle.session_owner ?? "").toUpperCase()) ?? null;
    return makeResult(base, {
      action: "resume_current_cycle",
      reason_code: null,
      mapped_cycle: toCycleSummary(mapping.mapped_cycle),
      mapped_session: ownerSession ? toSessionSummary(ownerSession) : null,
      recommended_next_action: `Resume cycle ${mapping.mapped_cycle.cycle_id}.`,
    });
  }

  return makeResult(base, {
    action: "blocked_ambiguous_topology",
    reason_code: "START_SESSION_UNRESOLVED_CONTINUITY",
    blocking_reasons: [
      "The workflow continuity could not be resolved from the current branch and workflow state.",
    ],
    required_user_choice: ["repair_mapping", "ignore_with_rationale"],
    recommended_next_action: "Re-anchor the workflow state and resolve continuity before continuing.",
  });
}
