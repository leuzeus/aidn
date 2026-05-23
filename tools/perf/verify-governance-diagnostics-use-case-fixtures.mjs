#!/usr/bin/env node
import {
  GOVERNED_CONCEPTS,
  deriveGovernanceOperations,
  evaluateGovernedConcept,
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

    const operations = deriveGovernanceOperations({
      concepts: diagnostics.concepts,
      issues: diagnostics.issues,
    });
    assert(typeof operations.source_of_truth_coverage_status === "string", "operations should expose source-of-truth coverage status");
    assert(Array.isArray(operations.recommended_actions) && operations.recommended_actions.length >= 1, "operations should expose recommended actions");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
