import fs from "node:fs";
import {
  defaultIndexStoreFromStateMode,
  normalizeIndexStoreMode,
} from "../../lib/config/aidn-config-lib.mjs";
import { isDbBackedStateMode } from "./state-mode-policy.mjs";

export function resolveDefaultIndexStore(stateMode) {
  return defaultIndexStoreFromStateMode(stateMode);
}

export function shouldEmbedArtifactContentByState(stateMode) {
  return isDbBackedStateMode(stateMode);
}

export function usesSqlIndexStore(storeMode) {
  const normalized = normalizeIndexStoreMode(storeMode);
  return normalized === "sql" || normalized === "dual" || normalized === "all";
}

export function usesSqliteIndexStore(storeMode) {
  const normalized = normalizeIndexStoreMode(storeMode);
  return normalized === "sqlite" || normalized === "dual-sqlite" || normalized === "all";
}

export function usesJsonIndexStore(storeMode) {
  const normalized = normalizeIndexStoreMode(storeMode);
  return normalized === "file" || normalized === "dual" || normalized === "dual-sqlite" || normalized === "all";
}

export function indexOutputsExistForStore({
  storeMode,
  indexOutputPath,
  indexSqlOutputPath,
  indexSqliteOutputPath,
}) {
  const normalized = normalizeIndexStoreMode(storeMode);
  if (normalized === "file") {
    return fs.existsSync(indexOutputPath);
  }
  if (normalized === "sql") {
    return fs.existsSync(indexSqlOutputPath);
  }
  if (normalized === "dual") {
    return fs.existsSync(indexOutputPath) && fs.existsSync(indexSqlOutputPath);
  }
  if (normalized === "sqlite") {
    return fs.existsSync(indexSqliteOutputPath);
  }
  if (normalized === "dual-sqlite") {
    return fs.existsSync(indexOutputPath) && fs.existsSync(indexSqliteOutputPath);
  }
  if (normalized === "all") {
    return fs.existsSync(indexOutputPath) && fs.existsSync(indexSqlOutputPath) && fs.existsSync(indexSqliteOutputPath);
  }
  return false;
}

export function resolveReloadIndexBackend({
  storeMode,
  indexOutputPath,
  indexSqliteOutputPath,
}) {
  if (usesSqliteIndexStore(storeMode)) {
    return {
      indexFile: indexSqliteOutputPath,
      indexBackend: "sqlite",
    };
  }
  return {
    indexFile: indexOutputPath,
    indexBackend: "json",
  };
}

export function resolveSyncCheckIndexBackend({
  storeMode,
  indexOutputPath,
  indexSqliteOutputPath,
}) {
  const normalized = normalizeIndexStoreMode(storeMode);
  if (normalized === "sqlite" || normalized === "dual-sqlite") {
    return {
      indexFile: indexSqliteOutputPath,
      indexBackend: "sqlite",
    };
  }
  return {
    indexFile: indexOutputPath,
    indexBackend: "json",
  };
}
