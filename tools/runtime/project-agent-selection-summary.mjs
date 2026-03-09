#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

function resolveTargetPath(targetRoot, candidate) {
  if (!candidate) {
    return "";
  }
  if (path.isAbsolute(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(targetRoot, candidate);
}

function renderSummary(result, rosterVerification) {
  const lines = [];
  lines.push("# Agent Selection Summary");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
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
  const rosterVerification = await verifyAgentRoster({
    targetRoot: absoluteTargetRoot,
    rosterFile,
  });
  const result = await listAgentAdapters({
    targetRoot: absoluteTargetRoot,
    rosterFile,
  });
  const outputPath = resolveTargetPath(absoluteTargetRoot, out);
  const markdown = renderSummary(result, rosterVerification);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${markdown}\n`, "utf8");
  return {
    target_root: absoluteTargetRoot,
    out_file: outputPath,
    written: true,
    summary: result,
    roster_verification: {
      pass: rosterVerification.pass,
      issues: rosterVerification.issues,
      warnings: rosterVerification.warnings,
    },
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
