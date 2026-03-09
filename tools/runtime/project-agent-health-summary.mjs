#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";
import { verifyAgentRoster } from "./verify-agent-roster.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    rosterFile: "docs/audit/AGENT-ROSTER.md",
    out: "docs/audit/AGENT-HEALTH-SUMMARY.md",
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
  console.log("  node tools/runtime/project-agent-health-summary.mjs --target .");
  console.log("  node tools/runtime/project-agent-health-summary.mjs --target . --json");
}

function buildMarkdown(result) {
  const lines = [];
  lines.push("# Agent Health Summary");
  lines.push("");
  lines.push("Purpose:");
  lines.push("");
  lines.push("- summarize whether each configured adapter is truly usable in the current environment");
  lines.push("- expose the effective roles and actions available through the roster");
  lines.push("- surface degraded or unavailable adapters before dispatch time");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`updated_at: ${new Date().toISOString()}`);
  lines.push(`roster_found: ${result.roster_found ? "yes" : "no"}`);
  lines.push(`default_requested_agent: ${result.default_requested_agent}`);
  lines.push(`pass: ${result.pass ? "yes" : "no"}`);
  lines.push(`issue_count: ${result.issues.length}`);
  lines.push(`warning_count: ${result.warnings.length}`);
  lines.push("");
  lines.push("## Adapter Health");
  lines.push("");
  for (const entry of result.entries) {
    lines.push(`- ${entry.id}: health=${entry.health_status}, enabled=${entry.enabled ? "yes" : "no"}, source=${entry.source}`);
    lines.push(`  reason: ${entry.health_reason}`);
    lines.push(`  environment: ${entry.environment_status}`);
    lines.push(`  environment_reason: ${entry.environment_reason}`);
    lines.push(`  roles: ${(entry.effective_roles.length > 0 ? entry.effective_roles : entry.supported_roles).join(", ") || "none"}`);
    const roleEntries = Object.entries(entry.capabilities_by_role ?? {});
    if (roleEntries.length > 0) {
      for (const [role, actions] of roleEntries) {
        lines.push(`  ${role}: ${(actions ?? []).join(", ") || "none"}`);
      }
    }
    for (const issue of entry.issues) {
      lines.push(`  issue: ${issue}`);
    }
    for (const warning of entry.warnings) {
      lines.push(`  warning: ${warning}`);
    }
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- `ready` means the adapter is enabled and loadable with a roster-compatible role set");
  lines.push("- `disabled` means the adapter is configured but intentionally excluded by the roster");
  lines.push("- `degraded` means the adapter loads but the roster config is inconsistent");
  lines.push("- `unavailable` means the adapter cannot be loaded or cannot pass the environment probe in the current environment");
  lines.push("- `environment` distinguishes loadable adapters from adapters that are actually runnable now");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function projectAgentHealthSummary({
  targetRoot,
  rosterFile = "docs/audit/AGENT-ROSTER.md",
  out = "docs/audit/AGENT-HEALTH-SUMMARY.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const verification = await verifyAgentRoster({
    targetRoot: absoluteTargetRoot,
    rosterFile,
  });
  const outPath = path.resolve(absoluteTargetRoot, out);
  const markdown = buildMarkdown(verification);
  const write = writeUtf8IfChanged(outPath, markdown);
  return {
    target_root: absoluteTargetRoot,
    output_file: write.path,
    written: write.written,
    verification,
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await projectAgentHealthSummary({
      targetRoot: args.target,
      rosterFile: args.rosterFile,
      out: args.out,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Agent health summary: ${result.output_file} (${result.written ? "written" : "unchanged"})`);
      console.log(`- pass=${result.verification.pass ? "yes" : "no"}`);
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
