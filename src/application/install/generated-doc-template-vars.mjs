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

function buildSessionTransitionCleanlinessBlock(policy = {}) {
  if (policy?.enabled !== true) {
    return "";
  }
  const optionsBlock = buildNestedBulletBlock(policy.requiredDecisionOptions, "  - `TO_DEFINE`");
  return [
    "### Session Transition Cleanliness Gate (Mandatory)",
    "",
    "- Adapter policy scope: `session-topology`.",
    "- Applies before opening a new `SXXX-*` session branch.",
    "- In addition to `Session Start Branch Base Gate (Mandatory)`, no orphan cycle artifacts from previous cycles/sessions or unresolved relay residue relevant to the current session topology may remain `untracked` or unarbitrated.",
    "- Evaluate the session context as potentially multi-cycle; do not assume a single active cycle.",
    "- If unresolved residue exists, one explicit decision is required before new session start:",
    optionsBlock,
    "- Record the decision in session continuity notes and relevant cycle/session CR notes.",
    "- Runtime note: this remains adapter policy until a dedicated admission gate is implemented.",
  ].join("\n");
}

function buildExecutionPolicyBlock(policy = {}) {
  if (policy?.enabled !== true) {
    return "";
  }
  const hardGates = buildPlainNestedBulletBlock(
    policy.hardGates,
    "  - Keep canonical hard gates from `docs/audit/SPEC.md` active.",
  );
  const lightGates = buildPlainNestedBulletBlock(
    policy.lightGates,
    "  - Light-gate reduction policy is repository-defined and should remain explicit.",
  );
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
  const escalationLines = [];
  if (policy?.fastPath?.autoEscalateOnTouchedFileThreshold === true) {
    escalationLines.push("- touched files exceed threshold.");
  }
  if (policy?.fastPath?.autoEscalateOnRequirementScopeDrift === true) {
    escalationLines.push("- requirement/scope drift appears.");
  }
  if (policy?.escalateOnParallelAttachedCycles === true) {
    escalationLines.push("- several attached cycles or parallel relays create integration ambiguity.");
  }
  if (policy?.escalateOnSharedIntegrationSurface === true) {
    escalationLines.push("- shared runtime/codegen or another shared integration surface is touched.");
  }
  escalationLines.push("- failing targeted validation indicates broader risk.");

  return [
    "## Execution Speed Policy (Project Optimization)",
    "",
    "This project uses latency optimizations while preserving canonical safety gates from `docs/audit/SPEC.md`.",
    "",
    `- Evaluation scope: \`${clean(policy.evaluationScope) || "dispatch-or-local-scope"}\`.`,
    "- In multi-agent contexts, evaluate fast-path eligibility at the concrete dispatch/local execution scope, not as a blanket session-wide shortcut.",
    "",
    "### 1) Gate classes: Hard vs Light",
    "",
    "- Hard gates (always mandatory):",
    hardGates,
    "- Light gates (risk-adaptive):",
    lightGates,
    "- Rule: hard gates cannot be skipped; light gates may be reduced only under Fast Path or low-risk classification.",
    "",
    "### 2) Fast Path for micro-changes",
    "",
    policy?.fastPath?.enabled === true
      ? "Fast Path is allowed when all conditions are true:"
      : "Fast Path is currently disabled for this adapter.",
    ...(policy?.fastPath?.enabled === true ? fastPathConditions : []),
    ...(policy?.fastPath?.enabled === true ? [
      "",
      "Fast Path execution:",
      "- keep mandatory hard gates.",
      "- use concise artifact updates (short decision + traceability entries).",
      "- run targeted validations only instead of broad suites when risk remains localized.",
      "",
      "Fast Path auto-escalation to full path:",
      ...escalationLines,
    ] : []),
    "",
    "### 3) Risk-based validation profile",
    "",
    `- \`LOW\` risk: ${clean(policy?.validationProfiles?.low) || "targeted tests and focused lint on impacted components/packages"}.`,
    `- \`MEDIUM\` risk: ${clean(policy?.validationProfiles?.medium) || "targeted validations plus cross-package checks relevant to the change surface"}.`,
    `- \`HIGH\` risk: ${clean(policy?.validationProfiles?.high) || "full validation stack required by the affected cycle type"}.`,
    "",
    "- Risk classification should be recorded before `VERIFYING`.",
    "- Runtime note: this remains adapter policy until runtime gate selection consumes it directly.",
  ].join("\n");
}

function buildSharedCodegenBoundaryBlock(policy = {}) {
  if (policy?.enabled !== true) {
    return "";
  }
  const pathsBlock = buildNestedBulletBlock(policy.generatorPaths, "  - `TO_DEFINE`");
  const evidenceBlock = buildNestedBulletBlock(policy.requiredEvidence, "  - `traceability.md`");
  const lines = [
    "## Shared Codegen Boundary Gate (Mandatory, adapter extension to `SPEC-R03`/`SPEC-R04`)",
    "",
    "When a cycle modifies shared code generation files, the cycle MUST include an explicit boundary check before moving to `VERIFYING`.",
    "",
  ];
  if (policy.sharedIntegrationSurface === true) {
    lines.push("- Treat this area as a shared integration surface.");
  }
  if (policy.escalateOnMultiAgentOverlap === true) {
    lines.push("- In multi-agent contexts, overlap on these files should be treated as elevated integration risk by default.");
  }
  lines.push(
    "- Relevant generator/shared-output paths:",
    pathsBlock,
    "- Required evidence in cycle artifacts:",
    evidenceBlock,
  );
  if (policy.forbidComponentSpecificGeneratorFixes === true) {
    lines.push(
      "- If DOM manipulation changed, record an explicit note that the change lives in patch/mutation/component layer, or document an approved exception with risk.",
      "- Hard stop: component-specific fixes must not be implemented in generator/shared generated bridge code.",
      "- If a component-specific DOM behavior change is needed, relocate it to patch/mutation/component layer or open an explicit exception CR with impact >= medium and user approval.",
    );
  }
  lines.push("- Runtime note: this remains adapter policy until a dedicated runtime overlap gate is introduced.");
  return lines.join("\n");
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
      adapterSessionPolicy.transitionCleanliness,
    ),
    EXECUTION_POLICY_BLOCK: buildExecutionPolicyBlock(adapterExecutionPolicy),
    SHARED_CODEGEN_BOUNDARY_BLOCK: buildSharedCodegenBoundaryBlock(
      adapterSpecializedGates.sharedCodegenBoundary,
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
