#!/usr/bin/env node
import {
  GOVERNED_CONCEPTS,
  deriveGovernanceOperations,
  evaluateGovernedConcept,
  evaluateGovernanceRuntimeSurface,
  projectGovernanceDiagnostics,
} from "../../src/application/runtime/governance-diagnostics-use-case.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  try {
    assert(Array.isArray(GOVERNED_CONCEPTS) && GOVERNED_CONCEPTS.length > 0, "governed concepts should be registered");
    const concept = evaluateGovernedConcept(GOVERNED_CONCEPTS.find((item) => item.concept === "runtime_state"));
    assert(concept.concept === "runtime_state", "runtime_state concept should be evaluated");
    assert(typeof concept.cli_contract_status === "string", "runtime_state concept should expose cli contract status");

    const diagnostics = projectGovernanceDiagnostics({
      targetRoot: "G:/fixture/project",
      workspace: {
        project_id: "project-fixture",
        workspace_id: "workspace-fixture",
        worktree_id: "worktree-fixture",
      },
    });
    assert(typeof diagnostics.ok === "boolean", "diagnostics should expose overall ok flag");
    assert(diagnostics.summary.complete >= 1, "diagnostics should report at least one complete concept");
    assert(diagnostics.registry.cli_effect_policy_count >= 1, "diagnostics should expose cli effect policy registry size");
    assert(diagnostics.registry.runtime_surface_count >= 1, "diagnostics should expose runtime surface registry size");
    assert(diagnostics.registry.observed_artifact_count >= 1, "diagnostics should expose observed artifact registry size");
    assert(Array.isArray(diagnostics.runtime_surfaces) && diagnostics.runtime_surfaces.length >= 1, "diagnostics should expose runtime surface coverage");
    assert(typeof diagnostics.runtime_surface_summary.covered === "number", "diagnostics should summarize runtime surface coverage");
    assert(Array.isArray(diagnostics.observed_artifacts) && diagnostics.observed_artifacts.length >= 1, "diagnostics should expose observed artifact coverage");
    assert(typeof diagnostics.observed_artifact_summary.partial === "number", "diagnostics should summarize observed artifact coverage");

    const operations = deriveGovernanceOperations({
      concepts: diagnostics.concepts,
      issues: diagnostics.issues,
    });
    assert(typeof operations.source_of_truth_coverage_status === "string", "operations should expose source-of-truth coverage status");
    assert(Array.isArray(operations.recommended_actions) && operations.recommended_actions.length >= 1, "operations should expose recommended actions");

    const surface = evaluateGovernanceRuntimeSurface(
      { id: "runtime-governance-diagnostics", linked_concepts: ["cli_output_contract", "workspace"] },
      new Map(diagnostics.concepts.map((item) => [item.concept, item])),
    );
    assert(surface.id === "runtime-governance-diagnostics", "runtime surface evaluation should preserve surface id");
    assert(typeof surface.linked_concept_coverage_status === "string", "runtime surface evaluation should expose linked concept coverage");
    const currentStateArtifact = diagnostics.observed_artifacts.find((item) => item.id === "current_state");
    assert(currentStateArtifact != null, "diagnostics should include current_state observed artifact");
    assert(typeof currentStateArtifact.metadata?.metadata_status === "string", "observed artifact should expose metadata status");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
