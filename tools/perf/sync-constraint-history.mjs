#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    reportFile: ".aidn/runtime/perf/constraint-report.json",
    actionsFile: "",
    historyFile: ".aidn/runtime/perf/constraint-history.ndjson",
    maxRuns: 200,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--report-file") {
      args.reportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--actions-file") {
      args.actionsFile = argv[i + 1] ?? "";
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

  if (!args.reportFile) {
    throw new Error("Missing value for --report-file");
  }
  if (!args.historyFile) {
    throw new Error("Missing value for --history-file");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/sync-constraint-history.mjs");
  console.log("  node tools/perf/sync-constraint-history.mjs --report-file .aidn/runtime/perf/constraint-report.json --actions-file .aidn/runtime/perf/constraint-actions.json --history-file .aidn/runtime/perf/constraint-history.ndjson");
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

function readJsonOptional(filePath) {
  if (!filePath) {
    return null;
  }
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return null;
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch {
    return null;
  }
}

function readNdjsonOptional(filePath) {
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

function buildRunId(report) {
  const summary = report?.summary ?? {};
  const skill = String(summary?.active_constraint?.skill ?? "none");
  const events = Number(summary?.events_analyzed ?? 0);
  const runs = Number(summary?.runs_analyzed ?? 0);
  const total = Number(summary?.duration_total_ms ?? 0);
  return `${skill}:${events}:${runs}:${total}`;
}

function normalize(report, actions) {
  const summary = report?.summary ?? {};
  const active = summary?.active_constraint ?? null;
  const topAction = Array.isArray(actions?.actions) ? actions.actions[0] : null;
  return {
    ts: report?.ts ?? new Date().toISOString(),
    run_id: buildRunId(report),
    source_file: report?.source_file ?? null,
    events_analyzed: Number(summary?.events_analyzed ?? 0),
    runs_analyzed: Number(summary?.runs_analyzed ?? 0),
    control_share_of_total: Number(summary?.control_share_of_total ?? 0),
    active_constraint_skill: active?.skill ?? null,
    active_constraint_share: Number(active?.share ?? 0),
    active_constraint_severity: active?.severity ?? null,
    active_constraint_signal: active?.signal ?? null,
    threshold_status: actions?.summary?.threshold_status ?? null,
    top_action_id: topAction?.action_id ?? null,
    top_action_batch: topAction?.batch ?? null,
    top_action_priority: topAction?.priority_score ?? null,
  };
}

function dedupeAndSort(runs) {
  const byRunId = new Map();
  for (const run of runs) {
    const runId = String(run?.run_id ?? "").trim();
    if (!runId) {
      continue;
    }
    byRunId.set(runId, run);
  }
  return Array.from(byRunId.values()).sort((a, b) => String(b.ts ?? "").localeCompare(String(a.ts ?? "")));
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
    const report = readJson(args.reportFile, "Constraint report");
    const actions = readJsonOptional(args.actionsFile);
    const history = readNdjsonOptional(args.historyFile);

    const current = normalize(report.data, actions?.data ?? null);
    const merged = dedupeAndSort([current, ...history.runs]).slice(0, args.maxRuns);
    const historyPath = writeHistory(args.historyFile, merged);

    const payload = {
      ts: new Date().toISOString(),
      report_file: report.absolute,
      actions_file: actions?.absolute ?? null,
      history_file: historyPath,
      appended_run_id: current.run_id,
      runs_total: merged.length,
      latest: current,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`History file: ${historyPath}`);
    console.log(`Runs total: ${merged.length}`);
    console.log(`Active constraint: ${current.active_constraint_skill ?? "n/a"}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
