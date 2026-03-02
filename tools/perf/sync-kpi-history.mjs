#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    kpiFile: ".aidn/runtime/perf/kpi-report.json",
    historyFile: ".aidn/runtime/perf/kpi-history.ndjson",
    maxRuns: 200,
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
    } else if (token === "--max-runs") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--max-runs must be an integer");
      }
      args.maxRuns = Number(raw);
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
  if (!args.historyFile) {
    throw new Error("Missing value for --history-file");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/sync-kpi-history.mjs");
  console.log("  node tools/perf/sync-kpi-history.mjs --kpi-file .aidn/runtime/perf/kpi-report.json --history-file .aidn/runtime/perf/kpi-history.ndjson --max-runs 200");
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

function readHistory(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return { absolute, runs: [] };
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
  return { absolute, runs };
}

function normalizeRun(run) {
  const normalized = {
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
    source: "kpi-report",
    synced_at: new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(run ?? {})) {
    if (!(key in normalized)) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function mergeRuns(historyRuns, incomingRuns) {
  const byRunId = new Map();
  for (const run of historyRuns) {
    const runId = String(run?.run_id ?? "").trim();
    if (!runId) {
      continue;
    }
    byRunId.set(runId, run);
  }
  for (const run of incomingRuns) {
    const runId = String(run?.run_id ?? "").trim();
    if (!runId) {
      continue;
    }
    byRunId.set(runId, normalizeRun(run));
  }
  const merged = Array.from(byRunId.values());
  merged.sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")));
  return merged;
}

function writeHistory(filePath, runs) {
  const absolute = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const content = runs.map((run) => JSON.stringify(run)).join("\n");
  fs.writeFileSync(absolute, `${content}${content ? "\n" : ""}`, "utf8");
  return absolute;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const kpi = readJson(args.kpiFile, "KPI report");
    const history = readHistory(args.historyFile);

    const kpiRuns = Array.isArray(kpi.data.runs) ? kpi.data.runs : [];
    const merged = mergeRuns(history.runs, kpiRuns);
    const kept = args.maxRuns > 0 ? merged.slice(0, args.maxRuns) : merged;
    const outPath = writeHistory(args.historyFile, kept);

    const payload = {
      ts: new Date().toISOString(),
      kpi_file: kpi.absolute,
      history_file: outPath,
      input_runs: kpiRuns.length,
      previous_history_runs: history.runs.length,
      output_history_runs: kept.length,
      max_runs: args.maxRuns,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`KPI history synced: ${outPath}`);
    console.log(`Input runs: ${payload.input_runs}`);
    console.log(`Previous history runs: ${payload.previous_history_runs}`);
    console.log(`Output history runs: ${payload.output_history_runs}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
