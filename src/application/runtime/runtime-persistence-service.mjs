import path from "node:path";
import {
  normalizeRuntimePersistenceBackend,
  readAidnProjectConfig,
  resolveConfigRuntimePersistence,
} from "../../lib/config/aidn-config-lib.mjs";
import { createSqliteRuntimeArtifactStore } from "../../adapters/runtime/sqlite-runtime-artifact-store.mjs";
import { createSqliteRuntimePersistenceAdmin } from "../../adapters/runtime/sqlite-runtime-persistence-admin.mjs";
import { createPostgresRuntimeArtifactStore } from "../../adapters/runtime/postgres-runtime-artifact-store.mjs";
import { createPostgresRuntimePersistenceAdmin } from "../../adapters/runtime/postgres-runtime-persistence-admin.mjs";
import { assertRuntimeCanonicalSnapshotReader } from "../../core/ports/runtime-canonical-snapshot-reader-port.mjs";

function resolveBackendFromCompatibility(configData) {
  const configPersistence = resolveConfigRuntimePersistence(configData);
  if (configPersistence?.backend) {
    return null;
  }
  return "sqlite";
}

function resolvePreferredConnectionRef(explicitConnectionRef, resolvedConnectionRef) {
  const explicit = String(explicitConnectionRef ?? "").trim();
  if (explicit) {
    return explicit;
  }
  const resolved = String(resolvedConnectionRef ?? "").trim();
  return resolved || "";
}

export function resolveEffectiveRuntimePersistence({
  targetRoot = ".",
  backend = "",
  connectionRef = "",
  configData = null,
  env = process.env,
} = {}) {
  const explicitBackend = normalizeRuntimePersistenceBackend(backend);
  if (explicitBackend) {
    return {
      backend: explicitBackend,
      source: "cli",
      explicit: true,
      connectionRef: String(connectionRef ?? "").trim() || null,
      config: null,
    };
  }

  const envBackend = normalizeRuntimePersistenceBackend(env.AIDN_RUNTIME_PERSISTENCE_BACKEND);
  if (envBackend) {
    return {
      backend: envBackend,
      source: "env",
      explicit: true,
      connectionRef: String(env.AIDN_RUNTIME_PERSISTENCE_CONNECTION_REF ?? "").trim() || null,
      config: null,
    };
  }

  const resolvedConfigData = configData ?? readAidnProjectConfig(targetRoot).data;
  const configPersistence = resolveConfigRuntimePersistence(resolvedConfigData);
  if (configPersistence?.backend) {
    return {
      backend: configPersistence.backend,
      source: "config-runtime-persistence",
      explicit: true,
      connectionRef: configPersistence.connectionRef ?? null,
      config: configPersistence,
    };
  }

  return {
    backend: resolveBackendFromCompatibility(resolvedConfigData),
    source: "compatibility-fallback",
    explicit: false,
    connectionRef: null,
    config: null,
  };
}

export function resolveRuntimeSqliteFile({
  targetRoot = ".",
  sqliteFile = ".aidn/runtime/index/workflow-index.sqlite",
} = {}) {
  return path.isAbsolute(sqliteFile)
    ? path.resolve(sqliteFile)
    : path.resolve(targetRoot, sqliteFile);
}

export function createRuntimeArtifactStore(options = {}) {
  const targetRoot = path.resolve(process.cwd(), options.targetRoot ?? ".");
  const resolution = resolveEffectiveRuntimePersistence({
    targetRoot,
    backend: options.backend,
    connectionRef: options.connectionRef,
    configData: options.configData ?? null,
    env: options.env ?? process.env,
  });
  const sqliteFile = resolveRuntimeSqliteFile({
    targetRoot,
    sqliteFile: options.sqliteFile,
  });

  if (resolution.backend === "sqlite") {
    return createSqliteRuntimeArtifactStore({
      ...options,
      sqliteFile,
    });
  }
  if (resolution.backend === "postgres") {
    return createPostgresRuntimeArtifactStore({
      ...options,
      targetRoot,
      connectionRef: resolvePreferredConnectionRef(options.connectionRef, resolution.connectionRef),
    });
  }

  throw new Error(`Runtime artifact backend "${resolution.backend}" is not implemented yet`);
}

export function createRuntimeCanonicalSnapshotReader(options = {}) {
  const store = createRuntimeArtifactStore(options);
  return assertRuntimeCanonicalSnapshotReader({
    describeBackend() {
      return store.describeBackend();
    },
    async readCanonicalSnapshot(snapshotOptions = {}) {
      return await store.loadSnapshot(snapshotOptions);
    },
  }, "RuntimeCanonicalSnapshotReader");
}

export function createRuntimePersistenceAdmin(options = {}) {
  const targetRoot = path.resolve(process.cwd(), options.targetRoot ?? ".");
  const resolution = resolveEffectiveRuntimePersistence({
    targetRoot,
    backend: options.backend,
    connectionRef: options.connectionRef,
    configData: options.configData ?? null,
    env: options.env ?? process.env,
  });
  const sqliteFile = resolveRuntimeSqliteFile({
    targetRoot,
    sqliteFile: options.sqliteFile,
  });

  if (resolution.backend === "sqlite") {
    return createSqliteRuntimePersistenceAdmin({
      ...options,
      sqliteFile,
    });
  }
  if (resolution.backend === "postgres") {
    return createPostgresRuntimePersistenceAdmin({
      ...options,
      targetRoot,
      connectionRef: resolvePreferredConnectionRef(options.connectionRef, resolution.connectionRef),
    });
  }

  throw new Error(`Runtime artifact backend "${resolution.backend}" is not implemented yet`);
}
