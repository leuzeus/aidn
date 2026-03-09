#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { isJsonEquivalent, writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    indexReportFile: ".aidn/runtime/index/index-report.json",
    out: ".aidn/runtime/index/index-regression-kpi.json",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--index-report-file") {
      args.indexReportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
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

  if (!args.indexReportFile) {
    throw new Error("Missing value for --index-report-file");
  }
  if (!args.out) {
    throw new Error("Missing value for --out");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/report-index-regression-kpi.mjs");
  console.log("  node tools/perf/report-index-regression-kpi.mjs --index-report-file .aidn/runtime/index/index-report.json --out .aidn/runtime/index/index-regression-kpi.json");
}

function readJson(filePath, label) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`${label} not found: ${absolute}`);
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    throw new Error(`${label} invalid JSON: ${error.message}`);
  }
}

function toNumberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildRun(report) {
  const ts = String(report?.ts ?? new Date().toISOString());
  const projection = report?.summary?.projection ?? {};
  const rows = report?.summary?.rows ?? {};
  const canonicalCoverage = toNumberOrZero(projection.canonical_coverage_ratio);
  const canonicalCoverageMarkdown = toNumberOrZero(projection.canonical_coverage_ratio_markdown);
  const artifactsWithCanonical = toNumberOrZero(projection.artifacts_with_canonical);
  const artifactsWithCanonicalMarkdown = toNumberOrZero(projection.artifacts_markdown_with_canonical);
  const artifactsTotal = toNumberOrZero(rows.artifacts);
  const artifactsMarkdown = toNumberOrZero(projection.artifacts_markdown);
  const artifactsWithoutCanonical = Math.max(0, artifactsTotal - artifactsWithCanonical);
  const artifactsWithoutCanonicalMarkdown = Math.max(0, artifactsMarkdown - artifactsWithCanonicalMarkdown);
  const runId = `index-${ts}`;

  return {
    run_id: runId,
    started_at: ts,
    ended_at: ts,
    canonical_coverage_ratio: canonicalCoverage,
    canonical_coverage_ratio_markdown: canonicalCoverageMarkdown,
    canonical_gap_all: Number((1 - canonicalCoverage).toFixed(6)),
    canonical_gap_markdown: Number((1 - canonicalCoverageMarkdown).toFixed(6)),
    artifacts_total: artifactsTotal,
    artifacts_markdown: artifactsMarkdown,
    artifacts_with_canonical: artifactsWithCanonical,
    artifacts_markdown_with_canonical: artifactsWithCanonicalMarkdown,
    artifacts_without_canonical: artifactsWithoutCanonical,
    artifacts_without_canonical_markdown: artifactsWithoutCanonicalMarkdown,
  };
}

function writeJson(filePath, payload) {
  return writeJsonIfChanged(filePath, payload, {
    isEquivalent(previousContent) {
      return isJsonEquivalent(previousContent, payload, ["ts"]);
    },
  });
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = readJson(args.indexReportFile, "Index report");
    const run = buildRun(report.data);

    const payload = {
      ts: new Date().toISOString(),
      source_index_report_file: report.absolute,
      summary: {
        runs: 1,
        canonical_coverage_ratio: run.canonical_coverage_ratio,
        canonical_coverage_ratio_markdown: run.canonical_coverage_ratio_markdown,
        canonical_gap_all: run.canonical_gap_all,
        canonical_gap_markdown: run.canonical_gap_markdown,
      },
      runs: [run],
    };
    const outWrite = writeJson(args.out, payload);
    payload.output_file = outWrite.path;
    payload.output_written = outWrite.written;

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Index regression KPI file: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
    console.log(`Run id: ${run.run_id}`);
    console.log(`canonical_coverage_ratio_markdown=${run.canonical_coverage_ratio_markdown}`);
    console.log(`canonical_gap_markdown=${run.canonical_gap_markdown}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
