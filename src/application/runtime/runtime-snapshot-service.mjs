import fs from "node:fs";
import path from "node:path";
import { createRuntimeArtifactStore, createRuntimeCanonicalSnapshotReader } from "./runtime-persistence-service.mjs";
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

function resolveRuntimeSnapshotAbsolute(indexFile) {
  return path.resolve(process.cwd(), indexFile ?? ".");
}

export function resolveRuntimeSnapshotTargetRoot(indexFile, targetRoot = "") {
  const explicit = String(targetRoot ?? "").trim();
  if (explicit) {
    return path.resolve(process.cwd(), explicit);
  }
  const absolute = resolveRuntimeSnapshotAbsolute(indexFile);
  const indexDir = path.dirname(absolute);
  const runtimeDir = path.dirname(indexDir);
  const aidnDir = path.dirname(runtimeDir);
  if (
    path.basename(indexDir) === "index"
    && path.basename(runtimeDir) === "runtime"
    && path.basename(aidnDir) === ".aidn"
  ) {
    return path.dirname(aidnDir);
  }
  return process.cwd();
}

export function readRuntimeSnapshotSync({ indexFile, backend = "", generatedAt } = {}) {
  const resolvedBackend = detectRuntimeSnapshotBackend(indexFile, backend);
  if (resolvedBackend === "postgres") {
    throw new Error("PostgreSQL runtime snapshot reads require the async readRuntimeSnapshot() API");
  }
  if (resolvedBackend === "sqlite") {
    const absolute = resolveRuntimeSnapshotAbsolute(indexFile);
    const store = createRuntimeArtifactStore({
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

export async function readRuntimeSnapshot({
  indexFile,
  backend = "",
  generatedAt,
  targetRoot = "",
  connectionString = "",
  connectionRef = "",
  configData = null,
  env = process.env,
  clientFactory = null,
  moduleLoader = null,
} = {}) {
  const resolvedBackend = detectRuntimeSnapshotBackend(indexFile, backend);
  if (resolvedBackend === "json") {
    return readJsonRuntimeSnapshot(indexFile);
  }
  if (resolvedBackend === "sqlite") {
    return readRuntimeSnapshotSync({
      indexFile,
      backend: resolvedBackend,
      generatedAt,
    });
  }

  const absolute = resolveRuntimeSnapshotAbsolute(indexFile);
  const resolvedTargetRoot = resolveRuntimeSnapshotTargetRoot(indexFile, targetRoot);
  const reader = createRuntimeCanonicalSnapshotReader({
    targetRoot: resolvedTargetRoot,
    backend: resolvedBackend,
    sqliteFile: absolute,
    connectionString,
    connectionRef,
    configData,
    env,
    clientFactory,
    moduleLoader,
  });
  const snapshot = await reader.readCanonicalSnapshot({
    includePayload: true,
    includeRuntimeHeads: false,
    generatedAt,
  });
  if (snapshot.warning) {
    throw new Error(snapshot.warning);
  }
  if (!snapshot.exists) {
    throw new Error(`Runtime index snapshot not found for backend "${resolvedBackend}" at ${absolute}`);
  }
  return {
    backend: resolvedBackend,
    absolute,
    payload: snapshot.payload,
  };
}

export function openRuntimeSqliteSnapshotContext({ indexFile, role = "runtime-snapshot-query" } = {}) {
  return openSqliteRuntimeQueryContext({
    indexFile,
    role,
  });
}

export async function readRuntimeIndexPayload(indexFile, options = {}) {
  return await readRuntimeSnapshot({
    indexFile,
    backend: options.backend,
    generatedAt: options.generatedAt,
    targetRoot: options.targetRoot,
    connectionString: options.connectionString,
    connectionRef: options.connectionRef,
    configData: options.configData ?? null,
    env: options.env ?? process.env,
    clientFactory: options.clientFactory ?? null,
    moduleLoader: options.moduleLoader ?? null,
  });
}

export function readRuntimeIndexPayloadSync(indexFile, options = {}) {
  return readRuntimeSnapshotSync({
    indexFile,
    backend: options.backend,
    generatedAt: options.generatedAt,
  });
}
