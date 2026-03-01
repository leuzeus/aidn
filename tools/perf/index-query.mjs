#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    indexFile: ".aidn/runtime/index/workflow-index.json",
    query: "active-cycles",
    since: "",
    cycleId: "",
    limit: 30,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--query") {
      args.query = String(argv[i + 1] ?? "").toLowerCase();
      i += 1;
    } else if (token === "--since") {
      args.since = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--cycle-id") {
      args.cycleId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--limit") {
      args.limit = Number(argv[i + 1] ?? "30");
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

  if (!args.indexFile) {
    throw new Error("Missing value for --index-file");
  }
  if (!["active-cycles", "artifacts-since", "cycle-files"].includes(args.query)) {
    throw new Error("Invalid --query. Expected active-cycles|artifacts-since|cycle-files");
  }
  if (args.query === "artifacts-since" && !args.since) {
    throw new Error("Missing --since for query artifacts-since");
  }
  if (args.query === "cycle-files" && !args.cycleId) {
    throw new Error("Missing --cycle-id for query cycle-files");
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) {
    throw new Error("Invalid --limit. Expected positive number.");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/index-query.mjs --query active-cycles");
  console.log("  node tools/perf/index-query.mjs --query artifacts-since --since 2026-03-01T00:00:00Z");
  console.log("  node tools/perf/index-query.mjs --query cycle-files --cycle-id C118");
}

function readIndex(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Index file not found: ${absolute}`);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${absolute}: ${error.message}`);
  }
  return { absolute, data };
}

function toTimestamp(value) {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function queryActiveCycles(indexData, limit) {
  const rows = Array.isArray(indexData.cycles) ? indexData.cycles : [];
  const active = rows.filter((row) => ["OPEN", "IMPLEMENTING", "VERIFYING"].includes(String(row.state ?? "").toUpperCase()));
  active.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  return active.slice(0, limit).map((row) => ({
    cycle_id: row.cycle_id,
    state: row.state,
    branch_name: row.branch_name,
    dor_state: row.dor_state,
    updated_at: row.updated_at,
  }));
}

function queryArtifactsSince(indexData, sinceIso, limit) {
  const sinceTs = toTimestamp(sinceIso);
  if (sinceTs == null) {
    throw new Error(`Invalid ISO timestamp for --since: ${sinceIso}`);
  }
  const rows = Array.isArray(indexData.artifacts) ? indexData.artifacts : [];
  const filtered = rows.filter((row) => {
    const ts = toTimestamp(row.updated_at);
    return ts != null && ts > sinceTs;
  });
  filtered.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  return filtered.slice(0, limit).map((row) => ({
    path: row.path,
    kind: row.kind,
    sha256: row.sha256,
    updated_at: row.updated_at,
  }));
}

function queryCycleFiles(indexData, cycleId, limit) {
  const rows = Array.isArray(indexData.file_map) ? indexData.file_map : [];
  const filtered = rows.filter((row) => String(row.cycle_id) === String(cycleId));
  filtered.sort((a, b) => String(b.last_seen_at ?? "").localeCompare(String(a.last_seen_at ?? "")));
  return filtered.slice(0, limit).map((row) => ({
    cycle_id: row.cycle_id,
    path: row.path,
    role: row.role,
    last_seen_at: row.last_seen_at,
  }));
}

function runQuery(indexData, args) {
  if (args.query === "active-cycles") {
    return queryActiveCycles(indexData, args.limit);
  }
  if (args.query === "artifacts-since") {
    return queryArtifactsSince(indexData, args.since, args.limit);
  }
  if (args.query === "cycle-files") {
    return queryCycleFiles(indexData, args.cycleId, args.limit);
  }
  return [];
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { absolute, data } = readIndex(args.indexFile);
    const rows = runQuery(data, args);
    const payload = {
      source_index: absolute,
      query: args.query,
      count: rows.length,
      rows,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Query: ${payload.query}`);
    console.log(`Index: ${payload.source_index}`);
    console.log(`Rows: ${payload.count}`);
    for (const row of payload.rows) {
      console.log(JSON.stringify(row));
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
