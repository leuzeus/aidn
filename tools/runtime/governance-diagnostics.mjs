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
  lines.push(`- issue_count=${result.operations?.issue_count ?? 0}`);
  if (Array.isArray(result.issues) && result.issues.length > 0) {
    lines.push("- issues:");
    for (const issue of result.issues.slice(0, 10)) {
      lines.push(`  - ${issue}`);
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
