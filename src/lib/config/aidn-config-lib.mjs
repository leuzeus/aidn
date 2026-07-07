import fs from "node:fs";
import path from "node:path";

export const VALID_STATE_MODES = new Set(["files", "dual", "db-only"]);
export const VALID_INDEX_STORE_MODES = new Set(["file", "sql", "dual", "sqlite", "dual-sqlite", "all"]);
export const VALID_RUNTIME_PERSISTENCE_BACKENDS = new Set(["sqlite", "postgres"]);
export const VALID_RUNTIME_LOCAL_PROJECTION_POLICIES = new Set(["keep-local-sqlite", "keep-json", "keep-sql", "none"]);

const projectConfigCache = new Map();
const projectConfigCacheStats = {
  hits: 0,
  misses: 0,
  invalidations: 0,
  writes: 0,
};

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function getConfigFileSignature(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return {
        exists: false,
        mtimeMs: 0,
        size: 0,
      };
    }
    return {
      exists: true,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return {
      exists: false,
      mtimeMs: 0,
      size: 0,
    };
  }
}

function signaturesMatch(left, right) {
  return left?.exists === right?.exists
    && Number(left?.mtimeMs ?? 0) === Number(right?.mtimeMs ?? 0)
    && Number(left?.size ?? 0) === Number(right?.size ?? 0);
}

export function normalizeStateMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!VALID_STATE_MODES.has(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizeIndexStoreMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!VALID_INDEX_STORE_MODES.has(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizeRuntimePersistenceBackend(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!VALID_RUNTIME_PERSISTENCE_BACKENDS.has(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizeRuntimeLocalProjectionPolicy(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!VALID_RUNTIME_LOCAL_PROJECTION_POLICIES.has(normalized)) {
    return null;
  }
  return normalized;
}

export function defaultIndexStoreFromStateMode(stateMode) {
  const normalized = normalizeStateMode(stateMode) ?? "files";
  if (normalized === "dual") {
    return "dual-sqlite";
  }
  if (normalized === "db-only") {
    return "sqlite";
  }
  return "file";
}

export function stateModeFromIndexStore(storeMode) {
  const normalized = normalizeIndexStoreMode(storeMode);
  if (normalized === "dual" || normalized === "dual-sqlite" || normalized === "all") {
    return "dual";
  }
  if (normalized === "sqlite") {
    return "db-only";
  }
  return "files";
}

export function resolveAidnConfigPath(targetRoot) {
  return path.resolve(targetRoot, ".aidn", "config.json");
}

export function readAidnProjectConfig(targetRoot) {
  const filePath = resolveAidnConfigPath(targetRoot);
  const signature = getConfigFileSignature(filePath);
  const cached = projectConfigCache.get(filePath);
  if (cached && signaturesMatch(cached.signature, signature)) {
    projectConfigCacheStats.hits += 1;
    return {
      exists: cached.exists,
      path: filePath,
      data: cloneJson(cached.data),
    };
  }
  if (cached) {
    projectConfigCacheStats.invalidations += 1;
  }
  projectConfigCacheStats.misses += 1;
  if (!signature.exists) {
    const data = {};
    projectConfigCache.set(filePath, {
      signature,
      exists: false,
      data,
    });
    return {
      exists: false,
      path: filePath,
      data: cloneJson(data),
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Invalid config root in ${filePath}: expected JSON object`);
  }
  projectConfigCache.set(filePath, {
    signature,
    exists: true,
    data: parsed,
  });
  return {
    exists: true,
    path: filePath,
    data: cloneJson(parsed),
  };
}

export function writeAidnProjectConfig(targetRoot, data) {
  const filePath = resolveAidnConfigPath(targetRoot);
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  projectConfigCache.delete(filePath);
  projectConfigCacheStats.invalidations += 1;
  projectConfigCacheStats.writes += 1;
  return filePath;
}

export function resetAidnProjectConfigCache() {
  projectConfigCache.clear();
  projectConfigCacheStats.hits = 0;
  projectConfigCacheStats.misses = 0;
  projectConfigCacheStats.invalidations = 0;
  projectConfigCacheStats.writes = 0;
}

export function getAidnProjectConfigCacheStats() {
  return {
    entries: projectConfigCache.size,
    hits: projectConfigCacheStats.hits,
    misses: projectConfigCacheStats.misses,
    invalidations: projectConfigCacheStats.invalidations,
    writes: projectConfigCacheStats.writes,
  };
}

export function resolveConfigStateMode(configData) {
  if (!isPlainObject(configData)) {
    return null;
  }
  const runtime = isPlainObject(configData.runtime) ? configData.runtime : {};
  const runtimeMode = normalizeStateMode(runtime.stateMode);
  if (runtimeMode) {
    return runtimeMode;
  }
  const profileMode = normalizeStateMode(configData.profile);
  if (profileMode) {
    return profileMode;
  }
  return null;
}

export function resolveConfigIndexStore(configData) {
  if (!isPlainObject(configData)) {
    return null;
  }
  const runtime = isPlainObject(configData.runtime) ? configData.runtime : {};
  const install = isPlainObject(configData.install) ? configData.install : {};
  const runtimeStore = normalizeIndexStoreMode(runtime.indexStoreMode);
  if (runtimeStore) {
    return runtimeStore;
  }
  const installStore = normalizeIndexStoreMode(install.artifactImportStore);
  if (installStore) {
    return installStore;
  }
  return null;
}

export function resolveConfigRuntimePersistence(configData) {
  if (!isPlainObject(configData)) {
    return null;
  }
  const runtime = isPlainObject(configData.runtime) ? configData.runtime : {};
  const persistence = isPlainObject(runtime.persistence) ? runtime.persistence : {};
  const backend = normalizeRuntimePersistenceBackend(persistence.backend);
  if (!backend) {
    return null;
  }
  return {
    backend,
    localProjectionPolicy: normalizeRuntimeLocalProjectionPolicy(persistence.localProjectionPolicy),
    connectionRef: String(persistence.connectionRef ?? "").trim() || null,
  };
}

export function resolveConfigRuntimePersistenceBackend(configData) {
  return resolveConfigRuntimePersistence(configData)?.backend ?? null;
}

export function resolveConfigSourceBranch(configData) {
  if (!isPlainObject(configData)) {
    return null;
  }
  const workflow = isPlainObject(configData.workflow) ? configData.workflow : {};
  const value = String(workflow.sourceBranch ?? "").trim();
  return value || null;
}
