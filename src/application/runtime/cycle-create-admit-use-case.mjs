import path from "node:path";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { AIDN_BRANCH_KIND, classifyAidnBranch } from "../../lib/workflow/branch-kind-lib.mjs";
import { resolveBranchMapping } from "../../lib/workflow/branch-mapping-lib.mjs";
import {
  collectOpenCycles,
  findSessionFile,
  listCycleStatuses,
  listSessionArtifacts,
  readCurrentState,
  readSourceBranch,
} from "../../lib/workflow/session-context-lib.mjs";

function makeResult(base, overrides = {}) {
  const action = overrides.action ?? base.action ?? "blocked_non_compliant_branch";
  const result = overrides.result ?? (String(action).startsWith("proceed_") || action === "create_cycle_allowed" ? "ok" : "stop");
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
    session_branch: base.session_branch,
    latest_active_cycle_branch: base.latest_active_cycle_branch,
    continuity_rule: overrides.continuity_rule ?? null,
    continuity_base_branch: overrides.continuity_base_branch ?? null,
    required_user_choice: overrides.required_user_choice ?? [],
    blocking_reasons: overrides.blocking_reasons ?? [],
    warnings: overrides.warnings ?? [],
    recommended_next_action: overrides.recommended_next_action ?? null,
  };
}

function resolveTargetSession({ currentState, sessions, branchKind, mapping }) {
  const activeSessionId = String(currentState.active_session ?? "none").toUpperCase();
  if (activeSessionId && activeSessionId !== "NONE") {
    return sessions.find((session) => session.session_id === activeSessionId) ?? null;
  }
  if (branchKind === AIDN_BRANCH_KIND.SESSION && mapping.mapped_session) {
    return mapping.mapped_session;
  }
  const mappedCycleOwner = String(mapping.mapped_cycle?.session_owner ?? "").toUpperCase();
  if (mappedCycleOwner) {
    return sessions.find((session) => session.session_id === mappedCycleOwner) ?? null;
  }
  if (sessions.length > 0) {
    return sessions[sessions.length - 1];
  }
  return null;
}

function resolveLatestSessionCycle(targetSession, openCycles) {
  if (!targetSession) {
    return null;
  }
  const ownerCycles = openCycles
    .filter((cycle) => String(cycle.session_owner ?? "").toUpperCase() === targetSession.session_id)
    .sort((left, right) => left.cycle_id.localeCompare(right.cycle_id, undefined, { numeric: true, sensitivity: "base" }));
  if (ownerCycles.length === 0) {
    return null;
  }
  const primaryFocus = String(targetSession.metadata.primary_focus_cycle ?? "").toUpperCase();
  if (primaryFocus) {
    const explicit = ownerCycles.find((cycle) => cycle.cycle_id === primaryFocus);
    if (explicit) {
      return explicit;
    }
  }
  return ownerCycles[ownerCycles.length - 1];
}

export function runCycleCreateAdmitUseCase({ targetRoot, mode = "COMMITTING" }) {
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
  const targetSession = resolveTargetSession({
    currentState,
    sessions,
    branchKind,
    mapping,
  });
  const latestActiveCycle = resolveLatestSessionCycle(targetSession, openCycles);
  const sessionBranch = targetSession?.metadata.session_branch
    ?? (findSessionFile(auditRoot, currentState.active_session) ? currentState.session_branch : currentState.session_branch)
    ?? "none";

  const base = {
    branch,
    branch_kind: branchKind,
    source_branch: sourceBranch,
    mode,
    active_session: String(currentState.active_session ?? "none"),
    active_cycle: String(currentState.active_cycle ?? "none"),
    session_branch: sessionBranch,
    latest_active_cycle_branch: latestActiveCycle?.branch_name ?? "none",
  };

  if ([AIDN_BRANCH_KIND.UNKNOWN, AIDN_BRANCH_KIND.OTHER].includes(branchKind)) {
    return makeResult(base, {
      action: "blocked_non_compliant_branch",
      reason_code: "CYCLE_CREATE_BRANCH_NOT_WORKFLOW_COMPLIANT",
      blocking_reasons: [
        `Current branch ${branch || "unknown"} is not a workflow-owned branch and cannot be used as a continuity source automatically.`,
      ],
      required_user_choice: ["switch_to_configured_source_branch", "ignore_with_rationale"],
      recommended_next_action: "Switch to the configured source branch or a valid session/cycle branch before creating a cycle.",
    });
  }

  if (branchKind === AIDN_BRANCH_KIND.CYCLE || branchKind === AIDN_BRANCH_KIND.INTERMEDIATE) {
    if (branch === latestActiveCycle?.branch_name) {
      return makeResult(base, {
        action: "proceed_r1_strict_chain",
        continuity_rule: "R1_STRICT_CHAIN",
        continuity_base_branch: branch,
        recommended_next_action: `Create the next cycle from ${branch} using strict chain continuity.`,
      });
    }
    return makeResult(base, {
      action: "stop_choose_continuity_rule",
      reason_code: "CYCLE_CREATE_CONTINUITY_CHOICE_REQUIRED",
      required_user_choice: [
        "r1_strict_chain",
        "r2_session_base_with_import",
        "r3_exception_override",
      ],
      blocking_reasons: [
        `Current branch ${branch} is not the latest allowed cycle continuity base for the active session context.`,
      ],
      recommended_next_action: "Choose the continuity rule explicitly before creating cycle artifacts.",
    });
  }

  if (branchKind === AIDN_BRANCH_KIND.SESSION) {
    return makeResult(base, {
      action: "proceed_r2_session_base_with_import",
      continuity_rule: "R2_SESSION_BASE_WITH_IMPORT",
      continuity_base_branch: branch,
      recommended_next_action: `Create the next cycle from session branch ${branch} and record predecessor import if needed.`,
    });
  }

  if (branchKind === AIDN_BRANCH_KIND.SOURCE) {
    if (!latestActiveCycle && (!sessionBranch || sessionBranch === "none")) {
      return makeResult(base, {
        action: "create_cycle_allowed",
        continuity_rule: "R2_SESSION_BASE_WITH_IMPORT",
        continuity_base_branch: branch,
        warnings: ["No active session branch was found; using the configured source branch as the continuity base."],
        recommended_next_action: `Create the cycle from configured source branch ${branch}.`,
      });
    }
    return makeResult(base, {
      action: "stop_choose_continuity_rule",
      reason_code: "CYCLE_CREATE_CONTINUITY_CHOICE_REQUIRED",
      required_user_choice: [
        "r1_strict_chain",
        "r2_session_base_with_import",
        "r3_exception_override",
      ],
      blocking_reasons: [
        `Configured source branch ${branch} does not uniquely identify the continuity rule while active workflow context already exists.`,
      ],
      recommended_next_action: "Choose whether to continue from the latest cycle branch, the session branch, or an explicit override before creating the cycle.",
    });
  }

  return makeResult(base, {
    action: "stop_choose_continuity_rule",
    reason_code: "CYCLE_CREATE_CONTINUITY_UNRESOLVED",
    required_user_choice: [
      "r1_strict_chain",
      "r2_session_base_with_import",
      "r3_exception_override",
    ],
    blocking_reasons: [
      "Cycle continuity could not be resolved from the current branch and workflow context.",
    ],
    recommended_next_action: "Re-anchor the active session/cycle context and choose the continuity rule explicitly.",
  });
}
