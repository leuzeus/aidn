#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    reportFile: ".aidn/runtime/index/index-report.json",
    thresholdsFile: ".aidn/runtime/index/index-thresholds.json",
    regressionFile: "",
    canonicalCheckFile: "",
    out: ".aidn/runtime/index/index-summary.md",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--report-file") {
      args.reportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--thresholds-file") {
      args.thresholdsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--regression-file") {
      args.regressionFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--canonical-check-file") {
      args.canonicalCheckFile = argv[i + 1] ?? "";
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

  if (!args.reportFile) {
    throw new Error("Missing value for --report-file");
  }
  if (!args.out) {
    throw new Error("Missing value for --out");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/render-index-summary.mjs");
  console.log("  node tools/perf/render-index-summary.mjs --report-file .aidn/runtime/index/index-report.json --out .aidn/runtime/index/index-summary.md");
  console.log("  node tools/perf/render-index-summary.mjs --report-file .aidn/runtime/index/index-report.json --thresholds-file .aidn/runtime/index/index-thresholds.json --regression-file .aidn/runtime/index/index-regression.json --canonical-check-file .aidn/runtime/index/index-canonical-check.json --out .aidn/runtime/index/index-summary.md");
}

function readJson(filePath, label, required = true) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    if (!required) {
      return { absolute, data: null, exists: false };
    }
    throw new Error(`${label} not found: ${absolute}`);
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")), exists: true };
  } catch (error) {
    throw new Error(`${label} invalid JSON: ${error.message}`);
  }
}

function fmt(value) {
  return value == null ? "n/a" : String(value);
}

function buildMarkdown(report, thresholds, regression, canonicalCheck) {
  const rows = report?.summary?.rows ?? {};
  const consistency = report?.summary?.consistency ?? {};
  const parity = report?.summary?.parity ?? {};
  const paritySql = report?.summary?.parity_sql ?? {};
  const paritySqlite = report?.summary?.parity_sqlite ?? {};
  const runMetrics = report?.summary?.run_metrics ?? {};
  const projection = report?.summary?.projection ?? {};
  const structure = report?.summary?.structure ?? {};
  const thresholdStatus = thresholds?.summary?.overall_status ?? "not-generated";
  const checks = Array.isArray(thresholds?.checks) ? thresholds.checks : [];
  const regressionStatus = regression?.summary?.overall_status ?? "not-generated";
  const regressionChecks = Array.isArray(regression?.checks) ? regression.checks : [];
  const canonicalStatus = canonicalCheck?.summary?.overall_status ?? "not-generated";
  const canonicalCoverage = canonicalCheck?.coverage?.canonical_coverage_ratio_markdown ?? null;
  const canonicalChecks = Array.isArray(canonicalCheck?.checks) ? canonicalCheck.checks : [];

  const lines = [];
  lines.push("## Index Quality Summary");
  lines.push("");
  lines.push(`- Schema version: ${fmt(report?.summary?.schema_version)}`);
  lines.push(`- Rows: cycles=${fmt(rows.cycles)}, artifacts=${fmt(rows.artifacts)}, file_map=${fmt(rows.file_map)}, tags=${fmt(rows.tags)}, run_metrics=${fmt(rows.run_metrics)}`);
  lines.push(`- Count consistency: ${consistency.all_count_match === 1 ? "pass" : "fail"}`);
  lines.push(`- Parity status: ${fmt(parity.status)}`);
  lines.push(`- Parity SQL status: ${fmt(paritySql.status)}`);
  lines.push(`- Parity SQLite status: ${fmt(paritySqlite.status)}`);
  lines.push(`- Projection canonical coverage (all): ${fmt(projection.canonical_coverage_ratio)}`);
  lines.push(`- Projection canonical coverage (markdown): ${fmt(projection.canonical_coverage_ratio_markdown)}`);
  lines.push(`- Projection rows: with_content=${fmt(projection.artifacts_with_content)}, with_canonical=${fmt(projection.artifacts_with_canonical)}, markdown=${fmt(projection.artifacts_markdown)}, markdown_with_canonical=${fmt(projection.artifacts_markdown_with_canonical)}`);
  lines.push(`- Structure profile: ${fmt(structure.kind)}`);
  lines.push(`- Declared workflow version: ${fmt(structure.declared_workflow_version)}`);
  lines.push(`- Declared version stale vs structure: ${structure.declared_version_looks_stale === 1 ? "yes" : "no"}`);
  lines.push(`- Run metrics present: ${runMetrics.present === 1 ? "yes" : "no"}`);
  lines.push(`- Threshold status: ${thresholdStatus}`);
  lines.push(`- Canonical check status: ${canonicalStatus}`);
  lines.push(`- Canonical check markdown coverage: ${fmt(canonicalCoverage)}`);
  lines.push(`- Regression status: ${regressionStatus}`);
  lines.push("");

  if (checks.length > 0) {
    lines.push("### Index Threshold Checks");
    lines.push("");
    lines.push("| id | status | severity | actual | op | expected |");
    lines.push("|---|---|---|---:|---|---:|");
    for (const check of checks) {
      lines.push(`| ${check.id ?? "n/a"} | ${check.status ?? "n/a"} | ${check.severity ?? "n/a"} | ${fmt(check.actual)} | ${check.op ?? "n/a"} | ${fmt(check.expected)} |`);
    }
    lines.push("");
  }

  if (regressionChecks.length > 0) {
    lines.push("### Index Regression Checks");
    lines.push("");
    lines.push("| id | status | severity | metric | latest | baseline | increase_pct | max |");
    lines.push("|---|---|---|---|---:|---:|---:|---:|");
    for (const check of regressionChecks) {
      lines.push(`| ${check.id ?? "n/a"} | ${check.status ?? "n/a"} | ${check.severity ?? "n/a"} | ${check.metric ?? "n/a"} | ${fmt(check.latest_value)} | ${fmt(check.baseline_median)} | ${fmt(check.increase_pct)} | ${fmt(check.max_increase_pct)} |`);
    }
    lines.push("");
  }

  if (canonicalChecks.length > 0) {
    lines.push("### Canonical Coverage Checks");
    lines.push("");
    lines.push("| id | status | severity | actual | op | expected |");
    lines.push("|---|---|---|---:|---|---:|");
    for (const check of canonicalChecks) {
      lines.push(`| ${check.id ?? "n/a"} | ${check.status ?? "n/a"} | ${check.severity ?? "n/a"} | ${fmt(check.actual)} | ${check.op ?? "n/a"} | ${fmt(check.expected)} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function writeFile(filePath, content) {
  return writeUtf8IfChanged(filePath, content);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = readJson(args.reportFile, "Index report", true);
    const thresholds = readJson(args.thresholdsFile, "Index thresholds", false);
    const regression = args.regressionFile
      ? readJson(args.regressionFile, "Index regression", false)
      : { absolute: null, data: null, exists: false };
    const canonicalCheck = args.canonicalCheckFile
      ? readJson(args.canonicalCheckFile, "Index canonical check", false)
      : { absolute: null, data: null, exists: false };
    const markdown = buildMarkdown(report.data, thresholds.data, regression.data, canonicalCheck.data);
    const outWrite = writeFile(args.out, markdown);
    console.log(`Index summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
