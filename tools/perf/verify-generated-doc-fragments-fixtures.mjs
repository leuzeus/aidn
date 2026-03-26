#!/usr/bin/env node
import path from "node:path";
import { readAidnProjectConfig, resolveConfigIndexStore, resolveConfigStateMode } from "../../src/lib/config/aidn-config-lib.mjs";
import { readWorkflowAdapterConfig } from "../../src/lib/config/workflow-adapter-config-lib.mjs";
import { buildGeneratedDocTemplateVars } from "../../src/application/install/generated-doc-template-vars.mjs";

function main() {
  const repoRoot = process.cwd();
  const targetRoot = path.resolve(repoRoot, "tests", "fixtures", "repo-installed-core");
  const aidnConfig = readAidnProjectConfig(targetRoot);
  const adapterConfig = readWorkflowAdapterConfig(targetRoot, {
    projectName: path.basename(targetRoot),
    preferredStateMode: resolveConfigStateMode(aidnConfig.data),
    defaultIndexStore: resolveConfigIndexStore(aidnConfig.data),
  });

  const enabledAdapter = {
    ...adapterConfig,
    data: {
      ...adapterConfig.data,
      sessionPolicy: {
        transitionCleanliness: {
          enabled: true,
          scope: "session-topology",
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
        escalateOnParallelAttachedCycles: true,
        escalateOnSharedIntegrationSurface: true,
        hardGates: [
          "branch-cycle-mapping",
          "continuity-rule-selection",
        ],
        lightGates: [
          "artifact-depth",
          "validation-breadth",
        ],
        fastPath: {
          enabled: true,
          maxTouchedFiles: 2,
          autoEscalateOnTouchedFileThreshold: true,
          autoEscalateOnRequirementScopeDrift: true,
          forbidApiContractSchemaSecurityChange: true,
          forbidSharedCodegenBoundaryImpact: true,
          requireNoContinuityAmbiguity: true,
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
          escalateOnMultiAgentOverlap: true,
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
        crossUsageConvergence: {
          enabled: true,
          sharedSurfaceKinds: [
            "runtime",
            "hydration",
            "dispatch",
            "codegen",
          ],
          evidenceArtifacts: [
            "plan.md",
            "traceability.md",
            "status.md",
          ],
          sharedSurfaceMinimumUsageClasses: 2,
          highRiskMinimumUsageClasses: 3,
          requireAlternateUsage: true,
          requireContextualUsageForHighRisk: true,
          overfitFixIsBlocking: true,
        },
      },
    },
  };

  const enabledVars = buildGeneratedDocTemplateVars({
    repoRoot,
    templateVars: {},
    aidnConfigData: aidnConfig.data,
    workflowAdapterConfig: enabledAdapter,
  });
  const disabledVars = buildGeneratedDocTemplateVars({
    repoRoot,
    templateVars: {},
    aidnConfigData: aidnConfig.data,
    workflowAdapterConfig: adapterConfig,
  });

  const checks = {
    transition_fragment_rendered: enabledVars.SESSION_TRANSITION_CLEANLINESS_BLOCK.includes("### Session Transition Cleanliness Gate (Mandatory)")
      && enabledVars.SESSION_TRANSITION_CLEANLINESS_BLOCK.includes("`adopt-to-current-session`")
      && !/\{\{[A-Z0-9_]+\}\}/.test(enabledVars.SESSION_TRANSITION_CLEANLINESS_BLOCK),
    execution_fragment_rendered: enabledVars.EXECUTION_POLICY_BLOCK.includes("## Execution Speed Policy (Project Optimization)")
      && enabledVars.EXECUTION_POLICY_BLOCK.includes("touched files exceed threshold")
      && enabledVars.EXECUTION_POLICY_BLOCK.includes("several attached cycles or parallel relays create integration ambiguity")
      && !/\{\{[A-Z0-9_]+\}\}/.test(enabledVars.EXECUTION_POLICY_BLOCK),
    shared_codegen_fragment_rendered: enabledVars.SHARED_CODEGEN_BOUNDARY_BLOCK.includes("## Shared Codegen Boundary Gate (Mandatory, adapter extension to `SPEC-R03`/`SPEC-R04`)")
      && enabledVars.SHARED_CODEGEN_BOUNDARY_BLOCK.includes("shared integration surface")
      && enabledVars.SHARED_CODEGEN_BOUNDARY_BLOCK.includes("impact >= medium and user approval")
      && !/\{\{[A-Z0-9_]+\}\}/.test(enabledVars.SHARED_CODEGEN_BOUNDARY_BLOCK),
    cross_usage_fragment_rendered: enabledVars.CROSS_USAGE_CONVERGENCE_BLOCK.includes("## Cross-Usage Convergence Policy (Project Policy, adapter extension to `SPEC-R04` / `SPEC-R11`)")
      && enabledVars.CROSS_USAGE_CONVERGENCE_BLOCK.includes("shared surface: `2`")
      && enabledVars.CROSS_USAGE_CONVERGENCE_BLOCK.includes("high-risk surface: `3`")
      && enabledVars.CROSS_USAGE_CONVERGENCE_BLOCK.includes("`runtime`")
      && enabledVars.CROSS_USAGE_CONVERGENCE_BLOCK.includes("`traceability.md`")
      && !/\{\{[A-Z0-9_]+\}\}/.test(enabledVars.CROSS_USAGE_CONVERGENCE_BLOCK),
    disabled_fragments_empty: disabledVars.SESSION_TRANSITION_CLEANLINESS_BLOCK === ""
      && disabledVars.EXECUTION_POLICY_BLOCK === ""
      && disabledVars.SHARED_CODEGEN_BOUNDARY_BLOCK === ""
      && disabledVars.CROSS_USAGE_CONVERGENCE_BLOCK === "",
  };

  const pass = Object.values(checks).every((value) => value === true);
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    target_root: targetRoot,
    checks,
    samples: {
      transition_excerpt: enabledVars.SESSION_TRANSITION_CLEANLINESS_BLOCK.split(/\r?\n/).slice(0, 6),
      execution_excerpt: enabledVars.EXECUTION_POLICY_BLOCK.split(/\r?\n/).filter((line) =>
        line.includes("Execution Speed Policy")
        || line.includes("touched files exceed threshold")
        || line.includes("parallel relays")
      ),
      shared_codegen_excerpt: enabledVars.SHARED_CODEGEN_BOUNDARY_BLOCK.split(/\r?\n/).filter((line) =>
        line.includes("Shared Codegen Boundary Gate")
        || line.includes("shared integration surface")
        || line.includes("impact >= medium")
      ),
      cross_usage_excerpt: enabledVars.CROSS_USAGE_CONVERGENCE_BLOCK.split(/\r?\n/).filter((line) =>
        line.includes("Cross-Usage Convergence Policy")
        || line.includes("shared surface:")
        || line.includes("high-risk surface:")
        || line.includes("`runtime`")
      ),
    },
    pass,
  }, null, 2));
  if (!pass) {
    process.exit(1);
  }
}

main();
