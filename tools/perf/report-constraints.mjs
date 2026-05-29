#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildConstraintReport } from "../../src/application/observability/constraint-report-use-case.mjs";
import { writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    file: ".aidn/runtime/perf/workflow-events.ndjson",
    runId: "",
    runPrefix: "",
    out: "",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") {
      args.file = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--run-id") {
      args.runId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--run-prefix") {
      args.runPrefix = argv[i + 1] ?? "";
      i += 1;
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/report-constraints.mjs");
  console.log("  node tools/perf/report-constraints.mjs --file .aidn/runtime/perf/workflow-events.ndjson");
  console.log("  node tools/perf/report-constraints.mjs --run-prefix session- --out .aidn/runtime/perf/constraint-report.json");
  console.log("  node tools/perf/report-constraints.mjs --json");
}

function parseNdjson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`NDJSON file not found: ${absolute}`);
  }
  const lines = fs.readFileSync(absolute, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
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

function formatPct(value) {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { events, absolute } = parseNdjson(args.file);
    let filtered = [...events];
    if (args.runId) {
      filtered = filtered.filter((event) => String(event.run_id ?? "") === args.runId);
    }
    if (args.runPrefix) {
      filtered = filtered.filter((event) => String(event.run_id ?? "").startsWith(args.runPrefix));
    }

    const summarized = buildConstraintReport(filtered);
    const payload = {
      ts: new Date().toISOString(),
      source_file: absolute,
      filters: {
        run_id: args.runId || null,
        run_prefix: args.runPrefix || null,
      },
      summary: summarized.summary,
      skills: summarized.skills,
    };

    let outWrite = null;
    if (args.out) {
      outWrite = writeJsonIfChanged(args.out, payload);
      payload.output_file = outWrite.path;
      payload.output_written = outWrite.written;
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Source: ${payload.source_file}`);
    console.log(`Events analyzed: ${payload.summary.events_analyzed}`);
    console.log(`Runs analyzed: ${payload.summary.runs_analyzed}`);
    console.log(`Control share of total duration: ${formatPct(payload.summary.control_share_of_total)}`);
    if (payload.summary.active_constraint) {
      console.log(`Active constraint: ${payload.summary.active_constraint.skill} (${payload.summary.active_constraint.signal}, share=${formatPct(payload.summary.active_constraint.share)}, severity=${payload.summary.active_constraint.severity})`);
      console.log(`Recommendation: ${payload.summary.active_constraint.recommendation}`);
    } else {
      console.log("Active constraint: n/a");
    }
    if (outWrite != null) {
      console.log(`Report file: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
