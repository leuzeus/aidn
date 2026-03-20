import path from "node:path";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { AIDN_BRANCH_KIND, classifyAidnBranch } from "../../lib/workflow/branch-kind-lib.mjs";
import {
  listSessionCandidateCycles,
  resolveBranchMapping,
  toCycleSummary,
  toSessionSummary,
} from "../../lib/workflow/branch-mapping-lib.mjs";
import {
  collectOpenCycles,
  findSessionFile,
  listCycleStatuses,
  listSessionArtifacts,
  parseSessionCloseCycleDecisions,
  readCurrentState,
  readSourceBranch,
  readTextIfExists,
} from "../../lib/workflow/session-context-lib.mjs";

function makeResult(base, overrides = {}) {
  const action = overrides.action ?? base.action ?? "blocked_missing_active_session";
  const result = overrides.result ?? (action === "close_session_allowed" ? "ok" : "stop");
  return {
    ts: new Date().toISOString(),
    ok: result === "ok",
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
    unresolved_cycles: overrides.unresolved_cycles ?? [],
    cycle_decisions: overrides.cycle_decisions ?? [],
    required_user_choice: overrides.required_user_choice ?? [],
    blocking_reasons: overrides.blocking_reasons ?? [],
    warnings: overrides.warnings ?? [],
    recommended_next_action: overrides.recommended_next_action ?? null,
  };
}

function resolveTargetSession({ activeSessionArtifact, mapping, branchKind, sessions, currentState }) {
  if (activeSessionArtifact) {
    return activeSessionArtifact;
  }
  if (branchKind === AIDN_BRANCH_KIND.SESSION && mapping.mapped_session) {
    return mapping.mapped_session;
  }
  const currentSessionId = String(currentState.active_session ?? "none").toUpperCase();
  return sessions.find((session) => session.session_id === currentSessionId) ?? null;
}

export function runCloseSessionAdmitUseCase({ targetRoot, mode = "UNKNOWN" }) {
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
  const activeSessionId = String(currentState.active_session ?? "none");
  const activeCycleId = String(currentState.active_cycle ?? "none");
  const activeSessionFile = findSessionFile(auditRoot, activeSessionId);
  const activeSessionArtifact = activeSessionFile
    ? sessions.find((session) => session.file_path === activeSessionFile) ?? null
    : null;
  const targetSession = resolveTargetSession({
    activeSessionArtifact,
    mapping,
    branchKind,
    sessions,
    currentState,
  });
  const targetSessionText = targetSession ? readTextIfExists(targetSession.file_path) : "";
  const cycleDecisions = parseSessionCloseCycleDecisions(targetSessionText);
  const sessionOpenCycles = targetSession
    ? listSessionCandidateCycles(targetSession, openCycles)
    : [];
  const unresolvedCycles = sessionOpenCycles.filter((cycle) => !cycleDecisions.some((item) => item.cycle_id === cycle.cycle_id));

  const base = {
    branch,
    branch_kind: branchKind,
    source_branch: sourceBranch,
    mode,
    active_session: activeSessionId,
    active_cycle: activeCycleId,
    mapped_session: targetSession ? toSessionSummary(targetSession) : null,
    mapped_cycle: mapping.mapped_cycle ? toCycleSummary(mapping.mapped_cycle) : null,
    open_cycles: sessionOpenCycles.map((cycle) => toCycleSummary(cycle)),
  };

  if (!targetSession) {
    return makeResult(base, {
      action: "blocked_missing_active_session",
      reason_code: "CLOSE_SESSION_ACTIVE_SESSION_MISSING",
      blocking_reasons: [
        "No active session artifact could be resolved for session close.",
      ],
      required_user_choice: ["reanchor_session", "repair_mapping"],
      recommended_next_action: "Resolve the active session before attempting close-session.",
    });
  }

  if (unresolvedCycles.length > 0) {
    return makeResult(base, {
      action: "blocked_open_cycles_require_resolution",
      reason_code: "CLOSE_SESSION_OPEN_CYCLE_DECISIONS_MISSING",
      unresolved_cycles: unresolvedCycles.map((cycle) => toCycleSummary(cycle)),
      cycle_decisions: cycleDecisions,
      blocking_reasons: [
        `Session ${targetSession.session_id} still has open cycles without explicit close decisions.`,
      ],
      required_user_choice: [
        "integrate_to_session",
        "report",
        "close_non_retained",
        "cancel_close",
      ],
      recommended_next_action: "Record one explicit close decision per open cycle in the session close report before closing the session.",
    });
  }

  return makeResult(base, {
    action: "close_session_allowed",
    reason_code: null,
    cycle_decisions: cycleDecisions,
    warnings: branchKind !== AIDN_BRANCH_KIND.SESSION
      ? ["close-session is being admitted outside a session branch; verify branch alignment before mutating artifacts."]
      : [],
    recommended_next_action: `Close session ${targetSession.session_id}, refresh snapshot/current state, then run pr-orchestrate before opening a new session.`,
  });
}
