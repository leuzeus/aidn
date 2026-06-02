import {
  normalizeIndexStoreMode,
  normalizeRuntimeLocalProjectionPolicy,
  normalizeRuntimePersistenceBackend,
  normalizeStateMode,
  resolveConfigSourceBranch,
  stateModeFromIndexStore,
} from "../../lib/config/aidn-config-lib.mjs";

export function buildStrictDbOnlyPolicy(existingPolicy = {}, options = {}) {
  const existing = existingPolicy && typeof existingPolicy === "object" && !Array.isArray(existingPolicy)
    ? existingPolicy
    : {};
  const canonicalBackend = normalizeRuntimePersistenceBackend(options?.canonicalBackend) ?? "sqlite";
  return {
    ...existing,
    strict: true,
    visibleArtifacts: {
      ...(existing.visibleArtifacts && typeof existing.visibleArtifacts === "object" && !Array.isArray(existing.visibleArtifacts)
        ? existing.visibleArtifacts
        : {}),
      automaticMaterialization: false,
      materializeFlag: "--materialize-visible-artifacts",
      managedRoots: ["docs/audit", ".codex"],
      protectedFiles: ["AGENTS.md", ".gitignore"],
    },
    cleanup: {
      ...(existing.cleanup && typeof existing.cleanup === "object" && !Array.isArray(existing.cleanup)
        ? existing.cleanup
        : {}),
      backupRequired: true,
      backupRoot: "<parent-du-projet>/.aidn-backups/<project_id>/<timestamp>/",
      quarantine: "external",
      command: "aidn runtime visible-artifacts-cleanup --write",
      restoreCommand: "aidn runtime visible-artifacts-restore --write",
    },
    codexBundle: {
      ...(existing.codexBundle && typeof existing.codexBundle === "object" && !Array.isArray(existing.codexBundle)
        ? existing.codexBundle
        : {}),
      enabled: true,
      path: ".aidn/runtime/context/hydrated-context.json",
      sourceOfTruth: "runtime-backend",
      targetBytes: 262144,
      hardLimitBytes: 1048576,
      maxArtifactBytes: 4096,
    },
    artifactImport: {
      ...(existing.artifactImport && typeof existing.artifactImport === "object" && !Array.isArray(existing.artifactImport)
        ? existing.artifactImport
        : {}),
      role: "compatibility-or-migration",
      legacyStoreField: "install.artifactImportStore",
      legacyStoreRole: "local-index-import",
      canonicalBackend,
      canonicalBackendField: "runtime.persistence.backend",
      canonicalBackendWins: true,
    },
  };
}

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
  } else if (base.runtime.persistence.backend === "postgres") {
    base.runtime.persistence.localProjectionPolicy = "none";
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

  if (base.runtime.stateMode === "db-only") {
    base.runtime.dbOnly = buildStrictDbOnlyPolicy(base.runtime.dbOnly, {
      canonicalBackend: base.runtime.persistence.backend,
    });
  }

  return base;
}
