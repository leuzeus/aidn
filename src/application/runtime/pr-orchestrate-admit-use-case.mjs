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
  findLatestSessionFile,
  listCycleStatuses,
  listSessionArtifacts,
  normalizePostMergeSyncStatus,
  normalizeSessionPrReviewStatus,
  normalizeSessionPrStatus,
  parseSessionMetadata,
  readCurrentState,
  readSourceBranch,
  readTextIfExists,
} from "../../lib/workflow/session-context-lib.mjs";

function resolveTargetSession({ currentState, mapping, branchKind, sessions, auditRoot }) {
  const activeSessionId = String(currentState.active_session ?? "none").toUpperCase();
  if (!canonicalNone(activeSessionId)) {
    const active = sessions.find((session) => session.session_id === activeSessionId) ?? null;
    if (active) {
      return active;
    }
  }
  if (branchKind === AIDN_BRANCH_KIND.SESSION && mapping.mapped_session) {
    return mapping.mapped_session;
  }
  return parseLatestSessionArtifact({
    findLatestSessionFile,
    parseSessionMetadata,
    readTextIfExists,
    auditRoot,
  });
}

function resolveResult(action) {
  if (action.startsWith("blocked_")) {
    return "stop";
  }
  return "ok";
}

function buildPushCommand(branch) {
  return `git push -u origin ${branch}`;
}

function buildPrCreateCommand(baseBranch, headBranch) {
  if (!baseBranch || !headBranch) {
    return "gh pr create --fill";
  }
  return `gh pr create --base ${baseBranch} --head ${headBranch} --fill`;
}

function buildPostMergeSyncCommands(sourceBranch) {
  if (!sourceBranch) {
    return [
      "git fetch origin",
      "git status --short --branch",
    ];
  }
  return [
    `git switch ${sourceBranch}`,
    `git fetch origin ${sourceBranch}`,
    `git rev-list --left-right --count ${sourceBranch}...origin/${sourceBranch}`,
  ];
}

function makeResult(base, overrides = {}) {
  const action = overrides.action ?? "blocked_pr_context_missing";
  const result = overrides.result ?? resolveResult(action);
  const ok = overrides.ok ?? (result === "ok");
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
    pr_status: overrides.pr_status ?? base.pr_status,
    pr_review_status: overrides.pr_review_status ?? base.pr_review_status,
    post_merge_sync_status: overrides.post_merge_sync_status ?? base.post_merge_sync_status,
    session_branch_upstream: overrides.session_branch_upstream ?? base.session_branch_upstream ?? null,
    session_branch_ahead: overrides.session_branch_ahead ?? base.session_branch_ahead ?? 0,
    session_branch_behind: overrides.session_branch_behind ?? base.session_branch_behind ?? 0,
    blocking_reasons: overrides.blocking_reasons ?? [],
    warnings: overrides.warnings ?? [],
    required_user_choice: overrides.required_user_choice ?? [],
    recommended_next_action: overrides.recommended_next_action ?? null,
    suggested_commands: overrides.suggested_commands ?? [],
  };
}

export function runPrOrchestrateAdmitUseCase({ targetRoot, mode = "UNKNOWN" }) {
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
  const mapping = resolveBranchMapping({
    branch,
    branchKind,
    sessions,
    cycles,
  });
  const targetSession = resolveTargetSession({
    currentState,
    mapping,
    branchKind,
    sessions,
    auditRoot,
  });
  const hasWorkingTreeChanges = gitAdapter.hasWorkingTreeChanges(absoluteTargetRoot);
  const upstreamBranch = gitAdapter.getUpstreamBranch(absoluteTargetRoot);
  const upstreamDivergence = upstreamBranch
    ? gitAdapter.getAheadBehind(absoluteTargetRoot, "HEAD", upstreamBranch)
    : { known: false, ahead: 0, behind: 0 };

  const prStatus = normalizeSessionPrStatus(targetSession?.metadata?.pr_status);
  const prReviewStatus = normalizeSessionPrReviewStatus(targetSession?.metadata?.pr_review_status);
  const postMergeSyncStatus = normalizePostMergeSyncStatus(targetSession?.metadata?.post_merge_sync_status);
  const sessionBranch = targetSession?.metadata?.session_branch ?? null;
  const prBaseBranch = targetSession?.metadata?.pr_base_branch ?? sourceBranch ?? null;
  const prHeadBranch = targetSession?.metadata?.pr_head_branch ?? sessionBranch ?? null;

  const base = {
    branch,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
    branch_kind: branchKind,
    source_branch: sourceBranch,
    mode,
    active_session: String(currentState.active_session ?? "none"),
    active_cycle: String(currentState.active_cycle ?? "none"),
    mapped_session: targetSession ? toSessionSummary(targetSession) : null,
    mapped_cycle: mapping.mapped_cycle ? toCycleSummary(mapping.mapped_cycle) : null,
    pr_status: prStatus,
    pr_review_status: prReviewStatus,
    post_merge_sync_status: postMergeSyncStatus,
    session_branch_upstream: upstreamBranch,
    session_branch_ahead: upstreamDivergence.ahead,
    session_branch_behind: upstreamDivergence.behind,
  };

  if (!targetSession) {
    return makeResult(base, {
      action: "blocked_pr_context_missing",
      reason_code: "PR_ORCHESTRATE_SESSION_MISSING",
      blocking_reasons: [
        "No target session could be resolved for PR orchestration.",
      ],
      required_user_choice: ["reanchor_session", "select_session"],
      recommended_next_action: "Resolve the latest or active session before attempting PR orchestration.",
    });
  }

  if (hasWorkingTreeChanges) {
    return makeResult(base, {
      action: "blocked_dirty_worktree",
      reason_code: "PR_ORCHESTRATE_DIRTY_WORKTREE",
      blocking_reasons: [
        "The git working tree is not clean; PR orchestration requires committed session state first.",
      ],
      required_user_choice: ["commit_now", "stash_now", "drop_changes_with_rationale"],
      recommended_next_action: "Commit or stash the remaining session changes before pushing or opening a PR.",
    });
  }

  if (prStatus === "none" || prStatus === "unknown") {
    if (targetSession.metadata.close_gate_satisfied !== true) {
      return makeResult(base, {
        action: "blocked_session_not_closed",
        reason_code: "PR_ORCHESTRATE_SESSION_NOT_CLOSED",
        blocking_reasons: [
          `Session ${targetSession.session_id} is not marked closed yet.`,
        ],
        required_user_choice: ["run_close_session", "reopen_session"],
        recommended_next_action: "Finish close-session before starting PR orchestration.",
      });
    }
    if (branchKind !== AIDN_BRANCH_KIND.SESSION || !sessionBranch || branch !== sessionBranch) {
      return makeResult(base, {
        action: "blocked_session_branch_required",
        reason_code: "PR_ORCHESTRATE_SESSION_BRANCH_REQUIRED",
        blocking_reasons: [
          `PR creation must start from the owning session branch ${sessionBranch ?? "unknown"}.`,
        ],
        required_user_choice: ["switch_to_session_branch", "override_with_rationale"],
        recommended_next_action: `Switch to ${sessionBranch ?? "the session branch"} and rerun pr-orchestrate.`,
      });
    }
    if (!upstreamBranch || !upstreamDivergence.known || upstreamDivergence.ahead > 0) {
      return makeResult(base, {
        action: "push_session_branch",
        reason_code: "PR_ORCHESTRATE_PUSH_REQUIRED",
        recommended_next_action: `Push ${branch} before opening the session PR.`,
        suggested_commands: [buildPushCommand(branch)],
      });
    }
    if (upstreamDivergence.behind > 0) {
      return makeResult(base, {
        action: "blocked_branch_diverged",
        reason_code: "PR_ORCHESTRATE_SESSION_BRANCH_DIVERGED",
        blocking_reasons: [
          `Session branch ${branch} is behind ${upstreamBranch}; reconcile before opening a PR.`,
        ],
        required_user_choice: ["reconcile_with_upstream", "override_with_rationale"],
        recommended_next_action: "Fetch/reconcile the session branch, then rerun pr-orchestrate.",
      });
    }
    return makeResult(base, {
      action: "open_pull_request",
      reason_code: "PR_ORCHESTRATE_OPEN_PR_READY",
      recommended_next_action: `Open the PR from ${prHeadBranch ?? branch} to ${prBaseBranch ?? sourceBranch ?? "the source branch"}.`,
      suggested_commands: [buildPrCreateCommand(prBaseBranch, prHeadBranch)],
    });
  }

  if (prStatus === "open") {
    if (prReviewStatus === "approved" || prReviewStatus === "resolved") {
      return makeResult(base, {
        action: "merge_pull_request",
        reason_code: "PR_ORCHESTRATE_READY_TO_MERGE",
        recommended_next_action: "Merge the reviewed PR, then rerun pr-orchestrate for post-merge sync.",
        suggested_commands: ["gh pr merge --merge --delete-branch"],
      });
    }
    return makeResult(base, {
      action: "await_review",
      reason_code: "PR_ORCHESTRATE_REVIEW_PENDING",
      recommended_next_action: "Continue PR review triage and record PR status updates in the session artifact.",
    });
  }

  if (prStatus === "closed_not_merged") {
    return makeResult(base, {
      action: "blocked_pr_closed_not_merged",
      reason_code: "PR_ORCHESTRATE_CLOSED_NOT_MERGED",
      blocking_reasons: [
        `Session ${targetSession.session_id} has a PR closed without merge.`,
      ],
      required_user_choice: ["resume_session_branch", "replace_session_with_rationale", "abandon_session"],
      recommended_next_action: "Decide how to recover or replace the session before starting another one.",
    });
  }

  if (prStatus === "merged") {
    if (postMergeSyncStatus === "done") {
      return makeResult(base, {
        action: "post_merge_sync_complete",
        reason_code: "PR_ORCHESTRATE_COMPLETE",
        recommended_next_action: "Post-merge sync is complete; a new session may now start from the reconciled source branch.",
      });
    }
    if (branchKind !== AIDN_BRANCH_KIND.SOURCE) {
      return makeResult(base, {
        action: "switch_to_source_for_post_merge_sync",
        reason_code: "PR_ORCHESTRATE_SOURCE_BRANCH_REQUIRED",
        recommended_next_action: `Switch to ${sourceBranch ?? "the source branch"} and reconcile local/remote state.`,
        suggested_commands: sourceBranch ? [`git switch ${sourceBranch}`] : [],
      });
    }
    if (!upstreamBranch || !upstreamDivergence.known || upstreamDivergence.ahead > 0 || upstreamDivergence.behind > 0) {
      return makeResult(base, {
        action: "post_merge_sync_required",
        reason_code: "PR_ORCHESTRATE_POST_MERGE_SYNC_REQUIRED",
        recommended_next_action: `Reconcile ${branch} with origin before opening a new session.`,
        suggested_commands: buildPostMergeSyncCommands(branch),
      });
    }
    return makeResult(base, {
      action: "post_merge_sync_complete",
      reason_code: "PR_ORCHESTRATE_POST_MERGE_SYNC_DONE",
      recommended_next_action: "Source branch is aligned; you may create the next session.",
    });
  }

  return makeResult(base, {
    action: "blocked_pr_context_missing",
    reason_code: "PR_ORCHESTRATE_UNRESOLVED_STATE",
    blocking_reasons: [
      "PR orchestration state could not be resolved from session metadata.",
    ],
    required_user_choice: ["repair_session_pr_state", "override_with_rationale"],
    recommended_next_action: "Repair the session PR metadata before continuing.",
  });
}
