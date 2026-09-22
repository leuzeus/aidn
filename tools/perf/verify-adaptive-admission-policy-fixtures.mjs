#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  evaluateAdaptiveAdmission,
  GOVERNANCE_LANE,
} from "../../src/core/governance/adaptive-admission-policy.mjs";
import { normalizeWorkflowAdapterConfig } from "../../src/lib/config/workflow-adapter-config-lib.mjs";
import { buildGeneratedDocTemplateVars } from "../../src/application/install/generated-doc-template-vars.mjs";
import { renderTemplateVariables } from "../../src/application/install/template-io.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const explore = evaluateAdaptiveAdmission({ mode: "THINKING", branchKind: "source" });
  const fast = evaluateAdaptiveAdmission({
    mode: "COMMITTING",
    branchKind: "cycle",
    changedPaths: ["docs/README.md", "src/ui/label.mjs"],
    maxTouchedFiles: 2,
  });
  const fastEscalated = evaluateAdaptiveAdmission({
    mode: "COMMITTING",
    branchKind: "cycle",
    requestedLane: "FAST",
    changedPaths: ["src/contracts/public-api.json"],
  });
  const assured = evaluateAdaptiveAdmission({
    mode: "COMMITTING",
    branchKind: "cycle",
    persistenceImpact: true,
  });
  const emergency = evaluateAdaptiveAdmission({
    mode: "COMMITTING",
    branchKind: "cycle",
    requestedLane: "FAST",
    changedPaths: ["docs/incident.md"],
    emergency: true,
  });
  const adapter = normalizeWorkflowAdapterConfig({
    version: 1,
    ciPolicy: {
      capacity: ["Only one delivery PR at a time"],
      enforcement: "hard",
    },
    branchPolicy: {
      sourceDirectWrites: true,
    },
    governancePolicy: {
      lanes: {
        FAST: {
          requiredGates: ["PROJECT-TARGETED-LINT"],
        },
      },
    },
  });
  const configuredFast = evaluateAdaptiveAdmission({
    mode: "COMMITTING",
    branchKind: "cycle",
    changedPaths: ["docs/README.md"],
    lanePolicy: adapter.governancePolicy.lanes,
  });
  const templateVars = buildGeneratedDocTemplateVars({
    repoRoot: process.cwd(),
    templateVars: {
      VERSION: "9.9.9",
      PROJECT_NAME: "fixture",
      SOURCE_BRANCH: "dev",
    },
    workflowAdapterConfig: { data: adapter },
  });
  const workflowTemplate = fs.readFileSync(path.join(process.cwd(), "scaffold", "docs_audit", "PROJECT_WORKFLOW.md"), "utf8");
  const pruneTemplate = fs.readFileSync(path.join(process.cwd(), "scaffold", "root", ".github", "workflows", "branch-prune.yml"), "utf8");
  const renderedWorkflow = renderTemplateVariables(workflowTemplate, templateVars);
  const renderedPrune = renderTemplateVariables(pruneTemplate, templateVars);

  assert(explore.lane === GOVERNANCE_LANE.EXPLORE, "THINKING should route to EXPLORE");
  assert(explore.branch_role === "source" && explore.work_branch_required === true, "source branch role must require a work branch for writes");
  assert(fast.lane === GOVERNANCE_LANE.FAST, "bounded reversible change should route to FAST");
  assert(fast.required_gates.includes("AIDN-GOV-TARGETED-VALIDATION"), "FAST must keep targeted validation");
  assert(fastEscalated.lane === GOVERNANCE_LANE.STANDARD, "FAST contract or shared-surface change must escalate");
  assert(assured.lane === GOVERNANCE_LANE.ASSURED, "persistence impact must route to ASSURED");
  for (const gate of fast.required_gates) {
    assert(assured.required_gates.includes(gate), `ASSURED must retain lower-lane gate ${gate}`);
  }
  for (const invariant of [
    "AIDN-GOV-SECRET-SAFETY",
    "AIDN-GOV-PROVENANCE",
    "AIDN-GOV-NO-IMPLICIT-WRITE",
    "AIDN-GOV-EVIDENCE-INTEGRITY",
    "AIDN-GOV-ROLLBACK",
  ]) {
    assert(emergency.required_gates.includes(invariant), `EMERGENCY must retain ${invariant}`);
  }
  assert(emergency.overlay === "EMERGENCY", "emergency overlay should be explicit");
  assert(adapter.governancePolicy.defaultLane === "STANDARD", "existing adapters must default conservatively to STANDARD");
  assert(adapter.branchPolicy.sourceDirectWrites === false, "existing adapters must prohibit source direct writes by default");
  assert(configuredFast.required_gates.includes("PROJECT-TARGETED-LINT"), "adapter lane gates must extend executable admission");
  assert(adapter.ciPolicy.enforcement === "informative", "CI prose without executable rule IDs must be informative");
  assert(renderedWorkflow.includes("product_version: 9.9.9"), "generated workflow must expose product_version");
  assert(renderedWorkflow.includes("workflow_contract_version: aidn-workflow-contract.v1"), "generated workflow must expose an unambiguous workflow contract version");
  assert(renderedWorkflow.includes("`dev -> main`"), "generated pruning documentation must use a distinct source/base relation");
  assert(!renderedWorkflow.includes("dev` is merged into `dev"), "generated pruning documentation must not merge a branch into itself");
  assert(renderedPrune.includes("baseBranch === sourceBranch"), "pruning automation must reject equal base/source branches");
  assert(renderedPrune.includes("DEFAULT_SOURCE_BRANCH") && !renderedPrune.includes("{{SOURCE_BRANCH}}"), "pruning automation must render the configured source branch");

  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    checks: {
      explore_read_only: true,
      fast_bounded: true,
      fast_escalation: true,
      assured_persistence: true,
      emergency_invariants: true,
      conservative_adapter_defaults: true,
      adapter_lane_extension_executable: true,
      prose_without_control_is_informative: true,
      generated_versions_unambiguous: true,
      pruning_relation_executable: true,
    },
    samples: { explore, fast, fast_escalated: fastEscalated, assured, emergency },
    pass: true,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
