#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { projectGovernanceDiagnostics } from "../../src/application/runtime/governance-diagnostics-use-case.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
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
  console.log("  aidn runtime governance-diagnostics --target . --json");
}

export function renderGovernanceDiagnosticsText(result) {
  const lines = [];
  lines.push("Governance diagnostics:");
  lines.push(`- ok=${result.ok ? "yes" : "no"}`);
  lines.push(`- project_id=${result.workspace?.project_id || "none"}`);
  lines.push(`- workspace_id=${result.workspace?.workspace_id || "none"}`);
  lines.push(`- governed_concepts=${result.governed_concepts}`);
  lines.push(`- complete=${result.summary?.complete ?? 0}`);
  lines.push(`- partial=${result.summary?.partial ?? 0}`);
  lines.push(`- missing=${result.summary?.missing ?? 0}`);
  lines.push(`- source_of_truth_coverage=${result.operations?.source_of_truth_coverage_status ?? "unknown"}`);
  lines.push(`- metadata_coverage=${result.operations?.metadata_coverage_status ?? "unknown"}`);
  lines.push(`- cli_contract_coverage=${result.operations?.cli_contract_coverage_status ?? "unknown"}`);
  lines.push(`- projection_freshness=${result.operations?.projection_freshness_status ?? "unknown"}`);
  lines.push(`- stale_projection_count=${result.operations?.stale_projection_count ?? 0}`);
  lines.push(`- no_write_coverage=${result.operations?.no_write_coverage_status ?? "unknown"}`);
  lines.push(`- no_write_coverage_count=${result.operations?.no_write_coverage_count ?? 0}`);
  lines.push(`- runtime_surface_coverage=${result.operations?.runtime_surface_coverage_status ?? "unknown"}`);
  lines.push(`- command_coverage=${result.operations?.command_coverage_status ?? "unknown"}`);
  lines.push(`- observed_artifact_coverage=${result.operations?.observed_artifact_coverage_status ?? "unknown"}`);
  lines.push(`- issue_count=${result.operations?.issue_count ?? 0}`);
  lines.push(`- runtime_surfaces=${result.registry?.runtime_surface_count ?? 0}`);
  lines.push(`- observed_artifacts=${result.registry?.observed_artifact_count ?? 0}`);
  if (Array.isArray(result.issues) && result.issues.length > 0) {
    lines.push("- issues:");
    for (const issue of result.issues.slice(0, 10)) {
      lines.push(`  - ${issue}`);
    }
  }
  if (Array.isArray(result.runtime_surfaces) && result.runtime_surfaces.length > 0) {
    lines.push("- runtime_surfaces:");
    for (const surface of result.runtime_surfaces.slice(0, 8)) {
      lines.push(`  - ${surface.id}: ${surface.status} effect=${surface.effect_class} contract=${surface.json_contract_status} linked=${surface.linked_concept_coverage_status}`);
    }
  }
  if (Array.isArray(result.concepts) && result.concepts.length > 0) {
    lines.push("- concepts:");
    for (const concept of result.concepts.slice(0, 14)) {
      lines.push(`  - ${concept.concept}: ${concept.status} coverage=${concept.coverage_kind ?? "covered"} sot=${concept.source_of_truth_status} metadata=${concept.metadata_status} contract=${concept.cli_contract_status ?? "not_applicable"}`);
    }
  }
  if (Array.isArray(result.command_coverage) && result.command_coverage.length > 0) {
    lines.push("- command_coverage:");
    for (const command of result.command_coverage.slice(0, 10)) {
      lines.push(`  - ${command.id}: ${command.linked_concept_coverage_status} linked=${command.linked_concepts.map((item) => `${item.concept}:${item.status}`).join(", ")}`);
    }
  }
  if (Array.isArray(result.observed_artifacts) && result.observed_artifacts.length > 0) {
    lines.push("- observed_artifacts:");
    for (const artifact of result.observed_artifacts) {
      lines.push(`  - ${artifact.id}: exists=${artifact.exists ? "yes" : "no"} metadata=${artifact.metadata?.metadata_status ?? "unknown"} lifecycle=${artifact.lifecycle_status ?? "unknown"} source_of_truth=${artifact.source_of_truth?.source_of_truth_status ?? "unknown"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function projectRuntimeGovernanceDiagnostics({
  targetRoot = ".",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const workspace = resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  return projectGovernanceDiagnostics({
    targetRoot: absoluteTargetRoot,
    workspace,
  });
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = projectRuntimeGovernanceDiagnostics({
      targetRoot: args.target,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      process.stdout.write(renderGovernanceDiagnosticsText(result));
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
