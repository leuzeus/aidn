#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { computeCampaignRuns, summarizeCampaignRuns } from "../../src/application/observability/campaign-kpi-report-use-case.mjs";

function parseArgs(argv) {
  const args = {
    file: ".aidn/runtime/perf/workflow-events.ndjson",
    json: false,
    runId: "",
    runPrefix: "",
    requireDelivery: false,
    limit: 20,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") {
      args.file = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--run-id") {
      args.runId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--run-prefix") {
      args.runPrefix = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--require-delivery") {
      args.requireDelivery = true;
    } else if (token === "--limit") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--limit must be an integer");
      }
      args.limit = Number(raw);
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

  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/report-kpi.mjs");
  console.log("  node tools/perf/report-kpi.mjs --file .aidn/runtime/perf/workflow-events.ndjson");
  console.log("  node tools/perf/report-kpi.mjs --run-id S072-20260301T1012Z");
  console.log("  node tools/perf/report-kpi.mjs --run-prefix session- --require-delivery");
  console.log("  node tools/perf/report-kpi.mjs --json");
}

function parseNdjson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`NDJSON file not found: ${absolute}`);
  }
  const content = fs.readFileSync(absolute, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const events = [];
  for (let i = 0; i < lines.length; i += 1) {
    try {
      events.push(JSON.parse(lines[i]));
    } catch (error) {
      throw new Error(`Invalid JSON at line ${i + 1}: ${error.message}`);
    }
  }
  return { events, absolute };
}

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return Number(value).toFixed(digits);
}

function printTable(runs) {
  const header = [
    "run_id".padEnd(24),
    "overhead".padStart(9),
    "churn".padStart(7),
    "gates".padStart(7),
    "events".padStart(7),
  ].join("  ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const run of runs) {
    const row = [
      String(run.run_id).slice(0, 24).padEnd(24),
      formatNumber(run.overhead_ratio, 3).padStart(9),
      String(run.artifacts_churn).padStart(7),
      String(run.gates_frequency).padStart(7),
      String(run.events_count).padStart(7),
    ].join("  ");
    console.log(row);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { events, absolute } = parseNdjson(args.file);
    let runs = computeCampaignRuns(events);

    if (args.runId) {
      runs = runs.filter((run) => run.run_id === args.runId);
    }
    if (args.runPrefix) {
      runs = runs.filter((run) => String(run.run_id).startsWith(args.runPrefix));
    }
    if (args.requireDelivery) {
      runs = runs.filter((run) => run.delivery_time_ms > 0);
    }
    if (args.limit > 0 && runs.length > args.limit) {
      runs = runs.slice(0, args.limit);
    }

    const summary = summarizeCampaignRuns(runs);
    const payload = {
      source_file: absolute,
      filters: {
        run_id: args.runId || null,
        run_prefix: args.runPrefix || null,
        require_delivery: args.requireDelivery,
        limit: args.limit,
      },
      summary,
      runs,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Source: ${absolute}`);
    console.log(`Runs analyzed: ${summary.runs_analyzed}`);
    console.log(
      `Overhead ratio (mean/median/p90): ${formatNumber(summary.overhead_ratio.mean, 3)} / ${formatNumber(summary.overhead_ratio.median, 3)} / ${formatNumber(summary.overhead_ratio.p90, 3)}`,
    );
    console.log(
      `Artifacts churn (mean/median/p90): ${formatNumber(summary.artifacts_churn.mean, 2)} / ${formatNumber(summary.artifacts_churn.median, 2)} / ${formatNumber(summary.artifacts_churn.p90, 2)}`,
    );
    console.log(
      `Gates frequency (mean/median/p90): ${formatNumber(summary.gates_frequency.mean, 2)} / ${formatNumber(summary.gates_frequency.median, 2)} / ${formatNumber(summary.gates_frequency.p90, 2)}`,
    );
    console.log("");
    printTable(runs);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
