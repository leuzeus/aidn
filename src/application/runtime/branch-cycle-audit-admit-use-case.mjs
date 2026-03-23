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
  listCycleStatuses,
  listSessionArtifacts,
  readCurrentState,
  readSourceBranch,
} from "../../lib/workflow/session-context-lib.mjs";

function makeResult(base, overrides = {}) {
  const action = overrides.action ?? base.action ?? "blocked_ambiguous_topology";
  const result = overrides.result ?? (String(action).startsWith("audit_") ? "ok" : "stop");
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
    candidate_sessions: overrides.candidate_sessions ?? base.candidate_sessions ?? [],
    candidate_cycles: overrides.candidate_cycles ?? base.candidate_cycles ?? [],
    required_user_choice: overrides.required_user_choice ?? [],
    blocking_reasons: overrides.blocking_reasons ?? [],
    warnings: overrides.warnings ?? [],
    recommended_next_action: overrides.recommended_next_action ?? null,
    workflow_state: {
      active_session: base.active_session,
      active_cycle: base.active_cycle,
      current_state_branch_kind: base.current_state_branch_kind,
      source_branch: base.source_branch,
    },
  };
}

export function runBranchCycleAuditAdmitUseCase({ targetRoot, mode = "COMMITTING" }) {
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

  const base = {
    branch,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
    branch_kind: branchKind,
    source_branch: sourceBranch,
    mode,
    active_session: String(currentState.active_session ?? "none"),
    active_cycle: String(currentState.active_cycle ?? "none"),
    current_state_branch_kind: currentState.branch_kind,
    mapped_session: mapping.mapped_session ? toSessionSummary(mapping.mapped_session) : null,
    mapped_cycle: mapping.mapped_cycle ? toCycleSummary(mapping.mapped_cycle) : null,
    open_cycles: openCycles.map((cycle) => toCycleSummary(cycle)),
    candidate_sessions: mapping.candidate_sessions,
    candidate_cycles: mapping.candidate_cycles,
  };

  if ([AIDN_BRANCH_KIND.UNKNOWN, AIDN_BRANCH_KIND.OTHER, AIDN_BRANCH_KIND.SOURCE].includes(branchKind)) {
    return makeResult(base, {
      action: "blocked_non_compliant_branch",
      reason_code: "BRANCH_AUDIT_BRANCH_NOT_OWNED",
      blocking_reasons: [
        `Current branch ${branch || "unknown"} is not an owned session/cycle/intermediate branch for branch-cycle-audit.`,
      ],
      required_user_choice: ["switch_to_owned_branch", "ignore_with_rationale"],
      recommended_next_action: "Switch to the session/cycle branch that owns the work before continuing in COMMITTING mode.",
    });
  }

  if (mapping.ambiguous) {
    return makeResult(base, {
      action: "blocked_ambiguous_topology",
      reason_code: "BRANCH_AUDIT_MAPPING_AMBIGUOUS",
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
      reason_code: "BRANCH_AUDIT_MAPPING_MISSING",
      blocking_reasons: [
        `Current branch ${branch} does not map to the expected workflow artifact.`,
      ],
      required_user_choice: ["repair_mapping", "create_missing_artifact"],
      recommended_next_action: "Create or repair the missing session/cycle mapping before continuing.",
    });
  }

  if (branchKind === AIDN_BRANCH_KIND.SESSION && mapping.mapped_session) {
    return makeResult(base, {
      action: "audit_session_branch",
      mapped_session: toSessionSummary(mapping.mapped_session),
      warnings: mode === "COMMITTING"
        ? ["Session-branch COMMITTING work should stay limited to integration, handoff, or orchestration unless an explicit exception is documented."]
        : [],
      recommended_next_action: `Continue on session ${mapping.mapped_session.session_id} and keep cycle ownership explicit.`,
    });
  }

  if ((branchKind === AIDN_BRANCH_KIND.CYCLE || branchKind === AIDN_BRANCH_KIND.INTERMEDIATE) && mapping.mapped_cycle) {
    const ownerSession = sessions.find((session) => session.session_id === String(mapping.mapped_cycle.session_owner ?? "").toUpperCase()) ?? null;
    return makeResult(base, {
      action: branchKind === AIDN_BRANCH_KIND.INTERMEDIATE ? "audit_intermediate_branch" : "audit_cycle_branch",
      mapped_cycle: toCycleSummary(mapping.mapped_cycle),
      mapped_session: ownerSession ? toSessionSummary(ownerSession) : null,
      recommended_next_action: `Continue on cycle ${mapping.mapped_cycle.cycle_id} with branch ownership preserved.`,
    });
  }

  return makeResult(base, {
    action: "blocked_ambiguous_topology",
    reason_code: "BRANCH_AUDIT_UNRESOLVED_TOPOLOGY",
    blocking_reasons: [
      "The branch-to-workflow mapping could not be resolved.",
    ],
    required_user_choice: ["repair_mapping", "reanchor_workflow_state"],
    recommended_next_action: "Re-anchor the workflow state and repair branch ownership before continuing.",
  });
}
