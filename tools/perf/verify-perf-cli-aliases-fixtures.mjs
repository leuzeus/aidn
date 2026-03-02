#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    sqliteFile: ".aidn/runtime/index/fixtures/cli-aliases/workflow-index.sqlite",
    canonicalCheckFile: ".aidn/runtime/index/fixtures/cli-aliases/index-canonical-check.json",
    canonicalSummaryFile: ".aidn/runtime/index/fixtures/cli-aliases/index-canonical-check-summary.md",
    campaignFile: ".aidn/runtime/perf/fixtures/cli-aliases/campaign-report.json",
    fallbackReportFile: ".aidn/runtime/perf/fallback-report.json",
    fallbackThresholdsFile: ".aidn/runtime/perf/fallback-thresholds.json",
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
    } else if (token === "--canonical-check-file") {
      args.canonicalCheckFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--canonical-summary-file") {
      args.canonicalSummaryFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--campaign-file") {
      args.campaignFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--fallback-report-file") {
      args.fallbackReportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--fallback-thresholds-file") {
      args.fallbackThresholdsFile = argv[i + 1] ?? "";
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
  console.log("  node tools/perf/verify-perf-cli-aliases-fixtures.mjs");
  console.log("  node tools/perf/verify-perf-cli-aliases-fixtures.mjs --target tests/fixtures/repo-installed-core");
}

function runNodeWithJson(scriptPath, args, cwd = process.cwd()) {
  const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function runNodeNoJson(scriptPath, args, cwd = process.cwd()) {
  execFileSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const root = process.cwd();
    const aidnCli = path.resolve(root, "bin", "aidn.mjs");
    const targetRoot = path.resolve(root, args.target);
    const sqliteFile = path.resolve(targetRoot, args.sqliteFile);
    const canonicalCheckFile = path.resolve(targetRoot, args.canonicalCheckFile);
    const canonicalSummaryFile = path.resolve(targetRoot, args.canonicalSummaryFile);
    const campaignFile = path.resolve(targetRoot, args.campaignFile);
    const fallbackReportFile = path.resolve(targetRoot, args.fallbackReportFile);
    const fallbackThresholdsFile = path.resolve(targetRoot, args.fallbackThresholdsFile);

    runNodeNoJson(aidnCli, [
      "perf",
      "index",
      "--target",
      ".",
      "--store",
      "sqlite",
      "--no-content",
      "--sqlite-output",
      sqliteFile,
    ], targetRoot);

    const canonicalCheck = runNodeWithJson(aidnCli, [
      "perf",
      "index-canonical-check",
      "--index-file",
      sqliteFile,
      "--backend",
      "sqlite",
      "--out",
      canonicalCheckFile,
      "--json",
    ], targetRoot);

    runNodeNoJson(aidnCli, [
      "perf",
      "index-canonical-summary",
      "--check-file",
      canonicalCheckFile,
      "--out",
      canonicalSummaryFile,
    ], targetRoot);

    const campaign = runNodeWithJson(aidnCli, [
      "perf",
      "campaign",
      "--iterations",
      "1",
      "--sleep-ms",
      "0",
      "--no-reset",
      "--target",
      ".",
      "--out",
      campaignFile,
      "--json",
    ], targetRoot);

    runNodeWithJson(aidnCli, [
      "perf",
      "fallback-report",
      "--file",
      ".aidn/runtime/perf/workflow-events.ndjson",
      "--run-prefix",
      "session-",
      "--out",
      fallbackReportFile,
      "--json",
    ], targetRoot);

    const fallbackThresholds = runNodeWithJson(aidnCli, [
      "perf",
      "check-fallbacks",
      "--target",
      ".",
      "--json",
    ], targetRoot);

    const pass = canonicalCheck?.summary?.overall_status === "pass"
      && Number(campaign?.iterations_completed ?? 0) === 1
      && typeof fallbackThresholds?.summary?.overall_status === "string"
      && fs.existsSync(sqliteFile)
      && fs.existsSync(canonicalCheckFile)
      && fs.existsSync(canonicalSummaryFile)
      && fs.existsSync(campaignFile)
      && fs.existsSync(fallbackReportFile)
      && fs.existsSync(fallbackThresholdsFile);

    const payload = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      files: {
        sqlite_file: sqliteFile,
        canonical_check_file: canonicalCheckFile,
        canonical_summary_file: canonicalSummaryFile,
        campaign_file: campaignFile,
        fallback_report_file: fallbackReportFile,
        fallback_thresholds_file: fallbackThresholdsFile,
      },
      checks: {
        canonical_status: canonicalCheck?.summary?.overall_status ?? null,
        canonical_markdown_coverage: canonicalCheck?.coverage?.canonical_coverage_ratio_markdown ?? null,
        campaign_iterations_completed: campaign?.iterations_completed ?? null,
        fallback_thresholds_status: fallbackThresholds?.summary?.overall_status ?? null,
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`Target: ${payload.target_root}`);
      console.log(`Canonical status: ${payload.checks.canonical_status}`);
      console.log(`Canonical markdown coverage: ${payload.checks.canonical_markdown_coverage}`);
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
