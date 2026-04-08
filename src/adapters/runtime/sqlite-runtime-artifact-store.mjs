import fs from "node:fs";
import path from "node:path";
import { createIndexStore } from "../../lib/index/index-store.mjs";
import { readIndexFromSqlite, readRuntimeHeadArtifactsFromSqlite } from "../../lib/sqlite/index-sqlite-lib.mjs";
import { assertRuntimeArtifactStore } from "../../core/ports/runtime-artifact-store-port.mjs";

export function createSqliteRuntimeArtifactStore(options = {}) {
  const sqliteFile = path.resolve(process.cwd(), options.sqliteFile ?? ".aidn/runtime/index/workflow-index.sqlite");
  const indexStore = createIndexStore({
    ...options,
    sqliteOutput: sqliteFile,
  });

  function describeBackend() {
    return {
      backend_kind: "sqlite",
      sqlite_file: sqliteFile,
      exists: fs.existsSync(sqliteFile),
      scope: "runtime-artifact-persistence",
    };
  }

  function loadSnapshot({
    includePayload = true,
    includeRuntimeHeads = true,
    generatedAt,
  } = {}) {
    if (!fs.existsSync(sqliteFile)) {
      return {
        exists: false,
        sqliteFile,
        payload: null,
        runtimeHeads: {},
        warning: "",
      };
    }
    try {
      return {
        exists: true,
        sqliteFile,
        payload: includePayload ? readIndexFromSqlite(sqliteFile, { generatedAt }).payload : null,
        runtimeHeads: includeRuntimeHeads ? readRuntimeHeadArtifactsFromSqlite(sqliteFile).heads : {},
        warning: "",
      };
    } catch (error) {
      return {
        exists: true,
        sqliteFile,
        payload: null,
        runtimeHeads: {},
        warning: `SQLite runtime artifact store unavailable: ${error.message}`,
      };
    }
  }

  function loadRuntimeHeads() {
    if (!fs.existsSync(sqliteFile)) {
      return {};
    }
    return readRuntimeHeadArtifactsFromSqlite(sqliteFile).heads;
  }

  function writeIndexProjection({ payload }) {
    return indexStore.write(payload);
  }

  return assertRuntimeArtifactStore({
    mode: indexStore.mode,
    describeBackend,
    loadSnapshot,
    loadRuntimeHeads,
    writeIndexProjection,
  }, "SqliteRuntimeArtifactStore");
}
