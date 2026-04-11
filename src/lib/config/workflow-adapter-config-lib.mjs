import fs from "node:fs";
import path from "node:path";
import {
  defaultIndexStoreFromStateMode,
  normalizeIndexStoreMode,
  normalizeStateMode,
} from "./aidn-config-lib.mjs";

const WORKFLOW_ADAPTER_CONFIG_VERSION = 1;

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value == null) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeChoice(value, allowed, fallback) {
  const normalized = normalizeString(value);
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((item) => normalizeString(item))
        .filter((item) => item.length > 0),
    ),
  );
}

function normalizePositiveInteger(value, fallback) {
  if (Number.isInteger(value) && value > 0) {
    return value;
  }
  const numeric = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

export function resolveWorkflowAdapterConfigPath(targetRoot) {
  return path.resolve(targetRoot, ".aidn", "project", "workflow.adapter.json");
}

export function createDefaultWorkflowAdapterConfig(options = {}) {
  const preferredStateMode = normalizeStateMode(options.preferredStateMode) ?? "dual";
  const defaultIndexStore = normalizeIndexStoreMode(options.defaultIndexStore)
    ?? defaultIndexStoreFromStateMode(preferredStateMode);
  const transitionCleanlinessScopes = new Set(["session-topology"]);
  const executionEvaluationScopes = new Set(["dispatch-or-local-scope"]);

  return {
    version: WORKFLOW_ADAPTER_CONFIG_VERSION,
    projectName: normalizeString(options.projectName),
    constraints: {
      runtime: normalizeString(options.constraints?.runtime),
      architecture: normalizeString(options.constraints?.architecture),
      delivery: normalizeString(options.constraints?.delivery),
      additional: normalizeStringArray(options.constraints?.additional),
    },
    dorPolicy: normalizeString(options.dorPolicy),
    runtimePolicy: {
      preferredStateMode,
      defaultIndexStore,
    },
    snapshotPolicy: {
      trigger: normalizeString(options.snapshotPolicy?.trigger),
      owner: normalizeString(options.snapshotPolicy?.owner),
      freshnessRule: normalizeString(options.snapshotPolicy?.freshnessRule),
      parkingLotRule: normalizeString(options.snapshotPolicy?.parkingLotRule),
    },
    ciPolicy: {
      capacity: normalizeStringArray(options.ciPolicy?.capacity),
    },
    sessionPolicy: {
      transitionCleanliness: {
        enabled: normalizeBoolean(options.sessionPolicy?.transitionCleanliness?.enabled, false),
        scope: normalizeChoice(
          options.sessionPolicy?.transitionCleanliness?.scope,
          transitionCleanlinessScopes,
          "session-topology",
        ),
        requiredDecisionOptions: normalizeStringArray(
          options.sessionPolicy?.transitionCleanliness?.requiredDecisionOptions,
        ),
      },
    },
    executionPolicy: {
      enabled: normalizeBoolean(options.executionPolicy?.enabled, false),
      evaluationScope: normalizeChoice(
        options.executionPolicy?.evaluationScope,
        executionEvaluationScopes,
        "dispatch-or-local-scope",
      ),
      escalateOnParallelAttachedCycles: normalizeBoolean(
        options.executionPolicy?.escalateOnParallelAttachedCycles,
        false,
      ),
      escalateOnSharedIntegrationSurface: normalizeBoolean(
        options.executionPolicy?.escalateOnSharedIntegrationSurface,
        false,
      ),
      hardGates: normalizeStringArray(options.executionPolicy?.hardGates),
      lightGates: normalizeStringArray(options.executionPolicy?.lightGates),
      fastPath: {
        enabled: normalizeBoolean(options.executionPolicy?.fastPath?.enabled, false),
        maxTouchedFiles: Number.isInteger(options.executionPolicy?.fastPath?.maxTouchedFiles)
          ? options.executionPolicy.fastPath.maxTouchedFiles
          : 0,
        autoEscalateOnTouchedFileThreshold: normalizeBoolean(
          options.executionPolicy?.fastPath?.autoEscalateOnTouchedFileThreshold,
          false,
        ),
        autoEscalateOnRequirementScopeDrift: normalizeBoolean(
          options.executionPolicy?.fastPath?.autoEscalateOnRequirementScopeDrift,
          false,
        ),
        forbidApiContractSchemaSecurityChange: normalizeBoolean(
          options.executionPolicy?.fastPath?.forbidApiContractSchemaSecurityChange,
          false,
        ),
        forbidSharedCodegenBoundaryImpact: normalizeBoolean(
          options.executionPolicy?.fastPath?.forbidSharedCodegenBoundaryImpact,
          false,
        ),
        requireNoContinuityAmbiguity: normalizeBoolean(
          options.executionPolicy?.fastPath?.requireNoContinuityAmbiguity,
          false,
        ),
      },
      validationProfiles: {
        low: normalizeString(options.executionPolicy?.validationProfiles?.low),
        medium: normalizeString(options.executionPolicy?.validationProfiles?.medium),
        high: normalizeString(options.executionPolicy?.validationProfiles?.high),
      },
    },
    specializedGates: {
      sharedCodegenBoundary: {
        enabled: normalizeBoolean(options.specializedGates?.sharedCodegenBoundary?.enabled, false),
        sharedIntegrationSurface: normalizeBoolean(
          options.specializedGates?.sharedCodegenBoundary?.sharedIntegrationSurface,
          false,
        ),
        escalateOnMultiAgentOverlap: normalizeBoolean(
          options.specializedGates?.sharedCodegenBoundary?.escalateOnMultiAgentOverlap,
          false,
        ),
        generatorPaths: normalizeStringArray(options.specializedGates?.sharedCodegenBoundary?.generatorPaths),
        requiredEvidence: normalizeStringArray(options.specializedGates?.sharedCodegenBoundary?.requiredEvidence),
        forbidComponentSpecificGeneratorFixes: normalizeBoolean(
          options.specializedGates?.sharedCodegenBoundary?.forbidComponentSpecificGeneratorFixes,
          false,
        ),
      },
      crossUsageConvergence: {
        enabled: normalizeBoolean(options.specializedGates?.crossUsageConvergence?.enabled, false),
        sharedSurfaceKinds: normalizeStringArray(options.specializedGates?.crossUsageConvergence?.sharedSurfaceKinds),
        evidenceArtifacts: normalizeStringArray(options.specializedGates?.crossUsageConvergence?.evidenceArtifacts),
        sharedSurfaceMinimumUsageClasses: normalizePositiveInteger(
          options.specializedGates?.crossUsageConvergence?.sharedSurfaceMinimumUsageClasses,
          2,
        ),
        highRiskMinimumUsageClasses: normalizePositiveInteger(
          options.specializedGates?.crossUsageConvergence?.highRiskMinimumUsageClasses,
          3,
        ),
        requireAlternateUsage: normalizeBoolean(
          options.specializedGates?.crossUsageConvergence?.requireAlternateUsage,
          true,
        ),
        requireContextualUsageForHighRisk: normalizeBoolean(
          options.specializedGates?.crossUsageConvergence?.requireContextualUsageForHighRisk,
          true,
        ),
        overfitFixIsBlocking: normalizeBoolean(
          options.specializedGates?.crossUsageConvergence?.overfitFixIsBlocking,
          true,
        ),
      },
    },
    legacyPreserved: {
      projectConstraintsBullets: normalizeStringArray(options.legacyPreserved?.projectConstraintsBullets),
      importedSections: normalizeStringArray(options.legacyPreserved?.importedSections),
    },
  };
}

export function normalizeWorkflowAdapterConfig(data, options = {}) {
  const base = isPlainObject(data) ? data : {};
  const defaults = createDefaultWorkflowAdapterConfig(options);
  const constraints = isPlainObject(base.constraints) ? base.constraints : {};
  const runtimePolicy = isPlainObject(base.runtimePolicy) ? base.runtimePolicy : {};
  const snapshotPolicy = isPlainObject(base.snapshotPolicy) ? base.snapshotPolicy : {};
  const ciPolicy = isPlainObject(base.ciPolicy) ? base.ciPolicy : {};
  const sessionPolicy = isPlainObject(base.sessionPolicy) ? base.sessionPolicy : {};
  const transitionCleanliness = isPlainObject(sessionPolicy.transitionCleanliness)
    ? sessionPolicy.transitionCleanliness
    : {};
  const executionPolicy = isPlainObject(base.executionPolicy) ? base.executionPolicy : {};
  const executionFastPath = isPlainObject(executionPolicy.fastPath) ? executionPolicy.fastPath : {};
  const validationProfiles = isPlainObject(executionPolicy.validationProfiles)
    ? executionPolicy.validationProfiles
    : {};
  const specializedGates = isPlainObject(base.specializedGates) ? base.specializedGates : {};
  const sharedCodegenBoundary = isPlainObject(specializedGates.sharedCodegenBoundary)
    ? specializedGates.sharedCodegenBoundary
    : {};
  const crossUsageConvergence = isPlainObject(specializedGates.crossUsageConvergence)
    ? specializedGates.crossUsageConvergence
    : {};
  const legacyPreserved = isPlainObject(base.legacyPreserved) ? base.legacyPreserved : {};
  const transitionCleanlinessScopes = new Set(["session-topology"]);
  const executionEvaluationScopes = new Set(["dispatch-or-local-scope"]);

  return {
    version: WORKFLOW_ADAPTER_CONFIG_VERSION,
    projectName: normalizeString(base.projectName, defaults.projectName),
    constraints: {
      runtime: normalizeString(constraints.runtime, defaults.constraints.runtime),
      architecture: normalizeString(constraints.architecture, defaults.constraints.architecture),
      delivery: normalizeString(constraints.delivery, defaults.constraints.delivery),
      additional: normalizeStringArray(constraints.additional),
    },
    dorPolicy: normalizeString(base.dorPolicy, defaults.dorPolicy),
    runtimePolicy: {
      preferredStateMode: normalizeStateMode(runtimePolicy.preferredStateMode)
        ?? defaults.runtimePolicy.preferredStateMode,
      defaultIndexStore: normalizeIndexStoreMode(runtimePolicy.defaultIndexStore)
        ?? defaults.runtimePolicy.defaultIndexStore,
    },
    snapshotPolicy: {
      trigger: normalizeString(snapshotPolicy.trigger, defaults.snapshotPolicy.trigger),
      owner: normalizeString(snapshotPolicy.owner, defaults.snapshotPolicy.owner),
      freshnessRule: normalizeString(snapshotPolicy.freshnessRule, defaults.snapshotPolicy.freshnessRule),
      parkingLotRule: normalizeString(snapshotPolicy.parkingLotRule, defaults.snapshotPolicy.parkingLotRule),
    },
    ciPolicy: {
      capacity: normalizeStringArray(ciPolicy.capacity),
    },
    sessionPolicy: {
      transitionCleanliness: {
        enabled: normalizeBoolean(
          transitionCleanliness.enabled,
          defaults.sessionPolicy.transitionCleanliness.enabled,
        ),
        scope: normalizeChoice(
          transitionCleanliness.scope,
          transitionCleanlinessScopes,
          defaults.sessionPolicy.transitionCleanliness.scope,
        ),
        requiredDecisionOptions: normalizeStringArray(
          transitionCleanliness.requiredDecisionOptions,
        ),
      },
    },
    executionPolicy: {
      enabled: normalizeBoolean(executionPolicy.enabled, defaults.executionPolicy.enabled),
      evaluationScope: normalizeChoice(
        executionPolicy.evaluationScope,
        executionEvaluationScopes,
        defaults.executionPolicy.evaluationScope,
      ),
      escalateOnParallelAttachedCycles: normalizeBoolean(
        executionPolicy.escalateOnParallelAttachedCycles,
        defaults.executionPolicy.escalateOnParallelAttachedCycles,
      ),
      escalateOnSharedIntegrationSurface: normalizeBoolean(
        executionPolicy.escalateOnSharedIntegrationSurface,
        defaults.executionPolicy.escalateOnSharedIntegrationSurface,
      ),
      hardGates: normalizeStringArray(executionPolicy.hardGates),
      lightGates: normalizeStringArray(executionPolicy.lightGates),
      fastPath: {
        enabled: normalizeBoolean(executionFastPath.enabled, defaults.executionPolicy.fastPath.enabled),
        maxTouchedFiles: Number.isInteger(executionFastPath.maxTouchedFiles)
          ? executionFastPath.maxTouchedFiles
          : defaults.executionPolicy.fastPath.maxTouchedFiles,
        autoEscalateOnTouchedFileThreshold: normalizeBoolean(
          executionFastPath.autoEscalateOnTouchedFileThreshold,
          defaults.executionPolicy.fastPath.autoEscalateOnTouchedFileThreshold,
        ),
        autoEscalateOnRequirementScopeDrift: normalizeBoolean(
          executionFastPath.autoEscalateOnRequirementScopeDrift,
          defaults.executionPolicy.fastPath.autoEscalateOnRequirementScopeDrift,
        ),
        forbidApiContractSchemaSecurityChange: normalizeBoolean(
          executionFastPath.forbidApiContractSchemaSecurityChange,
          defaults.executionPolicy.fastPath.forbidApiContractSchemaSecurityChange,
        ),
        forbidSharedCodegenBoundaryImpact: normalizeBoolean(
          executionFastPath.forbidSharedCodegenBoundaryImpact,
          defaults.executionPolicy.fastPath.forbidSharedCodegenBoundaryImpact,
        ),
        requireNoContinuityAmbiguity: normalizeBoolean(
          executionFastPath.requireNoContinuityAmbiguity,
          defaults.executionPolicy.fastPath.requireNoContinuityAmbiguity,
        ),
      },
      validationProfiles: {
        low: normalizeString(validationProfiles.low, defaults.executionPolicy.validationProfiles.low),
        medium: normalizeString(validationProfiles.medium, defaults.executionPolicy.validationProfiles.medium),
        high: normalizeString(validationProfiles.high, defaults.executionPolicy.validationProfiles.high),
      },
    },
    specializedGates: {
      sharedCodegenBoundary: {
        enabled: normalizeBoolean(
          sharedCodegenBoundary.enabled,
          defaults.specializedGates.sharedCodegenBoundary.enabled,
        ),
        sharedIntegrationSurface: normalizeBoolean(
          sharedCodegenBoundary.sharedIntegrationSurface,
          defaults.specializedGates.sharedCodegenBoundary.sharedIntegrationSurface,
        ),
        escalateOnMultiAgentOverlap: normalizeBoolean(
          sharedCodegenBoundary.escalateOnMultiAgentOverlap,
          defaults.specializedGates.sharedCodegenBoundary.escalateOnMultiAgentOverlap,
        ),
        generatorPaths: normalizeStringArray(sharedCodegenBoundary.generatorPaths),
        requiredEvidence: normalizeStringArray(sharedCodegenBoundary.requiredEvidence),
        forbidComponentSpecificGeneratorFixes: normalizeBoolean(
          sharedCodegenBoundary.forbidComponentSpecificGeneratorFixes,
          defaults.specializedGates.sharedCodegenBoundary.forbidComponentSpecificGeneratorFixes,
        ),
      },
      crossUsageConvergence: {
        enabled: normalizeBoolean(
          crossUsageConvergence.enabled,
          defaults.specializedGates.crossUsageConvergence.enabled,
        ),
        sharedSurfaceKinds: normalizeStringArray(crossUsageConvergence.sharedSurfaceKinds),
        evidenceArtifacts: normalizeStringArray(crossUsageConvergence.evidenceArtifacts),
        sharedSurfaceMinimumUsageClasses: normalizePositiveInteger(
          crossUsageConvergence.sharedSurfaceMinimumUsageClasses,
          defaults.specializedGates.crossUsageConvergence.sharedSurfaceMinimumUsageClasses,
        ),
        highRiskMinimumUsageClasses: normalizePositiveInteger(
          crossUsageConvergence.highRiskMinimumUsageClasses,
          defaults.specializedGates.crossUsageConvergence.highRiskMinimumUsageClasses,
        ),
        requireAlternateUsage: normalizeBoolean(
          crossUsageConvergence.requireAlternateUsage,
          defaults.specializedGates.crossUsageConvergence.requireAlternateUsage,
        ),
        requireContextualUsageForHighRisk: normalizeBoolean(
          crossUsageConvergence.requireContextualUsageForHighRisk,
          defaults.specializedGates.crossUsageConvergence.requireContextualUsageForHighRisk,
        ),
        overfitFixIsBlocking: normalizeBoolean(
          crossUsageConvergence.overfitFixIsBlocking,
          defaults.specializedGates.crossUsageConvergence.overfitFixIsBlocking,
        ),
      },
    },
    legacyPreserved: {
      projectConstraintsBullets: normalizeStringArray(legacyPreserved.projectConstraintsBullets),
      importedSections: normalizeStringArray(legacyPreserved.importedSections),
    },
  };
}

export function readWorkflowAdapterConfigFile(filePath, options = {}) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      exists: false,
      path: absolutePath,
      data: createDefaultWorkflowAdapterConfig(options),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${absolutePath}: ${error.message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Invalid config root in ${absolutePath}: expected JSON object`);
  }

  return {
    exists: true,
    path: absolutePath,
    data: normalizeWorkflowAdapterConfig(parsed, options),
  };
}

export function readWorkflowAdapterConfig(targetRoot, options = {}) {
  return readWorkflowAdapterConfigFile(resolveWorkflowAdapterConfigPath(targetRoot), options);
}

export function writeWorkflowAdapterConfigFile(filePath, data, options = {}) {
  const absolutePath = path.resolve(filePath);
  const normalized = normalizeWorkflowAdapterConfig(data, options);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return absolutePath;
}

export function writeWorkflowAdapterConfig(targetRoot, data, options = {}) {
  return writeWorkflowAdapterConfigFile(resolveWorkflowAdapterConfigPath(targetRoot), data, options);
}
