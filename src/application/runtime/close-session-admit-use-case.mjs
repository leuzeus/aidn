import path from "node:path";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { AIDN_BRANCH_KIND, classifyAidnBranch } from "../../lib/workflow/branch-kind-lib.mjs";
import { resolveDbBackedMode } from "../../../tools/runtime/db-first-runtime-view-lib.mjs";
import {
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
import { classifyOpenCycleTopology, isStaleMergedOpenCycle } from "./stale-open-cycle-guard-lib.mjs";
import { WORKFLOW_ACTION, WORKFLOW_RESULT } from "./workflow-transition-constants.mjs";
import {
  buildCloseSessionDecisionContext,
  evaluateCloseSessionTransition,
  resolveTargetSessionArtifact,
} from "./workflow-transition-lib.mjs";

function makeResult(base, overrides = {}) {
  const action = overrides.action ?? base.action ?? WORKFLOW_ACTION.BLOCKED_MISSING_ACTIVE_SESSION;
  const result = overrides.result ?? (action === WORKFLOW_ACTION.CLOSE_SESSION_ALLOWED ? WORKFLOW_RESULT.OK : WORKFLOW_RESULT.STOP);
  return {
    ts: new Date().toISOString(),
    ok: result === "ok",
    result,
    action,
    reason_code: overrides.reason_code ?? null,
    state_mode: base.state_mode,
    db_backed_mode: base.db_backed_mode,
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

export function runCloseSessionAdmitUseCase({ targetRoot, mode = "UNKNOWN" }) {
  const gitAdapter = createLocalGitAdapter();
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot);
  const { effectiveStateMode, dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
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
  const targetSession = resolveTargetSessionArtifact({
    activeSessionArtifact,
    mapping,
    branchKind,
    sessions,
    currentState,
  });
  const targetSessionText = targetSession ? readTextIfExists(targetSession.file_path) : "";
  const {
    cycleDecisions,
    cycleTopology,
    sessionOpenCycles,
    staleReportedCycles,
    staleUnresolvedCycles,
    unresolvedCycles,
  } = buildCloseSessionDecisionContext({
    classifyCycleTopology: {
      classifyOpenCycleTopology,
      isStaleMergedOpenCycle,
      parseSessionCloseCycleDecisions,
      targetRoot: absoluteTargetRoot,
    },
    openCycles,
    sourceBranch,
    targetSession,
    targetSessionText,
    sessions,
  });

  const base = {
    branch,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
    branch_kind: branchKind,
    source_branch: sourceBranch,
    mode,
    active_session: activeSessionId,
    active_cycle: activeCycleId,
    mapped_session: targetSession ? toSessionSummary(targetSession) : null,
    mapped_cycle: mapping.mapped_cycle ? toCycleSummary(mapping.mapped_cycle) : null,
    open_cycles: sessionOpenCycles.map((cycle) => toCycleSummary(cycle)),
  };

  return makeResult(base, evaluateCloseSessionTransition({
    branchKind,
    cycleDecisions,
    cycleTopology,
    staleReportedCycles,
    staleUnresolvedCycles,
    targetSession,
    unresolvedCycles,
  }));
}
