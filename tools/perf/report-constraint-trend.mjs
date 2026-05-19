#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildConstraintTrendReport } from "../../src/application/observability/constraint-trend-report-use-case.mjs";
import { isJsonEquivalent, writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    historyFile: ".aidn/runtime/perf/constraint-history.ndjson",
    out: ".aidn/runtime/perf/constraint-trend.json",
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
  console.log("  node tools/perf/report-constraint-trend.mjs");
  console.log("  node tools/perf/report-constraint-trend.mjs --history-file .aidn/runtime/perf/constraint-history.ndjson --out .aidn/runtime/perf/constraint-trend.json");
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
    const summary = buildConstraintTrendReport(runs);
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
    console.log(`Dominant constraint: ${summary.dominant_constraint_skill ?? "n/a"}`);
    console.log(`Constraint stability rate: ${summary.constraint_stability_rate}`);
    console.log(`Report file: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
