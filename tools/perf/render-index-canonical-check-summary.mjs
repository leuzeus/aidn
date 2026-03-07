#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    checkFile: ".aidn/runtime/index/index-canonical-check.json",
    out: ".aidn/runtime/index/index-canonical-check-summary.md",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--check-file") {
      args.checkFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.checkFile) {
    throw new Error("Missing value for --check-file");
  }
  if (!args.out) {
    throw new Error("Missing value for --out");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/render-index-canonical-check-summary.mjs");
  console.log("  node tools/perf/render-index-canonical-check-summary.mjs --check-file .aidn/runtime/index/index-canonical-check.json --out .aidn/runtime/index/index-canonical-check-summary.md");
}

function readJson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Canonical check file not found: ${absolute}`);
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    throw new Error(`Canonical check file invalid JSON: ${error.message}`);
  }
}

function fmt(value) {
  return value == null ? "n/a" : String(value);
}

function iconForStatus(status) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "pass") {
    return "PASS";
  }
  if (normalized === "warn") {
    return "WARN";
  }
  if (normalized === "fail") {
    return "FAIL";
  }
  return "N/A";
}

function buildMarkdown(payload) {
  const coverage = payload?.coverage ?? {};
  const summary = payload?.summary ?? {};
  const thresholds = payload?.thresholds ?? {};
  const thresholdSources = thresholds?.sources ?? {};
  const reasonCodes = Array.isArray(payload?.reason_codes) ? payload.reason_codes : [];
  const checks = Array.isArray(payload?.checks) ? payload.checks : [];

  const lines = [];
  lines.push("## Index Canonical Coverage Check");
  lines.push("");
  lines.push(`- Status: ${iconForStatus(summary.overall_status)}`);
  lines.push(`- Coverage markdown: ${fmt(coverage.canonical_coverage_ratio_markdown)} (threshold >= ${fmt(thresholds.min_coverage_markdown)})`);
  lines.push(`- Artifacts with canonical: ${fmt(coverage.artifacts_with_canonical)} (threshold >= ${fmt(thresholds.min_canonical_artifacts)})`);
  lines.push(`- Markdown artifacts: ${fmt(coverage.artifacts_markdown)} (threshold >= ${fmt(thresholds.min_markdown_artifacts)})`);
  lines.push(`- Threshold sources: coverage=${fmt(thresholdSources.min_coverage_markdown)}, canonical=${fmt(thresholdSources.min_canonical_artifacts)}, markdown=${fmt(thresholdSources.min_markdown_artifacts)}`);
  lines.push(`- Target rule warnings: ${reasonCodes.length}`);
  lines.push(`- Blocking checks: ${fmt(summary.blocking)}`);
  lines.push("");

  if (reasonCodes.length > 0) {
    lines.push("### Target Rule Warnings");
    lines.push("");
    for (const code of reasonCodes) {
      lines.push(`- ${code}`);
    }
    lines.push("");
  }

  if (checks.length > 0) {
    lines.push("### Canonical Check Rules");
    lines.push("");
    lines.push("| id | status | severity | actual | op | expected |");
    lines.push("|---|---|---|---:|---|---:|");
    for (const check of checks) {
      lines.push(`| ${check.id ?? "n/a"} | ${check.status ?? "n/a"} | ${check.severity ?? "n/a"} | ${fmt(check.actual)} | ${check.op ?? "n/a"} | ${fmt(check.expected)} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { data } = readJson(args.checkFile);
    const markdown = buildMarkdown(data);
    const outWrite = writeUtf8IfChanged(args.out, markdown);
    console.log(`Index canonical summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
