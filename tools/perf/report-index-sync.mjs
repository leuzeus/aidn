#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { isJsonEquivalent, writeJsonIfChanged } from "./io-lib.mjs";

function parseArgs(argv) {
  const args = {
    historyFile: ".aidn/runtime/index/index-sync-history.ndjson",
    out: ".aidn/runtime/index/index-sync-report.json",
    limitRuns: 100,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--history-file") {
      args.historyFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--limit-runs") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--limit-runs must be an integer");
      }
      args.limitRuns = Number(raw);
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.historyFile) {
    throw new Error("Missing value for --history-file");
  }
  if (!args.out) {
    throw new Error("Missing value for --out");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/report-index-sync.mjs");
  console.log("  node tools/perf/report-index-sync.mjs --history-file .aidn/runtime/index/index-sync-history.ndjson --out .aidn/runtime/index/index-sync-report.json");
}

function readNdjson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`History file not found: ${absolute}`);
  }
  const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
  const runs = [];
  for (let i = 0; i < lines.length; i += 1) {
    try {
      runs.push(JSON.parse(lines[i]));
    } catch (error) {
      throw new Error(`Invalid NDJSON line ${i + 1}: ${error.message}`);
    }
  }
  return { absolute, runs };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function summarize(runs) {
  const total = runs.length;
  const inSyncRuns = runs.filter((run) => run.in_sync === true).length;
  const driftRuns = runs.filter((run) => run.in_sync !== true).length;
  const appliedRuns = runs.filter((run) => String(run.action ?? "") === "applied").length;
  const mismatchTotal = runs.reduce((sum, run) => sum + toNumber(run.mismatch_count), 0);
  const avgMismatch = total > 0 ? mismatchTotal / total : 0;
  const inSyncRate = total > 0 ? inSyncRuns / total : 0;
  const highDriftRuns = runs.filter((run) => String(run.drift_level ?? "none") === "high").length;

  const keyCounts = new Map();
  const reasonCodeCounts = new Map();
  for (const run of runs) {
    const keys = Array.isArray(run.mismatch_keys) ? run.mismatch_keys : [];
    for (const key of keys) {
      const normalized = String(key).trim();
      if (!normalized) {
        continue;
      }
      keyCounts.set(normalized, (keyCounts.get(normalized) ?? 0) + 1);
    }
    const reasonCodes = Array.isArray(run.reason_codes) ? run.reason_codes : [];
    for (const code of reasonCodes) {
      const normalized = String(code).trim();
      if (!normalized) {
        continue;
      }
      reasonCodeCounts.set(normalized, (reasonCodeCounts.get(normalized) ?? 0) + 1);
    }
  }
  const topMismatchKeys = Array.from(keyCounts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 10);
  const topReasonCodes = Array.from(reasonCodeCounts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, 10);

  return {
    runs_analyzed: total,
    in_sync_runs: inSyncRuns,
    drift_runs: driftRuns,
    applied_runs: appliedRuns,
    high_drift_runs: highDriftRuns,
    in_sync_rate: inSyncRate,
    avg_mismatch_count: avgMismatch,
    top_mismatch_keys: topMismatchKeys,
    top_reason_codes: topReasonCodes,
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
    const history = readNdjson(args.historyFile);
    const runs = args.limitRuns > 0 ? history.runs.slice(0, args.limitRuns) : history.runs;
    const summary = summarize(runs);
    const payload = {
      ts: new Date().toISOString(),
      history_file: history.absolute,
      summary,
      runs,
    };
    const outWrite = writeJson(args.out, payload);
    payload.output_file = outWrite.path;
    payload.output_written = outWrite.written;

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Runs analyzed: ${summary.runs_analyzed}`);
    console.log(`In-sync rate: ${summary.in_sync_rate}`);
    console.log(`Drift runs: ${summary.drift_runs}`);
    console.log(`Applied runs: ${summary.applied_runs}`);
    console.log(`Avg mismatch count: ${summary.avg_mismatch_count}`);
    console.log(`Report file: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
