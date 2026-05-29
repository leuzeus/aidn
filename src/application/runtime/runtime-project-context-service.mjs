import path from "node:path";
import { resolveWorkspaceContext } from "./workspace-resolution-service.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function normalizeRuntimeProfile(value) {
  return normalizeScalar(value) || "default";
}

function isExplicitIdentitySource(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return normalized === "explicit"
    || normalized === "env"
    || normalized === "locator"
    || normalized === "project-explicit"
    || normalized === "project-env"
    || normalized === "project-locator";
}

export function buildRuntimeScopeId({
  projectId = "",
  workspaceId = "",
  runtimeProfile = "default",
} = {}) {
  const project = normalizeScalar(projectId) || "unknown-project";
  const workspace = normalizeScalar(workspaceId) || project;
  const profile = normalizeRuntimeProfile(runtimeProfile);
  return `runtime:project=${project}:workspace=${workspace}:profile=${profile}`;
}

export function resolveRuntimeProjectContext({
  targetRoot = ".",
  workspace = null,
  runtimeProfile = "default",
  env = process.env,
  projectId = "",
  workspaceId = "",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const resolvedWorkspace = workspace ?? resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
    env,
    projectId,
    workspaceId,
  });
  const project = normalizeScalar(resolvedWorkspace.project_id) || "unknown-project";
  const workspaceValue = normalizeScalar(resolvedWorkspace.workspace_id) || project;
  const worktree = normalizeScalar(resolvedWorkspace.worktree_id) || "unknown-worktree";
  const profile = normalizeRuntimeProfile(runtimeProfile);
  const runtimeScopeId = buildRuntimeScopeId({
    projectId: project,
    workspaceId: workspaceValue,
    runtimeProfile: profile,
  });
  const legacyScopeKey = absoluteTargetRoot;
  const projectSource = normalizeScalar(resolvedWorkspace.project_id_source) || "unknown";
  const workspaceSource = normalizeScalar(resolvedWorkspace.workspace_id_source) || "unknown";
  const worktreeSource = normalizeScalar(resolvedWorkspace.worktree_id_source) || "unknown";
  const explicitProjectContext = isExplicitIdentitySource(projectSource)
    && isExplicitIdentitySource(workspaceSource);

  return {
    project_id: project,
    project_id_source: projectSource,
    workspace_id: workspaceValue,
    workspace_id_source: workspaceSource,
    worktree_id: worktree,
    worktree_id_source: worktreeSource,
    runtime_scope_id: runtimeScopeId,
    runtime_profile: profile,
    legacy_scope_key: legacyScopeKey,
    scope_key: runtimeScopeId,
    target_root_ref: absoluteTargetRoot,
    project_root_ref: normalizeScalar(resolvedWorkspace.project_root) || absoluteTargetRoot,
    locator_ref: normalizeScalar(resolvedWorkspace.shared_runtime_locator_ref) || "none",
    identity_source: `project:${projectSource};workspace:${workspaceSource};worktree:${worktreeSource}`,
    explicit_project_context: explicitProjectContext,
    is_legacy_scope: runtimeScopeId === legacyScopeKey,
  };
}

export function buildRuntimeProjectContextDiagnostics(projectContext = {}) {
  const findings = [];
  if (projectContext.explicit_project_context !== true) {
    findings.push({
      severity: "warning",
      finding_type: "missing-explicit-project-context",
      message: "runtime project identity is not explicitly configured; cross-device stability is not guaranteed",
    });
  }
  if (normalizeScalar(projectContext.scope_key) === normalizeScalar(projectContext.legacy_scope_key)) {
    findings.push({
      severity: "warning",
      finding_type: "legacy-path-scope",
      message: "runtime scope still resolves to an absolute path",
    });
  }
  return {
    status: findings.length > 0 ? "warning" : "clear",
    findings,
    recommended_actions: findings.length > 0
      ? ["configure explicit project_id/workspace_id before using shared PostgreSQL monitoring"]
      : ["no immediate project context action required"],
  };
}

export function buildRuntimeScopeRegistryRow(projectContext = {}, {
  updatedAt = new Date().toISOString(),
} = {}) {
  const scopeKey = normalizeScalar(projectContext.scope_key || projectContext.runtime_scope_id);
  return {
    scope_key: scopeKey || null,
    runtime_scope_id: normalizeScalar(projectContext.runtime_scope_id) || scopeKey || null,
    legacy_scope_key: normalizeScalar(projectContext.legacy_scope_key) || null,
    project_id: normalizeScalar(projectContext.project_id) || null,
    project_id_source: normalizeScalar(projectContext.project_id_source) || "unknown",
    workspace_id: normalizeScalar(projectContext.workspace_id) || null,
    workspace_id_source: normalizeScalar(projectContext.workspace_id_source) || "unknown",
    worktree_id: normalizeScalar(projectContext.worktree_id) || null,
    worktree_id_source: normalizeScalar(projectContext.worktree_id_source) || "unknown",
    runtime_profile: normalizeRuntimeProfile(projectContext.runtime_profile),
    project_root_ref: normalizeScalar(projectContext.project_root_ref) || null,
    target_root_ref: normalizeScalar(projectContext.target_root_ref) || null,
    locator_ref: normalizeScalar(projectContext.locator_ref) || "none",
    identity_source: normalizeScalar(projectContext.identity_source) || "unknown",
    explicit_project_context: projectContext.explicit_project_context === true,
    is_legacy_scope: projectContext.is_legacy_scope === true,
    updated_at: updatedAt,
  };
}
