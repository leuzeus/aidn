import {
  defaultIndexStoreFromStateMode,
  normalizeIndexStoreMode,
  normalizeStateMode,
  resolveConfigIndexStore,
  resolveConfigStateMode,
} from "../../lib/config/aidn-config-lib.mjs";

function clean(value) {
  return String(value ?? "").trim();
}

function pick(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function toConstraintValue(value, fallback = "TO_DEFINE") {
  const text = clean(value);
  return text || fallback;
}

function toAdditionalConstraintsText(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return "none";
  }
  const normalized = values
    .map((item) => clean(item))
    .filter((item) => item.length > 0);
  return normalized.length > 0 ? normalized.join(" | ") : "none";
}

export function buildGeneratedDocTemplateVars({
  templateVars = {},
  aidnConfigData = {},
  workflowAdapterConfig = null,
}) {
  const adapterData = workflowAdapterConfig?.data ?? {};
  const adapterConstraints = adapterData.constraints ?? {};
  const adapterRuntimePolicy = adapterData.runtimePolicy ?? {};
  const preferredStateMode = normalizeStateMode(
    pick(
      adapterRuntimePolicy.preferredStateMode,
      resolveConfigStateMode(aidnConfigData),
      templateVars.PREFERRED_STATE_MODE,
      "dual",
    ),
  ) ?? "dual";
  const defaultIndexStore = normalizeIndexStoreMode(
    pick(
      adapterRuntimePolicy.defaultIndexStore,
      resolveConfigIndexStore(aidnConfigData),
      templateVars.DEFAULT_INDEX_STORE,
      defaultIndexStoreFromStateMode(preferredStateMode),
    ),
  ) ?? defaultIndexStoreFromStateMode(preferredStateMode);

  return {
    ...templateVars,
    PROJECT_NAME: pick(adapterData.projectName, templateVars.PROJECT_NAME),
    PREFERRED_STATE_MODE: preferredStateMode,
    DEFAULT_INDEX_STORE: defaultIndexStore,
    RUNTIME_CONSTRAINTS: toConstraintValue(
      pick(adapterConstraints.runtime, templateVars.RUNTIME_CONSTRAINTS),
    ),
    ARCH_CONSTRAINTS: toConstraintValue(
      pick(adapterConstraints.architecture, templateVars.ARCH_CONSTRAINTS),
    ),
    DELIVERY_CONSTRAINTS: toConstraintValue(
      pick(adapterConstraints.delivery, templateVars.DELIVERY_CONSTRAINTS),
    ),
    ADDITIONAL_CONSTRAINTS: toAdditionalConstraintsText(adapterConstraints.additional),
    DEPENDENCY_CONSTRAINTS: toConstraintValue(templateVars.DEPENDENCY_CONSTRAINTS),
    GENERATED_ARTIFACT_CONSTRAINTS: toConstraintValue(templateVars.GENERATED_ARTIFACT_CONSTRAINTS),
    TEST_REGRESSION_CONSTRAINTS: toConstraintValue(templateVars.TEST_REGRESSION_CONSTRAINTS),
    DOR_POLICY: toConstraintValue(templateVars.DOR_POLICY),
    SNAPSHOT_TRIGGER: toConstraintValue(templateVars.SNAPSHOT_TRIGGER),
    SNAPSHOT_OWNER: toConstraintValue(templateVars.SNAPSHOT_OWNER),
    SNAPSHOT_FRESHNESS_RULE: toConstraintValue(templateVars.SNAPSHOT_FRESHNESS_RULE),
    PARKING_LOT_RULE: toConstraintValue(templateVars.PARKING_LOT_RULE),
  };
}
