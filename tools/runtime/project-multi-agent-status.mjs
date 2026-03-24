#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AGENT_ROLES } from "../../src/core/agents/agent-role-model.mjs";
import { assessIntegrationRisk } from "../../src/application/runtime/integration-risk-service.mjs";
import { runDbFirstArtifactUseCase } from "../../src/application/runtime/db-first-artifact-use-case.mjs";
import { resolveStateMode } from "../../src/application/runtime/db-first-artifact-lib.mjs";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";
import { computeCoordinatorNextAction } from "./coordinator-next-action.mjs";
import { projectAgentHealthSummary } from "./project-agent-health-summary.mjs";
import { projectAgentSelectionSummary } from "./project-agent-selection-summary.mjs";
import { projectCoordinationSummary } from "./project-coordination-summary.mjs";
import { suggestCoordinatorArbitration } from "./coordinator-suggest-arbitration.mjs";
import { verifyAgentRoster } from "./verify-agent-roster.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    rosterFile: "docs/audit/AGENT-ROSTER.md",
    coordinationHistoryFile: ".aidn/runtime/context/coordination-history.ndjson",
    out: "docs/audit/MULTI-AGENT-STATUS.md",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--target") {
      args.target = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--roster-file") {
      args.rosterFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--coordination-history-file") {
      args.coordinationHistoryFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--out") {
      args.out = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/project-multi-agent-status.mjs --target .");
  console.log("  node tools/runtime/project-multi-agent-status.mjs --target . --json");
}

function findSelectionPreview(selectionSummary, recommendation) {
  return selectionSummary.summary.auto_selection_preview.find((item) => (
    item.role === recommendation.role
    && item.action === recommendation.action
  )) ?? null;
}

function summarizeAdapterEnvironment(entries = []) {
  const summary = {
    ready: 0,
    degraded: 0,
    unavailable: 0,
    unknown: 0,
  };
  for (const entry of entries) {
    const key = String(entry.environment_status ?? "unknown").trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(summary, key)) {
      summary[key] += 1;
    } else {
      summary.unknown += 1;
    }
  }
  return summary;
}

function buildRoleCoverage(entries = []) {
  const coverage = Object.fromEntries(
    AGENT_ROLES.map((role) => [role, {
      ready: 0,
      degraded: 0,
      unavailable: 0,
      disabled: 0,
      unknown: 0,
    }]),
  );
  for (const entry of entries) {
    const roles = Array.isArray(entry.effective_roles) && entry.effective_roles.length > 0
      ? entry.effective_roles
      : (entry.supported_roles ?? []);
    const healthStatus = String(entry.health_status ?? "unknown").trim().toLowerCase();
    for (const role of roles) {
      if (!coverage[role]) {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(coverage[role], healthStatus)) {
        coverage[role][healthStatus] += 1;
      } else {
        coverage[role].unknown += 1;
      }
    }
  }
  return coverage;
}

function buildRoleCoverageRecommendation(roleCoverage, recommendedRole) {
  const roleSummary = roleCoverage?.[recommendedRole] ?? null;
  if (!roleSummary) {
    return {
      status: "unknown",
      reason: `no coverage summary is available for role ${recommendedRole}`,
    };
  }
  const runnableCount = roleSummary.ready + roleSummary.degraded;
  if (runnableCount > 0) {
    return {
      status: "ok",
      reason: `${runnableCount} runnable adapter(s) remain available for role ${recommendedRole}`,
    };
  }
  if (roleSummary.unavailable > 0) {
    return {
      status: "blocked",
      reason: `no runnable adapter remains for role ${recommendedRole}; fix adapter environment compatibility or roster configuration before dispatch`,
    };
  }
  if (roleSummary.disabled > 0) {
    return {
      status: "blocked",
      reason: `all adapters for role ${recommendedRole} are disabled by roster`,
    };
  }
  return {
    status: "unknown",
    reason: `no adapter is currently exposed for role ${recommendedRole}`,
  };
}

function buildMarkdown({
  coordinator,
  arbitration,
  rosterVerification,
  selectionSummary,
  healthSummary,
  coordinationSummary,
  integrationRisk,
  roleCoverage,
  effectiveRecommendedRoleCoverage,
  out,
}) {
  const selectionPreview = findSelectionPreview(selectionSummary, coordinator.recommendation);
  const environmentSummary = summarizeAdapterEnvironment(healthSummary.verification.entries);
  const environmentBlocked = healthSummary.verification.entries
    .filter((entry) => entry.environment_status === "unavailable");
  const lines = [];
  lines.push("# Multi-Agent Status");
  lines.push("");
  lines.push("Purpose:");
  lines.push("");
  lines.push("- provide one short operational digest for multi-agent routing");
  lines.push("- summarize handoff, roster validity, selection preview, and coordination history");
  lines.push("- reduce the need to open multiple multi-agent artifacts during reload");
  lines.push("");
  lines.push("Rule/State boundary:");
  lines.push("");
  lines.push("- this file is a derived digest");
  lines.push("- canonical workflow rules remain in `SPEC.md` and `WORKFLOW.md`");
  lines.push("- detailed state stays in `HANDOFF-PACKET.md`, `AGENT-ROSTER.md`, `AGENT-SELECTION-SUMMARY.md`, `COORDINATION-SUMMARY.md`, and `USER-ARBITRATION.md`");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`updated_at: ${new Date().toISOString()}`);
  lines.push(`recommended_role: ${coordinator.recommendation.role}`);
  lines.push(`recommended_action: ${coordinator.recommendation.action}`);
  lines.push(`recommended_goal: ${coordinator.recommendation.goal}`);
  lines.push(`recommended_source: ${coordinator.recommendation.source}`);
  lines.push(`recommended_stop_required: ${coordinator.recommendation.stop_required ? "yes" : "no"}`);
  lines.push(`handoff_status: ${coordinator.handoff?.packet?.handoff_status ?? "none"}`);
  lines.push(`handoff_admission_status: ${coordinator.handoff?.admission_status ?? "none"}`);
  lines.push(`repair_layer_status: ${coordinator.handoff?.packet?.repair_layer_status ?? "unknown"}`);
  lines.push(`repair_primary_reason: ${coordinator.handoff?.packet?.repair_primary_reason ?? "unknown"}`);
  lines.push(`roster_verification: ${rosterVerification.pass ? "pass" : "fail"}`);
  lines.push(`roster_issue_count: ${rosterVerification.issues.length}`);
  lines.push(`adapter_health_pass: ${healthSummary.verification.pass ? "yes" : "no"}`);
  lines.push(`environment_ready_count: ${environmentSummary.ready}`);
  lines.push(`environment_degraded_count: ${environmentSummary.degraded}`);
  lines.push(`environment_unavailable_count: ${environmentSummary.unavailable}`);
  lines.push(`recommended_role_coverage_status: ${effectiveRecommendedRoleCoverage.status}`);
  lines.push(`adapter_count: ${selectionSummary.summary.adapters.length}`);
  lines.push(`auto_selected_agent: ${selectionPreview?.selected_agent ?? "unknown"}`);
  lines.push(`coordination_history_status: ${coordinationSummary.summary.history_status}`);
  lines.push(`last_execution_status: ${coordinationSummary.summary.last_execution_status}`);
  lines.push(`integration_strategy: ${integrationRisk.recommended_strategy}`);
  lines.push(`integration_mergeability: ${integrationRisk.mergeability}`);
  lines.push(`integration_candidate_cycle_count: ${integrationRisk.candidate_cycles.length}`);
  lines.push(`arbitration_required: ${arbitration.arbitration_required ? "yes" : "no"}`);
  lines.push(`arbitration_status: ${arbitration.arbitration_status ?? "ok"}`);
  lines.push(`preferred_decision: ${arbitration.preferred_decision}`);
  lines.push("");
  lines.push("## Coordinator Recommendation");
  lines.push("");
  lines.push(`- source: ${coordinator.recommendation.source}`);
  lines.push(`- reason: ${coordinator.recommendation.reason}`);
  lines.push(`- stop_required: ${coordinator.recommendation.stop_required ? "yes" : "no"}`);
  lines.push(`- admission_status: ${coordinator.handoff?.status?.admission_status ?? coordinator.handoff?.admission_status ?? "unknown"}`);
  lines.push(`- repair_primary_reason: ${coordinator.handoff?.packet?.repair_primary_reason ?? "unknown"}`);
  lines.push("");
  lines.push("## Integration Strategy");
  lines.push("");
  lines.push(`- candidate_cycle_count: ${integrationRisk.candidate_cycles.length}`);
  lines.push(`- overlap_level: ${integrationRisk.overlap.overall_overlap}`);
  lines.push(`- semantic_risk: ${integrationRisk.semantic.semantic_risk}`);
  lines.push(`- readiness: ${integrationRisk.readiness}`);
  lines.push(`- mergeability: ${integrationRisk.mergeability}`);
  lines.push(`- recommended_strategy: ${integrationRisk.recommended_strategy}`);
  lines.push(`- arbitration_required: ${integrationRisk.arbitration_required ? "yes" : "no"}`);
  for (const reason of integrationRisk.rationale ?? []) {
    lines.push(`- rationale: ${reason}`);
  }
  lines.push("");
  lines.push("## Arbitration");
  lines.push("");
  lines.push(`- required: ${arbitration.arbitration_required ? "yes" : "no"}`);
  lines.push(`- status: ${arbitration.arbitration_status ?? "ok"}`);
  lines.push(`- reason: ${arbitration.arbitration_reason}`);
  lines.push(`- preferred_decision: ${arbitration.preferred_decision}`);
  if (Array.isArray(arbitration.suggestions) && arbitration.suggestions.length > 0) {
    for (const suggestion of arbitration.suggestions) {
      lines.push(`- suggestion: ${suggestion.decision} recommended=${suggestion.recommended ? "yes" : "no"} actionable=${suggestion.immediately_actionable ? "yes" : "no"}`);
      lines.push(`  rationale: ${suggestion.rationale}`);
    }
  } else {
    lines.push("- suggestion: none");
  }
  lines.push("");
  lines.push("## Roster Verification");
  lines.push("");
  if (rosterVerification.pass) {
    lines.push("- status: pass");
  } else {
    lines.push("- status: fail");
    for (const issue of rosterVerification.issues) {
      lines.push(`- issue: ${issue}`);
    }
  }
  for (const warning of rosterVerification.warnings) {
    lines.push(`- warning: ${warning}`);
  }
  lines.push("");
  lines.push("## Selection Preview");
  lines.push("");
  if (selectionPreview) {
    lines.push(`- selected_agent: ${selectionPreview.selected_agent}`);
    lines.push(`- selection_status: ${selectionPreview.status}`);
    lines.push(`- reason: ${selectionPreview.reason}`);
  } else {
    lines.push("- selected_agent: unknown");
    lines.push("- selection_status: unavailable");
  }
  lines.push("");
  lines.push("## Adapter Health");
  lines.push("");
  for (const entry of healthSummary.verification.entries) {
    lines.push(`- ${entry.id}: ${entry.health_status} (${entry.health_reason})`);
    lines.push(`  environment: ${entry.environment_status} (${entry.environment_reason})`);
  }
  lines.push("");
  lines.push("## Environment Compatibility");
  lines.push("");
  lines.push(`- ready: ${environmentSummary.ready}`);
  lines.push(`- degraded: ${environmentSummary.degraded}`);
  lines.push(`- unavailable: ${environmentSummary.unavailable}`);
  lines.push(`- unknown: ${environmentSummary.unknown}`);
  if (environmentBlocked.length > 0) {
    for (const entry of environmentBlocked) {
      lines.push(`- blocked_adapter: ${entry.id} -> ${entry.environment_reason}`);
    }
  } else {
    lines.push("- blocked_adapter: none");
  }
  lines.push("");
  lines.push("## Role Coverage");
  lines.push("");
  for (const role of AGENT_ROLES) {
    const summary = roleCoverage[role];
    lines.push(`- ${role}: ready=${summary.ready}, degraded=${summary.degraded}, unavailable=${summary.unavailable}, disabled=${summary.disabled}, unknown=${summary.unknown}`);
  }
  lines.push(`- recommendation: ${effectiveRecommendedRoleCoverage.reason}`);
  lines.push("");
  lines.push("## Coordination");
  lines.push("");
  lines.push(`- history_status: ${coordinationSummary.summary.history_status}`);
  lines.push(`- total_dispatches: ${coordinationSummary.summary.total_dispatches}`);
  lines.push(`- arbitration_count: ${coordinationSummary.summary.arbitration_count}`);
  lines.push(`- last_arbitration_decision: ${coordinationSummary.summary.last_arbitration_decision}`);
  lines.push("");
  lines.push("## Priority Reads");
  lines.push("");
  lines.push("- `docs/audit/HANDOFF-PACKET.md`");
  lines.push("- `docs/audit/CURRENT-STATE.md`");
  lines.push("- `docs/audit/RUNTIME-STATE.md`");
  lines.push("- `docs/audit/AGENT-ROSTER.md`");
  lines.push("- `docs/audit/AGENT-HEALTH-SUMMARY.md` when adapter environment compatibility is degraded");
  lines.push("- `docs/audit/AGENT-SELECTION-SUMMARY.md`");
  lines.push("- `docs/audit/COORDINATION-SUMMARY.md`");
  lines.push("- `docs/audit/USER-ARBITRATION.md` when escalation is active");
  lines.push("- `aidn runtime coordinator-suggest-arbitration --target . --json` when arbitration remains required");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- refresh this digest after roster changes, handoff refresh, or active coordination dispatch");
  lines.push("- if `roster_verification` fails, do not trust `auto_selected_agent` until the roster is fixed");
  lines.push("- if `recommended_role_coverage_status` is `blocked`, do not dispatch automatically until adapter availability is restored");
  lines.push(`- generated file: \`${out}\``);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function projectMultiAgentStatus({
  targetRoot,
  rosterFile = "docs/audit/AGENT-ROSTER.md",
  coordinationHistoryFile = ".aidn/runtime/context/coordination-history.ndjson",
  out = "docs/audit/MULTI-AGENT-STATUS.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const effectiveStateMode = resolveStateMode(absoluteTargetRoot, "");
  const coordinator = computeCoordinatorNextAction({
    targetRoot: absoluteTargetRoot,
  });
  const integrationRisk = assessIntegrationRisk({
    targetRoot: absoluteTargetRoot,
  });
  const arbitration = await suggestCoordinatorArbitration({
    targetRoot: absoluteTargetRoot,
    agentRosterFile: rosterFile,
  }).then((result) => ({
    arbitration_status: "ok",
    ...result,
  })).catch((error) => ({
    target_root: absoluteTargetRoot,
    dispatch_status: "error",
    arbitration_status: "error",
    arbitration_required: true,
    arbitration_reason: `arbitration suggestions unavailable: ${error.message}`,
    preferred_decision: "reanchor",
    suggestions: [],
    error_message: error.message,
  }));
  const rosterVerification = await verifyAgentRoster({
    targetRoot: absoluteTargetRoot,
    rosterFile,
  });
  const healthSummary = await projectAgentHealthSummary({
    targetRoot: absoluteTargetRoot,
    rosterFile,
  });
  const roleCoverage = buildRoleCoverage(healthSummary.verification.entries);
  const roleCoverageRecommendation = buildRoleCoverageRecommendation(roleCoverage, coordinator.recommendation.role);
  const effectiveRecommendedRoleCoverage = arbitration?.recommended_role_coverage ?? {
    role: coordinator.recommendation.role,
    status: roleCoverageRecommendation.status,
    reason: roleCoverageRecommendation.reason,
    summary: roleCoverage[coordinator.recommendation.role] ?? null,
  };
  const selectionSummary = await projectAgentSelectionSummary({
    targetRoot: absoluteTargetRoot,
    rosterFile,
  });
  const coordinationSummary = projectCoordinationSummary({
    targetRoot: absoluteTargetRoot,
    historyFile: coordinationHistoryFile,
  });
  const outPath = path.resolve(absoluteTargetRoot, out);
  const markdown = buildMarkdown({
    coordinator,
    arbitration,
    rosterVerification,
    selectionSummary,
    healthSummary,
    coordinationSummary,
    integrationRisk,
    roleCoverage,
    effectiveRecommendedRoleCoverage,
    out,
  });
  const relativeOut = String(out).replace(/\\/g, "/").replace(/^docs\/audit\//i, "");
  const dbFirstWrite = effectiveStateMode === "dual" || effectiveStateMode === "db-only"
    ? runDbFirstArtifactUseCase({
      target: absoluteTargetRoot,
      auditRoot: "docs/audit",
      path: relativeOut,
      content: markdown,
      kind: "other",
      family: "normative",
      subtype: "multi_agent_status",
      stateMode: effectiveStateMode,
    })
    : null;
  const write = effectiveStateMode === "files"
    ? writeUtf8IfChanged(outPath, markdown)
    : {
      path: outPath,
      written: Boolean(dbFirstWrite?.ok),
    };
  return {
    target_root: absoluteTargetRoot,
    output_file: write.path,
    written: write.written,
    state_mode: effectiveStateMode,
    db_first_applied: Boolean(dbFirstWrite),
    db_first_materialized: Boolean(dbFirstWrite?.materialized),
    db_first_artifact_path: dbFirstWrite?.artifact?.path ?? relativeOut,
    coordinator,
    recommendation: coordinator.recommendation,
    handoff_status: coordinator.handoff?.status ?? null,
    integration_risk: integrationRisk,
    arbitration,
    recommended_role_coverage: effectiveRecommendedRoleCoverage,
    roster_verification: {
      pass: rosterVerification.pass,
      issues: rosterVerification.issues,
      warnings: rosterVerification.warnings,
    },
    agent_health_summary: {
      output_file: healthSummary.output_file,
      written: healthSummary.written,
      verification: {
        pass: healthSummary.verification.pass,
        issues: healthSummary.verification.issues,
        warnings: healthSummary.verification.warnings,
        environment_summary: summarizeAdapterEnvironment(healthSummary.verification.entries),
        role_coverage: roleCoverage,
        recommended_role_coverage: effectiveRecommendedRoleCoverage,
      },
    },
    agent_selection_summary: {
      output_file: selectionSummary.out_file,
      written: selectionSummary.written,
    },
    coordination_summary: {
      output_file: coordinationSummary.output_file,
      written: coordinationSummary.written,
      summary: coordinationSummary.summary,
    },
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await projectMultiAgentStatus({
      targetRoot: args.target,
      rosterFile: args.rosterFile,
      coordinationHistoryFile: args.coordinationHistoryFile,
      out: args.out,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Multi-agent status: ${result.output_file} (${result.written ? "written" : "unchanged"})`);
      console.log(`- recommended=${result.coordinator.recommendation.role}+${result.coordinator.recommendation.action}`);
      console.log(`- roster_verification=${result.roster_verification.pass ? "pass" : "fail"}`);
    }
  }).catch((error) => {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
