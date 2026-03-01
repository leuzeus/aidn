#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeUtf8IfChanged } from "./io-lib.mjs";

function parseArgs(argv) {
  const args = {
    checkFile: ".aidn/runtime/index/index-sync-check.json",
    out: ".aidn/runtime/index/index-sync-summary.md",
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
  console.log("  node tools/perf/render-index-sync-summary.mjs");
  console.log("  node tools/perf/render-index-sync-summary.mjs --check-file .aidn/runtime/index/index-sync-check.json --out .aidn/runtime/index/index-sync-summary.md");
}

function readJson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Check file not found: ${absolute}`);
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    throw new Error(`Invalid JSON in ${absolute}: ${error.message}`);
  }
}

function fmt(value) {
  if (value == null) {
    return "n/a";
  }
  return String(value);
}

function buildMarkdown(payload) {
  const mismatches = Array.isArray(payload?.summary_mismatches) ? payload.summary_mismatches : [];
  const lines = [];
  lines.push("## Index Sync Check");
  lines.push("");
  lines.push(`- In sync: ${payload?.in_sync ? "yes" : "no"}`);
  lines.push(`- Action: ${fmt(payload?.action)}`);
  lines.push(`- Expected digest: ${fmt(payload?.expected?.digest)}`);
  lines.push(`- Current digest: ${fmt(payload?.current?.digest)}`);
  lines.push(`- Structure kind (expected): ${fmt(payload?.expected?.summary?.structure_kind)}`);
  lines.push("");

  if (mismatches.length > 0) {
    lines.push("### Drift Mismatches");
    lines.push("");
    lines.push("| key | expected | current |");
    lines.push("|---|---|---|");
    for (const row of mismatches) {
      lines.push(`| ${fmt(row?.key)} | ${fmt(row?.expected)} | ${fmt(row?.current)} |`);
    }
    lines.push("");
  }

  if (payload?.apply_result?.writes) {
    lines.push("### Apply Result");
    lines.push("");
    lines.push(`- Files written: ${fmt(payload.apply_result.writes.files_written_count)}`);
    lines.push(`- Bytes written: ${fmt(payload.apply_result.writes.bytes_written)}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const check = readJson(args.checkFile);
    const content = buildMarkdown(check.data);
    const outWrite = writeUtf8IfChanged(args.out, content);
    console.log(`Index sync summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
