#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeWorkflowAdapterConfig } from "../../src/lib/config/workflow-adapter-config-lib.mjs";
import { previewWorkflowAdapterMigration } from "../../src/application/project/workflow-adapter-migration-service.mjs";
import { IMPORTED_SECTION_POLICIES } from "../../src/application/project/imported-sections-policy-lib.mjs";

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function main() {
  let tempRoot = "";
  try {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(scriptDir, "..", "..");
    const sourceFixture = path.resolve(repoRoot, "tests", "fixtures", "repo-installed-core");
    const fixtureRoot = path.resolve(repoRoot, "tests", "fixtures", "project-migration-gowire-like");
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-imported-sections-"));
    const migrationTarget = path.join(tempRoot, "repo");
    fs.cpSync(sourceFixture, migrationTarget, { recursive: true });
    fs.writeFileSync(
      path.join(migrationTarget, "docs", "audit", "WORKFLOW.md"),
      readText(path.resolve(fixtureRoot, "WORKFLOW.md")),
      "utf8",
    );
    fs.rmSync(path.join(migrationTarget, ".aidn", "project", "workflow.adapter.legacy-source.md"), { force: true });
    fs.rmSync(path.join(migrationTarget, ".aidn", "project", "workflow.adapter.migration-report.json"), { force: true });

    const legacyWorkflow = readText(path.resolve(fixtureRoot, "WORKFLOW.md"));
    const specText = readText(path.resolve(repoRoot, "docs", "SPEC.md"));
    const projectWorkflowTemplate = readText(path.resolve(repoRoot, "scaffold", "docs_audit", "PROJECT_WORKFLOW.md"));
    const continuityTemplate = readText(path.resolve(repoRoot, "scaffold", "docs_audit", "CONTINUITY_GATE.md"));
    const incidentTemplate = readText(path.resolve(repoRoot, "scaffold", "docs_audit", "incidents", "TEMPLATE_INC_TMP.md"));

    const migrationPreview = previewWorkflowAdapterMigration({
      repoRoot,
      targetRoot: migrationTarget,
      version: "0.4.0",
    });

    const normalizedConfig = normalizeWorkflowAdapterConfig({
      projectName: "fixture-project",
      sessionPolicy: {
        transitionCleanliness: {
          enabled: "true",
          requiredDecisionOptions: [
            "adopt-to-current-session",
            "archive-non-retained",
            "drop-with-rationale",
          ],
        },
      },
      executionPolicy: {
        enabled: true,
        evaluationScope: "dispatch-or-local-scope",
        escalateOnParallelAttachedCycles: "yes",
        escalateOnSharedIntegrationSurface: "1",
        hardGates: [
          "branch-cycle-mapping",
          "continuity-rule-selection",
        ],
        lightGates: [
          "artifact-depth",
          "validation-breadth",
        ],
        fastPath: {
          enabled: "true",
          maxTouchedFiles: 2,
          autoEscalateOnTouchedFileThreshold: "true",
          autoEscalateOnRequirementScopeDrift: "true",
          forbidApiContractSchemaSecurityChange: "true",
          forbidSharedCodegenBoundaryImpact: "true",
          requireNoContinuityAmbiguity: "true",
        },
        validationProfiles: {
          low: "targeted tests",
          medium: "cross-package checks",
          high: "full validation stack",
        },
      },
      specializedGates: {
        sharedCodegenBoundary: {
          enabled: true,
          sharedIntegrationSurface: true,
          escalateOnMultiAgentOverlap: "true",
          generatorPaths: [
            "internal/builder/engines/components.go",
            "internal/components/manifest.json",
            "web/ce/elements.js",
          ],
          requiredEvidence: [
            "decisions.md",
            "traceability.md",
          ],
          forbidComponentSpecificGeneratorFixes: true,
        },
      },
    });

    const policyHeadings = IMPORTED_SECTION_POLICIES.map((item) => item.heading);
    const previewHeadings = migrationPreview.importedSectionDecisions.map((item) => item.heading);
    const classifications = new Set(IMPORTED_SECTION_POLICIES.map((item) => item.classification));
    const scopes = new Set(IMPORTED_SECTION_POLICIES.map((item) => item.multiAgentScope));
    const nativeHeadings = migrationPreview.importedSectionDecisions
      .filter((item) => item.classification === "native-core")
      .map((item) => item.heading);
    const structuredHeadings = migrationPreview.importedSectionDecisions
      .filter((item) => item.classification === "adapter-structured")
      .map((item) => item.heading);

    const checks = {
      legacy_fixture_contains_all_policy_headings: policyHeadings.every((heading) => legacyWorkflow.includes(heading)),
      migration_preview_covers_all_policy_headings: policyHeadings.every((heading) => previewHeadings.includes(heading)),
      migration_preview_policy_count_matches_fixture_targets: previewHeadings.length === policyHeadings.length,
      policy_classifications_limited_to_expected_values: Array.from(classifications).every((item) => [
        "native-core",
        "adapter-structured",
        "keep-temporary",
      ].includes(item)),
      policy_scopes_limited_to_expected_values: Array.from(scopes).every((item) => [
        "session-topology",
        "dispatch-scope",
        "shared-integration-surface",
      ].includes(item)),
      native_core_headings_match_expected_groups: [
        "Incident Trigger Conditions",
        "Noise Control (Anti-Noise)",
        "Temporary Incident Tracking File",
        "Authorization Gate (Mandatory for L3/L4)",
        "Workflow Self-Improvement Scope",
        "Resume and Cleanup",
        "Rule Set (choose exactly one)",
        "Mode mapping",
        "Interactive Stop Prompt (selection list)",
      ].every((heading) => nativeHeadings.includes(heading)),
      adapter_structured_headings_match_expected_groups: [
        "Session Transition Cleanliness Gate (Mandatory)",
        "Execution Speed Policy (Project Optimization)",
        "1) Gate classes: Hard vs Light",
        "2) Fast Path for micro-changes",
        "3) Risk-based validation profile",
        "Shared Codegen Boundary Gate (Mandatory, adapter extension to `SPEC-R03`/`SPEC-R04`)",
      ].every((heading) => structuredHeadings.includes(heading)),
      incident_spec_has_severity_model: [
        "Workflow Incident Management",
        "L1_LOW",
        "L2_MEDIUM",
        "L3_HIGH",
        "L4_CRITICAL",
        "resume the interrupted workflow from recorded checkpoint",
      ].every((snippet) => specText.includes(snippet)),
      incident_project_template_has_noise_and_defer_policy: [
        "trivial one-shot `L1` issues should stay out of temporary incident tracking unless they repeat or widen in scope",
        "`L2+` incidents should keep explicit temporary tracking until resolution or defer decision",
        "open a follow-up cycle or task before the next session start",
      ].every((snippet) => projectWorkflowTemplate.includes(snippet)),
      incident_template_has_authorization_and_resume_fields: [
        "authorize-now",
        "defer-with-risk",
        "abort-current-flow",
        "resume_from_step",
      ].every((snippet) => incidentTemplate.includes(snippet)),
      continuity_spec_has_r1_r2_r3: [
        "R1_STRICT_CHAIN",
        "R2_SESSION_BASE_WITH_IMPORT",
        "R3_EXCEPTION_OVERRIDE",
      ].every((snippet) => specText.includes(snippet)),
      continuity_template_has_mode_policy_and_prompt: [
        "## Mode policy",
        "## Selectable prompt template",
        "R1_STRICT_CHAIN (Recommended)",
        "R2_SESSION_BASE_WITH_IMPORT",
        "R3_EXCEPTION_OVERRIDE",
      ].every((snippet) => continuityTemplate.includes(snippet)),
      normalized_transition_cleanliness_enabled: normalizedConfig.sessionPolicy.transitionCleanliness.enabled === true,
      normalized_transition_cleanliness_scope_defaulted: normalizedConfig.sessionPolicy.transitionCleanliness.scope === "session-topology",
      normalized_transition_cleanliness_options_kept: normalizedConfig.sessionPolicy.transitionCleanliness.requiredDecisionOptions.length === 3,
      normalized_execution_policy_enabled: normalizedConfig.executionPolicy.enabled === true,
      normalized_execution_policy_scope_kept: normalizedConfig.executionPolicy.evaluationScope === "dispatch-or-local-scope",
      normalized_execution_policy_escalation_flags: normalizedConfig.executionPolicy.escalateOnParallelAttachedCycles === true
        && normalizedConfig.executionPolicy.escalateOnSharedIntegrationSurface === true,
      normalized_execution_fast_path: normalizedConfig.executionPolicy.fastPath.enabled === true
        && normalizedConfig.executionPolicy.fastPath.maxTouchedFiles === 2
        && normalizedConfig.executionPolicy.fastPath.autoEscalateOnTouchedFileThreshold === true
        && normalizedConfig.executionPolicy.fastPath.autoEscalateOnRequirementScopeDrift === true
        && normalizedConfig.executionPolicy.fastPath.forbidApiContractSchemaSecurityChange === true
        && normalizedConfig.executionPolicy.fastPath.forbidSharedCodegenBoundaryImpact === true
        && normalizedConfig.executionPolicy.fastPath.requireNoContinuityAmbiguity === true,
      normalized_execution_validation_profiles: normalizedConfig.executionPolicy.validationProfiles.low === "targeted tests"
        && normalizedConfig.executionPolicy.validationProfiles.medium === "cross-package checks"
        && normalizedConfig.executionPolicy.validationProfiles.high === "full validation stack",
      normalized_shared_codegen_boundary: normalizedConfig.specializedGates.sharedCodegenBoundary.enabled === true
        && normalizedConfig.specializedGates.sharedCodegenBoundary.sharedIntegrationSurface === true
        && normalizedConfig.specializedGates.sharedCodegenBoundary.escalateOnMultiAgentOverlap === true
        && normalizedConfig.specializedGates.sharedCodegenBoundary.generatorPaths.length === 3
        && normalizedConfig.specializedGates.sharedCodegenBoundary.requiredEvidence.length === 2
        && normalizedConfig.specializedGates.sharedCodegenBoundary.forbidComponentSpecificGeneratorFixes === true,
    };

    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      fixture_root: fixtureRoot,
      checks,
      sample: {
        imported_section_decisions: migrationPreview.importedSectionDecisions,
        normalized_config_excerpt: {
          sessionPolicy: normalizedConfig.sessionPolicy,
          executionPolicy: normalizedConfig.executionPolicy,
          specializedGates: normalizedConfig.specializedGates,
        },
      },
      pass,
    };

    console.log(JSON.stringify(output, null, 2));
    if (!pass) {
      process.exit(1);
    }
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
