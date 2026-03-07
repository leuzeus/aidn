#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    triageFile: ".aidn/runtime/index/repair-layer-triage.json",
    out: ".aidn/runtime/index/repair-layer-triage-summary.md",
    top: 10,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--triage-file") {
      args.triageFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--out") {
      args.out = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--top") {
      const raw = String(argv[i + 1] ?? "").trim();
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--top must be an integer");
      }
      args.top = Number(raw);
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.triageFile || !args.out) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/render-repair-layer-triage-summary.mjs");
  console.log("  node tools/perf/render-repair-layer-triage-summary.mjs --triage-file .aidn/runtime/index/repair-layer-triage.json --out .aidn/runtime/index/repair-layer-triage-summary.md");
}

function readJson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Triage file not found: ${absolute}`);
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON at ${absolute}: ${error.message}`);
  }
}

function renderStep(step) {
  if (!step || typeof step !== "object") {
    return null;
  }
  if (step.kind === "query" && step.command) {
    return `- Query: \`${step.command}\``;
  }
  if (step.kind === "autofix_safe_only" && step.command) {
    return `- Safe autofix: \`${step.command}\``;
  }
  if (step.kind === "resolve" && Array.isArray(step.commands) && step.commands.length > 0) {
    const commands = step.commands
      .slice(0, 3)
      .map((command) => `\`${command.accept}\``)
      .join(", ");
    return `- Resolve candidates: ${commands}`;
  }
  return null;
}

function buildMarkdown(triage, topLimit) {
  const summary = triage?.summary ?? {};
  const items = Array.isArray(triage?.items) ? triage.items.slice(0, topLimit) : [];
  const severityCounts = summary?.severity_counts ?? {};
  const lines = [];
  lines.push("## Repair Layer Triage");
  lines.push("");
  lines.push(`- Open findings: ${summary?.open_findings_count ?? 0}`);
  lines.push(`- Actionable findings: ${summary?.actionable_count ?? 0}`);
  lines.push(`- Severity counts: error=${severityCounts.error ?? 0}, warning=${severityCounts.warning ?? 0}, info=${severityCounts.info ?? 0}`);
  lines.push("");
  if (items.length === 0) {
    lines.push("No open repair findings.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }
  for (const item of items) {
    lines.push(`### ${item.finding_type ?? "UNKNOWN"}${item.entity_id ? ` ${item.entity_id}` : ""}`);
    lines.push("");
    lines.push(`- Severity: ${item.severity ?? "n/a"}`);
    lines.push(`- Confidence: ${item.confidence ?? "n/a"}`);
    if (item.artifact_path) {
      lines.push(`- Artifact: ${item.artifact_path}`);
    }
    if (item.message) {
      lines.push(`- Message: ${item.message}`);
    }
    if (item.suggested_action) {
      lines.push(`- Suggested action: ${item.suggested_action}`);
    }
    if (Array.isArray(item.next_steps) && item.next_steps.length > 0) {
      lines.push("- Next steps:");
      for (const step of item.next_steps) {
        const rendered = renderStep(step);
        if (rendered) {
          lines.push(`  ${rendered}`);
        }
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const triage = readJson(args.triageFile);
    const content = buildMarkdown(triage, args.top);
    const outWrite = writeUtf8IfChanged(args.out, content);
    console.log(`Repair triage summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
