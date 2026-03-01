#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CONTROL_SKILLS = new Set([
  "context-reload",
  "start-session",
  "branch-cycle-audit",
  "drift-check",
  "close-session",
]);

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

function toInt(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return fallback;
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

function eventIsControl(event) {
  if (typeof event.control === "boolean") {
    return event.control;
  }
  if (Array.isArray(event.gates_triggered) && event.gates_triggered.length > 0) {
    return true;
  }
  if (CONTROL_SKILLS.has(String(event.skill ?? ""))) {
    return true;
  }
  const phase = String(event.phase ?? "").toLowerCase();
  if (phase === "check" || phase === "fallback" || phase === "write") {
    return true;
  }
  return false;
}

function computeRuns(events) {
  const runs = new Map();
  for (const event of events) {
    const runId = String(event.run_id ?? "unknown");
    if (!runs.has(runId)) {
      runs.set(runId, {
        run_id: runId,
        started_at: event.ts ?? null,
        ended_at: event.ts ?? null,
        control_time_ms: 0,
        delivery_time_ms: 0,
        gates_executed: 0,
        stops: 0,
        churn_ops: 0,
        events_count: 0,
      });
    }

    const bucket = runs.get(runId);
    const durationMs = toInt(event.duration_ms, 0);
    const gatesTriggered = Array.isArray(event.gates_triggered) ? event.gates_triggered.length : 0;
    const stops = String(event.result ?? "").toLowerCase() === "stop" ? 1 : 0;
    const artifactWrites = toInt(event.artifact_writes, 0);
    const artifactRewrites = toInt(event.artifact_rewrites, 0);
    const artifactDeletes = toInt(event.artifact_deletes, 0);
    const filesWritten = toInt(event.files_written_count, 0);
    const churnOps = artifactWrites + artifactRewrites + artifactDeletes + filesWritten;

    if (eventIsControl(event)) {
      bucket.control_time_ms += durationMs;
    } else {
      bucket.delivery_time_ms += durationMs;
    }
    bucket.gates_executed += gatesTriggered;
    bucket.stops += stops;
    bucket.churn_ops += churnOps;
    bucket.events_count += 1;

    if (event.ts && (!bucket.started_at || event.ts < bucket.started_at)) {
      bucket.started_at = event.ts;
    }
    if (event.ts && (!bucket.ended_at || event.ts > bucket.ended_at)) {
      bucket.ended_at = event.ts;
    }
  }

  const out = [];
  for (const run of runs.values()) {
    const overheadRatio = run.delivery_time_ms > 0
      ? run.control_time_ms / run.delivery_time_ms
      : null;
    const artifactsChurn = run.churn_ops;
    const gatesFrequency = run.gates_executed;
    const gatesStopRate = run.gates_executed > 0
      ? run.stops / run.gates_executed
      : 0;

    out.push({
      ...run,
      overhead_ratio: overheadRatio,
      artifacts_churn: artifactsChurn,
      gates_frequency: gatesFrequency,
      gates_stop_rate: gatesStopRate,
    });
  }

  out.sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")));
  return out;
}

function mean(values) {
  if (!values.length) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
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

function p90(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1);
  return sorted[index];
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

function summarize(runs) {
  const overheadValues = runs.map((run) => run.overhead_ratio).filter((value) => value != null);
  const churnValues = runs.map((run) => run.artifacts_churn);
  const gatesValues = runs.map((run) => run.gates_frequency);

  return {
    runs_analyzed: runs.length,
    overhead_ratio: {
      mean: mean(overheadValues),
      median: median(overheadValues),
      p90: p90(overheadValues),
    },
    artifacts_churn: {
      mean: mean(churnValues),
      median: median(churnValues),
      p90: p90(churnValues),
    },
    gates_frequency: {
      mean: mean(gatesValues),
      median: median(gatesValues),
      p90: p90(gatesValues),
    },
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { events, absolute } = parseNdjson(args.file);
    let runs = computeRuns(events);

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

    const summary = summarize(runs);
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
