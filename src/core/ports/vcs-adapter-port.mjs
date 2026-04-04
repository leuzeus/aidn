const REQUIRED_METHODS = [
  "getCurrentBranch",
  "getHeadCommit",
  "hasWorkingTreeChanges",
  "execStatusPorcelain",
];

const WORKSPACE_IDENTITY_METHODS = [
  "getRepoRoot",
  "getWorktreeRoot",
  "getGitDir",
  "getGitCommonDir",
  "isLinkedWorktree",
];

export function assertVcsAdapter(candidate, label = "VcsAdapter") {
  if (!candidate || typeof candidate !== "object") {
    throw new Error(`${label} must be an object`);
  }
  for (const methodName of REQUIRED_METHODS) {
    if (typeof candidate[methodName] !== "function") {
      throw new Error(`${label} is missing required method: ${methodName}()`);
    }
  }
  return candidate;
}

export function hasWorkspaceIdentityMethods(candidate) {
  return WORKSPACE_IDENTITY_METHODS.every((methodName) => typeof candidate?.[methodName] === "function");
}

export function assertWorkspaceAwareVcsAdapter(candidate, label = "VcsAdapter") {
  const adapter = assertVcsAdapter(candidate, label);
  for (const methodName of WORKSPACE_IDENTITY_METHODS) {
    if (typeof adapter[methodName] !== "function") {
      throw new Error(`${label} is missing required workspace method: ${methodName}()`);
    }
  }
  return adapter;
}
