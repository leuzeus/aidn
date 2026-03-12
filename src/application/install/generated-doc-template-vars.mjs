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

function toPolicyValue(value, fallback = "TO_DEFINE") {
  const text = clean(value);
  return text || fallback;
}

function parseLabeledConstraint(raw) {
  const match = clean(raw).match(/^(.+?):\s*`([^`]+)`$/);
  if (!match) {
    return {
      label: "",
      value: "",
      raw: clean(raw),
    };
  }
  return {
    label: clean(match[1]).toLowerCase(),
    value: clean(match[2]),
    raw: clean(raw),
  };
}

function buildAdditionalConstraintBlock(values) {
  const normalized = Array.isArray(values)
    ? values.map((item) => clean(item)).filter((item) => item.length > 0)
    : [];
  if (normalized.length === 0) {
    return "- Additional local constraints: `none`";
  }
  return normalized.map((item) => `- ${item}`).join("\n");
}

function buildCiCapacityBlock(values) {
  const normalized = Array.isArray(values)
    ? values.map((item) => clean(item)).filter((item) => item.length > 0)
    : [];
  if (normalized.length === 0) {
    return "- Project-specific CI/review capacity policy: `none`";
  }
  return normalized.map((item) => `- ${item}`).join("\n");
}

function buildProjectConstraintsBlock({
  runtimeConstraint,
  architectureConstraint,
  dependencyConstraint,
  deliveryConstraint,
  remainingAdditional,
  generatedArtifactConstraint,
  testRegressionConstraint,
  legacyProjectConstraintsBullets,
}) {
  const legacyBullets = Array.isArray(legacyProjectConstraintsBullets)
    ? legacyProjectConstraintsBullets.map((item) => clean(item)).filter((item) => item.length > 0)
    : [];
  if (legacyBullets.length > 0) {
    return legacyBullets.map((item) => `- ${item}`).join("\n");
  }
  const lines = [
    `- Runtime/platform constraints: \`${toConstraintValue(runtimeConstraint)}\``,
    `- Architecture constraints: \`${toConstraintValue(architectureConstraint)}\``,
    `- Dependency/data constraints: \`${toConstraintValue(dependencyConstraint)}\``,
    `- Delivery constraints (CI/release/compliance): \`${toConstraintValue(deliveryConstraint)}\``,
    buildAdditionalConstraintBlock(remainingAdditional),
    `- Generated artifact constraints: \`${toConstraintValue(generatedArtifactConstraint)}\``,
    `- Testing/regression constraints: \`${toConstraintValue(testRegressionConstraint)}\``,
  ];
  return lines.join("\n");
}

export function buildGeneratedDocTemplateVars({
  templateVars = {},
  aidnConfigData = {},
  workflowAdapterConfig = null,
}) {
  const adapterData = workflowAdapterConfig?.data ?? {};
  const adapterConstraints = adapterData.constraints ?? {};
  const adapterRuntimePolicy = adapterData.runtimePolicy ?? {};
  const adapterSnapshotPolicy = adapterData.snapshotPolicy ?? {};
  const adapterLegacyPreserved = adapterData.legacyPreserved ?? {};
  const parsedAdditional = Array.isArray(adapterConstraints.additional)
    ? adapterConstraints.additional
      .map((item) => parseLabeledConstraint(item))
      .filter((item) => item.raw.length > 0)
    : [];
  const additionalConsumed = new Set();
  function promoteAdditional(labelExpressions) {
    const found = parsedAdditional.find((item, index) => {
      if (additionalConsumed.has(index) || !item.label || !item.value) {
        return false;
      }
      return labelExpressions.some((expression) => expression.test(item.label));
    });
    if (!found) {
      return "";
    }
    const index = parsedAdditional.indexOf(found);
    additionalConsumed.add(index);
    return found.value;
  }
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
  const dependencyConstraint = promoteAdditional([
    /dependency\/data constraints/i,
    /dependency minimization constraints/i,
  ]);
  const generatedArtifactConstraint = promoteAdditional([
    /generated artifact constraints/i,
  ]);
  const testRegressionConstraint = promoteAdditional([
    /testing\/regression constraints/i,
    /regression safety constraints/i,
  ]);
  const remainingAdditional = parsedAdditional
    .filter((item, index) => !additionalConsumed.has(index))
    .map((item) => item.raw);
  const runtimeConstraintValue = pick(adapterConstraints.runtime, templateVars.RUNTIME_CONSTRAINTS);
  const architectureConstraintValue = pick(adapterConstraints.architecture, templateVars.ARCH_CONSTRAINTS);
  const deliveryConstraintValue = pick(adapterConstraints.delivery, templateVars.DELIVERY_CONSTRAINTS);

  return {
    ...templateVars,
    PROJECT_NAME: pick(adapterData.projectName, templateVars.PROJECT_NAME),
    PREFERRED_STATE_MODE: preferredStateMode,
    DEFAULT_INDEX_STORE: defaultIndexStore,
    RUNTIME_CONSTRAINTS: toConstraintValue(runtimeConstraintValue),
    ARCH_CONSTRAINTS: toConstraintValue(architectureConstraintValue),
    DELIVERY_CONSTRAINTS: toConstraintValue(deliveryConstraintValue),
    ADDITIONAL_CONSTRAINT_BLOCK: buildAdditionalConstraintBlock(remainingAdditional),
    DEPENDENCY_CONSTRAINTS: toConstraintValue(pick(dependencyConstraint, templateVars.DEPENDENCY_CONSTRAINTS)),
    GENERATED_ARTIFACT_CONSTRAINTS: toConstraintValue(
      pick(generatedArtifactConstraint, templateVars.GENERATED_ARTIFACT_CONSTRAINTS),
    ),
    TEST_REGRESSION_CONSTRAINTS: toConstraintValue(
      pick(testRegressionConstraint, templateVars.TEST_REGRESSION_CONSTRAINTS),
    ),
    DOR_POLICY: toPolicyValue(pick(adapterData.dorPolicy, templateVars.DOR_POLICY)),
    SNAPSHOT_TRIGGER: toPolicyValue(pick(adapterSnapshotPolicy.trigger, templateVars.SNAPSHOT_TRIGGER)),
    SNAPSHOT_OWNER: toPolicyValue(pick(adapterSnapshotPolicy.owner, templateVars.SNAPSHOT_OWNER)),
    SNAPSHOT_FRESHNESS_RULE: toPolicyValue(
      pick(adapterSnapshotPolicy.freshnessRule, templateVars.SNAPSHOT_FRESHNESS_RULE),
    ),
    PARKING_LOT_RULE: toPolicyValue(
      pick(adapterSnapshotPolicy.parkingLotRule, templateVars.PARKING_LOT_RULE),
    ),
    CI_CAPACITY_BLOCK: buildCiCapacityBlock(adapterData.ciPolicy?.capacity),
    PROJECT_CONSTRAINTS_BLOCK: buildProjectConstraintsBlock({
      runtimeConstraint: runtimeConstraintValue,
      architectureConstraint: architectureConstraintValue,
      dependencyConstraint: pick(dependencyConstraint, templateVars.DEPENDENCY_CONSTRAINTS),
      deliveryConstraint: deliveryConstraintValue,
      remainingAdditional,
      generatedArtifactConstraint: pick(generatedArtifactConstraint, templateVars.GENERATED_ARTIFACT_CONSTRAINTS),
      testRegressionConstraint: pick(testRegressionConstraint, templateVars.TEST_REGRESSION_CONSTRAINTS),
      legacyProjectConstraintsBullets: adapterLegacyPreserved.projectConstraintsBullets,
    }),
  };
}
