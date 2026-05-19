#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildFallbackRunBuckets, summarizeFallbackRuns } from "../../src/application/observability/fallback-report-use-case.mjs";
import { isJsonEquivalent, writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    file: ".aidn/runtime/perf/workflow-events.ndjson",
    runPrefix: "session-",
    runId: "",
    limitRuns: 30,
    stormThreshold: 2,
    out: ".aidn/runtime/perf/fallback-report.json",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") {
      args.file = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--run-prefix") {
      args.runPrefix = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--run-id") {
      args.runId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--limit-runs") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--limit-runs must be an integer");
      }
      args.limitRuns = Number(raw);
    } else if (token === "--storm-threshold") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--storm-threshold must be an integer");
      }
      args.stormThreshold = Number(raw);
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

  if (!args.file) {
    throw new Error("Missing value for --file");
  }
  if (!args.out) {
    throw new Error("Missing value for --out");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/report-fallbacks.mjs");
  console.log("  node tools/perf/report-fallbacks.mjs --file .aidn/runtime/perf/workflow-events.ndjson --run-prefix session- --out .aidn/runtime/perf/fallback-report.json");
}

function readNdjson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`NDJSON file not found: ${absolute}`);
  }
  const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
  const events = [];
  for (let i = 0; i < lines.length; i += 1) {
    try {
      events.push(JSON.parse(lines[i]));
    } catch (error) {
      throw new Error(`Invalid JSON at line ${i + 1}: ${error.message}`);
    }
  }
  return { absolute, events };
}

function writeJson(filePath, payload) {
  return writeJsonIfChanged(filePath, payload, {
    isEquivalent(previousContent) {
      return isJsonEquivalent(previousContent, payload, ["ts"]);
    },
  });
}

function printHuman(summary) {
  console.log(`Runs analyzed: ${summary.runs_analyzed}`);
  console.log(`Fallback total: ${summary.fallback_total}`);
  console.log(`Cold-start fallback total: ${summary.cold_start_fallback_total}`);
  console.log(`Adjusted fallback total: ${summary.adjusted_fallback_total}`);
  console.log(`Runs with fallback: ${summary.runs_with_fallback}`);
  console.log(`Runs with adjusted fallback: ${summary.runs_with_adjusted_fallback}`);
  console.log(`Fallback run rate: ${summary.fallback_run_rate}`);
  console.log(`Adjusted fallback run rate: ${summary.adjusted_fallback_run_rate}`);
  console.log(`Storm runs (>= ${summary.storm_threshold_per_run}): ${summary.storm_runs}`);
  console.log(`Adjusted storm runs (>= ${summary.storm_threshold_per_run}): ${summary.adjusted_storm_runs}`);
  console.log(`Max fallback per run: ${summary.max_fallback_per_run}`);
  console.log(`Adjusted max fallback per run: ${summary.adjusted_max_fallback_per_run}`);
  console.log(`L3 repeated fallback: ${summary.l3_repeated_fallback}`);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { absolute, events } = readNdjson(args.file);
    const runs = buildFallbackRunBuckets(events, args);
    const summary = summarizeFallbackRuns(runs, args.stormThreshold);
    const payload = {
      ts: new Date().toISOString(),
      source_file: absolute,
      filters: {
        run_id: args.runId || null,
        run_prefix: args.runPrefix || null,
        limit_runs: args.limitRuns,
        storm_threshold: args.stormThreshold,
      },
      summary,
      runs,
    };
    const outWrite = writeJson(args.out, payload);
    payload.output_file = outWrite.path;
    payload.output_written = outWrite.written;

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      printHuman(summary);
      console.log(`Report file: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
