import fs from "node:fs";
import path from "node:path";

export const VALID_STATE_MODES = new Set(["files", "dual", "db-only"]);
export const VALID_INDEX_STORE_MODES = new Set(["file", "sql", "dual", "sqlite", "dual-sqlite", "all"]);

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
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
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      path: filePath,
      data: {},
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
  return {
    exists: true,
    path: filePath,
    data: parsed,
  };
}

export function writeAidnProjectConfig(targetRoot, data) {
  const filePath = resolveAidnConfigPath(targetRoot);
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return filePath;
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

export function resolveConfigSourceBranch(configData) {
  if (!isPlainObject(configData)) {
    return null;
  }
  const workflow = isPlainObject(configData.workflow) ? configData.workflow : {};
  const value = String(workflow.sourceBranch ?? "").trim();
  return value || null;
}
