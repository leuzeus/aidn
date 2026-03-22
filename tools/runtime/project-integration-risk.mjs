#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runDbFirstArtifactUseCase } from "../../src/application/runtime/db-first-artifact-use-case.mjs";
import { resolveStateMode } from "../../src/application/runtime/db-first-artifact-lib.mjs";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";
import { assessIntegrationRisk } from "../../src/application/runtime/integration-risk-service.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    sessionsDir: "docs/audit/sessions",
    cyclesDir: "docs/audit/cycles",
    out: "docs/audit/INTEGRATION-RISK.md",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--target") {
      args.target = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--current-state-file") {
      args.currentStateFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--sessions-dir") {
      args.sessionsDir = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--cycles-dir") {
      args.cyclesDir = String(argv[index + 1] ?? "").trim();
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/project-integration-risk.mjs --target .");
  console.log("  node tools/runtime/project-integration-risk.mjs --target . --json");
}

function buildMarkdown(result, out) {
  const lines = [];
  lines.push("# Integration Risk");
  lines.push("");
  lines.push("Purpose:");
  lines.push("");
  lines.push("- assess collision and mergeability risk across cycles attached to the active session");
  lines.push("- recommend an integration strategy before merge-oriented relay decisions");
  lines.push("- keep the decision traceable for later relays and user arbitration");
  lines.push("");
  lines.push("Rule/State boundary:");
  lines.push("");
  lines.push("- this file is a derived digest");
  lines.push("- canonical workflow rules remain in `SPEC.md`, `WORKFLOW.md`, and `AGENTS.md`");
  lines.push("- cycle state remains in cycle `status.md` and related artifacts");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`updated_at: ${new Date().toISOString()}`);
  lines.push(`active_session: ${result.active_session}`);
  lines.push(`active_cycle: ${result.active_cycle}`);
  lines.push(`candidate_cycle_count: ${result.candidate_cycles.length}`);
  lines.push(`overlap_level: ${result.overlap.overall_overlap}`);
  lines.push(`semantic_risk: ${result.semantic.semantic_risk}`);
  lines.push(`integration_readiness: ${result.readiness}`);
  lines.push(`mergeability: ${result.mergeability}`);
  lines.push(`recommended_strategy: ${result.recommended_strategy}`);
  lines.push(`arbitration_required: ${result.arbitration_required ? "yes" : "no"}`);
  lines.push(`missing_context: ${result.missing_context ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Session Topology");
  lines.push("");
  lines.push(`- session_file: ${result.session_file}`);
  lines.push(`- attached_cycles: ${result.topology.attached_cycles.join(", ") || "none"}`);
  lines.push(`- integration_target_cycles: ${result.topology.integration_target_cycles.join(", ") || "none"}`);
  lines.push(`- primary_focus_cycle: ${result.topology.primary_focus_cycle ?? "none"}`);
  lines.push("");
  lines.push("## Candidate Cycles");
  lines.push("");
  for (const cycle of result.candidate_cycles) {
    lines.push(`- ${cycle.cycle_id}: type=${cycle.cycle_type} readiness=${cycle.readiness} outcome=${cycle.outcome} dor_state=${cycle.dor_state}`);
    lines.push(`  status: ${cycle.status_path}`);
    lines.push(`  blockers: ${cycle.blockers.join(" | ") || "none"}`);
    lines.push(`  referenced_paths: ${cycle.referenced_paths.join(", ") || "none"}`);
  }
  lines.push("");
  lines.push("## Pair Assessments");
  lines.push("");
  if (result.overlap.pair_assessments.length === 0) {
    lines.push("- none");
  } else {
    for (const pair of result.overlap.pair_assessments) {
      lines.push(`- ${pair.left_cycle_id} <-> ${pair.right_cycle_id}: overlap=${pair.overlap_level}`);
      lines.push(`  reason: ${pair.reason}`);
      lines.push(`  shared_paths: ${pair.shared_paths.join(", ") || "none"}`);
      lines.push(`  shared_modules: ${pair.shared_modules.join(", ") || "none"}`);
    }
  }
  lines.push("");
  lines.push("## Semantic Risk");
  lines.push("");
  lines.push(`- overall: ${result.semantic.semantic_risk}`);
  for (const reason of result.semantic.reasons ?? []) {
    lines.push(`- reason: ${reason}`);
  }
  lines.push("");
  lines.push("## Recommendation");
  lines.push("");
  lines.push(`- mergeability: ${result.mergeability}`);
  lines.push(`- recommended_strategy: ${result.recommended_strategy}`);
  lines.push(`- arbitration_required: ${result.arbitration_required ? "yes" : "no"}`);
  for (const reason of result.rationale ?? []) {
    lines.push(`- rationale: ${reason}`);
  }
  lines.push("");
  lines.push("## Strategy Hints");
  lines.push("");
  lines.push("- `direct_merge`: normal Git merge/cherry-pick path is acceptable");
  lines.push("- `integration_cycle`: route through a dedicated integration cycle before session integration");
  lines.push("- `report_forward`: do not integrate now; defer explicitly");
  lines.push("- `rework_from_example`: replay intentionally from source material instead of merging mechanically");
  lines.push("- `user_arbitration_required`: stop automatic routing and resolve manually");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- this digest is conservative and should prefer explicit integration handling over false-safe merge recommendations");
  lines.push("- generated file: `" + out + "`");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function projectIntegrationRisk({
  targetRoot,
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  sessionsDir = "docs/audit/sessions",
  cyclesDir = "docs/audit/cycles",
  out = "docs/audit/INTEGRATION-RISK.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const effectiveStateMode = resolveStateMode(absoluteTargetRoot, "");
  const assessment = assessIntegrationRisk({
    targetRoot: absoluteTargetRoot,
    currentStateFile,
    sessionsDir,
    cyclesDir,
  });
  const outputPath = path.resolve(absoluteTargetRoot, out);
  const markdown = buildMarkdown(assessment, out);
  const relativeOut = String(out).replace(/\\/g, "/").replace(/^docs\/audit\//i, "");
  const dbFirstWrite = effectiveStateMode === "dual" || effectiveStateMode === "db-only"
    ? runDbFirstArtifactUseCase({
      target: absoluteTargetRoot,
      auditRoot: "docs/audit",
      path: relativeOut,
      content: markdown,
      kind: "other",
      family: "normative",
      subtype: "integration_risk",
      stateMode: effectiveStateMode,
    })
    : null;
  const write = effectiveStateMode === "files"
    ? writeUtf8IfChanged(outputPath, markdown)
    : {
      path: outputPath,
      written: Boolean(dbFirstWrite?.ok),
    };
  return {
    ...assessment,
    output_file: write.path,
    written: write.written,
    state_mode: effectiveStateMode,
    db_first_applied: Boolean(dbFirstWrite),
    db_first_materialized: Boolean(dbFirstWrite?.materialized),
    db_first_artifact_path: dbFirstWrite?.artifact?.path ?? relativeOut,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = projectIntegrationRisk({
      targetRoot: args.target,
      currentStateFile: args.currentStateFile,
      sessionsDir: args.sessionsDir,
      cyclesDir: args.cyclesDir,
      out: args.out,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Integration risk: ${result.output_file} (${result.written ? "written" : "unchanged"})`);
      console.log(`- strategy=${result.recommended_strategy}`);
      console.log(`- mergeability=${result.mergeability}`);
      console.log(`- overlap=${result.overlap.overall_overlap}`);
      console.log(`- semantic_risk=${result.semantic.semantic_risk}`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
