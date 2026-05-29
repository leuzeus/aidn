import {
  normalizeIndexStoreMode,
  normalizeRuntimeLocalProjectionPolicy,
  normalizeRuntimePersistenceBackend,
  normalizeStateMode,
  resolveConfigSourceBranch,
  stateModeFromIndexStore,
} from "../../lib/config/aidn-config-lib.mjs";

export function buildNextAidnProjectConfig(existingData, defaults, args) {
  const base = (existingData && typeof existingData === "object" && !Array.isArray(existingData))
    ? JSON.parse(JSON.stringify(existingData))
    : {};

  if (typeof base.version !== "number") {
    base.version = 1;
  }
  if (!base.install || typeof base.install !== "object" || Array.isArray(base.install)) {
    base.install = {};
  }
  if (!base.runtime || typeof base.runtime !== "object" || Array.isArray(base.runtime)) {
    base.runtime = {};
  }
  if (!base.runtime.persistence || typeof base.runtime.persistence !== "object" || Array.isArray(base.runtime.persistence)) {
    base.runtime.persistence = {};
  }
  if (!base.workflow || typeof base.workflow !== "object" || Array.isArray(base.workflow)) {
    base.workflow = {};
  }

  const explicitStore = normalizeIndexStoreMode(args?.artifactImportStore);
  if (explicitStore) {
    base.install.artifactImportStore = explicitStore;
    base.runtime.stateMode = stateModeFromIndexStore(explicitStore);
  } else {
    if (!normalizeIndexStoreMode(base.install.artifactImportStore)) {
      base.install.artifactImportStore = defaults.store;
    }
    if (!normalizeStateMode(base.runtime.stateMode)) {
      base.runtime.stateMode = defaults.stateMode;
    }
  }

  if (!normalizeStateMode(base.profile)) {
    base.profile = base.runtime.stateMode;
  }
  if (!normalizeRuntimePersistenceBackend(base.runtime.persistence.backend)) {
    base.runtime.persistence.backend = "sqlite";
  }
  const explicitRuntimeBackend = normalizeRuntimePersistenceBackend(args?.runtimePersistenceBackend);
  if (explicitRuntimeBackend) {
    base.runtime.persistence.backend = explicitRuntimeBackend;
  }
  const explicitLocalProjectionPolicy = normalizeRuntimeLocalProjectionPolicy(args?.runtimePersistenceLocalProjectionPolicy);
  if (explicitLocalProjectionPolicy) {
    base.runtime.persistence.localProjectionPolicy = explicitLocalProjectionPolicy;
  } else if (!normalizeRuntimeLocalProjectionPolicy(base.runtime.persistence.localProjectionPolicy)) {
    base.runtime.persistence.localProjectionPolicy = "keep-local-sqlite";
  }
  const explicitConnectionRef = String(args?.runtimePersistenceConnectionRef ?? "").trim();
  if (explicitConnectionRef) {
    base.runtime.persistence.connectionRef = explicitConnectionRef;
  }

  const resolvedSourceBranch = String(args?.sourceBranch ?? "").trim() || resolveConfigSourceBranch(base) || "";
  if (resolvedSourceBranch) {
    base.workflow.sourceBranch = resolvedSourceBranch;
  }

  return base;
}
