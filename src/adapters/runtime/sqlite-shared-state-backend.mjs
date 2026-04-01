import fs from "node:fs";
import path from "node:path";
import { readIndexFromSqlite, readRuntimeHeadArtifactsFromSqlite } from "../../lib/sqlite/index-sqlite-lib.mjs";

export function createSqliteSharedStateBackend({
  sqliteFile,
  sharedRuntimeMode = "local-only",
  coordinationBackendKind = "none",
  projectionScope = "local-target",
  logicalRoot = null,
} = {}) {
  const absoluteSqliteFile = path.resolve(process.cwd(), sqliteFile ?? "");

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
    if (!fs.existsSync(absoluteSqliteFile)) {
      return {
        exists: false,
        sqliteFile: absoluteSqliteFile,
        payload: null,
        runtimeHeads: {},
        warning: "",
      };
    }
    try {
      return {
        exists: true,
        sqliteFile: absoluteSqliteFile,
        payload: includePayload ? readIndexFromSqlite(absoluteSqliteFile).payload : null,
        runtimeHeads: includeRuntimeHeads ? readRuntimeHeadArtifactsFromSqlite(absoluteSqliteFile).heads : {},
        warning: "",
      };
    } catch (error) {
      return {
        exists: true,
        sqliteFile: absoluteSqliteFile,
        payload: null,
        runtimeHeads: {},
        warning: `SQLite artifact fallback unavailable: ${error.message}`,
      };
    }
  }

  return {
    describeBackend,
    loadSnapshot,
  };
}
