import path from "node:path";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { AIDN_BRANCH_KIND, classifyAidnBranch } from "../../lib/workflow/branch-kind-lib.mjs";
import { resolveBranchMapping, toCycleSummary, toSessionSummary } from "../../lib/workflow/branch-mapping-lib.mjs";
import {
  findCycleDirectory,
  listCycleStatuses,
  listSessionArtifacts,
  readCurrentState,
  readCycleChangeRequestImpacts,
  readSourceBranch,
} from "../../lib/workflow/session-context-lib.mjs";

function makeResult(base, overrides = {}) {
  const action = overrides.action ?? base.action ?? "proceed_requirements_delta";
  const result = overrides.result ?? (String(action).startsWith("proceed_") || String(action).startsWith("recommend_") ? "ok" : "stop");
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
    detected_impacts: overrides.detected_impacts ?? base.detected_impacts ?? [],
    required_user_choice: overrides.required_user_choice ?? [],
    blocking_reasons: overrides.blocking_reasons ?? [],
    warnings: overrides.warnings ?? [],
    recommended_next_action: overrides.recommended_next_action ?? null,
  };
}

function isOwnershipClear(branchKind, mapping, activeCycleId) {
  if (mapping.ambiguous || mapping.missing) {
    return false;
  }
  if (branchKind === AIDN_BRANCH_KIND.CYCLE || branchKind === AIDN_BRANCH_KIND.INTERMEDIATE) {
    return Boolean(mapping.mapped_cycle);
  }
  if (branchKind === AIDN_BRANCH_KIND.SESSION) {
    return Boolean(mapping.mapped_session) && activeCycleId && activeCycleId !== "none";
  }
  return false;
}

export function runRequirementsDeltaAdmitUseCase({ targetRoot, mode = "COMMITTING" }) {
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
  const mapping = resolveBranchMapping({
    branch,
    branchKind,
    sessions,
    cycles,
  });
  const activeCycleId = String(currentState.active_cycle ?? "none");
  const activeCycle = cycles.find((cycle) => cycle.cycle_id === String(activeCycleId).toUpperCase()) ?? mapping.mapped_cycle ?? null;
  const cycleDir = activeCycle ? findCycleDirectory(auditRoot, activeCycle.cycle_id) : null;
  const impacts = readCycleChangeRequestImpacts(cycleDir);
  const mediumOrHighImpact = impacts.some((item) => item === "medium" || item === "high");
  const ownershipClear = isOwnershipClear(branchKind, mapping, activeCycleId);

  const base = {
    branch,
    branch_kind: branchKind,
    source_branch: sourceBranch,
    mode,
    active_session: String(currentState.active_session ?? "none"),
    active_cycle: activeCycleId,
    mapped_session: mapping.mapped_session ? toSessionSummary(mapping.mapped_session) : null,
    mapped_cycle: activeCycle ? toCycleSummary(activeCycle) : null,
    detected_impacts: impacts,
  };

  if (mediumOrHighImpact && !ownershipClear) {
    return makeResult(base, {
      action: "stop_choose_cycle_or_branch",
      reason_code: "REQUIREMENTS_DELTA_OWNERSHIP_ARBITRATION_REQUIRED",
      required_user_choice: [
        "continue_same_cycle",
        "open_new_cycle",
        "switch_branch_then_continue",
      ],
      blocking_reasons: [
        "Requirements delta detected medium/high impact while branch ownership remains unclear.",
      ],
      recommended_next_action: "Choose the owning cycle/branch explicitly before mutating addendum or traceability artifacts.",
    });
  }

  if (!mediumOrHighImpact && !ownershipClear) {
    return makeResult(base, {
      action: "recommend_new_cycle",
      reason_code: "REQUIREMENTS_DELTA_OWNERSHIP_WARN",
      warnings: [
        "Branch ownership is not fully clear; low-impact delta may continue, but a new cycle is likely safer if scope grows.",
      ],
      recommended_next_action: "Continue carefully in the current scope or open a new cycle if the delta expands.",
    });
  }

  return makeResult(base, {
    action: "proceed_requirements_delta",
    reason_code: null,
    recommended_next_action: activeCycle
      ? `Continue requirements delta work in cycle ${activeCycle.cycle_id}.`
      : "Continue requirements delta work with the current mapped workflow scope.",
  });
}
