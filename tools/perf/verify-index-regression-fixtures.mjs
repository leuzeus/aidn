#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    indexParityFile: ".aidn/runtime/index/fixtures/regression/index-parity.json",
    indexSqliteParityFile: ".aidn/runtime/index/fixtures/regression/index-sqlite-parity.json",
    indexReportFile: ".aidn/runtime/index/fixtures/regression/index-report.json",
    indexRegressionKpiFile: ".aidn/runtime/index/fixtures/regression/index-regression-kpi.json",
    indexRegressionHistoryFile: ".aidn/runtime/index/fixtures/regression/index-regression-history.ndjson",
    indexRegressionOutFile: ".aidn/runtime/index/fixtures/regression/index-regression.json",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-parity-file") {
      args.indexParityFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-sqlite-parity-file") {
      args.indexSqliteParityFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-report-file") {
      args.indexReportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-regression-kpi-file") {
      args.indexRegressionKpiFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-regression-history-file") {
      args.indexRegressionHistoryFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-regression-out-file") {
      args.indexRegressionOutFile = argv[i + 1] ?? "";
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
  console.log("  node tools/perf/verify-index-regression-fixtures.mjs");
  console.log("  node tools/perf/verify-index-regression-fixtures.mjs --target tests/fixtures/repo-installed-core");
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

function writeHistoryWithSyntheticRuns(historyFile, run) {
  const baseTs = Date.parse(run.started_at ?? new Date().toISOString());
  const entries = [0, 1, 2].map((offset) => ({
    ...run,
    run_id: `${run.run_id}-hist-${offset + 1}`,
    started_at: new Date(baseTs - ((offset + 1) * 60_000)).toISOString(),
    ended_at: new Date(baseTs - ((offset + 1) * 60_000)).toISOString(),
  }));
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.writeFileSync(historyFile, `${entries.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  return entries.length;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const indexParityFile = resolveTargetPath(targetRoot, args.indexParityFile);
    const indexSqliteParityFile = resolveTargetPath(targetRoot, args.indexSqliteParityFile);
    const indexReportFile = resolveTargetPath(targetRoot, args.indexReportFile);
    const indexRegressionKpiFile = resolveTargetPath(targetRoot, args.indexRegressionKpiFile);
    const indexRegressionHistoryFile = resolveTargetPath(targetRoot, args.indexRegressionHistoryFile);
    const indexRegressionOutFile = resolveTargetPath(targetRoot, args.indexRegressionOutFile);

    const indexJsonFile = path.resolve(targetRoot, ".aidn/runtime/index/workflow-index.json");
    const indexSqlFile = path.resolve(targetRoot, ".aidn/runtime/index/workflow-index.sql");
    const indexSqliteFile = path.resolve(targetRoot, ".aidn/runtime/index/workflow-index.sqlite");

    runNoJson("tools/perf/index-sync.mjs", [
      "--target",
      targetRoot,
      "--store",
      "all",
      "--no-content",
      "--output",
      indexJsonFile,
      "--sql-output",
      indexSqlFile,
      "--sqlite-output",
      indexSqliteFile,
    ]);

    const parity = runJson("tools/perf/index-verify-dual.mjs", [
      "--index-file",
      indexJsonFile,
      "--sql-file",
      indexSqlFile,
      "--json",
    ]);
    const sqliteParity = runJson("tools/perf/index-verify-sqlite.mjs", [
      "--index-file",
      indexJsonFile,
      "--sqlite-file",
      indexSqliteFile,
      "--json",
    ]);
    fs.mkdirSync(path.dirname(indexParityFile), { recursive: true });
    fs.writeFileSync(indexParityFile, `${JSON.stringify(parity, null, 2)}\n`, "utf8");
    fs.writeFileSync(indexSqliteParityFile, `${JSON.stringify(sqliteParity, null, 2)}\n`, "utf8");

    runNoJson("tools/perf/report-index.mjs", [
      "--index-file",
      indexJsonFile,
      "--parity-file",
      indexParityFile,
      "--sqlite-parity-file",
      indexSqliteParityFile,
      "--out",
      indexReportFile,
    ]);

    const regressionKpi = runJson("tools/perf/report-index-regression-kpi.mjs", [
      "--index-report-file",
      indexReportFile,
      "--out",
      indexRegressionKpiFile,
      "--json",
    ]);

    const latestRun = Array.isArray(regressionKpi?.runs) ? regressionKpi.runs[0] : null;
    if (!latestRun) {
      throw new Error("Missing latest run in index regression KPI payload");
    }
    const syntheticHistoryRuns = writeHistoryWithSyntheticRuns(indexRegressionHistoryFile, latestRun);

    const regression = runJson("tools/perf/check-regression.mjs", [
      "--kpi-file",
      indexRegressionKpiFile,
      "--history-file",
      indexRegressionHistoryFile,
      "--targets",
      "docs/performance/INDEX_REGRESSION_TARGETS.json",
      "--out",
      indexRegressionOutFile,
      "--json",
    ]);

    const checks = Array.isArray(regression?.checks) ? regression.checks : [];
    const invalidCount = checks.filter((check) => check?.status === "invalid").length;
    const pass = regression?.summary?.blocking === 0
      && regression?.summary?.missing_history === 0
      && invalidCount === 0;

    const output = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      files: {
        index_parity_file: indexParityFile,
        index_sqlite_parity_file: indexSqliteParityFile,
        index_report_file: indexReportFile,
        index_regression_kpi_file: indexRegressionKpiFile,
        index_regression_history_file: indexRegressionHistoryFile,
        index_regression_out_file: indexRegressionOutFile,
      },
      checks: {
        synthetic_history_runs: syntheticHistoryRuns,
        overall_status: regression?.summary?.overall_status ?? null,
        blocking: Number(regression?.summary?.blocking ?? -1),
        missing_history: Number(regression?.summary?.missing_history ?? -1),
        invalid_checks: invalidCount,
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${output.target_root}`);
      console.log(`Regression status: ${output.checks.overall_status}`);
      console.log(`Blocking checks: ${output.checks.blocking}`);
      console.log(`Missing history: ${output.checks.missing_history}`);
      console.log(`Invalid checks: ${output.checks.invalid_checks}`);
      console.log(`Result: ${output.pass ? "PASS" : "FAIL"}`);
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
