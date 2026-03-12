function freezeItems(items) {
  return Object.freeze(items.map((item) => Object.freeze({ ...item })));
}

export const IMPORTED_SECTION_POLICIES = freezeItems([
  {
    heading: "Session Transition Cleanliness Gate (Mandatory)",
    classification: "adapter-structured",
    multiAgentScope: "session-topology",
    nativeTarget: "sessionPolicy.transitionCleanliness",
    canonicalParity: "project-only",
  },
  {
    heading: "Incident Trigger Conditions",
    classification: "native-core",
    multiAgentScope: "dispatch-scope",
    nativeTarget: "docs/SPEC.md#SPEC-R10 + template/docs_audit/PROJECT_WORKFLOW.md",
    canonicalParity: "covered",
  },
  {
    heading: "Noise Control (Anti-Noise)",
    classification: "native-core",
    multiAgentScope: "dispatch-scope",
    nativeTarget: "docs/SPEC.md#SPEC-R10 + template/docs_audit/PROJECT_WORKFLOW.md",
    canonicalParity: "covered",
  },
  {
    heading: "Temporary Incident Tracking File",
    classification: "native-core",
    multiAgentScope: "dispatch-scope",
    nativeTarget: "template/docs_audit/incidents/TEMPLATE_INC_TMP.md + template/docs_audit/PROJECT_WORKFLOW.md",
    canonicalParity: "covered",
  },
  {
    heading: "Authorization Gate (Mandatory for L3/L4)",
    classification: "native-core",
    multiAgentScope: "dispatch-scope",
    nativeTarget: "docs/SPEC.md#SPEC-R10 + template/docs_audit/incidents/TEMPLATE_INC_TMP.md",
    canonicalParity: "covered",
  },
  {
    heading: "Workflow Self-Improvement Scope",
    classification: "native-core",
    multiAgentScope: "dispatch-scope",
    nativeTarget: "docs/SPEC.md#SPEC-R10 + template/docs_audit/PROJECT_WORKFLOW.md",
    canonicalParity: "covered",
  },
  {
    heading: "Resume and Cleanup",
    classification: "native-core",
    multiAgentScope: "dispatch-scope",
    nativeTarget: "docs/SPEC.md#SPEC-R10 + template/docs_audit/incidents/TEMPLATE_INC_TMP.md",
    canonicalParity: "covered",
  },
  {
    heading: "Execution Speed Policy (Project Optimization)",
    classification: "adapter-structured",
    multiAgentScope: "dispatch-scope",
    nativeTarget: "executionPolicy",
    canonicalParity: "project-only",
  },
  {
    heading: "1) Gate classes: Hard vs Light",
    classification: "adapter-structured",
    multiAgentScope: "dispatch-scope",
    nativeTarget: "executionPolicy.hardGates + executionPolicy.lightGates",
    canonicalParity: "project-only",
  },
  {
    heading: "2) Fast Path for micro-changes",
    classification: "adapter-structured",
    multiAgentScope: "dispatch-scope",
    nativeTarget: "executionPolicy.fastPath",
    canonicalParity: "project-only",
  },
  {
    heading: "3) Risk-based validation profile",
    classification: "adapter-structured",
    multiAgentScope: "dispatch-scope",
    nativeTarget: "executionPolicy.validationProfiles",
    canonicalParity: "project-only",
  },
  {
    heading: "Rule Set (choose exactly one)",
    classification: "native-core",
    multiAgentScope: "dispatch-scope",
    nativeTarget: "docs/SPEC.md#SPEC-R06 + template/docs_audit/CONTINUITY_GATE.md",
    canonicalParity: "covered",
  },
  {
    heading: "Mode mapping",
    classification: "native-core",
    multiAgentScope: "dispatch-scope",
    nativeTarget: "docs/SPEC.md#SPEC-R06 + template/docs_audit/CONTINUITY_GATE.md",
    canonicalParity: "covered",
  },
  {
    heading: "Interactive Stop Prompt (selection list)",
    classification: "native-core",
    multiAgentScope: "dispatch-scope",
    nativeTarget: "template/docs_audit/CONTINUITY_GATE.md + cycle-create skill",
    canonicalParity: "covered",
  },
  {
    heading: "Shared Codegen Boundary Gate (Mandatory, adapter extension to `SPEC-R03`/`SPEC-R04`)",
    classification: "adapter-structured",
    multiAgentScope: "shared-integration-surface",
    nativeTarget: "specializedGates.sharedCodegenBoundary",
    canonicalParity: "project-only",
  },
]);

export function findImportedSectionPolicy(heading) {
  const wanted = String(heading ?? "").trim().toLowerCase();
  return IMPORTED_SECTION_POLICIES.find((item) => item.heading.toLowerCase() === wanted) ?? null;
}

function hasSessionTransitionCleanliness(adapterData) {
  return adapterData?.sessionPolicy?.transitionCleanliness?.enabled === true;
}

function hasExecutionPolicy(adapterData) {
  return adapterData?.executionPolicy?.enabled === true;
}

function hasSharedCodegenBoundary(adapterData) {
  return adapterData?.specializedGates?.sharedCodegenBoundary?.enabled === true;
}

export function isImportedSectionSatisfiedByStructuredConfig(sectionOrHeading, adapterData = null) {
  const heading = extractImportedSectionHeading(sectionOrHeading);
  const policy = findImportedSectionPolicy(heading);
  if (!policy || policy.classification !== "adapter-structured") {
    return false;
  }
  switch (policy.nativeTarget) {
    case "sessionPolicy.transitionCleanliness":
      return hasSessionTransitionCleanliness(adapterData);
    case "executionPolicy":
    case "executionPolicy.hardGates + executionPolicy.lightGates":
    case "executionPolicy.fastPath":
    case "executionPolicy.validationProfiles":
      return hasExecutionPolicy(adapterData);
    case "specializedGates.sharedCodegenBoundary":
      return hasSharedCodegenBoundary(adapterData);
    default:
      return false;
  }
}

export function extractImportedSectionHeading(section) {
  const firstLine = String(section ?? "").replace(/\r\n/g, "\n").split("\n")[0] ?? "";
  return String(firstLine).replace(/^#{2,3}\s+/, "").trim();
}

export function shouldRetainImportedSection(section, adapterData = null) {
  const heading = extractImportedSectionHeading(section);
  const policy = findImportedSectionPolicy(heading);
  if (policy?.classification === "native-core") {
    return false;
  }
  if (isImportedSectionSatisfiedByStructuredConfig(heading, adapterData)) {
    return false;
  }
  return true;
}

export function filterRetainedImportedSections(sections, adapterData = null) {
  return (Array.isArray(sections) ? sections : []).filter((section) => shouldRetainImportedSection(section, adapterData));
}
