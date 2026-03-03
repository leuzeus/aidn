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
    indexSyncCheckFile: ".aidn/runtime/index/fixtures/cli-aliases/index-sync-check.json",
    exportPathsFile: ".aidn/runtime/index/fixtures/cli-aliases/export-paths.txt",
    campaignFile: ".aidn/runtime/perf/fixtures/cli-aliases/campaign-report.json",
    constraintReportFile: ".aidn/runtime/perf/fixtures/cli-aliases/constraint-report.json",
    constraintActionsFile: ".aidn/runtime/perf/fixtures/cli-aliases/constraint-actions.json",
    constraintSummaryFile: ".aidn/runtime/perf/fixtures/cli-aliases/constraint-summary.md",
    constraintThresholdsFile: ".aidn/runtime/perf/fixtures/cli-aliases/constraint-thresholds.json",
    constraintHistoryFile: ".aidn/runtime/perf/fixtures/cli-aliases/constraint-history.ndjson",
    constraintTrendFile: ".aidn/runtime/perf/fixtures/cli-aliases/constraint-trend.json",
    constraintTrendThresholdsFile: ".aidn/runtime/perf/fixtures/cli-aliases/constraint-trend-thresholds.json",
    constraintTrendSummaryFile: ".aidn/runtime/perf/fixtures/cli-aliases/constraint-trend-summary.md",
    constraintLotPlanFile: ".aidn/runtime/perf/fixtures/cli-aliases/constraint-lot-plan.json",
    constraintLotSummaryFile: ".aidn/runtime/perf/fixtures/cli-aliases/constraint-lot-plan-summary.md",
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
    } else if (token === "--index-sync-check-file") {
      args.indexSyncCheckFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--export-paths-file") {
      args.exportPathsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--campaign-file") {
      args.campaignFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--constraint-report-file") {
      args.constraintReportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--constraint-actions-file") {
      args.constraintActionsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--constraint-summary-file") {
      args.constraintSummaryFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--constraint-thresholds-file") {
      args.constraintThresholdsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--constraint-history-file") {
      args.constraintHistoryFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--constraint-trend-file") {
      args.constraintTrendFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--constraint-trend-thresholds-file") {
      args.constraintTrendThresholdsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--constraint-trend-summary-file") {
      args.constraintTrendSummaryFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--constraint-lot-plan-file") {
      args.constraintLotPlanFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--constraint-lot-summary-file") {
      args.constraintLotSummaryFile = argv[i + 1] ?? "";
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
    const indexSyncCheckFile = path.resolve(targetRoot, args.indexSyncCheckFile);
    const exportPathsFile = path.resolve(targetRoot, args.exportPathsFile);
    const campaignFile = path.resolve(targetRoot, args.campaignFile);
    const constraintReportFile = path.resolve(targetRoot, args.constraintReportFile);
    const constraintActionsFile = path.resolve(targetRoot, args.constraintActionsFile);
    const constraintSummaryFile = path.resolve(targetRoot, args.constraintSummaryFile);
    const constraintThresholdsFile = path.resolve(targetRoot, args.constraintThresholdsFile);
    const constraintHistoryFile = path.resolve(targetRoot, args.constraintHistoryFile);
    const constraintTrendFile = path.resolve(targetRoot, args.constraintTrendFile);
    const constraintTrendThresholdsFile = path.resolve(targetRoot, args.constraintTrendThresholdsFile);
    const constraintTrendSummaryFile = path.resolve(targetRoot, args.constraintTrendSummaryFile);
    const constraintLotPlanFile = path.resolve(targetRoot, args.constraintLotPlanFile);
    const constraintLotSummaryFile = path.resolve(targetRoot, args.constraintLotSummaryFile);
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

    const indexSyncCheck = runNodeWithJson(aidnCli, [
      "perf",
      "index-check",
      "--target",
      ".",
      "--json",
    ], targetRoot);
    fs.mkdirSync(path.dirname(indexSyncCheckFile), { recursive: true });
    fs.writeFileSync(indexSyncCheckFile, `${JSON.stringify(indexSyncCheck, null, 2)}\n`, "utf8");

    const exportPaths = runNodeWithJson(aidnCli, [
      "perf",
      "index-select-paths",
      "--target",
      ".",
      "--check-file",
      indexSyncCheckFile,
      "--out",
      exportPathsFile,
      "--json",
    ], targetRoot);

    const reconcile = runNodeWithJson(aidnCli, [
      "perf",
      "index-reconcile",
      "--target",
      ".",
      "--index-file",
      sqliteFile,
      "--index-backend",
      "sqlite",
      "--check-file",
      indexSyncCheckFile,
      "--paths-file",
      exportPathsFile,
      "--audit-root",
      "docs/audit",
      "--json",
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

    const constraintReport = runNodeWithJson(aidnCli, [
      "perf",
      "constraint-report",
      "--file",
      ".aidn/runtime/perf/workflow-events.ndjson",
      "--run-prefix",
      "session-",
      "--out",
      constraintReportFile,
      "--json",
    ], targetRoot);
    const constraintThresholds = runNodeWithJson(aidnCli, [
      "perf",
      "check-constraints",
      "--target",
      ".",
      "--kpi-file",
      constraintReportFile,
      "--out",
      constraintThresholdsFile,
      "--json",
    ], targetRoot);
    const constraintActions = runNodeWithJson(aidnCli, [
      "perf",
      "constraint-actions",
      "--report-file",
      constraintReportFile,
      "--thresholds-file",
      constraintThresholdsFile,
      "--out",
      constraintActionsFile,
      "--json",
    ], targetRoot);
    runNodeNoJson(aidnCli, [
      "perf",
      "constraint-summary",
      "--report-file",
      constraintReportFile,
      "--thresholds-file",
      constraintThresholdsFile,
      "--actions-file",
      constraintActionsFile,
      "--out",
      constraintSummaryFile,
    ], targetRoot);
    runNodeNoJson(aidnCli, [
      "perf",
      "constraint-history",
      "--report-file",
      constraintReportFile,
      "--actions-file",
      constraintActionsFile,
      "--history-file",
      constraintHistoryFile,
      "--max-runs",
      "20",
    ], targetRoot);
    const constraintTrend = runNodeWithJson(aidnCli, [
      "perf",
      "constraint-trend",
      "--history-file",
      constraintHistoryFile,
      "--out",
      constraintTrendFile,
      "--json",
    ], targetRoot);
    const constraintTrendThresholds = runNodeWithJson(aidnCli, [
      "perf",
      "check-constraint-trend",
      "--target",
      ".",
      "--kpi-file",
      constraintTrendFile,
      "--out",
      constraintTrendThresholdsFile,
      "--json",
    ], targetRoot);
    runNodeNoJson(aidnCli, [
      "perf",
      "constraint-trend-summary",
      "--report-file",
      constraintTrendFile,
      "--thresholds-file",
      constraintTrendThresholdsFile,
      "--out",
      constraintTrendSummaryFile,
    ], targetRoot);
    const constraintLotPlan = runNodeWithJson(aidnCli, [
      "perf",
      "constraint-lot-plan",
      "--actions-file",
      constraintActionsFile,
      "--trend-file",
      constraintTrendFile,
      "--out",
      constraintLotPlanFile,
      "--json",
    ], targetRoot);
    const firstLotId = String(constraintLotPlan?.lots?.[0]?.lot_id ?? "");
    const firstActionId = String(constraintLotPlan?.lots?.[0]?.actions?.[0]?.action_id ?? "");
    const constraintLotUpdate = runNodeWithJson(aidnCli, [
      "perf",
      "constraint-lot-update",
      "--plan-file",
      constraintLotPlanFile,
      "--lot-id",
      firstLotId,
      "--lot-status",
      "in_progress",
      "--action-update",
      `${firstActionId}:done`,
      "--json",
    ], targetRoot);
    const constraintLotAdvance = runNodeWithJson(aidnCli, [
      "perf",
      "constraint-lot-advance",
      "--plan-file",
      constraintLotPlanFile,
      "--json",
    ], targetRoot);
    runNodeNoJson(aidnCli, [
      "perf",
      "constraint-lot-summary",
      "--plan-file",
      constraintLotPlanFile,
      "--out",
      constraintLotSummaryFile,
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

    const constraintSummaryContainsActive = fs.existsSync(constraintSummaryFile)
      && fs.readFileSync(constraintSummaryFile, "utf8").includes("Active constraint:");
    const constraintSummaryContainsActions = fs.existsSync(constraintSummaryFile)
      && fs.readFileSync(constraintSummaryFile, "utf8").includes("Action Backlog");
    const constraintTrendSummaryContainsTitle = fs.existsSync(constraintTrendSummaryFile)
      && fs.readFileSync(constraintTrendSummaryFile, "utf8").includes("Constraint Trend");
    const constraintTrendSummaryContainsChecks = fs.existsSync(constraintTrendSummaryFile)
      && fs.readFileSync(constraintTrendSummaryFile, "utf8").includes("Trend Threshold Checks");
    const constraintLotSummaryContainsTitle = fs.existsSync(constraintLotSummaryFile)
      && fs.readFileSync(constraintLotSummaryFile, "utf8").includes("Constraint Lot Plan");

    const pass = canonicalCheck?.summary?.overall_status === "pass"
      && Number(campaign?.iterations_completed ?? 0) === 1
      && typeof constraintReport?.summary?.active_constraint?.skill === "string"
      && constraintSummaryContainsActive
      && constraintSummaryContainsActions
      && constraintTrendSummaryContainsTitle
      && constraintTrendSummaryContainsChecks
      && constraintLotSummaryContainsTitle
      && typeof constraintThresholds?.summary?.overall_status === "string"
      && typeof constraintActions?.summary?.generated_actions === "number"
      && Number(constraintTrend?.summary?.runs_analyzed ?? 0) >= 1
      && typeof constraintTrendThresholds?.summary?.overall_status === "string"
      && Number(constraintLotPlan?.summary?.lots_total ?? 0) >= 1
      && Array.isArray(constraintLotUpdate?.updates)
      && constraintLotUpdate.updates.length >= 1
      && Array.isArray(constraintLotAdvance?.transitions)
      && typeof constraintLotAdvance.transitions.length === "number"
      && typeof exportPaths?.selected_paths_count === "number"
      && typeof reconcile?.pass === "boolean"
      && typeof fallbackThresholds?.summary?.overall_status === "string"
      && typeof indexThresholds?.summary?.overall_status === "string"
      && typeof indexSyncThresholds?.summary?.overall_status === "string"
      && fs.existsSync(sqliteFile)
      && fs.existsSync(canonicalCheckFile)
      && fs.existsSync(canonicalSummaryFile)
      && fs.existsSync(campaignFile)
      && fs.existsSync(constraintReportFile)
      && fs.existsSync(constraintActionsFile)
      && fs.existsSync(constraintSummaryFile)
      && fs.existsSync(constraintThresholdsFile)
      && fs.existsSync(constraintHistoryFile)
      && fs.existsSync(constraintTrendFile)
      && fs.existsSync(constraintTrendThresholdsFile)
      && fs.existsSync(constraintTrendSummaryFile)
      && fs.existsSync(constraintLotPlanFile)
      && fs.existsSync(constraintLotSummaryFile)
      && fs.existsSync(indexSyncCheckFile)
      && fs.existsSync(exportPathsFile)
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
        index_sync_check_file: indexSyncCheckFile,
        export_paths_file: exportPathsFile,
        campaign_file: campaignFile,
        constraint_report_file: constraintReportFile,
        constraint_actions_file: constraintActionsFile,
        constraint_summary_file: constraintSummaryFile,
        constraint_thresholds_file: constraintThresholdsFile,
        constraint_history_file: constraintHistoryFile,
        constraint_trend_file: constraintTrendFile,
        constraint_trend_thresholds_file: constraintTrendThresholdsFile,
        constraint_trend_summary_file: constraintTrendSummaryFile,
        constraint_lot_plan_file: constraintLotPlanFile,
        constraint_lot_summary_file: constraintLotSummaryFile,
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
        constraint_active_skill: constraintReport?.summary?.active_constraint?.skill ?? null,
        constraint_actions_generated: constraintActions?.summary?.generated_actions ?? null,
        constraint_summary_contains_active: constraintSummaryContainsActive,
        constraint_summary_contains_actions: constraintSummaryContainsActions,
        constraint_trend_runs_analyzed: constraintTrend?.summary?.runs_analyzed ?? null,
        constraint_trend_summary_contains_title: constraintTrendSummaryContainsTitle,
        constraint_trend_summary_contains_checks: constraintTrendSummaryContainsChecks,
        constraint_trend_thresholds_status: constraintTrendThresholds?.summary?.overall_status ?? null,
        constraint_lot_count: constraintLotPlan?.summary?.lots_total ?? null,
        constraint_lot_updates: Array.isArray(constraintLotUpdate?.updates) ? constraintLotUpdate.updates.length : null,
        constraint_lot_advance_transitions: Array.isArray(constraintLotAdvance?.transitions) ? constraintLotAdvance.transitions.length : null,
        constraint_lot_summary_contains_title: constraintLotSummaryContainsTitle,
        constraint_thresholds_status: constraintThresholds?.summary?.overall_status ?? null,
        index_select_paths_count: exportPaths?.selected_paths_count ?? null,
        index_reconcile_pass: reconcile?.pass ?? null,
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
