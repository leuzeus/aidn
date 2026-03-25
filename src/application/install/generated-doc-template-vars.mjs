import {
  defaultIndexStoreFromStateMode,
  normalizeIndexStoreMode,
  normalizeStateMode,
  resolveConfigIndexStore,
  resolveConfigStateMode,
} from "../../lib/config/aidn-config-lib.mjs";
import { renderGeneratedDocFragment } from "./generated-doc-fragment-render-service.mjs";
import { getScaffoldRelativePath } from "./scaffold-paths-lib.mjs";

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

function buildNestedBulletBlock(values, fallback = "") {
  const normalized = Array.isArray(values)
    ? values.map((item) => clean(item)).filter((item) => item.length > 0)
    : [];
  if (normalized.length === 0) {
    return fallback;
  }
  return normalized.map((item) => `  - \`${item}\``).join("\n");
}

function buildPlainNestedBulletBlock(values, fallback = "") {
  const normalized = Array.isArray(values)
    ? values.map((item) => clean(item)).filter((item) => item.length > 0)
    : [];
  if (normalized.length === 0) {
    return fallback;
  }
  return normalized.map((item) => `  - ${item}`).join("\n");
}

function buildLineBlock(lines, fallback = "") {
  const normalized = Array.isArray(lines)
    ? lines.map((item) => clean(item)).filter((item) => item.length > 0)
    : [];
  if (normalized.length === 0) {
    return fallback;
  }
  return normalized.join("\n");
}

function buildSessionTransitionCleanlinessBlock(repoRoot, policy = {}) {
  if (policy?.enabled !== true) {
    return "";
  }
  return renderGeneratedDocFragment({
    repoRoot,
    fragmentRelative: getScaffoldRelativePath("fragments", "workflow", "session-transition-cleanliness.md"),
    templateVars: {
      TRANSITION_CLEANLINESS_SCOPE: clean(policy.scope) || "session-topology",
      TRANSITION_REQUIRED_DECISION_OPTIONS_BLOCK: buildNestedBulletBlock(
        policy.requiredDecisionOptions,
        "  - `TO_DEFINE`",
      ),
    },
  });
}

function buildExecutionFastPathBody(policy = {}) {
  if (policy?.fastPath?.enabled !== true) {
    return "";
  }
  const lines = [
    "",
    "Fast Path execution:",
    "- keep mandatory hard gates.",
    "- use concise artifact updates (short decision + traceability entries).",
    "- run targeted validations only instead of broad suites when risk remains localized.",
    "",
    "Fast Path auto-escalation to full path:",
  ];
  if (policy?.fastPath?.autoEscalateOnTouchedFileThreshold === true) {
    lines.push("- touched files exceed threshold.");
  }
  if (policy?.fastPath?.autoEscalateOnRequirementScopeDrift === true) {
    lines.push("- requirement/scope drift appears.");
  }
  if (policy?.escalateOnParallelAttachedCycles === true) {
    lines.push("- several attached cycles or parallel relays create integration ambiguity.");
  }
  if (policy?.escalateOnSharedIntegrationSurface === true) {
    lines.push("- shared runtime/codegen or another shared integration surface is touched.");
  }
  lines.push("- failing targeted validation indicates broader risk.");
  return lines.join("\n");
}

function buildExecutionPolicyBlock(repoRoot, policy = {}) {
  if (policy?.enabled !== true) {
    return "";
  }
  const fastPathConditions = [
    `- touch scope is small (\`<= ${Number.isInteger(policy?.fastPath?.maxTouchedFiles) && policy.fastPath.maxTouchedFiles > 0 ? policy.fastPath.maxTouchedFiles : 2}\` files changed, no structural migration).`,
  ];
  if (policy?.fastPath?.forbidApiContractSchemaSecurityChange === true) {
    fastPathConditions.push("- no API/contract/schema/security change.");
  }
  if (policy?.fastPath?.forbidSharedCodegenBoundaryImpact === true) {
    fastPathConditions.push("- no shared codegen boundary impact.");
  }
  if (policy?.fastPath?.requireNoContinuityAmbiguity === true) {
    fastPathConditions.push("- no continuity ambiguity (rule already selected and recorded).");
  }
  return renderGeneratedDocFragment({
    repoRoot,
    fragmentRelative: getScaffoldRelativePath("fragments", "workflow", "execution-speed-policy.md"),
    templateVars: {
      EXECUTION_EVALUATION_SCOPE: clean(policy.evaluationScope) || "dispatch-or-local-scope",
      EXECUTION_HARD_GATES_BLOCK: buildPlainNestedBulletBlock(
        policy.hardGates,
        "  - Keep canonical hard gates from `docs/audit/SPEC.md` active.",
      ),
      EXECUTION_LIGHT_GATES_BLOCK: buildPlainNestedBulletBlock(
        policy.lightGates,
        "  - Light-gate reduction policy is repository-defined and should remain explicit.",
      ),
      EXECUTION_FAST_PATH_INTRO: policy?.fastPath?.enabled === true
        ? "Fast Path is allowed when all conditions are true:"
        : "Fast Path is currently disabled for this adapter.",
      EXECUTION_FAST_PATH_CONDITIONS_BLOCK: policy?.fastPath?.enabled === true
        ? buildLineBlock(fastPathConditions)
        : "",
      EXECUTION_FAST_PATH_BODY: buildExecutionFastPathBody(policy),
      EXECUTION_VALIDATION_LOW: clean(policy?.validationProfiles?.low)
        || "targeted tests and focused lint on impacted components/packages",
      EXECUTION_VALIDATION_MEDIUM: clean(policy?.validationProfiles?.medium)
        || "targeted validations plus cross-package checks relevant to the change surface",
      EXECUTION_VALIDATION_HIGH: clean(policy?.validationProfiles?.high)
        || "full validation stack required by the affected cycle type",
    },
  });
}

function buildSharedCodegenHardStopBlock(policy = {}) {
  if (policy?.forbidComponentSpecificGeneratorFixes !== true) {
    return "";
  }
  return [
    "- If DOM manipulation changed, record an explicit note that the change lives in patch/mutation/component layer, or document an approved exception with risk.",
    "- Hard stop: component-specific fixes must not be implemented in generator/shared generated bridge code.",
    "- If a component-specific DOM behavior change is needed, relocate it to patch/mutation/component layer or open an explicit exception CR with impact >= medium and user approval.",
  ].join("\n");
}

function buildSharedCodegenBoundaryBlock(repoRoot, policy = {}) {
  if (policy?.enabled !== true) {
    return "";
  }
  return renderGeneratedDocFragment({
    repoRoot,
    fragmentRelative: getScaffoldRelativePath("fragments", "workflow", "shared-codegen-boundary.md"),
    templateVars: {
      SHARED_CODEGEN_SHARED_SURFACE_LINE: policy.sharedIntegrationSurface === true
        ? "- Treat this area as a shared integration surface."
        : "",
      SHARED_CODEGEN_OVERLAP_LINE: policy.escalateOnMultiAgentOverlap === true
        ? "- In multi-agent contexts, overlap on these files should be treated as elevated integration risk by default."
        : "",
      SHARED_CODEGEN_PATHS_BLOCK: buildNestedBulletBlock(policy.generatorPaths, "  - `TO_DEFINE`"),
      SHARED_CODEGEN_EVIDENCE_BLOCK: buildNestedBulletBlock(policy.requiredEvidence, "  - `traceability.md`"),
      SHARED_CODEGEN_HARD_STOP_BLOCK: buildSharedCodegenHardStopBlock(policy),
    },
  });
}

function buildCrossUsageRuleLines(policy = {}) {
  const lines = [];
  if (policy.requireAlternateUsage === true) {
    lines.push("- At least one non-primary usage should exercise a different caller, business path, or contract shape.");
  }
  if (policy.requireContextualUsageForHighRisk === true) {
    lines.push("- High-risk changes should include at least one context, edge, or adversarial usage.");
  }
  if (policy.overfitFixIsBlocking === true) {
    lines.push("- If a fix resolves the triggering scenario but regresses another declared usage class, treat it as overfitted and block closure.");
  }
  lines.push("- Prefer reusing canonical scenarios for shared surfaces instead of multiplying near-duplicate tests.");
  return buildLineBlock(lines);
}

function buildCrossUsageSurfaceBlock(policy = {}) {
  const kinds = Array.isArray(policy.sharedSurfaceKinds)
    ? policy.sharedSurfaceKinds.map((item) => clean(item)).filter((item) => item.length > 0)
    : [];
  if (kinds.length === 0) {
    return "";
  }
  return [
    "- Shared-surface defaults apply to:",
    ...kinds.map((item) => `  - \`${item}\``),
  ].join("\n");
}

function buildCrossUsageEvidenceBlock(policy = {}) {
  const artifacts = Array.isArray(policy.evidenceArtifacts)
    ? policy.evidenceArtifacts.map((item) => clean(item)).filter((item) => item.length > 0)
    : [];
  if (artifacts.length === 0) {
    return "";
  }
  return [
    "- Expected evidence artifacts:",
    ...artifacts.map((item) => `  - \`${item}\``),
  ].join("\n");
}

function buildCrossUsageConvergenceBlock(repoRoot, policy = {}) {
  if (policy?.enabled !== true) {
    return "";
  }
  return renderGeneratedDocFragment({
    repoRoot,
    fragmentRelative: getScaffoldRelativePath("fragments", "workflow", "cross-usage-convergence-policy.md"),
    templateVars: {
      CROSS_USAGE_SHARED_MIN: String(policy.sharedSurfaceMinimumUsageClasses ?? 2),
      CROSS_USAGE_HIGH_RISK_MIN: String(policy.highRiskMinimumUsageClasses ?? 3),
      CROSS_USAGE_RULE_LINES: buildCrossUsageRuleLines(policy),
      CROSS_USAGE_SURFACE_BLOCK: buildCrossUsageSurfaceBlock(policy),
      CROSS_USAGE_EVIDENCE_BLOCK: buildCrossUsageEvidenceBlock(policy),
    },
  });
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
  repoRoot = process.cwd(),
  templateVars = {},
  aidnConfigData = {},
  workflowAdapterConfig = null,
}) {
  const adapterData = workflowAdapterConfig?.data ?? {};
  const adapterConstraints = adapterData.constraints ?? {};
  const adapterRuntimePolicy = adapterData.runtimePolicy ?? {};
  const adapterSnapshotPolicy = adapterData.snapshotPolicy ?? {};
  const adapterSessionPolicy = adapterData.sessionPolicy ?? {};
  const adapterExecutionPolicy = adapterData.executionPolicy ?? {};
  const adapterSpecializedGates = adapterData.specializedGates ?? {};
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
    SESSION_TRANSITION_CLEANLINESS_BLOCK: buildSessionTransitionCleanlinessBlock(
      repoRoot,
      adapterSessionPolicy.transitionCleanliness,
    ),
    EXECUTION_POLICY_BLOCK: buildExecutionPolicyBlock(repoRoot, adapterExecutionPolicy),
    SHARED_CODEGEN_BOUNDARY_BLOCK: buildSharedCodegenBoundaryBlock(
      repoRoot,
      adapterSpecializedGates.sharedCodegenBoundary,
    ),
    CROSS_USAGE_CONVERGENCE_BLOCK: buildCrossUsageConvergenceBlock(
      repoRoot,
      adapterSpecializedGates.crossUsageConvergence,
    ),
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
