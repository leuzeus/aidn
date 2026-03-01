#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    checkFile: ".aidn/runtime/index/index-sync-check.json",
    historyFile: ".aidn/runtime/index/index-sync-history.ndjson",
    maxRuns: 200,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--check-file") {
      args.checkFile = argv[i + 1] ?? "";
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

  if (!args.checkFile) {
    throw new Error("Missing value for --check-file");
  }
  if (!args.historyFile) {
    throw new Error("Missing value for --history-file");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/sync-index-sync-history.mjs");
  console.log("  node tools/perf/sync-index-sync-history.mjs --check-file .aidn/runtime/index/index-sync-check.json --history-file .aidn/runtime/index/index-sync-history.ndjson --max-runs 200");
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

function normalizeCheck(payload) {
  const mismatches = Array.isArray(payload?.summary_mismatches) ? payload.summary_mismatches : [];
  const mismatchKeys = mismatches
    .map((item) => String(item?.key ?? "").trim())
    .filter((key) => key.length > 0);
  const applied = payload?.apply_result?.writes ?? {};

  return {
    ts: payload?.ts ?? new Date().toISOString(),
    run_id: `${payload?.target_root ?? "unknown"}::${payload?.expected?.digest ?? "n/a"}::${payload?.ts ?? "n/a"}`,
    target_root: payload?.target_root ?? null,
    in_sync: payload?.in_sync === true,
    drift_level: payload?.drift_level ?? "none",
    reason_codes: Array.isArray(payload?.reason_codes) ? payload.reason_codes : [],
    action: payload?.action ?? null,
    expected_digest: payload?.expected?.digest ?? null,
    current_digest: payload?.current?.digest ?? null,
    mismatch_count: mismatchKeys.length,
    mismatch_keys: mismatchKeys,
    structure_kind: payload?.expected?.summary?.structure_kind ?? null,
    applied_files_written: Number(applied.files_written_count ?? 0),
    applied_bytes_written: Number(applied.bytes_written ?? 0),
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
  return Array.from(byRunId.values()).sort((a, b) =>
    String(b.ts ?? "").localeCompare(String(a.ts ?? "")));
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
    const check = readJson(args.checkFile, "Index sync check");
    const history = readNdjsonOptional(args.historyFile);

    const current = normalizeCheck(check.data);
    const merged = dedupeAndSort([current, ...history.runs]).slice(0, args.maxRuns);
    const historyPath = writeHistory(args.historyFile, merged);

    const output = {
      ts: new Date().toISOString(),
      check_file: check.absolute,
      history_file: historyPath,
      appended_run_id: current.run_id,
      runs_total: merged.length,
      latest: current,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`History file: ${historyPath}`);
      console.log(`Runs total: ${merged.length}`);
      console.log(`Latest in_sync: ${current.in_sync ? "yes" : "no"}`);
      console.log(`Latest mismatch_count: ${current.mismatch_count}`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
