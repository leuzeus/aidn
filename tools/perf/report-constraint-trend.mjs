#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { isJsonEquivalent, writeJsonIfChanged } from "./io-lib.mjs";

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

function topCounts(mapLike, keyLabel, limit = 10) {
  return Array.from(mapLike.entries())
    .map(([key, count]) => ({ [keyLabel]: key, count }))
    .sort((a, b) => b.count - a.count || String(a[keyLabel]).localeCompare(String(b[keyLabel])))
    .slice(0, limit);
}

function summarize(runs) {
  const total = runs.length;
  const constraints = new Map();
  const actions = new Map();
  let switches = 0;
  let transitions = 0;
  let avgControlShare = 0;
  let avgActiveShare = 0;
  let highSeverityRuns = 0;
  let quickWinTopRuns = 0;

  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    const skill = String(run?.active_constraint_skill ?? "").trim() || "none";
    const topAction = String(run?.top_action_id ?? "").trim();
    const topActionBatch = String(run?.top_action_batch ?? "").trim();
    const severity = String(run?.active_constraint_severity ?? "").trim();
    constraints.set(skill, (constraints.get(skill) ?? 0) + 1);
    if (topAction) {
      actions.set(topAction, (actions.get(topAction) ?? 0) + 1);
    }
    if (severity === "high") {
      highSeverityRuns += 1;
    }
    if (topActionBatch === "quick-win") {
      quickWinTopRuns += 1;
    }
    avgControlShare += Number(run?.control_share_of_total ?? 0);
    avgActiveShare += Number(run?.active_constraint_share ?? 0);

    if (i > 0) {
      transitions += 1;
      const previousSkill = String(runs[i - 1]?.active_constraint_skill ?? "").trim() || "none";
      if (previousSkill !== skill) {
        switches += 1;
      }
    }
  }

  const topConstraints = topCounts(constraints, "skill", 10);
  const topActions = topCounts(actions, "action_id", 10);
  const dominant = topConstraints[0] ?? null;
  const avgControl = total > 0 ? avgControlShare / total : 0;
  const avgActive = total > 0 ? avgActiveShare / total : 0;
  const stabilityRate = transitions > 0 ? (transitions - switches) / transitions : 1;

  return {
    runs_analyzed: total,
    unique_constraints: constraints.size,
    dominant_constraint_skill: dominant?.skill ?? null,
    dominant_constraint_share: dominant ? dominant.count / total : 0,
    constraint_switches: switches,
    constraint_stability_rate: stabilityRate,
    avg_control_share_of_total: avgControl,
    avg_active_constraint_share: avgActive,
    high_severity_runs: highSeverityRuns,
    quick_win_top_runs: quickWinTopRuns,
    top_constraints: topConstraints,
    top_actions: topActions,
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
