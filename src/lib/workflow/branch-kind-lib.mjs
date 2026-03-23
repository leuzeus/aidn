export const AIDN_BRANCH_KIND = Object.freeze({
  SOURCE: "source",
  SESSION: "session",
  CYCLE: "cycle",
  INTERMEDIATE: "intermediate",
  OTHER: "other",
  UNKNOWN: "unknown",
});

const CYCLE_TYPE_PATTERN = "(feature|hotfix|spike|refactor|structural|migration|security|perf|integration|compat|corrective)";
const INTERMEDIATE_BRANCH_RE = new RegExp(`^${CYCLE_TYPE_PATTERN}\\/C[0-9]+-I[0-9]+-`, "i");
const CYCLE_BRANCH_RE = new RegExp(`^${CYCLE_TYPE_PATTERN}\\/C[0-9]+-`, "i");
const SESSION_BRANCH_RE = /^S[0-9]+-/i;

export function normalizeBranchName(branch) {
  return String(branch ?? "").trim();
}

export function classifyAidnBranch(branch, options = {}) {
  const normalizedBranch = normalizeBranchName(branch);
  if (!normalizedBranch || normalizedBranch === "unknown") {
    return AIDN_BRANCH_KIND.UNKNOWN;
  }
  const normalizedSourceBranch = normalizeBranchName(options.sourceBranch);
  if (options.includeSource === true && normalizedSourceBranch && normalizedBranch === normalizedSourceBranch) {
    return AIDN_BRANCH_KIND.SOURCE;
  }
  if (SESSION_BRANCH_RE.test(normalizedBranch)) {
    return AIDN_BRANCH_KIND.SESSION;
  }
  if (INTERMEDIATE_BRANCH_RE.test(normalizedBranch)) {
    return AIDN_BRANCH_KIND.INTERMEDIATE;
  }
  if (CYCLE_BRANCH_RE.test(normalizedBranch)) {
    return AIDN_BRANCH_KIND.CYCLE;
  }
  return AIDN_BRANCH_KIND.OTHER;
}

export function extractCycleIdFromBranch(branch) {
  const normalizedBranch = normalizeBranchName(branch);
  const match = normalizedBranch.match(/\b(C[0-9]+)\b/i);
  return match ? String(match[1]).toUpperCase() : null;
}
