import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { canonicalNone, canonicalUnknown, normalizeScalar } from "../../lib/workflow/session-context-lib.mjs";

function normalizeRef(value) {
  const normalized = normalizeScalar(value);
  if (!normalized || canonicalNone(normalized) || canonicalUnknown(normalized)) {
    return "";
  }
  return normalized;
}

function buildUnknownCycleTopology(cycle, sessionBranch, reason) {
  return {
    cycle_id: cycle?.cycle_id ?? null,
    cycle_branch: normalizeRef(cycle?.branch_name),
    session_owner: normalizeScalar(cycle?.session_owner ?? "") || "none",
    session_branch: sessionBranch || "none",
    source_branch: "none",
    status: "unknown",
    blocking_reason: reason || "git topology could not be verified",
  };
}

export function classifyOpenCycleTopology({
  targetRoot,
  cycle,
  sessionsById,
  sourceBranch,
  gitAdapter = createLocalGitAdapter(),
}) {
  const cycleBranch = normalizeRef(cycle?.branch_name);
  const ownerId = normalizeScalar(cycle?.session_owner ?? "").toUpperCase();
  const ownerSession = ownerId ? sessionsById.get(ownerId) ?? null : null;
  const sessionBranch = normalizeRef(ownerSession?.metadata?.session_branch);
  const normalizedSourceBranch = normalizeRef(sourceBranch);

  if (!cycleBranch) {
    return buildUnknownCycleTopology(cycle, sessionBranch, "cycle branch is not recorded in workflow artifacts");
  }
  if (!sessionBranch) {
    return buildUnknownCycleTopology(cycle, sessionBranch, `owning session ${ownerId || "unknown"} has no session branch recorded`);
  }
  if (typeof gitAdapter.refExists !== "function" || typeof gitAdapter.isAncestor !== "function") {
    return buildUnknownCycleTopology(cycle, sessionBranch, "git adapter does not expose ancestry checks");
  }
  if (!gitAdapter.refExists(targetRoot, cycleBranch)) {
    return buildUnknownCycleTopology(cycle, sessionBranch, `cycle branch ${cycleBranch} is not available locally`);
  }
  if (!gitAdapter.refExists(targetRoot, sessionBranch)) {
    return buildUnknownCycleTopology(cycle, sessionBranch, `session branch ${sessionBranch} is not available locally`);
  }
  if (!gitAdapter.isAncestor(targetRoot, cycleBranch, sessionBranch)) {
    return {
      cycle_id: cycle?.cycle_id ?? null,
      cycle_branch: cycleBranch,
      session_owner: ownerId || "none",
      session_branch: sessionBranch,
      source_branch: normalizedSourceBranch || "none",
      status: "active",
      blocking_reason: "",
    };
  }

  if (normalizedSourceBranch && gitAdapter.refExists(targetRoot, normalizedSourceBranch)
    && gitAdapter.isAncestor(targetRoot, sessionBranch, normalizedSourceBranch)) {
    return {
      cycle_id: cycle?.cycle_id ?? null,
      cycle_branch: cycleBranch,
      session_owner: ownerId || "none",
      session_branch: sessionBranch,
      source_branch: normalizedSourceBranch,
      status: "stale_merged_into_source",
      blocking_reason: `cycle branch ${cycleBranch} is already merged into session branch ${sessionBranch}, and session branch ${sessionBranch} is already merged into source branch ${normalizedSourceBranch}`,
    };
  }

  return {
    cycle_id: cycle?.cycle_id ?? null,
    cycle_branch: cycleBranch,
    session_owner: ownerId || "none",
    session_branch: sessionBranch,
    source_branch: normalizedSourceBranch || "none",
    status: "stale_merged_into_session",
    blocking_reason: `cycle branch ${cycleBranch} is already merged into session branch ${sessionBranch}`,
  };
}

export function isStaleMergedOpenCycle(classification) {
  return classification?.status === "stale_merged_into_session"
    || classification?.status === "stale_merged_into_source";
}
