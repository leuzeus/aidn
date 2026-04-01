import path from "node:path";
import { createSqliteSharedStateBackend } from "../../adapters/runtime/sqlite-shared-state-backend.mjs";
import { assertSharedStateBackend } from "../../core/ports/shared-state-backend-port.mjs";
import { resolveWorkspaceContext } from "./workspace-resolution-service.mjs";

function resolveSharedProjectionSqliteFile(targetRoot, workspace) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? workspace?.target_root ?? ".");
  const sharedRuntimeMode = String(workspace?.shared_runtime_mode ?? "local-only").trim();
  const sharedBackendKind = String(workspace?.shared_backend_kind ?? "none").trim().toLowerCase();
  const sharedRuntimeRoot = String(workspace?.shared_runtime_root ?? "").trim();

  if (sharedRuntimeMode === "shared-runtime" && sharedBackendKind === "sqlite-file" && sharedRuntimeRoot) {
    return {
      sqliteFile: path.resolve(sharedRuntimeRoot, "index", "workflow-index.sqlite"),
      projectionScope: "shared-runtime-root",
      logicalRoot: sharedRuntimeRoot,
      coordinationBackendKind: "sqlite-file",
    };
  }
  if (sharedRuntimeMode === "shared-runtime" && sharedBackendKind === "postgres") {
    return {
      sqliteFile: path.resolve(absoluteTargetRoot, ".aidn", "runtime", "index", "workflow-index.sqlite"),
      projectionScope: "local-compat",
      logicalRoot: sharedRuntimeRoot || null,
      coordinationBackendKind: "postgres",
    };
  }
  return {
    sqliteFile: path.resolve(absoluteTargetRoot, ".aidn", "runtime", "index", "workflow-index.sqlite"),
    projectionScope: "local-target",
    logicalRoot: null,
    coordinationBackendKind: "none",
  };
}

export function resolveSharedStateBackend({
  targetRoot = ".",
  workspace = null,
} = {}) {
  const resolvedWorkspace = workspace ?? resolveWorkspaceContext({
    targetRoot,
  });
  const target = path.resolve(process.cwd(), targetRoot ?? ".");
  const projection = resolveSharedProjectionSqliteFile(target, resolvedWorkspace);
  return assertSharedStateBackend(createSqliteSharedStateBackend({
    sqliteFile: projection.sqliteFile,
    sharedRuntimeMode: resolvedWorkspace.shared_runtime_mode,
    coordinationBackendKind: projection.coordinationBackendKind,
    projectionScope: projection.projectionScope,
    logicalRoot: projection.logicalRoot,
  }));
}

export function loadSharedStateSnapshot({
  targetRoot = ".",
  workspace = null,
  includePayload = true,
  includeRuntimeHeads = true,
} = {}) {
  const backend = resolveSharedStateBackend({
    targetRoot,
    workspace,
  });
  return {
    backend: backend.describeBackend(),
    ...backend.loadSnapshot({
      includePayload,
      includeRuntimeHeads,
    }),
  };
}
