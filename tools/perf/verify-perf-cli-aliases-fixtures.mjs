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
    fallbackPassFile: ".aidn/runtime/perf/fixtures/cli-aliases/fallback-pass.json",
    fallbackThresholdsFile: ".aidn/runtime/perf/fallback-thresholds.json",
    indexReportPassFile: ".aidn/runtime/index/fixtures/cli-aliases/index-report-pass.json",
    indexThresholdsFile: ".aidn/runtime/index/fixtures/cli-aliases/index-thresholds.json",
    indexSyncReportPassFile: ".aidn/runtime/index/fixtures/cli-aliases/index-sync-report-pass.json",
    indexSyncThresholdsFile: ".aidn/runtime/index/fixtures/cli-aliases/index-sync-thresholds.json",
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
    } else if (token === "--fallback-pass-file") {
      args.fallbackPassFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--fallback-thresholds-file") {
      args.fallbackThresholdsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-report-pass-file") {
      args.indexReportPassFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-thresholds-file") {
      args.indexThresholdsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-sync-report-pass-file") {
      args.indexSyncReportPassFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-sync-thresholds-file") {
      args.indexSyncThresholdsFile = argv[i + 1] ?? "";
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
    const fallbackPassFile = path.resolve(targetRoot, args.fallbackPassFile);
    const fallbackThresholdsFile = path.resolve(targetRoot, args.fallbackThresholdsFile);
    const indexReportPassFile = path.resolve(targetRoot, args.indexReportPassFile);
    const indexThresholdsFile = path.resolve(targetRoot, args.indexThresholdsFile);
    const indexSyncReportPassFile = path.resolve(targetRoot, args.indexSyncReportPassFile);
    const indexSyncThresholdsFile = path.resolve(targetRoot, args.indexSyncThresholdsFile);

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

    fs.mkdirSync(path.dirname(fallbackPassFile), { recursive: true });
    fs.writeFileSync(fallbackPassFile, `${JSON.stringify({
      ts: new Date().toISOString(),
      summary: {
        runs_analyzed: 1,
        adjusted_fallback_total: 0,
        adjusted_storm_runs: 0,
        l3_repeated_fallback: 0,
      },
    }, null, 2)}\n`, "utf8");

    fs.mkdirSync(path.dirname(indexReportPassFile), { recursive: true });
    fs.writeFileSync(indexReportPassFile, `${JSON.stringify({
      ts: new Date().toISOString(),
      summary: {
        schema_version: 1,
        rows: { artifacts: 1 },
        consistency: { all_count_match: 1 },
        parity: { ok_numeric: 1 },
        parity_sql: { ok_numeric: 1 },
        parity_sqlite: { ok_numeric: 1 },
        run_metrics: { present: 1 },
        projection: {
          artifacts_with_canonical: 1,
          canonical_coverage_ratio_markdown: 1,
        },
        structure: {
          is_unknown: 0,
          declared_version_looks_stale: 0,
        },
      },
    }, null, 2)}\n`, "utf8");

    fs.mkdirSync(path.dirname(indexSyncReportPassFile), { recursive: true });
    fs.writeFileSync(indexSyncReportPassFile, `${JSON.stringify({
      ts: new Date().toISOString(),
      summary: {
        runs_analyzed: 1,
        in_sync_rate: 1,
        avg_mismatch_count: 0,
        drift_runs: 0,
        high_drift_runs: 0,
      },
    }, null, 2)}\n`, "utf8");

    const fallbackThresholds = runNodeWithJson(aidnCli, [
      "perf",
      "check-fallbacks",
      "--target",
      ".",
      "--kpi-file",
      fallbackPassFile,
      "--out",
      fallbackThresholdsFile,
      "--json",
    ], targetRoot);

    const indexThresholds = runNodeWithJson(aidnCli, [
      "perf",
      "index-thresholds",
      "--target",
      ".",
      "--kpi-file",
      indexReportPassFile,
      "--out",
      indexThresholdsFile,
      "--json",
    ], targetRoot);

    const indexSyncThresholds = runNodeWithJson(aidnCli, [
      "perf",
      "index-sync-thresholds",
      "--target",
      ".",
      "--kpi-file",
      indexSyncReportPassFile,
      "--out",
      indexSyncThresholdsFile,
      "--json",
    ], targetRoot);

    const pass = canonicalCheck?.summary?.overall_status === "pass"
      && Number(campaign?.iterations_completed ?? 0) === 1
      && typeof fallbackThresholds?.summary?.overall_status === "string"
      && typeof indexThresholds?.summary?.overall_status === "string"
      && typeof indexSyncThresholds?.summary?.overall_status === "string"
      && fs.existsSync(sqliteFile)
      && fs.existsSync(canonicalCheckFile)
      && fs.existsSync(canonicalSummaryFile)
      && fs.existsSync(campaignFile)
      && fs.existsSync(fallbackReportFile)
      && fs.existsSync(fallbackThresholdsFile)
      && fs.existsSync(indexThresholdsFile)
      && fs.existsSync(indexSyncThresholdsFile);

    const payload = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      files: {
        sqlite_file: sqliteFile,
        canonical_check_file: canonicalCheckFile,
        canonical_summary_file: canonicalSummaryFile,
        campaign_file: campaignFile,
        fallback_report_file: fallbackReportFile,
        fallback_pass_file: fallbackPassFile,
        fallback_thresholds_file: fallbackThresholdsFile,
        index_report_pass_file: indexReportPassFile,
        index_thresholds_file: indexThresholdsFile,
        index_sync_report_pass_file: indexSyncReportPassFile,
        index_sync_thresholds_file: indexSyncThresholdsFile,
      },
      checks: {
        canonical_status: canonicalCheck?.summary?.overall_status ?? null,
        canonical_markdown_coverage: canonicalCheck?.coverage?.canonical_coverage_ratio_markdown ?? null,
        campaign_iterations_completed: campaign?.iterations_completed ?? null,
        fallback_thresholds_status: fallbackThresholds?.summary?.overall_status ?? null,
        index_thresholds_status: indexThresholds?.summary?.overall_status ?? null,
        index_sync_thresholds_status: indexSyncThresholds?.summary?.overall_status ?? null,
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
