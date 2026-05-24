function freezeDeep(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  for (const nested of Object.values(value)) {
    freezeDeep(nested);
  }
  return Object.freeze(value);
}

const GOVERNANCE_COVERAGE_EXCEPTIONS = freezeDeep([
  {
    concept: "worktree",
    coverage_kind: "subsumed",
    governed_by: "workspace_identity",
    source_of_truth_relation: "workspace/worktree identity and locator metadata when explicitly configured",
    metadata_relation: "workspace metadata only; not a separate governed concept",
    lifecycle_status: "discovered -> active -> archived",
    scope: "shared-boundary",
    rationale: "Worktree identity is already governed through the workspace boundary and should not become a second canonical concept.",
  },
  {
    concept: "handoff_relay",
    coverage_kind: "subsumed",
    governed_by: "handoff_packet and coordination_records",
    source_of_truth_relation: "shared coordination payloads only when explicitly configured",
    metadata_relation: "runtime projection fields only; not a first-class product concept",
    lifecycle_status: "draft -> ready -> consumed -> archived",
    scope: "shared-boundary",
    rationale: "Handoff relay data is represented by the handoff packet and shared coordination projections, not by a new core concept.",
  },
  {
    concept: "repair_decision",
    coverage_kind: "subsumed",
    governed_by: "repair_findings and coordination_records",
    source_of_truth_relation: "repair-layer tables with required Markdown projection",
    metadata_relation: "repair-layer metadata only; not a separate governance concept",
    lifecycle_status: "open -> triaged -> resolved|waived -> archived",
    scope: "repair-layer",
    rationale: "Repair decisions are visible through the repair layer and coordination history, but are not first-class governance primitives.",
  },
  {
    concept: "migration_run",
    coverage_kind: "excluded",
    governed_by: "runtime migration telemetry",
    source_of_truth_relation: "migration logs and project-local tooling state",
    metadata_relation: "not governed by the core metadata policy",
    lifecycle_status: "recorded -> superseded -> archived",
    scope: "operational-telemetry",
    rationale: "Migration runs are implementation telemetry and stay outside the information model that governs local-first product state.",
  },
  {
    concept: "gate_result",
    coverage_kind: "excluded",
    governed_by: "CI workflow telemetry",
    source_of_truth_relation: "workflow-run records and gate logs",
    metadata_relation: "not governed by the core metadata policy",
    lifecycle_status: "recorded -> superseded -> archived",
    scope: "ci-telemetry",
    rationale: "Gate results belong to the CI/provenance layer and should not be promoted to a core runtime concept.",
  },
  {
    concept: "reference_data",
    coverage_kind: "excluded",
    governed_by: "fixture corpus and test fixtures",
    source_of_truth_relation: "tracked fixture corpus or local-only pilot corpus",
    metadata_relation: "fixture metadata only; not live workflow metadata",
    lifecycle_status: "seeded -> refreshed -> superseded",
    scope: "test-corpus",
    rationale: "Reference data is a test corpus family, not live workflow state, and remains outside the product information model.",
  },
]);

export function listGovernanceCoverageExceptions() {
  return GOVERNANCE_COVERAGE_EXCEPTIONS.map((item) => ({
    ...item,
  }));
}

