#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    kpiFile: ".aidn/runtime/perf/kpi-report.json",
    historyFile: ".aidn/runtime/perf/kpi-history.ndjson",
    targets: "docs/performance/REGRESSION_TARGETS.json",
    out: ".aidn/runtime/perf/kpi-regression.json",
    strict: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--kpi-file") {
      args.kpiFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--history-file") {
      args.historyFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--targets") {
      args.targets = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.kpiFile) {
    throw new Error("Missing value for --kpi-file");
  }
  if (!args.targets) {
    throw new Error("Missing value for --targets");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/check-regression.mjs");
  console.log("  node tools/perf/check-regression.mjs --kpi-file .aidn/runtime/perf/kpi-report.json --history-file .aidn/runtime/perf/kpi-history.ndjson --targets docs/performance/REGRESSION_TARGETS.json");
  console.log("  node tools/perf/check-regression.mjs --strict");
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

function readNdjsonOptional(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return { absolute, exists: false, runs: [] };
  }
  const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
  const runs = [];
  for (let i = 0; i < lines.length; i += 1) {
    try {
      runs.push(JSON.parse(lines[i]));
    } catch (error) {
      throw new Error(`History NDJSON invalid at line ${i + 1}: ${error.message}`);
    }
  }
  return { absolute, exists: true, runs };
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function sortRuns(runs) {
  return [...runs].sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")));
}

function normalizeRun(run) {
  return {
    run_id: run.run_id ?? null,
    started_at: run.started_at ?? null,
    ended_at: run.ended_at ?? null,
    overhead_ratio: run.overhead_ratio ?? null,
    artifacts_churn: run.artifacts_churn ?? null,
    gates_frequency: run.gates_frequency ?? null,
    gates_stop_rate: run.gates_stop_rate ?? null,
    control_time_ms: run.control_time_ms ?? null,
    delivery_time_ms: run.delivery_time_ms ?? null,
    events_count: run.events_count ?? null,
  };
}

function mergeRuns(currentRuns, historyRuns) {
  const byRunId = new Map();
  for (const run of historyRuns) {
    const runId = String(run?.run_id ?? "").trim();
    if (!runId) {
      continue;
    }
    byRunId.set(runId, normalizeRun(run));
  }
  for (const run of currentRuns) {
    const runId = String(run?.run_id ?? "").trim();
    if (!runId) {
      continue;
    }
    byRunId.set(runId, normalizeRun(run));
  }
  return sortRuns(Array.from(byRunId.values()));
}

function evaluateRule(rule, runs, minHistoryDefault) {
  const id = String(rule.id ?? "").trim();
  const metric = String(rule.metric ?? "").trim();
  const maxIncreasePct = toNumber(rule.max_increase_pct);
  const severity = String(rule.severity ?? "warn").trim().toLowerCase();
  const minHistory = toNumber(rule.min_history) ?? minHistoryDefault;

  if (!id || !metric || maxIncreasePct == null) {
    return {
      id: id || "invalid_rule",
      metric,
      status: "invalid",
      severity: "error",
      message: "Missing id/metric/max_increase_pct",
    };
  }

  const sorted = sortRuns(runs);
  if (!sorted.length) {
    return {
      id,
      metric,
      status: "missing_history",
      severity,
      message: "No runs available",
      min_history: minHistory,
      history_count: 0,
    };
  }

  const latest = sorted[0];
  const latestValue = toNumber(latest?.[metric]);
  const historyRaw = sorted.slice(1).map((run) => toNumber(run?.[metric])).filter((value) => value != null);

  if (latestValue == null) {
    return {
      id,
      metric,
      status: "missing_metric",
      severity,
      message: `Latest run missing metric: ${metric}`,
      min_history: minHistory,
      history_count: historyRaw.length,
    };
  }

  if (historyRaw.length < minHistory) {
    return {
      id,
      metric,
      status: "missing_history",
      severity,
      message: `Insufficient history for metric ${metric}`,
      min_history: minHistory,
      history_count: historyRaw.length,
      latest_value: latestValue,
    };
  }

  const baseline = median(historyRaw);
  if (baseline == null || baseline <= 0) {
    return {
      id,
      metric,
      status: "invalid",
      severity: "error",
      message: "Invalid baseline (median <= 0 or missing)",
      baseline,
      latest_value: latestValue,
    };
  }

  const increasePct = ((latestValue - baseline) / baseline) * 100;
  const pass = increasePct <= maxIncreasePct;
  return {
    id,
    metric,
    status: pass ? "pass" : "fail",
    severity,
    message: pass ? "Regression threshold satisfied" : "Regression threshold violated",
    latest_run_id: latest.run_id ?? null,
    latest_value: latestValue,
    baseline_median: baseline,
    increase_pct: increasePct,
    max_increase_pct: maxIncreasePct,
    min_history: minHistory,
    history_count: historyRaw.length,
  };
}

function summarize(checks, strict) {
  let pass = 0;
  let fail = 0;
  let missingHistory = 0;
  let missingMetric = 0;
  let invalid = 0;
  let blocking = 0;

  for (const check of checks) {
    if (check.status === "pass") {
      pass += 1;
      continue;
    }
    if (check.status === "fail") {
      fail += 1;
      if (check.severity === "error" || strict) {
        blocking += 1;
      }
      continue;
    }
    if (check.status === "missing_history") {
      missingHistory += 1;
      continue;
    }
    if (check.status === "missing_metric") {
      missingMetric += 1;
      if (check.severity === "error") {
        blocking += 1;
      }
      continue;
    }
    invalid += 1;
    blocking += 1;
  }

  const overallStatus = blocking > 0 ? "fail" : (fail > 0 ? "warn" : "pass");
  return {
    overall_status: overallStatus,
    pass,
    fail,
    missing_history: missingHistory,
    missing_metric: missingMetric,
    invalid,
    blocking,
  };
}

function writeJson(filePath, payload) {
  const absolute = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return absolute;
}

function printHuman(summary, checks) {
  console.log(`Overall status: ${summary.overall_status.toUpperCase()}`);
  console.log(
    `Checks: pass=${summary.pass}, fail=${summary.fail}, missing_history=${summary.missing_history}, missing_metric=${summary.missing_metric}, invalid=${summary.invalid}, blocking=${summary.blocking}`,
  );
  console.log("");
  for (const check of checks) {
    if (check.status === "pass" || check.status === "fail") {
      console.log(
        `- ${check.status.toUpperCase()} ${check.id} [${check.severity}] ${check.metric}: latest=${check.latest_value}, baseline=${check.baseline_median}, increase_pct=${check.increase_pct?.toFixed(3)}, max=${check.max_increase_pct}`,
      );
    } else {
      console.log(`- ${check.status.toUpperCase()} ${check.id} [${check.severity}] ${check.metric}: ${check.message}`);
    }
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { absolute: kpiPath, data: kpiData } = readJson(args.kpiFile, "KPI file");
    const history = readNdjsonOptional(args.historyFile);
    const { absolute: targetsPath, data: targetsData } = readJson(args.targets, "Regression targets");

    const currentRuns = Array.isArray(kpiData.runs) ? kpiData.runs : [];
    const runs = mergeRuns(currentRuns, history.runs);
    const rules = Array.isArray(targetsData.rules) ? targetsData.rules : [];
    const minHistoryDefault = toNumber(targetsData.min_history) ?? 3;
    const checks = rules.map((rule) => evaluateRule(rule, runs, minHistoryDefault));
    const summary = summarize(checks, args.strict);

    const output = {
      ts: new Date().toISOString(),
      strict: args.strict,
      kpi_file: kpiPath,
      history_file: history.absolute,
      history_exists: history.exists,
      history_runs: history.runs.length,
      targets_file: targetsPath,
      runs_analyzed: runs.length,
      current_runs: currentRuns.length,
      summary,
      checks,
    };
    const outPath = writeJson(args.out, output);
    output.output_file = outPath;

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      printHuman(summary, checks);
      console.log("");
      console.log(`Report file: ${outPath}`);
    }

    if (summary.blocking > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
