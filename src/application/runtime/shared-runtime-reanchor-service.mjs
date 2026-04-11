import path from "node:path";
import {
  createDefaultSharedRuntimeLocator,
  normalizeSharedRuntimeLocator,
  readSharedRuntimeLocatorSafe,
  resolveSharedRuntimeLocatorPath,
  resolveSharedRuntimeLocatorRef,
  writeSharedRuntimeLocator,
} from "../../lib/config/shared-runtime-locator-config-lib.mjs";
import { validateSharedRuntimeContext } from "./shared-runtime-validation-service.mjs";
import { resolveWorkspaceContext } from "./workspace-resolution-service.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function normalizeBackendKind(value) {
  return normalizeScalar(value).toLowerCase();
}

function makeResolutionLocatorState(locatorState) {
  return {
    exists: Boolean(locatorState?.exists),
    valid: Boolean(locatorState?.valid ?? true),
    path: normalizeScalar(locatorState?.path),
    ref: normalizeScalar(locatorState?.ref) || resolveSharedRuntimeLocatorRef(),
    data: locatorState?.data ?? createDefaultSharedRuntimeLocator(),
    error: locatorState?.error ?? null,
  };
}

function summarizeLocatorState(locatorState) {
  return {
    exists: Boolean(locatorState?.exists),
    valid: Boolean(locatorState?.valid ?? true),
    path: normalizeScalar(locatorState?.path),
    ref: normalizeScalar(locatorState?.ref) || resolveSharedRuntimeLocatorRef(),
    data: locatorState?.data ?? createDefaultSharedRuntimeLocator(),
    error: locatorState?.error ?? null,
  };
}

function buildValidationForBrokenLocator(locatorState) {
  return {
    ok: false,
    status: "reject",
    issues: [
      `shared runtime locator cannot be parsed: ${normalizeScalar(locatorState?.error?.message) || "unknown error"}`,
    ],
    warnings: [],
    checks: {
      locator_parseable: {
        ok: false,
        details: normalizeScalar(locatorState?.error?.message) || "locator parse failed",
      },
    },
    locator_exists: Boolean(locatorState?.exists),
    locator_ref: normalizeScalar(locatorState?.ref) || resolveSharedRuntimeLocatorRef(),
  };
}

function summarizeValidation(validation) {
  return {
    ok: validation?.ok === true,
    status: normalizeScalar(validation?.status) || "unknown",
    issues: Array.isArray(validation?.issues) ? validation.issues : [],
    warnings: Array.isArray(validation?.warnings) ? validation.warnings : [],
  };
}

function hasRepairIntent(options = {}) {
  return Boolean(
    options.write === true
    || options.localOnly === true
    || normalizeScalar(options.projectId)
    || normalizeScalar(options.projectRoot)
    || normalizeScalar(options.workspaceId)
    || normalizeScalar(options.backendKind)
    || normalizeScalar(options.sharedRoot)
    || normalizeScalar(options.connectionRef)
    || normalizeScalar(options.projectionPolicy),
  );
}

function buildProposedLocator(inspectResult, options = {}) {
  const current = inspectResult.current_locator?.valid
    ? inspectResult.current_locator.data
    : createDefaultSharedRuntimeLocator();
  const projectionPolicy = normalizeScalar(options.projectionPolicy)
    || normalizeScalar(current.projection?.localIndexMode)
    || "preserve-current";

  if (options.localOnly === true) {
    return normalizeSharedRuntimeLocator({
      enabled: false,
      projectId: "",
      workspaceId: "",
      project: {
        root: "",
        rootRef: "none",
      },
      backend: {
        kind: "none",
        root: "",
        connectionRef: "",
      },
      projection: {
        localIndexMode: projectionPolicy,
      },
    });
  }

  const backendKind = normalizeBackendKind(options.backendKind || current.backend?.kind || "");
  const projectId = normalizeScalar(options.projectId)
    || normalizeScalar(current.projectId)
    || normalizeScalar(inspectResult.workspace?.project_id)
    || normalizeScalar(current.compat?.legacyWorkspaceIdentity);
  const workspaceId = normalizeScalar(options.workspaceId)
    || normalizeScalar(current.workspaceId)
    || normalizeScalar(inspectResult.workspace?.workspace_id)
    || projectId;
  const projectRoot = normalizeScalar(options.projectRoot)
    || normalizeScalar(current.project?.root)
    || ".";
  const backendRoot = normalizeScalar(options.sharedRoot) || normalizeScalar(current.backend?.root);
  const connectionRef = normalizeScalar(options.connectionRef) || normalizeScalar(current.backend?.connectionRef);

  return normalizeSharedRuntimeLocator({
    enabled: true,
    projectId,
    workspaceId,
    project: {
      root: projectRoot,
      rootRef: normalizeScalar(current.project?.rootRef) || "target-root",
    },
    backend: {
      kind: backendKind || "none",
      root: backendRoot,
      connectionRef,
    },
    projection: {
      localIndexMode: projectionPolicy,
    },
  });
}

function buildRecommendedAction(inspectResult) {
  if (inspectResult.current_locator?.valid === false) {
    return "run shared-runtime-reanchor with --local-only --write or provide explicit backend settings";
  }
  if (inspectResult.current_validation?.ok === false) {
    return "run shared-runtime-reanchor with a trusted shared root or a postgres connection reference";
  }
  return "shared runtime locator is healthy";
}

export function inspectSharedRuntimeReanchor({
  targetRoot = ".",
  env = process.env,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const safeLocatorState = readSharedRuntimeLocatorSafe(absoluteTargetRoot);
  const resolutionLocatorState = makeResolutionLocatorState(safeLocatorState);
  const workspace = resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
    env,
    locatorState: resolutionLocatorState,
  });
  const validation = safeLocatorState.valid
    ? validateSharedRuntimeContext({
      targetRoot: absoluteTargetRoot,
      workspace,
      env,
      locatorState: resolutionLocatorState,
    })
    : buildValidationForBrokenLocator(safeLocatorState);

  return {
    ok: validation.ok === true && safeLocatorState.valid !== false,
    target_root: absoluteTargetRoot,
    locator_path: resolveSharedRuntimeLocatorPath(absoluteTargetRoot),
    current_locator: summarizeLocatorState(safeLocatorState),
    workspace,
    current_validation: validation,
    recommended_next_action: buildRecommendedAction({
      current_locator: safeLocatorState,
      current_validation: validation,
      workspace,
    }),
  };
}

export function repairSharedRuntimeReanchor({
  targetRoot = ".",
  env = process.env,
  projectId = "",
  projectRoot = "",
  workspaceId = "",
  backendKind = "",
  sharedRoot = "",
  connectionRef = "",
  projectionPolicy = "",
  localOnly = false,
  write = false,
} = {}) {
  const inspectResult = inspectSharedRuntimeReanchor({
    targetRoot,
    env,
  });
  const intendedWrite = write === true || hasRepairIntent({
    localOnly,
    projectId,
    projectRoot,
    workspaceId,
    backendKind,
    sharedRoot,
    connectionRef,
    projectionPolicy,
  });

  if (!intendedWrite) {
    return {
      ok: inspectResult.ok === true,
      action: "inspect",
      applied: false,
      ...inspectResult,
    };
  }

  const proposedLocator = buildProposedLocator(inspectResult, {
    projectId,
    projectRoot,
    workspaceId,
    backendKind,
    sharedRoot,
    connectionRef,
    projectionPolicy,
    localOnly,
  });
  const proposedLocatorState = makeResolutionLocatorState({
    exists: true,
    valid: true,
    path: resolveSharedRuntimeLocatorPath(inspectResult.target_root),
    ref: resolveSharedRuntimeLocatorRef(),
    data: proposedLocator,
    error: null,
  });
  const proposedWorkspace = resolveWorkspaceContext({
    targetRoot: inspectResult.target_root,
    env,
    locatorState: proposedLocatorState,
  });
  const proposedValidation = validateSharedRuntimeContext({
    targetRoot: inspectResult.target_root,
    workspace: proposedWorkspace,
    env,
    locatorState: proposedLocatorState,
  });

  if (proposedValidation.ok !== true) {
    return {
      ok: false,
      action: localOnly ? "fallback-local-only" : "repair",
      applied: false,
      ...inspectResult,
      proposed_locator: proposedLocator,
      proposed_workspace: proposedWorkspace,
      proposed_validation: proposedValidation,
      recommended_next_action: "adjust the proposed backend settings until the validation status is clear or warn",
    };
  }

  writeSharedRuntimeLocator(inspectResult.target_root, proposedLocator);
  const appliedLocatorState = readSharedRuntimeLocatorSafe(inspectResult.target_root);
  const appliedResolutionLocatorState = makeResolutionLocatorState(appliedLocatorState);
  const appliedWorkspace = resolveWorkspaceContext({
    targetRoot: inspectResult.target_root,
    env,
    locatorState: appliedResolutionLocatorState,
  });
  const appliedValidation = validateSharedRuntimeContext({
    targetRoot: inspectResult.target_root,
    workspace: appliedWorkspace,
    env,
    locatorState: appliedResolutionLocatorState,
  });

  return {
    ok: appliedValidation.ok === true && appliedLocatorState.valid === true,
    action: localOnly ? "fallback-local-only" : "repair",
    applied: true,
    target_root: inspectResult.target_root,
    locator_path: inspectResult.locator_path,
    current_locator: inspectResult.current_locator,
    current_validation: inspectResult.current_validation,
    workspace: inspectResult.workspace,
    proposed_locator: proposedLocator,
    proposed_workspace: proposedWorkspace,
    proposed_validation: proposedValidation,
    applied_locator: summarizeLocatorState(appliedLocatorState),
    applied_workspace: appliedWorkspace,
    applied_validation: appliedValidation,
    recommended_next_action: appliedValidation.ok === true
      ? "re-run pre-write or handoff admission on the repaired worktree"
      : "shared runtime locator still requires manual review",
  };
}

export function summarizeSharedRuntimeReanchorResult(result) {
  return {
    ok: result?.ok === true,
    action: normalizeScalar(result?.action) || "inspect",
    applied: result?.applied === true,
    current_status: normalizeScalar(result?.current_validation?.status),
    proposed_status: normalizeScalar(result?.proposed_validation?.status),
    applied_status: normalizeScalar(result?.applied_validation?.status),
    recommended_next_action: normalizeScalar(result?.recommended_next_action),
    current_locator_valid: result?.current_locator?.valid === true,
  };
}
