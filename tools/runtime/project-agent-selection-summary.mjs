#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { deriveGovernedRuntimeArtifactMetadata } from "../../src/application/runtime/governed-runtime-artifact-metadata-lib.mjs";
import { runDbFirstArtifactUseCase } from "../../src/application/runtime/db-first-artifact-use-case.mjs";
import { resolveStateMode } from "../../src/application/runtime/db-first-artifact-lib.mjs";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";
import { listAgentAdapters } from "./list-agent-adapters.mjs";
import { verifyAgentRoster } from "./verify-agent-roster.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    rosterFile: "docs/audit/AGENT-ROSTER.md",
    out: "docs/audit/AGENT-SELECTION-SUMMARY.md",
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
  console.log("  node tools/runtime/project-agent-selection-summary.mjs --target .");
  console.log("  node tools/runtime/project-agent-selection-summary.mjs --target . --json");
}

function deriveAgentSelectionSummaryDiagnostic(result) {
  return {
    scope: "project-agent-selection-summary",
    state_mode: String(result?.state_mode ?? "unknown").trim() || "unknown",
    roster_pass: result?.roster_verification?.pass === true,
    adapter_count: Array.isArray(result?.summary?.adapters) ? result.summary.adapters.length : 0,
    preview_count: Array.isArray(result?.summary?.auto_selection_preview) ? result.summary.auto_selection_preview.length : 0,
    written: result?.written === true,
    summary: `agent selection summary roster verification is ${result?.roster_verification?.pass === true ? "pass" : "fail"}`,
    recommended_command: "aidn runtime list-agent-adapters --json",
  };
}

function resolveTargetPath(targetRoot, candidate) {
  if (!candidate) {
    return "";
  }
  if (path.isAbsolute(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(targetRoot, candidate);
}

function renderSummary(result, rosterVerification, governanceMetadata) {
  const lines = [];
  lines.push("# Agent Selection Summary");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`source_of_truth: ${governanceMetadata.source_of_truth}`);
  lines.push(`source_mode: ${governanceMetadata.source_mode}`);
  lines.push(`lifecycle_status: ${governanceMetadata.lifecycle_status}`);
  lines.push(`owner: ${governanceMetadata.owner}`);
  lines.push(`steward: ${governanceMetadata.steward}`);
  lines.push(`updated_at: ${new Date().toISOString()}`);
  lines.push(`roster_found: ${result.roster.found ? "yes" : "no"}`);
  lines.push(`default_requested_agent: ${result.roster.default_requested_agent}`);
  lines.push(`registered_adapter_count: ${result.roster.registered_ids.length}`);
  lines.push(`adapter_count: ${result.adapters.length}`);
  lines.push(`roster_verification: ${rosterVerification.pass ? "pass" : "fail"}`);
  lines.push(`roster_issue_count: ${rosterVerification.issues.length}`);
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
  if (rosterVerification.warnings.length > 0) {
    for (const warning of rosterVerification.warnings) {
      lines.push(`- warning: ${warning}`);
    }
  }
  lines.push("");
  lines.push("## Installed Adapters");
  lines.push("");
  for (const adapter of result.adapters) {
    lines.push(`- ${adapter.id}: source=${adapter.source}, enabled=${adapter.enabled ? "yes" : "no"}, health=${adapter.health_status}, priority=${adapter.priority}, roles=${adapter.supported_roles.join(", ")}`);
  }
  lines.push("");
  lines.push("## Auto Selection Preview");
  lines.push("");
  for (const scenario of result.auto_selection_preview) {
    lines.push(`- ${scenario.role} + ${scenario.action}: ${scenario.selected_agent} (${scenario.status})`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Use `aidn runtime list-agent-adapters --target . --json` for the full machine-readable view.");
  lines.push("- Use `aidn runtime coordinator-select-agent --target . --role <role> --action <action> --json` to diagnose one relay.");
  lines.push("");
  return `${lines.join("\n")}`;
}

export async function projectAgentSelectionSummary({
  targetRoot,
  rosterFile = "docs/audit/AGENT-ROSTER.md",
  out = "docs/audit/AGENT-SELECTION-SUMMARY.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const effectiveStateMode = resolveStateMode(absoluteTargetRoot, "");
  const governanceMetadata = deriveGovernedRuntimeArtifactMetadata({
    runtimeStateMode: effectiveStateMode,
    owner: "aidn-runtime",
    steward: "aidn-runtime",
  });
  const rosterVerification = await verifyAgentRoster({
    targetRoot: absoluteTargetRoot,
    rosterFile,
  });
  const result = await listAgentAdapters({
    targetRoot: absoluteTargetRoot,
    rosterFile,
  });
  const outputPath = resolveTargetPath(absoluteTargetRoot, out);
  const markdown = renderSummary(result, rosterVerification, governanceMetadata);
  const renderedMarkdown = `${markdown}\n`;
  const relativeOut = String(out).replace(/\\/g, "/").replace(/^docs\/audit\//i, "");
  const dbFirstWrite = effectiveStateMode === "dual" || effectiveStateMode === "db-only"
    ? runDbFirstArtifactUseCase({
      target: absoluteTargetRoot,
      auditRoot: "docs/audit",
      path: relativeOut,
      content: renderedMarkdown,
      kind: "other",
      family: "normative",
      subtype: "agent_selection_summary",
      stateMode: effectiveStateMode,
    })
    : null;
  const write = effectiveStateMode === "files"
    ? writeUtf8IfChanged(outputPath, renderedMarkdown)
    : {
      path: outputPath,
      written: Boolean(dbFirstWrite?.ok),
    };
  return {
    target_root: absoluteTargetRoot,
    out_file: write.path,
    written: write.written,
    state_mode: effectiveStateMode,
    db_first_applied: Boolean(dbFirstWrite),
    db_first_materialized: Boolean(dbFirstWrite?.materialized),
    db_first_artifact_path: dbFirstWrite?.artifact?.path ?? relativeOut,
    governance_metadata: governanceMetadata,
    summary: result,
    roster_verification: {
      pass: rosterVerification.pass,
      issues: rosterVerification.issues,
      warnings: rosterVerification.warnings,
    },
    agent_selection_diagnostic: deriveAgentSelectionSummaryDiagnostic({
      target_root: absoluteTargetRoot,
      out_file: write.path,
      written: write.written,
      state_mode: effectiveStateMode,
      summary: result,
      roster_verification: {
        pass: rosterVerification.pass,
        issues: rosterVerification.issues,
        warnings: rosterVerification.warnings,
      },
    }),
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await projectAgentSelectionSummary({
      targetRoot: args.target,
      rosterFile: args.rosterFile,
      out: args.out,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Agent selection summary: ${result.out_file}`);
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
