#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function getDatabaseSync() {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch (error) {
    throw new Error(`SQLite backend unavailable: ${error.message}`);
  }
}

function parseArgs(argv) {
  const args = {
    indexFile: ".aidn/runtime/index/workflow-index.json",
    backend: "auto",
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
    } else if (token === "--backend") {
      args.backend = String(argv[i + 1] ?? "").toLowerCase();
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
  if (!["auto", "json", "sqlite"].includes(args.backend)) {
    throw new Error("Invalid --backend. Expected auto|json|sqlite");
  }
  if (!["active-cycles", "artifacts-since", "cycle-files", "run-metrics", "canonical-coverage"].includes(args.query)) {
    throw new Error("Invalid --query. Expected active-cycles|artifacts-since|cycle-files|run-metrics|canonical-coverage");
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
  console.log("  node tools/perf/index-query.mjs --query active-cycles --index-file .aidn/runtime/index/workflow-index.sqlite --backend sqlite");
  console.log("  node tools/perf/index-query.mjs --query artifacts-since --since 2026-03-01T00:00:00Z");
  console.log("  node tools/perf/index-query.mjs --query cycle-files --cycle-id C118");
  console.log("  node tools/perf/index-query.mjs --query run-metrics --limit 30");
  console.log("  node tools/perf/index-query.mjs --query canonical-coverage");
}

function detectBackend(indexFile, backend) {
  if (backend === "json" || backend === "sqlite") {
    return backend;
  }
  return String(indexFile).toLowerCase().endsWith(".sqlite") ? "sqlite" : "json";
}

function readJsonIndex(filePath) {
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

function openSqlite(filePath) {
  const DatabaseSync = getDatabaseSync();
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Index sqlite file not found: ${absolute}`);
  }
  const db = new DatabaseSync(absolute);
  return { absolute, db };
}

function getSqliteColumns(db, tableName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName});`).all();
  const out = new Set();
  for (const row of rows) {
    if (typeof row?.name === "string") {
      out.add(row.name);
    }
  }
  return out;
}

function toTimestamp(value) {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function queryActiveCyclesJson(indexData, limit) {
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

function queryArtifactsSinceJson(indexData, sinceIso, limit) {
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
    family: row.family ?? "unknown",
    subtype: row.subtype ?? null,
    gate_relevance: Number(row.gate_relevance ?? 0),
    classification_reason: row.classification_reason ?? null,
    sha256: row.sha256,
    updated_at: row.updated_at,
  }));
}

function queryCycleFilesJson(indexData, cycleId, limit) {
  const rows = Array.isArray(indexData.file_map) ? indexData.file_map : [];
  const filtered = rows.filter((row) => String(row.cycle_id) === String(cycleId));
  filtered.sort((a, b) => String(b.last_seen_at ?? "").localeCompare(String(a.last_seen_at ?? "")));
  return filtered.slice(0, limit).map((row) => ({
    cycle_id: row.cycle_id,
    path: row.path,
    role: row.role,
    relation: row.relation ?? "unknown",
    last_seen_at: row.last_seen_at,
  }));
}

function queryRunMetricsJson(indexData, limit) {
  const rows = Array.isArray(indexData.run_metrics) ? indexData.run_metrics : [];
  const sorted = [...rows].sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")));
  return sorted.slice(0, limit).map((row) => ({
    run_id: row.run_id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    overhead_ratio: row.overhead_ratio,
    artifacts_churn: row.artifacts_churn,
    gates_frequency: row.gates_frequency,
  }));
}

function queryCanonicalCoverageJson(indexData) {
  const artifacts = Array.isArray(indexData.artifacts) ? indexData.artifacts : [];
  const artifactsCount = artifacts.length;
  const artifactsWithCanonical = artifacts.filter((row) => {
    if (row?.canonical && typeof row.canonical === "object") {
      return true;
    }
    if (typeof row?.canonical_json === "string" && row.canonical_json.trim().length > 0) {
      return true;
    }
    return typeof row?.canonical_format === "string" && row.canonical_format.trim().length > 0;
  }).length;
  const markdownArtifacts = artifacts.filter((row) => String(row?.path ?? "").toLowerCase().endsWith(".md"));
  const markdownCount = markdownArtifacts.length;
  const markdownWithCanonical = markdownArtifacts.filter((row) => {
    if (row?.canonical && typeof row.canonical === "object") {
      return true;
    }
    if (typeof row?.canonical_json === "string" && row.canonical_json.trim().length > 0) {
      return true;
    }
    return typeof row?.canonical_format === "string" && row.canonical_format.trim().length > 0;
  }).length;

  return [{
    artifacts: artifactsCount,
    artifacts_with_canonical: artifactsWithCanonical,
    artifacts_markdown: markdownCount,
    artifacts_markdown_with_canonical: markdownWithCanonical,
    canonical_coverage_ratio: artifactsCount > 0
      ? Number((artifactsWithCanonical / artifactsCount).toFixed(4))
      : 0,
    canonical_coverage_ratio_markdown: markdownCount > 0
      ? Number((markdownWithCanonical / markdownCount).toFixed(4))
      : 0,
  }];
}

function runJsonQuery(indexData, args) {
  if (args.query === "active-cycles") {
    return queryActiveCyclesJson(indexData, args.limit);
  }
  if (args.query === "artifacts-since") {
    return queryArtifactsSinceJson(indexData, args.since, args.limit);
  }
  if (args.query === "cycle-files") {
    return queryCycleFilesJson(indexData, args.cycleId, args.limit);
  }
  if (args.query === "run-metrics") {
    return queryRunMetricsJson(indexData, args.limit);
  }
  if (args.query === "canonical-coverage") {
    return queryCanonicalCoverageJson(indexData);
  }
  return [];
}

function runSqliteQuery(db, args) {
  if (args.query === "active-cycles") {
    return db.prepare(`
      SELECT cycle_id, state, branch_name, dor_state, updated_at
      FROM cycles
      WHERE UPPER(state) IN ('OPEN', 'IMPLEMENTING', 'VERIFYING')
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(args.limit);
  }
  if (args.query === "artifacts-since") {
    const columns = getSqliteColumns(db, "artifacts");
    const familyExpr = columns.has("family") ? "family" : "'unknown' AS family";
    const subtypeExpr = columns.has("subtype") ? "subtype" : "NULL AS subtype";
    const gateExpr = columns.has("gate_relevance") ? "gate_relevance" : "0 AS gate_relevance";
    const reasonExpr = columns.has("classification_reason") ? "classification_reason" : "NULL AS classification_reason";
    return db.prepare(`
      SELECT path, kind, ${familyExpr}, ${subtypeExpr}, ${gateExpr}, ${reasonExpr}, sha256, updated_at
      FROM artifacts
      WHERE updated_at > ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(args.since, args.limit);
  }
  if (args.query === "cycle-files") {
    const columns = getSqliteColumns(db, "file_map");
    const relationExpr = columns.has("relation") ? "relation" : "'unknown' AS relation";
    return db.prepare(`
      SELECT cycle_id, path, role, ${relationExpr}, last_seen_at
      FROM file_map
      WHERE cycle_id = ?
      ORDER BY last_seen_at DESC
      LIMIT ?
    `).all(args.cycleId, args.limit);
  }
  if (args.query === "run-metrics") {
    return db.prepare(`
      SELECT run_id, started_at, ended_at, overhead_ratio, artifacts_churn, gates_frequency
      FROM run_metrics
      ORDER BY started_at DESC
      LIMIT ?
    `).all(args.limit);
  }
  if (args.query === "canonical-coverage") {
    const columns = getSqliteColumns(db, "artifacts");
    const canonicalJsonExpr = columns.has("canonical_json")
      ? "(canonical_json IS NOT NULL AND TRIM(canonical_json) <> '')"
      : "0";
    const canonicalFormatExpr = columns.has("canonical_format")
      ? "(canonical_format IS NOT NULL AND TRIM(canonical_format) <> '')"
      : "0";
    const hasCanonicalExpr = `(${canonicalJsonExpr} OR ${canonicalFormatExpr})`;
    const row = db.prepare(`
      SELECT
        COUNT(*) AS artifacts,
        SUM(CASE WHEN ${hasCanonicalExpr} THEN 1 ELSE 0 END) AS artifacts_with_canonical,
        SUM(CASE WHEN LOWER(path) LIKE '%.md' THEN 1 ELSE 0 END) AS artifacts_markdown,
        SUM(CASE WHEN LOWER(path) LIKE '%.md' AND ${hasCanonicalExpr} THEN 1 ELSE 0 END) AS artifacts_markdown_with_canonical
      FROM artifacts
    `).get();
    const artifacts = Number(row?.artifacts ?? 0);
    const artifactsWithCanonical = Number(row?.artifacts_with_canonical ?? 0);
    const artifactsMarkdown = Number(row?.artifacts_markdown ?? 0);
    const artifactsMarkdownWithCanonical = Number(row?.artifacts_markdown_with_canonical ?? 0);
    return [{
      artifacts,
      artifacts_with_canonical: artifactsWithCanonical,
      artifacts_markdown: artifactsMarkdown,
      artifacts_markdown_with_canonical: artifactsMarkdownWithCanonical,
      canonical_coverage_ratio: artifacts > 0
        ? Number((artifactsWithCanonical / artifacts).toFixed(4))
        : 0,
      canonical_coverage_ratio_markdown: artifactsMarkdown > 0
        ? Number((artifactsMarkdownWithCanonical / artifactsMarkdown).toFixed(4))
        : 0,
    }];
  }
  return [];
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const backend = detectBackend(args.indexFile, args.backend);
    let sourceIndex = "";
    let rows = [];

    if (backend === "sqlite") {
      const { absolute, db } = openSqlite(args.indexFile);
      sourceIndex = absolute;
      try {
        rows = runSqliteQuery(db, args);
      } finally {
        db.close();
      }
    } else {
      const { absolute, data } = readJsonIndex(args.indexFile);
      sourceIndex = absolute;
      rows = runJsonQuery(data, args);
    }

    const payload = {
      source_index: sourceIndex,
      backend,
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
