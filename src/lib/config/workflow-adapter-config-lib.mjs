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

export function resolveWorkflowAdapterConfigPath(targetRoot) {
  return path.resolve(targetRoot, ".aidn", "project", "workflow.adapter.json");
}

export function createDefaultWorkflowAdapterConfig(options = {}) {
  const preferredStateMode = normalizeStateMode(options.preferredStateMode) ?? "dual";
  const defaultIndexStore = normalizeIndexStoreMode(options.defaultIndexStore)
    ?? defaultIndexStoreFromStateMode(preferredStateMode);

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
  const legacyPreserved = isPlainObject(base.legacyPreserved) ? base.legacyPreserved : {};

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
