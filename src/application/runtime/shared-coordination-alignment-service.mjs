import path from "node:path";
import {
  readAidnProjectConfig,
  resolveConfigRuntimePersistence,
  resolveConfigStateMode,
  normalizeStateMode,
} from "../../lib/config/aidn-config-lib.mjs";
import { readWorkflowAdapterConfig } from "../../lib/config/workflow-adapter-config-lib.mjs";
import { resolveWorkspaceContext } from "./workspace-resolution-service.mjs";

const DB_BACKED_STATE_MODES = new Set(["dual", "db-only"]);

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function normalizeBackendKind(value) {
  return normalizeScalar(value).toLowerCase() || "none";
}

function collectStateModeSources({
  configRead,
  workflowRead,
}) {
  const sources = [];
  const configStateMode = normalizeStateMode(resolveConfigStateMode(configRead?.data));
  if (configStateMode) {
    sources.push({
      source: "config",
      value: configStateMode,
      exists: configRead?.exists === true,
    });
  }

  const workflowStateMode = workflowRead?.exists === true
    ? normalizeStateMode(workflowRead.data?.runtimePolicy?.preferredStateMode)
    : null;
  if (workflowStateMode) {
    sources.push({
      source: "workflow-adapter",
      value: workflowStateMode,
      exists: true,
    });
  }
  return sources;
}

function createReanchorCommand({
  connectionRef,
  projectId,
  workspaceId,
}) {
  const parts = [
    "aidn runtime shared-runtime-reanchor --target .",
    "--backend postgres",
    `--connection-ref ${connectionRef || "env:AIDN_PG_URL"}`,
  ];
  if (projectId) {
    parts.push(`--project-id ${projectId}`);
  }
  if (workspaceId) {
    parts.push(`--workspace-id ${workspaceId}`);
  }
  parts.push("--write --json");
  return parts.join(" ");
}

export function assessSharedCoordinationAlignment({
  targetRoot = ".",
  workspace = null,
  configData = null,
  workflowAdapterData = null,
  env = process.env,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const resolvedWorkspace = workspace ?? resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
    env,
  });
  const configRead = configData
    ? { exists: true, data: configData }
    : readAidnProjectConfig(absoluteTargetRoot);
  const workflowRead = workflowAdapterData
    ? { exists: true, data: workflowAdapterData }
    : readWorkflowAdapterConfig(absoluteTargetRoot);
  const runtimePersistence = resolveConfigRuntimePersistence(configRead.data) ?? {
    backend: "sqlite",
    localProjectionPolicy: null,
    connectionRef: null,
  };
  const stateModeSources = collectStateModeSources({
    configRead,
    workflowRead,
  });
  const dbBackedMode = stateModeSources.some((entry) => DB_BACKED_STATE_MODES.has(entry.value));
  const runtimeBackend = normalizeBackendKind(runtimePersistence.backend);
  const sharedRuntimeMode = normalizeScalar(resolvedWorkspace.shared_runtime_mode) || "local-only";
  const sharedBackendKind = normalizeBackendKind(resolvedWorkspace.shared_backend_kind);
  const sharedRuntimeEnabled = sharedRuntimeMode === "shared-runtime";
  const locatorExists = resolvedWorkspace.shared_runtime_locator_exists === true;
  const explicitDisabledLocator = locatorExists && !sharedRuntimeEnabled;
  const findings = [];

  if (dbBackedMode && runtimeBackend === "postgres" && explicitDisabledLocator) {
    findings.push({
      severity: "warning",
      code: "postgres-runtime-shared-coordination-disabled",
      message: "runtime persistence is PostgreSQL in a DB-backed state mode, but the shared-runtime locator explicitly disables shared coordination",
      recommended_action: createReanchorCommand({
        connectionRef: runtimePersistence.connectionRef,
        projectId: resolvedWorkspace.project_id,
        workspaceId: resolvedWorkspace.workspace_id,
      }),
    });
  } else if (dbBackedMode && runtimeBackend === "postgres" && sharedRuntimeEnabled && sharedBackendKind !== "postgres") {
    findings.push({
      severity: "warning",
      code: "postgres-runtime-shared-backend-mismatch",
      message: `runtime persistence is PostgreSQL, but shared coordination resolves backend.kind=${sharedBackendKind}`,
      recommended_action: "confirm the non-PostgreSQL shared backend is intentional, or re-anchor shared runtime with backend.kind=postgres",
    });
  }

  const hasErrors = findings.some((item) => item.severity === "error");
  const hasWarnings = findings.some((item) => item.severity === "warning");
  return {
    status: hasErrors ? "block" : (hasWarnings ? "warn" : "clear"),
    db_backed_mode: dbBackedMode,
    state_mode_sources: stateModeSources,
    runtime_persistence_backend: runtimeBackend,
    runtime_persistence_connection_ref: runtimePersistence.connectionRef ?? "none",
    shared_runtime_mode: sharedRuntimeMode,
    shared_backend_kind: sharedBackendKind,
    shared_runtime_locator_exists: locatorExists,
    project_id: normalizeScalar(resolvedWorkspace.project_id),
    workspace_id: normalizeScalar(resolvedWorkspace.workspace_id),
    findings,
    recommended_actions: findings.length > 0
      ? Array.from(new Set(findings.map((item) => item.recommended_action).filter(Boolean)))
      : ["no shared coordination alignment action required"],
  };
}
