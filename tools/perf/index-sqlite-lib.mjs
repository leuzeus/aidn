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

function parseJsonOrNull(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readMetaMap(db) {
  const hasMeta = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'index_meta'
  `).get();
  if (!hasMeta) {
    return {};
  }
  const rows = db.prepare("SELECT key, value FROM index_meta").all();
  const meta = {};
  for (const row of rows) {
    if (typeof row?.key === "string") {
      meta[row.key] = row.value ?? null;
    }
  }
  return meta;
}

function readRows(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

function getTableColumns(db, tableName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName});`).all();
  const set = new Set();
  for (const row of rows) {
    if (typeof row?.name === "string") {
      set.add(row.name);
    }
  }
  return set;
}

function toSchemaVersion(value, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function buildSummary(payload, structureKindHint = null) {
  return {
    cycles_count: Array.isArray(payload.cycles) ? payload.cycles.length : 0,
    artifacts_count: Array.isArray(payload.artifacts) ? payload.artifacts.length : 0,
    file_map_count: Array.isArray(payload.file_map) ? payload.file_map.length : 0,
    tags_count: Array.isArray(payload.tags) ? payload.tags.length : 0,
    run_metrics_count: Array.isArray(payload.run_metrics) ? payload.run_metrics.length : 0,
    structure_kind: structureKindHint ?? "unknown",
  };
}

export function readIndexFromSqlite(sqliteFile, options = {}) {
  const DatabaseSync = getDatabaseSync();
  const absolute = path.resolve(process.cwd(), sqliteFile);
  if (!fs.existsSync(absolute)) {
    throw new Error(`SQLite index file not found: ${absolute}`);
  }

  const db = new DatabaseSync(absolute);
  try {
    const meta = readMetaMap(db);
    const artifactColumns = getTableColumns(db, "artifacts");
    const fileMapColumns = getTableColumns(db, "file_map");
    const structureProfile = parseJsonOrNull(meta.structure_profile_json);
    const structureKind = meta.structure_kind
      ?? structureProfile?.kind
      ?? "unknown";

    const payload = {
      schema_version: toSchemaVersion(meta.schema_version, 1),
      generated_at: options.generatedAt ?? new Date().toISOString(),
      target_root: meta.target_root ?? null,
      audit_root: meta.audit_root ?? null,
      structure_profile: structureProfile ?? null,
      cycles: readRows(db, `
        SELECT cycle_id, session_id, state, outcome, branch_name, dor_state,
               continuity_rule, continuity_base_branch, continuity_latest_cycle_branch, updated_at
        FROM cycles
        ORDER BY cycle_id ASC
      `),
      artifacts: readRows(db, `
        SELECT path, kind,
               ${artifactColumns.has("family") ? "family" : "'unknown' AS family"},
               ${artifactColumns.has("subtype") ? "subtype" : "NULL AS subtype"},
               ${artifactColumns.has("gate_relevance") ? "gate_relevance" : "0 AS gate_relevance"},
               ${artifactColumns.has("classification_reason") ? "classification_reason" : "NULL AS classification_reason"},
               ${artifactColumns.has("content_format") ? "content_format" : "NULL AS content_format"},
               ${artifactColumns.has("content") ? "content" : "NULL AS content"},
               sha256, size_bytes, CAST(mtime_ns AS TEXT) AS mtime_ns, session_id, cycle_id, updated_at
        FROM artifacts
        ORDER BY path ASC
      `),
      file_map: readRows(db, `
        SELECT cycle_id, path, role,
               ${fileMapColumns.has("relation") ? "relation" : "'unknown' AS relation"},
               last_seen_at
        FROM file_map
        ORDER BY cycle_id ASC, path ASC
      `),
      tags: readRows(db, `
        SELECT tag
        FROM tags
        ORDER BY tag ASC
      `),
      artifact_tags: readRows(db, `
        SELECT a.path AS path, t.tag AS tag
        FROM artifact_tags at
        JOIN artifacts a ON a.artifact_id = at.artifact_id
        JOIN tags t ON t.tag_id = at.tag_id
        ORDER BY a.path ASC, t.tag ASC
      `),
      run_metrics: readRows(db, `
        SELECT run_id, started_at, ended_at, overhead_ratio, artifacts_churn, gates_frequency
        FROM run_metrics
        ORDER BY started_at DESC, run_id ASC
      `),
    };
    payload.summary = buildSummary(payload, structureKind);
    return { absolute, payload, meta };
  } finally {
    db.close();
  }
}
