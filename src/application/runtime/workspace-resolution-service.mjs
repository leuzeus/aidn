import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { assertVcsAdapter, hasWorkspaceIdentityMethods } from "../../core/ports/vcs-adapter-port.mjs";
import { readSharedRuntimeLocator } from "../../lib/config/shared-runtime-locator-config-lib.mjs";
import { canonicalizeRuntimePath, resolveRuntimePath } from "./shared-runtime-path-lib.mjs";

const SHARED_BACKEND_KINDS = new Set(["none", "sqlite-file", "postgres", "unknown"]);

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function parseBooleanLike(value) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = normalizeScalar(value).toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
}

function normalizeSharedBackendKind(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  if (!normalized) {
    return "none";
  }
  return SHARED_BACKEND_KINDS.has(normalized) ? normalized : "unknown";
}

function safeRealpath(candidatePath) {
  if (!candidatePath) {
    return "";
  }
  try {
    return fs.realpathSync.native(candidatePath);
  } catch {
    try {
      return fs.realpathSync(candidatePath);
    } catch {
      return path.resolve(candidatePath);
    }
  }
}

function normalizeIdentityPath(candidatePath) {
  return canonicalizeRuntimePath(safeRealpath(candidatePath));
}

function hashIdentity(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function deriveLegacyWorkspaceIdentity({
  explicitWorkspaceId,
  envWorkspaceId,
  locatorWorkspaceId,
  gitCommonDir,
  repoRoot,
  worktreeRoot,
}) {
  if (explicitWorkspaceId) {
    return {
      workspace_id: explicitWorkspaceId,
      workspace_id_source: "explicit",
    };
  }
  if (envWorkspaceId) {
    return {
      workspace_id: envWorkspaceId,
      workspace_id_source: "env",
    };
  }
  if (locatorWorkspaceId) {
    return {
      workspace_id: locatorWorkspaceId,
      workspace_id_source: "locator",
    };
  }
  if (gitCommonDir) {
    return {
      workspace_id: hashIdentity("git", gitCommonDir),
      workspace_id_source: "git-common-dir",
    };
  }
  if (repoRoot) {
    return {
      workspace_id: hashIdentity("repo", repoRoot),
      workspace_id_source: "repo-root",
    };
  }
  return {
    workspace_id: hashIdentity("local", worktreeRoot),
    workspace_id_source: "worktree-root",
  };
}

function deriveProjectIdentity({
  explicitProjectId,
  envProjectId,
  locatorProjectId,
  legacyWorkspaceIdentity,
}) {
  if (explicitProjectId) {
    return {
      project_id: explicitProjectId,
      project_id_source: "explicit",
    };
  }
  if (envProjectId) {
    return {
      project_id: envProjectId,
      project_id_source: "env",
    };
  }
  if (locatorProjectId) {
    return {
      project_id: locatorProjectId,
      project_id_source: "locator",
    };
  }
  return {
    project_id: legacyWorkspaceIdentity.workspace_id,
    project_id_source: `legacy-${legacyWorkspaceIdentity.workspace_id_source}`,
  };
}

function deriveProjectRoot({
  targetRoot,
  explicitProjectRoot,
  envProjectRoot,
  locatorProjectRoot,
}) {
  if (normalizeScalar(explicitProjectRoot)) {
    return {
      project_root: resolveRuntimePath(targetRoot, explicitProjectRoot),
      project_root_source: "explicit",
    };
  }
  if (normalizeScalar(envProjectRoot)) {
    return {
      project_root: resolveRuntimePath(targetRoot, envProjectRoot),
      project_root_source: "env",
    };
  }
  if (normalizeScalar(locatorProjectRoot)) {
    return {
      project_root: resolveRuntimePath(targetRoot, locatorProjectRoot),
      project_root_source: "locator",
    };
  }
  return {
    project_root: targetRoot,
    project_root_source: "target-root",
  };
}

function deriveWorkspaceIdentity({
  explicitWorkspaceId,
  envWorkspaceId,
  locatorWorkspaceId,
  projectIdentity,
}) {
  if (explicitWorkspaceId) {
    return {
      workspace_id: explicitWorkspaceId,
      workspace_id_source: "explicit",
    };
  }
  if (envWorkspaceId) {
    return {
      workspace_id: envWorkspaceId,
      workspace_id_source: "env",
    };
  }
  if (locatorWorkspaceId) {
    return {
      workspace_id: locatorWorkspaceId,
      workspace_id_source: "locator",
    };
  }
  return {
    workspace_id: projectIdentity.project_id,
    workspace_id_source: `project-${projectIdentity.project_id_source}`,
  };
}

function resolveSharedRuntime({
  worktreeRoot,
  env,
  explicitSharedRuntimeRoot = "",
  explicitSharedBackendKind = "",
  explicitSharedRuntimeEnabled = null,
  locatorExists = false,
  locatorRef = "none",
  locatorSharedRuntimeRoot = "",
  locatorSharedBackendKind = "",
  locatorSharedRuntimeEnabled = null,
  locatorConnectionRef = "",
  locatorProjectionPolicy = "",
}) {
  const envSharedRuntimeRoot = normalizeScalar(env.AIDN_SHARED_RUNTIME_ROOT);
  const envSharedBackendKind = normalizeScalar(env.AIDN_SHARED_BACKEND_KIND);
  const envConnectionRef = normalizeScalar(env.AIDN_SHARED_RUNTIME_CONNECTION_REF);
  const explicitEnabled = parseBooleanLike(explicitSharedRuntimeEnabled);
  const envEnabled = parseBooleanLike(env.AIDN_SHARED_RUNTIME_ENABLED);
  const locatorEnabled = parseBooleanLike(locatorSharedRuntimeEnabled);
  const sharedRuntimeRootRaw = normalizeScalar(explicitSharedRuntimeRoot) || envSharedRuntimeRoot || normalizeScalar(locatorSharedRuntimeRoot);
  const sharedRuntimeRoot = sharedRuntimeRootRaw
    ? resolveRuntimePath(worktreeRoot, sharedRuntimeRootRaw)
    : "";
  const sharedBackendKind = normalizeSharedBackendKind(
    normalizeScalar(explicitSharedBackendKind)
      || envSharedBackendKind
      || normalizeScalar(locatorSharedBackendKind)
      || (sharedRuntimeRoot ? "unknown" : "none"),
  );
  const sharedConnectionRef = normalizeScalar(envConnectionRef) || normalizeScalar(locatorConnectionRef);
  const sharedRuntimeEnabled = explicitEnabled
    ?? envEnabled
    ?? locatorEnabled
    ?? (Boolean(sharedRuntimeRoot) || Boolean(sharedConnectionRef) || sharedBackendKind !== "none");
  const projectionPolicy = normalizeScalar(locatorProjectionPolicy) || "preserve-current";

  return {
    shared_runtime_enabled: sharedRuntimeEnabled,
    shared_runtime_mode: sharedRuntimeEnabled ? "shared-runtime" : "local-only",
    shared_runtime_root: sharedRuntimeRoot || null,
    shared_runtime_root_source: normalizeScalar(explicitSharedRuntimeRoot)
      ? "explicit"
      : (envSharedRuntimeRoot ? "env" : (normalizeScalar(locatorSharedRuntimeRoot) ? "locator" : "none")),
    shared_backend_kind: sharedRuntimeEnabled ? sharedBackendKind : "none",
    shared_backend_kind_source: normalizeScalar(explicitSharedBackendKind)
      ? "explicit"
      : (envSharedBackendKind ? "env" : (normalizeScalar(locatorSharedBackendKind) ? "locator" : "derived")),
    shared_runtime_connection_ref: sharedRuntimeEnabled ? (sharedConnectionRef || null) : null,
    shared_runtime_connection_ref_source: envConnectionRef
      ? "env"
      : (normalizeScalar(locatorConnectionRef) ? "locator" : "none"),
    shared_runtime_projection_policy: projectionPolicy,
    shared_runtime_projection_policy_source: normalizeScalar(locatorProjectionPolicy) ? "locator" : "default",
    shared_runtime_locator_exists: locatorExists,
    shared_runtime_locator_ref: locatorExists ? locatorRef : "none",
  };
}

export function resolveWorkspaceContext({
  targetRoot = ".",
  gitAdapter = createLocalGitAdapter(),
  env = process.env,
  projectId = "",
  projectRoot = "",
  workspaceId = "",
  sharedRuntimeRoot = "",
  sharedBackendKind = "",
  sharedRuntimeEnabled = null,
  locatorState = null,
} = {}) {
  const adapter = assertVcsAdapter(gitAdapter, "WorkspaceResolutionGitAdapter");
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot);
  const explicitProjectId = normalizeScalar(projectId);
  const explicitProjectRoot = normalizeScalar(projectRoot);
  const explicitWorkspaceId = normalizeScalar(workspaceId);
  const envProjectId = normalizeScalar(env.AIDN_PROJECT_ID);
  const envProjectRoot = normalizeScalar(env.AIDN_PROJECT_ROOT);
  const envWorkspaceId = normalizeScalar(env.AIDN_WORKSPACE_ID);
  const locator = locatorState ?? readSharedRuntimeLocator(absoluteTargetRoot);
  const locatorData = locator.data ?? {};

  const supportsWorkspaceIdentity = hasWorkspaceIdentityMethods(adapter);
  const worktreeRoot = normalizeIdentityPath(
    (supportsWorkspaceIdentity ? adapter.getWorktreeRoot(absoluteTargetRoot) : "")
    || (typeof adapter.getRepoRoot === "function" ? adapter.getRepoRoot(absoluteTargetRoot) : "")
    || absoluteTargetRoot,
  );
  const repoRoot = normalizeIdentityPath(
    (typeof adapter.getRepoRoot === "function" ? adapter.getRepoRoot(absoluteTargetRoot) : "")
    || worktreeRoot,
  );
  const gitDir = supportsWorkspaceIdentity
    ? normalizeIdentityPath(adapter.getGitDir(absoluteTargetRoot) || "")
    : "";
  const gitCommonDir = supportsWorkspaceIdentity
    ? normalizeIdentityPath(adapter.getGitCommonDir(absoluteTargetRoot) || "")
    : "";
  const linkedWorktree = supportsWorkspaceIdentity
    ? adapter.isLinkedWorktree(absoluteTargetRoot) === true
    : false;
  const isGitRepo = repoRoot.length > 0 && repoRoot !== normalizeIdentityPath(absoluteTargetRoot)
    ? true
    : Boolean(typeof adapter.getHeadCommit === "function" && adapter.getHeadCommit(absoluteTargetRoot) !== "unknown");

  const legacyWorkspaceIdentity = deriveLegacyWorkspaceIdentity({
    explicitWorkspaceId,
    envWorkspaceId,
    locatorWorkspaceId: normalizeScalar(locatorData.workspaceId),
    gitCommonDir,
    repoRoot,
    worktreeRoot,
  });
  const projectIdentity = deriveProjectIdentity({
    explicitProjectId,
    envProjectId,
    locatorProjectId: normalizeScalar(locatorData.projectId),
    legacyWorkspaceIdentity,
  });
  const projectRootResolution = deriveProjectRoot({
    targetRoot: absoluteTargetRoot,
    explicitProjectRoot,
    envProjectRoot,
    locatorProjectRoot: normalizeScalar(locatorData.project?.root),
  });
  const workspaceIdentity = deriveWorkspaceIdentity({
    explicitWorkspaceId,
    envWorkspaceId,
    locatorWorkspaceId: normalizeScalar(locatorData.workspaceId),
    projectIdentity,
  });

  return {
    target_root: absoluteTargetRoot,
    project_id: projectIdentity.project_id,
    project_id_source: projectIdentity.project_id_source,
    project_root: projectRootResolution.project_root || absoluteTargetRoot,
    project_root_source: projectRootResolution.project_root_source,
    worktree_root: worktreeRoot,
    repo_root: repoRoot || null,
    git_dir: gitDir || null,
    git_common_dir: gitCommonDir || null,
    is_git_repo: isGitRepo,
    is_linked_worktree: linkedWorktree,
    workspace_id: workspaceIdentity.workspace_id,
    workspace_id_source: workspaceIdentity.workspace_id_source,
    worktree_id: hashIdentity("worktree", worktreeRoot),
    worktree_id_source: "worktree-root",
    ...resolveSharedRuntime({
      worktreeRoot: worktreeRoot || normalizeIdentityPath(absoluteTargetRoot),
      env,
      explicitSharedRuntimeRoot: sharedRuntimeRoot,
      explicitSharedBackendKind: sharedBackendKind,
      explicitSharedRuntimeEnabled: sharedRuntimeEnabled,
      locatorExists: locator.exists === true,
      locatorRef: locator.ref ?? "none",
      locatorSharedRuntimeRoot: locatorData.backend?.root ?? "",
      locatorSharedBackendKind: locatorData.backend?.kind ?? "",
      locatorSharedRuntimeEnabled: locatorData.enabled,
      locatorConnectionRef: locatorData.backend?.connectionRef ?? "",
      locatorProjectionPolicy: locatorData.projection?.localIndexMode ?? "",
    }),
  };
}
