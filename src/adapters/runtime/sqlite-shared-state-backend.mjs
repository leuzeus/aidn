import fs from "node:fs";
import path from "node:path";
import { createSqliteRuntimeArtifactStore } from "./sqlite-runtime-artifact-store.mjs";

export function createSqliteSharedStateBackend({
  sqliteFile,
  sharedRuntimeMode = "local-only",
  coordinationBackendKind = "none",
  projectionScope = "local-target",
  logicalRoot = null,
} = {}) {
  const absoluteSqliteFile = path.resolve(process.cwd(), sqliteFile ?? "");
  const runtimeArtifactStore = createSqliteRuntimeArtifactStore({
    sqliteFile: absoluteSqliteFile,
    mode: "sqlite",
  });

  function describeBackend() {
    return {
      shared_runtime_mode: sharedRuntimeMode,
      coordination_backend_kind: coordinationBackendKind,
      projection_backend_kind: "sqlite",
      projection_scope: projectionScope,
      sqlite_file: absoluteSqliteFile,
      logical_root: logicalRoot || null,
      exists: fs.existsSync(absoluteSqliteFile),
    };
  }

  function loadSnapshot({
    includePayload = true,
    includeRuntimeHeads = true,
  } = {}) {
    return runtimeArtifactStore.loadSnapshot({
      includePayload,
      includeRuntimeHeads,
    });
  }

  return {
    describeBackend,
    loadSnapshot,
  };
}
