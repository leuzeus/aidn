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

function hasTable(db, tableName) {
  const row = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName);
  return Boolean(row);
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
    sessions_count: Array.isArray(payload.sessions) ? payload.sessions.length : 0,
    artifacts_count: Array.isArray(payload.artifacts) ? payload.artifacts.length : 0,
    file_map_count: Array.isArray(payload.file_map) ? payload.file_map.length : 0,
    tags_count: Array.isArray(payload.tags) ? payload.tags.length : 0,
    run_metrics_count: Array.isArray(payload.run_metrics) ? payload.run_metrics.length : 0,
    artifact_links_count: Array.isArray(payload.artifact_links) ? payload.artifact_links.length : 0,
    cycle_links_count: Array.isArray(payload.cycle_links) ? payload.cycle_links.length : 0,
    session_cycle_links_count: Array.isArray(payload.session_cycle_links) ? payload.session_cycle_links.length : 0,
    session_links_count: Array.isArray(payload.session_links) ? payload.session_links.length : 0,
    migration_runs_count: Array.isArray(payload.migration_runs) ? payload.migration_runs.length : 0,
    migration_findings_count: Array.isArray(payload.migration_findings) ? payload.migration_findings.length : 0,
    repair_decisions_count: Array.isArray(payload.repair_decisions) ? payload.repair_decisions.length : 0,
    structure_kind: structureKindHint ?? "unknown",
    artifacts_with_content_count: Array.isArray(payload.artifacts)
      ? payload.artifacts.filter((row) => typeof row?.content === "string").length
      : 0,
    artifacts_with_canonical_count: Array.isArray(payload.artifacts)
      ? payload.artifacts.filter((row) => row?.canonical && typeof row.canonical === "object").length
      : 0,
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
      repair_layer_meta: parseJsonOrNull(meta.repair_layer_meta_json),
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
               ${artifactColumns.has("canonical_format") ? "canonical_format" : "NULL AS canonical_format"},
               ${artifactColumns.has("canonical_json") ? "canonical_json" : "NULL AS canonical_json"},
               sha256, size_bytes, CAST(mtime_ns AS TEXT) AS mtime_ns, session_id, cycle_id,
               ${artifactColumns.has("source_mode") ? "source_mode" : "'explicit' AS source_mode"},
               ${artifactColumns.has("entity_confidence") ? "entity_confidence" : "1.0 AS entity_confidence"},
               ${artifactColumns.has("legacy_origin") ? "legacy_origin" : "NULL AS legacy_origin"},
               updated_at
        FROM artifacts
        ORDER BY path ASC
      `).map((row) => ({
        path: row.path ?? null,
        kind: row.kind ?? "other",
        family: row.family ?? "unknown",
        subtype: row.subtype ?? null,
        gate_relevance: Number(row.gate_relevance ?? 0),
        classification_reason: row.classification_reason ?? null,
        content_format: row.content_format ?? null,
        content: row.content ?? null,
        canonical_format: row.canonical_format ?? null,
        canonical: parseJsonOrNull(row.canonical_json),
        sha256: row.sha256 ?? null,
        size_bytes: Number(row.size_bytes ?? 0),
        mtime_ns: row.mtime_ns ?? null,
        session_id: row.session_id ?? null,
        cycle_id: row.cycle_id ?? null,
        source_mode: row.source_mode ?? "explicit",
        entity_confidence: Number(row.entity_confidence ?? 1),
        legacy_origin: row.legacy_origin ?? null,
        updated_at: row.updated_at ?? null,
      })),
      sessions: hasTable(db, "sessions")
        ? readRows(db, `
          SELECT session_id, branch_name, state, owner, started_at, ended_at, source_artifact_path,
                 source_confidence, source_mode, updated_at,
                 ${getTableColumns(db, "sessions").has("parent_session") ? "parent_session" : "NULL AS parent_session"},
                 ${getTableColumns(db, "sessions").has("branch_kind") ? "branch_kind" : "NULL AS branch_kind"},
                 ${getTableColumns(db, "sessions").has("cycle_branch") ? "cycle_branch" : "NULL AS cycle_branch"},
                 ${getTableColumns(db, "sessions").has("intermediate_branch") ? "intermediate_branch" : "NULL AS intermediate_branch"},
                 ${getTableColumns(db, "sessions").has("integration_target_cycle") ? "integration_target_cycle" : "NULL AS integration_target_cycle"},
                 ${getTableColumns(db, "sessions").has("carry_over_pending") ? "carry_over_pending" : "NULL AS carry_over_pending"}
          FROM sessions
          ORDER BY session_id ASC
        `).map((row) => ({
          session_id: row.session_id ?? null,
          branch_name: row.branch_name ?? null,
          state: row.state ?? null,
          owner: row.owner ?? null,
          started_at: row.started_at ?? null,
          ended_at: row.ended_at ?? null,
          source_artifact_path: row.source_artifact_path ?? null,
          source_confidence: Number(row.source_confidence ?? 1),
          source_mode: row.source_mode ?? "explicit",
          parent_session: row.parent_session ?? null,
          branch_kind: row.branch_kind ?? null,
          cycle_branch: row.cycle_branch ?? null,
          intermediate_branch: row.intermediate_branch ?? null,
          integration_target_cycle: row.integration_target_cycle ?? null,
          carry_over_pending: row.carry_over_pending ?? null,
          updated_at: row.updated_at ?? null,
        }))
        : [],
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
      artifact_links: hasTable(db, "artifact_links")
        ? readRows(db, `
          SELECT source_path, target_path, relation_type, confidence, inference_source, source_mode,
                 ${getTableColumns(db, "artifact_links").has("relation_status") ? "relation_status" : "'explicit' AS relation_status"},
                 updated_at
          FROM artifact_links
          ORDER BY source_path ASC, target_path ASC, relation_type ASC
        `).map((row) => ({
          source_path: row.source_path ?? null,
          target_path: row.target_path ?? null,
          relation_type: row.relation_type ?? null,
          confidence: Number(row.confidence ?? 1),
          inference_source: row.inference_source ?? null,
          source_mode: row.source_mode ?? "explicit",
          relation_status: row.relation_status ?? "explicit",
          updated_at: row.updated_at ?? null,
        }))
        : [],
      cycle_links: hasTable(db, "cycle_links")
        ? readRows(db, `
          SELECT source_cycle_id, target_cycle_id, relation_type, confidence, inference_source, source_mode,
                 ${getTableColumns(db, "cycle_links").has("relation_status") ? "relation_status" : "'explicit' AS relation_status"},
                 updated_at
          FROM cycle_links
          ORDER BY source_cycle_id ASC, target_cycle_id ASC, relation_type ASC
        `).map((row) => ({
          source_cycle_id: row.source_cycle_id ?? null,
          target_cycle_id: row.target_cycle_id ?? null,
          relation_type: row.relation_type ?? null,
          confidence: Number(row.confidence ?? 1),
          inference_source: row.inference_source ?? null,
          source_mode: row.source_mode ?? "explicit",
          relation_status: row.relation_status ?? "explicit",
          updated_at: row.updated_at ?? null,
        }))
        : [],
      session_cycle_links: hasTable(db, "session_cycle_links")
        ? readRows(db, `
          SELECT session_id, cycle_id, relation_type, confidence, inference_source, source_mode,
                 ${getTableColumns(db, "session_cycle_links").has("relation_status") ? "relation_status" : "'explicit' AS relation_status"},
                 ${getTableColumns(db, "session_cycle_links").has("ambiguity_status") ? "ambiguity_status" : "NULL AS ambiguity_status"},
                 updated_at
          FROM session_cycle_links
          ORDER BY session_id ASC, cycle_id ASC, relation_type ASC
        `).map((row) => ({
          session_id: row.session_id ?? null,
          cycle_id: row.cycle_id ?? null,
          relation_type: row.relation_type ?? null,
          confidence: Number(row.confidence ?? 1),
          inference_source: row.inference_source ?? null,
          source_mode: row.source_mode ?? "explicit",
          relation_status: row.relation_status ?? "explicit",
          ambiguity_status: row.ambiguity_status ?? null,
          updated_at: row.updated_at ?? null,
        }))
        : [],
      session_links: hasTable(db, "session_links")
        ? readRows(db, `
          SELECT source_session_id, target_session_id, relation_type, confidence, inference_source, source_mode,
                 ${getTableColumns(db, "session_links").has("relation_status") ? "relation_status" : "'explicit' AS relation_status"},
                 updated_at
          FROM session_links
          ORDER BY source_session_id ASC, target_session_id ASC, relation_type ASC
        `).map((row) => ({
          source_session_id: row.source_session_id ?? null,
          target_session_id: row.target_session_id ?? null,
          relation_type: row.relation_type ?? null,
          confidence: Number(row.confidence ?? 1),
          inference_source: row.inference_source ?? null,
          source_mode: row.source_mode ?? "explicit",
          relation_status: row.relation_status ?? "explicit",
          updated_at: row.updated_at ?? null,
        }))
        : [],
      migration_runs: hasTable(db, "migration_runs")
        ? readRows(db, `
          SELECT migration_run_id, engine_version, started_at, ended_at, status, target_root, notes
          FROM migration_runs
          ORDER BY started_at DESC, migration_run_id ASC
        `)
        : [],
      migration_findings: hasTable(db, "migration_findings")
        ? readRows(db, `
          SELECT migration_run_id, severity, finding_type, entity_type, entity_id, artifact_path, message, confidence, suggested_action, created_at
          FROM migration_findings
          ORDER BY created_at DESC, finding_id ASC
        `)
        : [],
      repair_decisions: hasTable(db, "repair_decisions")
        ? readRows(db, `
          SELECT relation_scope, source_ref, target_ref, relation_type, decision, decided_at, decided_by, notes
          FROM repair_decisions
          ORDER BY relation_scope ASC, source_ref ASC, target_ref ASC, relation_type ASC
        `)
        : [],
    };
    payload.summary = buildSummary(payload, structureKind);
    return { absolute, payload, meta };
  } finally {
    db.close();
  }
}
