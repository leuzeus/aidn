import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "../fs/atomic-write-lib.mjs";

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
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function assertJsonConfigValue(value, field, seen) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol"
    || typeof value === "bigint") {
    throw new Error(`Invalid AIDN config ${field}: value is not JSON-serializable`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Invalid AIDN config ${field}: number must be finite`);
  }
  if (value == null || typeof value !== "object") {
    return;
  }
  if (seen.has(value)) {
    throw new Error(`Invalid AIDN config ${field}: cyclic value`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonConfigValue(item, `${field}[${index}]`, seen));
  } else {
    if (!isPlainObject(value)) {
      throw new Error(`Invalid AIDN config ${field}: expected plain object`);
    }
    for (const [key, item] of Object.entries(value)) {
      assertJsonConfigValue(item, `${field}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function assertOptionalObject(data, field) {
  if (data[field] != null && !isPlainObject(data[field])) {
    throw new Error(`Invalid AIDN config ${field}: expected object`);
  }
}

function assertOptionalBoolean(data, field, pathLabel) {
  if (data[field] != null && typeof data[field] !== "boolean") {
    throw new Error(`Invalid AIDN config ${pathLabel}: expected boolean`);
  }
}

function assertOptionalString(data, field, pathLabel) {
  if (data[field] != null && typeof data[field] !== "string") {
    throw new Error(`Invalid AIDN config ${pathLabel}: expected string`);
  }
}

function assertOptionalStringArray(data, field, pathLabel) {
  if (data[field] != null
    && (!Array.isArray(data[field])
      || data[field].some((item) => typeof item !== "string"))) {
    throw new Error(`Invalid AIDN config ${pathLabel}: expected string array`);
  }
}

function assertOptionalNonNegativeInteger(data, field, pathLabel) {
  if (data[field] != null
    && (!Number.isInteger(data[field]) || data[field] < 0)) {
    throw new Error(`Invalid AIDN config ${pathLabel}: expected non-negative integer`);
  }
}

export function validateAidnProjectConfig(data) {
  if (!isPlainObject(data)) {
    throw new Error("Invalid AIDN config root: expected plain object");
  }
  assertJsonConfigValue(data, "$", new Set());
  if (data.version != null && (!Number.isInteger(data.version) || data.version < 1)) {
    throw new Error("Invalid AIDN config version: expected a positive integer");
  }
  if (data.profile != null && !normalizeStateMode(data.profile)) {
    throw new Error("Invalid AIDN config profile: expected files|dual|db-only");
  }
  for (const section of ["install", "runtime", "workflow"]) {
    assertOptionalObject(data, section);
  }
  const install = data.install ?? {};
  if (install.artifactImportStore != null
    && !normalizeIndexStoreMode(install.artifactImportStore)) {
    throw new Error("Invalid AIDN config install.artifactImportStore");
  }
  const runtime = data.runtime ?? {};
  if (runtime.stateMode != null && !normalizeStateMode(runtime.stateMode)) {
    throw new Error("Invalid AIDN config runtime.stateMode");
  }
  if (runtime.indexStoreMode != null && !normalizeIndexStoreMode(runtime.indexStoreMode)) {
    throw new Error("Invalid AIDN config runtime.indexStoreMode");
  }
  if (runtime.persistence != null && !isPlainObject(runtime.persistence)) {
    throw new Error("Invalid AIDN config runtime.persistence: expected object");
  }
  if (runtime.dbOnly != null && !isPlainObject(runtime.dbOnly)) {
    throw new Error("Invalid AIDN config runtime.dbOnly: expected object");
  }
  const persistence = runtime.persistence ?? {};
  if (persistence.backend != null
    && !normalizeRuntimePersistenceBackend(persistence.backend)) {
    throw new Error("Invalid AIDN config runtime.persistence.backend");
  }
  if (persistence.localProjectionPolicy != null
    && !normalizeRuntimeLocalProjectionPolicy(persistence.localProjectionPolicy)) {
    throw new Error("Invalid AIDN config runtime.persistence.localProjectionPolicy");
  }
  if (persistence.connectionRef != null
    && typeof persistence.connectionRef !== "string") {
    throw new Error("Invalid AIDN config runtime.persistence.connectionRef: expected string");
  }
  const dbOnly = runtime.dbOnly ?? {};
  assertOptionalBoolean(dbOnly, "strict", "runtime.dbOnly.strict");
  for (const section of ["visibleArtifacts", "cleanup", "codexBundle", "artifactImport"]) {
    assertOptionalObject(dbOnly, section);
  }
  const visibleArtifacts = dbOnly.visibleArtifacts ?? {};
  assertOptionalBoolean(
    visibleArtifacts,
    "automaticMaterialization",
    "runtime.dbOnly.visibleArtifacts.automaticMaterialization",
  );
  assertOptionalString(
    visibleArtifacts,
    "materializeFlag",
    "runtime.dbOnly.visibleArtifacts.materializeFlag",
  );
  for (const field of [
    "managedRoots",
    "managedRuntimePaths",
    "protectedReanchorPaths",
    "protectedWorkflowPaths",
    "protectedFiles",
  ]) {
    assertOptionalStringArray(
      visibleArtifacts,
      field,
      `runtime.dbOnly.visibleArtifacts.${field}`,
    );
  }
  const cleanup = dbOnly.cleanup ?? {};
  assertOptionalBoolean(cleanup, "backupRequired", "runtime.dbOnly.cleanup.backupRequired");
  for (const field of ["backupRoot", "quarantine", "command", "restoreCommand"]) {
    assertOptionalString(cleanup, field, `runtime.dbOnly.cleanup.${field}`);
  }
  if (cleanup.quarantine != null && cleanup.quarantine !== "external") {
    throw new Error("Invalid AIDN config runtime.dbOnly.cleanup.quarantine");
  }
  const codexBundle = dbOnly.codexBundle ?? {};
  assertOptionalBoolean(codexBundle, "enabled", "runtime.dbOnly.codexBundle.enabled");
  for (const field of ["path", "sourceOfTruth"]) {
    assertOptionalString(codexBundle, field, `runtime.dbOnly.codexBundle.${field}`);
  }
  if (codexBundle.sourceOfTruth != null
    && codexBundle.sourceOfTruth !== "runtime-backend") {
    throw new Error("Invalid AIDN config runtime.dbOnly.codexBundle.sourceOfTruth");
  }
  for (const field of ["targetBytes", "hardLimitBytes", "maxArtifactBytes"]) {
    assertOptionalNonNegativeInteger(
      codexBundle,
      field,
      `runtime.dbOnly.codexBundle.${field}`,
    );
  }
  if (codexBundle.targetBytes != null && codexBundle.hardLimitBytes != null
    && codexBundle.targetBytes > codexBundle.hardLimitBytes) {
    throw new Error(
      "Invalid AIDN config runtime.dbOnly.codexBundle: targetBytes exceeds hardLimitBytes",
    );
  }
  if (codexBundle.maxArtifactBytes != null && codexBundle.hardLimitBytes != null
    && codexBundle.maxArtifactBytes > codexBundle.hardLimitBytes) {
    throw new Error(
      "Invalid AIDN config runtime.dbOnly.codexBundle: maxArtifactBytes exceeds hardLimitBytes",
    );
  }
  const artifactImport = dbOnly.artifactImport ?? {};
  for (const field of [
    "role",
    "legacyStoreField",
    "legacyStoreRole",
    "canonicalBackend",
    "canonicalBackendField",
  ]) {
    assertOptionalString(artifactImport, field, `runtime.dbOnly.artifactImport.${field}`);
  }
  assertOptionalBoolean(
    artifactImport,
    "canonicalBackendWins",
    "runtime.dbOnly.artifactImport.canonicalBackendWins",
  );
  if (artifactImport.role != null && artifactImport.role !== "compatibility-or-migration") {
    throw new Error("Invalid AIDN config runtime.dbOnly.artifactImport.role");
  }
  if (artifactImport.legacyStoreRole != null
    && artifactImport.legacyStoreRole !== "local-index-import") {
    throw new Error("Invalid AIDN config runtime.dbOnly.artifactImport.legacyStoreRole");
  }
  if (artifactImport.canonicalBackend != null
    && !normalizeRuntimePersistenceBackend(artifactImport.canonicalBackend)) {
    throw new Error("Invalid AIDN config runtime.dbOnly.artifactImport.canonicalBackend");
  }
  if (artifactImport.canonicalBackendField != null
    && artifactImport.canonicalBackendField !== "runtime.persistence.backend") {
    throw new Error("Invalid AIDN config runtime.dbOnly.artifactImport.canonicalBackendField");
  }
  const workflow = data.workflow ?? {};
  if (workflow.sourceBranch != null && typeof workflow.sourceBranch !== "string") {
    throw new Error("Invalid AIDN config workflow.sourceBranch: expected string");
  }
  return data;
}

export function writeAidnProjectConfig(targetRoot, data, options = {}) {
  validateAidnProjectConfig(data);
  const filePath = resolveAidnConfigPath(targetRoot);
  writeFileAtomicSync(
    filePath,
    `${JSON.stringify(data, null, 2)}\n`,
    {
      encoding: "utf8",
      ...(options.fsImpl ? { fsImpl: options.fsImpl } : {}),
    },
  );
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
