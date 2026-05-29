import { findDescendantSharedRuntimeLocators, readSharedRuntimeLocator } from "../../lib/config/shared-runtime-locator-config-lib.mjs";
import { canonicalizeRuntimePath, isSameOrChildRuntimePath, resolveRuntimePath } from "./shared-runtime-path-lib.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function makeCheck(ok, details) {
  return {
    ok,
    details: normalizeScalar(details) || "none",
  };
}

export function validateSharedRuntimeContext({
  targetRoot,
  workspace,
  env = process.env,
  locatorState = null,
  platform = process.platform,
} = {}) {
  const absoluteTargetRoot = resolveRuntimePath(process.cwd(), targetRoot ?? workspace?.target_root ?? ".", { platform });
  const locator = locatorState ?? readSharedRuntimeLocator(absoluteTargetRoot);
  const locatorData = locator.data ?? {};
  const resolvedWorkspace = workspace ?? {};
  const issues = [];
  const warnings = [];

  const sharedRuntimeMode = normalizeScalar(resolvedWorkspace.shared_runtime_mode) || "local-only";
  const sharedRuntimeRoot = normalizeScalar(resolvedWorkspace.shared_runtime_root);
  const sharedBackendKind = normalizeScalar(resolvedWorkspace.shared_backend_kind).toLowerCase() || "none";
  const sharedConnectionRef = normalizeScalar(resolvedWorkspace.shared_runtime_connection_ref);
  const projectId = normalizeScalar(resolvedWorkspace.project_id);
  const projectIdSource = normalizeScalar(resolvedWorkspace.project_id_source) || "unknown";
  const workspaceId = normalizeScalar(resolvedWorkspace.workspace_id);
  const workspaceIdSource = normalizeScalar(resolvedWorkspace.workspace_id_source) || "unknown";
  const worktreeRoot = canonicalizeRuntimePath(resolvedWorkspace.worktree_root ?? absoluteTargetRoot, { platform });
  const docsRoot = resolveRuntimePath(worktreeRoot, "docs", { platform });
  const docsAuditRoot = resolveRuntimePath(worktreeRoot, "docs/audit", { platform });
  const gitDir = canonicalizeRuntimePath(resolvedWorkspace.git_dir, { platform });
  const localRuntimeRoot = resolveRuntimePath(worktreeRoot, ".aidn/runtime", { platform });
  const locatorProjectId = normalizeScalar(locatorData.projectId);
  const locatorWorkspaceId = normalizeScalar(locatorData.workspaceId);
  const envProjectId = normalizeScalar(env.AIDN_PROJECT_ID);
  const envWorkspaceId = normalizeScalar(env.AIDN_WORKSPACE_ID);
  const descendantLocators = locator.exists === true
    ? []
    : findDescendantSharedRuntimeLocators(absoluteTargetRoot, {
      maxResults: 2,
    });

  const checks = {
    shared_runtime_contract_complete: makeCheck(true, sharedRuntimeMode === "local-only"
      ? "local-only mode does not require shared runtime contract fields"
      : `shared backend kind=${sharedBackendKind}`),
    shared_runtime_root_is_trusted: makeCheck(true, sharedRuntimeRoot || "no shared runtime root configured"),
    locator_project_identity_consistent: makeCheck(true, locatorProjectId || "no locator project identity declared"),
    locator_workspace_identity_consistent: makeCheck(true, locatorWorkspaceId || "no locator workspace identity declared"),
    nested_project_locator_topology_clear: makeCheck(true, "no nested project locator ambiguity detected"),
  };

  if (sharedRuntimeMode !== "local-only") {
    if (sharedBackendKind === "none") {
      issues.push("shared runtime is enabled but backend kind is none");
      checks.shared_runtime_contract_complete = makeCheck(false, "shared runtime requires a concrete backend kind");
    } else if (sharedBackendKind === "sqlite-file" && !sharedRuntimeRoot) {
      issues.push("shared runtime sqlite-file backend requires a shared runtime root");
      checks.shared_runtime_contract_complete = makeCheck(false, "sqlite-file backend is missing shared_runtime_root");
    } else if (sharedBackendKind === "postgres" && !sharedConnectionRef) {
      issues.push("shared runtime postgres backend requires a connection reference");
      checks.shared_runtime_contract_complete = makeCheck(false, "postgres backend is missing shared_runtime_connection_ref");
    }
  }

  if (sharedRuntimeRoot) {
    if (isSameOrChildRuntimePath(sharedRuntimeRoot, docsAuditRoot, { platform })) {
      issues.push(`shared runtime root overlaps versioned workflow artifacts: ${sharedRuntimeRoot}`);
      checks.shared_runtime_root_is_trusted = makeCheck(false, "shared runtime root must not point inside docs/audit");
    } else if (isSameOrChildRuntimePath(sharedRuntimeRoot, docsRoot, { platform })) {
      issues.push(`shared runtime root overlaps docs tree: ${sharedRuntimeRoot}`);
      checks.shared_runtime_root_is_trusted = makeCheck(false, "shared runtime root must not point inside docs");
    } else if (gitDir && isSameOrChildRuntimePath(sharedRuntimeRoot, gitDir, { platform })) {
      issues.push(`shared runtime root overlaps git metadata: ${sharedRuntimeRoot}`);
      checks.shared_runtime_root_is_trusted = makeCheck(false, "shared runtime root must not point inside .git");
    } else if (isSameOrChildRuntimePath(sharedRuntimeRoot, localRuntimeRoot, { platform })) {
      issues.push(`shared runtime root overlaps local runtime cache: ${sharedRuntimeRoot}`);
      checks.shared_runtime_root_is_trusted = makeCheck(false, "shared runtime root must not point inside .aidn/runtime");
    } else if (canonicalizeRuntimePath(sharedRuntimeRoot, { platform }) === worktreeRoot) {
      issues.push(`shared runtime root must not equal the worktree root: ${sharedRuntimeRoot}`);
      checks.shared_runtime_root_is_trusted = makeCheck(false, "shared runtime root must stay outside the worktree root");
    } else {
      checks.shared_runtime_root_is_trusted = makeCheck(true, sharedRuntimeRoot);
    }

    if (
      resolvedWorkspace.is_linked_worktree === true
      && sharedBackendKind === "sqlite-file"
      && isSameOrChildRuntimePath(sharedRuntimeRoot, worktreeRoot, { platform })
    ) {
      warnings.push("linked worktree uses a worktree-local sqlite shared runtime root; confirm this is intentionally not shared across sibling worktrees");
    }
  }

  if (locatorProjectId) {
    if (projectIdSource !== "locator" && projectId && projectId !== locatorProjectId) {
      issues.push(`shared runtime locator project_id mismatch: locator=${locatorProjectId} resolved=${projectId}`);
      checks.locator_project_identity_consistent = makeCheck(false, `locator=${locatorProjectId}; resolved=${projectId}; source=${projectIdSource}`);
    } else {
      checks.locator_project_identity_consistent = makeCheck(true, `locator=${locatorProjectId}; source=${projectIdSource}`);
    }
  }

  if (locatorWorkspaceId) {
    if (workspaceIdSource !== "locator" && workspaceId && workspaceId !== locatorWorkspaceId) {
      issues.push(`shared runtime locator workspace_id mismatch: locator=${locatorWorkspaceId} resolved=${workspaceId}`);
      checks.locator_workspace_identity_consistent = makeCheck(false, `locator=${locatorWorkspaceId}; resolved=${workspaceId}; source=${workspaceIdSource}`);
    } else {
      checks.locator_workspace_identity_consistent = makeCheck(true, `locator=${locatorWorkspaceId}; source=${workspaceIdSource}`);
    }
  }

  if (descendantLocators.length > 1) {
    const listedLocators = descendantLocators
      .map((entry) => canonicalizeRuntimePath(entry, { platform }))
      .join(", ");
    issues.push(`target root is ambiguous: multiple nested shared runtime locators detected beneath ${canonicalizeRuntimePath(absoluteTargetRoot, { platform })}`);
    checks.nested_project_locator_topology_clear = makeCheck(false, listedLocators);
  } else if (descendantLocators.length === 1) {
    warnings.push(`target root does not declare a local shared runtime locator; prefer the nested project root at ${canonicalizeRuntimePath(descendantLocators[0], { platform })}`);
    checks.nested_project_locator_topology_clear = makeCheck(true, canonicalizeRuntimePath(descendantLocators[0], { platform }));
  }

  if (locator.exists && locatorData.enabled === false && sharedRuntimeMode !== "local-only") {
    warnings.push("shared runtime is enabled by override while the locator is disabled");
  }
  if (locatorProjectId && envProjectId && envProjectId !== locatorProjectId) {
    warnings.push(`environment project override differs from locator project identity: env=${envProjectId} locator=${locatorProjectId}`);
  }
  if (locatorWorkspaceId && envWorkspaceId && envWorkspaceId !== locatorWorkspaceId) {
    warnings.push(`environment workspace override differs from locator workspace identity: env=${envWorkspaceId} locator=${locatorWorkspaceId}`);
  }

  return {
    ok: issues.length === 0,
    status: issues.length > 0 ? "reject" : (warnings.length > 0 ? "warn" : "clear"),
    issues,
    warnings,
    checks,
    locator_exists: locator.exists === true,
    locator_ref: locator.ref ?? "none",
  };
}
