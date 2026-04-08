import fs from "node:fs";
import path from "node:path";
import { createRuntimeArtifactStore } from "./runtime-persistence-service.mjs";
import { openSqliteRuntimeQueryContext } from "../../adapters/runtime/sqlite-runtime-query-context.mjs";

export function detectRuntimeSnapshotBackend(indexFile, backend = "") {
  if (backend === "json" || backend === "sqlite" || backend === "postgres") {
    return backend;
  }
  return String(indexFile ?? "").toLowerCase().endsWith(".sqlite") ? "sqlite" : "json";
}

export function readJsonRuntimeSnapshot(indexFile) {
  const absolute = path.resolve(process.cwd(), indexFile);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Index file not found: ${absolute}`);
  }
  const payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
  return { backend: "json", absolute, payload };
}

export function readRuntimeSnapshot({ indexFile, backend = "", generatedAt } = {}) {
  const resolvedBackend = detectRuntimeSnapshotBackend(indexFile, backend);
  if (resolvedBackend === "sqlite" || resolvedBackend === "postgres") {
    const absolute = path.resolve(process.cwd(), indexFile);
    const targetRoot = path.resolve(process.cwd(), path.dirname(path.dirname(path.dirname(indexFile ?? "."))));
    const store = createRuntimeArtifactStore({
      targetRoot,
      backend: "sqlite",
      sqliteFile: absolute,
    });
    const snapshot = store.loadSnapshot({
      includePayload: true,
      includeRuntimeHeads: false,
      generatedAt,
    });
    if (!snapshot.exists) {
      throw new Error(`SQLite index file not found: ${absolute}`);
    }
    if (snapshot.warning) {
      throw new Error(snapshot.warning);
    }
    return {
      backend: resolvedBackend,
      absolute,
      payload: snapshot.payload,
    };
  }
  return readJsonRuntimeSnapshot(indexFile);
}

export function openRuntimeSqliteSnapshotContext({ indexFile, role = "runtime-snapshot-query" } = {}) {
  return openSqliteRuntimeQueryContext({
    indexFile,
    role,
  });
}

export function readRuntimeIndexPayload(indexFile, options = {}) {
  return readRuntimeSnapshot({
    indexFile,
    backend: options.backend,
    generatedAt: options.generatedAt,
  });
}
