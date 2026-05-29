import path from "node:path";
import { createRuntimeCanonicalSharedStateBackend } from "../../adapters/runtime/runtime-canonical-shared-state-backend.mjs";
import { createSqliteSharedStateBackend } from "../../adapters/runtime/sqlite-shared-state-backend.mjs";
import {
  createRuntimeArtifactStore,
  resolveEffectiveRuntimePersistence,
} from "./runtime-persistence-service.mjs";
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

function resolveLocalProjectionPolicy(value) {
  return String(value ?? "").trim().toLowerCase() || "keep-local-sqlite";
}

export function resolveSharedStateBackend({
  targetRoot = ".",
  workspace = null,
  backend = "",
  connectionString = "",
  connectionRef = "",
  localProjectionPolicy = "",
  configData = null,
  env = process.env,
  clientFactory = null,
  moduleLoader = null,
} = {}) {
  const resolvedWorkspace = workspace ?? resolveWorkspaceContext({
    targetRoot,
  });
  const target = path.resolve(process.cwd(), targetRoot ?? ".");
  const runtimePersistence = resolveEffectiveRuntimePersistence({
    targetRoot: target,
    backend,
    connectionRef,
    configData,
    env,
  });
  const effectiveLocalProjectionPolicy = resolveLocalProjectionPolicy(
    localProjectionPolicy || runtimePersistence.config?.localProjectionPolicy,
  );

  if (runtimePersistence.backend === "postgres" && effectiveLocalProjectionPolicy === "none") {
    return createRuntimeCanonicalSharedStateBackend({
      runtimeArtifactStore: createRuntimeArtifactStore({
        targetRoot: target,
        backend: runtimePersistence.backend,
        connectionString,
        connectionRef: connectionRef || runtimePersistence.connectionRef || "",
        configData,
        env,
        clientFactory,
        moduleLoader,
      }),
      sharedRuntimeMode: resolvedWorkspace.shared_runtime_mode,
      coordinationBackendKind: String(resolvedWorkspace.shared_backend_kind ?? "none").trim().toLowerCase() || "none",
      projectionScope: "runtime-canonical",
      logicalRoot: resolvedWorkspace.shared_runtime_root || null,
    });
  }

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
  backend = "",
  connectionString = "",
  connectionRef = "",
  localProjectionPolicy = "",
  configData = null,
  env = process.env,
} = {}) {
  const sharedBackend = resolveSharedStateBackend({
    targetRoot,
    workspace,
    backend,
    connectionString,
    connectionRef,
    localProjectionPolicy,
    configData,
    env,
  });
  const backendDescription = sharedBackend.describeBackend();
  if (backendDescription?.projection_scope === "runtime-canonical") {
    throw new Error("Runtime canonical shared-state backends require loadSharedStateSnapshotAsync()");
  }
  return {
    backend: backendDescription,
    ...sharedBackend.loadSnapshot({
      includePayload,
      includeRuntimeHeads,
    }),
  };
}

export async function loadSharedStateSnapshotAsync({
  targetRoot = ".",
  workspace = null,
  includePayload = true,
  includeRuntimeHeads = true,
  backend = "",
  connectionString = "",
  connectionRef = "",
  localProjectionPolicy = "",
  configData = null,
  env = process.env,
  clientFactory = null,
  moduleLoader = null,
} = {}) {
  const sharedBackend = resolveSharedStateBackend({
    targetRoot,
    workspace,
    backend,
    connectionString,
    connectionRef,
    localProjectionPolicy,
    configData,
    env,
    clientFactory,
    moduleLoader,
  });
  return {
    backend: sharedBackend.describeBackend(),
    ...await sharedBackend.loadSnapshot({
      includePayload,
      includeRuntimeHeads,
    }),
  };
}
