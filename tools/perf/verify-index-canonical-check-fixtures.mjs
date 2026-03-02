#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    sqliteFile: ".aidn/runtime/index/fixtures/canonical-check/workflow-index.sqlite",
    reportFile: ".aidn/runtime/index/fixtures/canonical-check/index-canonical-check.json",
    summaryFile: ".aidn/runtime/index/fixtures/canonical-check/index-canonical-check-summary.md",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--report-file") {
      args.reportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--summary-file") {
      args.summaryFile = argv[i + 1] ?? "";
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-index-canonical-check-fixtures.mjs");
  console.log("  node tools/perf/verify-index-canonical-check-fixtures.mjs --target tests/fixtures/repo-installed-core");
}

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function runNoJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveTargetPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const sqliteFile = resolveTargetPath(targetRoot, args.sqliteFile);
    const reportFile = resolveTargetPath(targetRoot, args.reportFile);
    const summaryFile = resolveTargetPath(targetRoot, args.summaryFile);

    runNoJson("tools/perf/index-sync.mjs", [
      "--target",
      targetRoot,
      "--store",
      "sqlite",
      "--no-content",
      "--sqlite-output",
      sqliteFile,
    ]);

    const check = runJson("tools/perf/check-index-canonical-coverage.mjs", [
      "--index-file",
      sqliteFile,
      "--backend",
      "sqlite",
      "--targets",
      "docs/performance/INDEX_TARGETS.json",
      "--out",
      reportFile,
      "--json",
    ]);

    const strictPass = runJson("tools/perf/check-index-canonical-coverage.mjs", [
      "--index-file",
      sqliteFile,
      "--backend",
      "sqlite",
      "--targets",
      "docs/performance/INDEX_TARGETS.json",
      "--out",
      reportFile,
      "--strict",
      "--json",
    ]);

    let strictFailureDetected = false;
    try {
      runNoJson("tools/perf/check-index-canonical-coverage.mjs", [
        "--index-file",
        sqliteFile,
        "--backend",
        "sqlite",
        "--min-coverage-markdown",
        "1.1",
        "--out",
        reportFile,
        "--strict",
      ]);
    } catch {
      strictFailureDetected = true;
    }

    runNoJson("tools/perf/render-index-canonical-check-summary.mjs", [
      "--check-file",
      reportFile,
      "--out",
      summaryFile,
    ]);
    const summaryText = fs.existsSync(summaryFile)
      ? fs.readFileSync(summaryFile, "utf8")
      : "";

    const pass = check?.summary?.overall_status === "pass"
      && strictPass?.summary?.overall_status === "pass"
      && strictFailureDetected
      && fs.existsSync(summaryFile)
      && summaryText.includes("## Index Canonical Coverage Check")
      && summaryText.includes("- Status: PASS")
      && summaryText.includes("- Coverage markdown:")
      && String(check?.targets_file ?? "").replace(/\\/g, "/").toLowerCase().endsWith("docs/performance/index_targets.json")
      && Number(check?.thresholds?.min_coverage_markdown ?? -1) === 0.8
      && Number(check?.thresholds?.min_canonical_artifacts ?? -1) === 1
      && Number(check?.thresholds?.min_markdown_artifacts ?? -1) === 1
      && String(check?.thresholds?.sources?.min_coverage_markdown ?? "") === "targets"
      && String(check?.thresholds?.sources?.min_canonical_artifacts ?? "") === "targets"
      && String(check?.thresholds?.sources?.min_markdown_artifacts ?? "") === "targets"
      && Array.isArray(check?.reason_codes)
      && check.reason_codes.length === 0;

    const payload = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      sqlite_file: sqliteFile,
      report_file: reportFile,
      summary_file: summaryFile,
      checks: {
        non_strict_status: check?.summary?.overall_status ?? null,
        strict_status: strictPass?.summary?.overall_status ?? null,
        strict_failure_detected: strictFailureDetected,
        targets_file: check?.targets_file ?? null,
        min_coverage_markdown: Number(check?.thresholds?.min_coverage_markdown ?? -1),
        min_canonical_artifacts: Number(check?.thresholds?.min_canonical_artifacts ?? -1),
        min_markdown_artifacts: Number(check?.thresholds?.min_markdown_artifacts ?? -1),
        min_coverage_markdown_source: String(check?.thresholds?.sources?.min_coverage_markdown ?? ""),
        min_canonical_artifacts_source: String(check?.thresholds?.sources?.min_canonical_artifacts ?? ""),
        min_markdown_artifacts_source: String(check?.thresholds?.sources?.min_markdown_artifacts ?? ""),
        reason_codes_count: Array.isArray(check?.reason_codes) ? check.reason_codes.length : -1,
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`Target: ${payload.target_root}`);
      console.log(`Non-strict status: ${payload.checks.non_strict_status}`);
      console.log(`Strict status: ${payload.checks.strict_status}`);
      console.log(`Strict failure detected: ${payload.checks.strict_failure_detected ? "yes" : "no"}`);
      console.log(`Result: ${payload.pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
