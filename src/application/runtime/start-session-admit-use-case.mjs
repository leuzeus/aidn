import path from "node:path";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { AIDN_BRANCH_KIND, classifyAidnBranch } from "../../lib/workflow/branch-kind-lib.mjs";
import { resolveDbBackedMode } from "../../../tools/runtime/db-first-runtime-view-lib.mjs";
import {
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
  parseSessionMetadata,
  readCurrentState,
  readSourceBranch,
  readTextIfExists,
} from "../../lib/workflow/session-context-lib.mjs";
import { classifyOpenCycleTopology, isStaleMergedOpenCycle } from "./stale-open-cycle-guard-lib.mjs";
import { WORKFLOW_ACTION, WORKFLOW_REASON, WORKFLOW_RESULT } from "./workflow-transition-constants.mjs";
import {
  evaluateMappedBranchTransition,
  evaluateSourceBranchTransition,
} from "./workflow-transition-lib.mjs";

function makeResult(base, overrides = {}) {
  const action = overrides.action ?? base.action ?? WORKFLOW_ACTION.BLOCKED_NON_COMPLIANT_BRANCH;
  const result = overrides.result ?? (action.startsWith("create_") || action.startsWith("resume_") ? WORKFLOW_RESULT.OK : WORKFLOW_RESULT.STOP);
  const ok = overrides.ok ?? (result === WORKFLOW_RESULT.OK);
  return {
    ts: new Date().toISOString(),
    ok,
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

export function runStartSessionAdmitUseCase({ targetRoot, mode = "UNKNOWN" }) {
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
  const activeSession = String(currentState.active_session ?? "none");
  const activeCycle = String(currentState.active_cycle ?? "none");
  const activeSessionArtifact = sessions.find((session) => session.session_id === activeSession) ?? null;
  const latestSession = parseLatestSessionArtifact({
    findLatestSessionFile,
    parseSessionMetadata,
    readTextIfExists,
    auditRoot,
  });
  const sessionsById = new Map(sessions.map((session) => [session.session_id, session]));
  const openCycleTopology = new Map(openCycles.map((cycle) => [
    cycle.cycle_id,
    classifyOpenCycleTopology({
      targetRoot: absoluteTargetRoot,
      cycle,
      sessionsById,
      sourceBranch,
    }),
  ]));
  const resumableOpenCycles = openCycles.filter((cycle) => !isStaleMergedOpenCycle(openCycleTopology.get(cycle.cycle_id)));
  const staleOpenCycles = openCycles.filter((cycle) => isStaleMergedOpenCycle(openCycleTopology.get(cycle.cycle_id)));

  const base = {
    branch,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
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
      action: WORKFLOW_ACTION.BLOCKED_NON_COMPLIANT_BRANCH,
      reason_code: WORKFLOW_REASON.START_SESSION_BRANCH_NOT_AIDN,
      blocking_reasons: [
        `Current branch ${branch || "unknown"} is not a workflow branch and is not the configured source branch.`,
      ],
      required_user_choice: ["merge_to_source_first", "ignore_with_rationale"],
      recommended_next_action: "Switch to the configured source/session/cycle branch or record an explicit override before continuing.",
    });
  }

  if (branchKind === AIDN_BRANCH_KIND.SOURCE) {
    return makeResult(base, evaluateSourceBranchTransition({
      activeSessionArtifact,
      latestSession,
      openCycleTopology,
      openCycles,
      resumableOpenCycles,
      sourceBranch,
      staleOpenCycles,
    }));
  }

  return makeResult(base, evaluateMappedBranchTransition({
    baseBranch: base.branch,
    branchKind,
    mapping,
    openCycles,
    sessions,
    mode: base.mode,
  }));
}
