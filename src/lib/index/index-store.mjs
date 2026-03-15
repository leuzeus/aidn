import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildSqlFromIndex } from "./index-sql-lib.mjs";
import { writeUtf8IfChanged } from "./io-lib.mjs";
import { ensureWorkflowDbSchema } from "../sqlite/workflow-db-schema-lib.mjs";

const require = createRequire(import.meta.url);
const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));

function getDatabaseSync() {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch (error) {
    throw new Error(`SQLite backend unavailable: ${error.message}`);
  }
}

function stableIndexProjection(indexPayload) {
  if (!indexPayload || typeof indexPayload !== "object") {
    return indexPayload;
  }
  const clone = JSON.parse(JSON.stringify(indexPayload));
  delete clone.generated_at;
  if (clone.repair_layer_meta && typeof clone.repair_layer_meta === "object") {
    delete clone.repair_layer_meta.applied_at;
  }
  return clone;
}

function isJsonIndexEquivalent(previousContent, nextPayload) {
  try {
    const previous = JSON.parse(previousContent);
    const previousStable = stableIndexProjection(previous);
    const nextStable = stableIndexProjection(nextPayload);
    return JSON.stringify(previousStable) === JSON.stringify(nextStable);
  } catch {
    return false;
  }
}

function readSchema(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Schema file not found: ${absolute}`);
  }
  return fs.readFileSync(absolute, "utf8").trim();
}

function toIdempotentSchema(schemaText) {
  return String(schemaText).replace(/CREATE TABLE\s+/gi, "CREATE TABLE IF NOT EXISTS ");
}

function payloadDigest(payload) {
  const stable = stableIndexProjection(payload);
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function writeJsonIndex(outputPath, payload) {
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  return writeUtf8IfChanged(outputPath, content, {
    isEquivalent(previous) {
      return isJsonIndexEquivalent(previous, payload);
    },
  });
}

function writeSqlIndex(outputPath, payload, schemaFile, includeSchema) {
  const schemaText = includeSchema ? readSchema(schemaFile) : "";
  const content = buildSqlFromIndex(payload, { includeSchema, schemaText });
  return writeUtf8IfChanged(outputPath, content);
}

function runInsert(statement, rows, projector) {
  for (const row of rows) {
    statement.run(...projector(row));
  }
}

function canonicalToJson(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function ensureMetaTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );
  `);
}

function ensureRepairLayerTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      branch_name TEXT,
      state TEXT,
      owner TEXT,
      parent_session TEXT,
      branch_kind TEXT,
      cycle_branch TEXT,
      intermediate_branch TEXT,
      integration_target_cycle TEXT,
      carry_over_pending TEXT,
      started_at TEXT,
      ended_at TEXT,
      source_artifact_path TEXT,
      source_confidence REAL NOT NULL DEFAULT 1.0,
      source_mode TEXT NOT NULL DEFAULT 'explicit',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifact_links (
      source_path TEXT NOT NULL,
      target_path TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      inference_source TEXT,
      source_mode TEXT NOT NULL DEFAULT 'explicit',
      relation_status TEXT NOT NULL DEFAULT 'explicit',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (source_path, target_path, relation_type)
    );

    CREATE TABLE IF NOT EXISTS cycle_links (
      source_cycle_id TEXT NOT NULL,
      target_cycle_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      inference_source TEXT,
      source_mode TEXT NOT NULL DEFAULT 'explicit',
      relation_status TEXT NOT NULL DEFAULT 'explicit',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (source_cycle_id, target_cycle_id, relation_type)
    );

    CREATE TABLE IF NOT EXISTS session_cycle_links (
      session_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      inference_source TEXT,
      source_mode TEXT NOT NULL DEFAULT 'explicit',
      relation_status TEXT NOT NULL DEFAULT 'explicit',
      ambiguity_status TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (session_id, cycle_id, relation_type)
    );

    CREATE TABLE IF NOT EXISTS session_links (
      source_session_id TEXT NOT NULL,
      target_session_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      inference_source TEXT,
      source_mode TEXT NOT NULL DEFAULT 'explicit',
      relation_status TEXT NOT NULL DEFAULT 'explicit',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (source_session_id, target_session_id, relation_type)
    );

    CREATE TABLE IF NOT EXISTS repair_decisions (
      relation_scope TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      decision TEXT NOT NULL,
      decided_at TEXT NOT NULL,
      decided_by TEXT,
      notes TEXT,
      PRIMARY KEY (relation_scope, source_ref, target_ref, relation_type)
    );

    CREATE TABLE IF NOT EXISTS migration_runs (
      migration_run_id TEXT PRIMARY KEY,
      engine_version TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL,
      target_root TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS migration_findings (
      finding_id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_run_id TEXT NOT NULL,
      severity TEXT NOT NULL,
      finding_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      artifact_path TEXT,
      message TEXT NOT NULL,
      confidence REAL,
      suggested_action TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (migration_run_id) REFERENCES migration_runs(migration_run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_artifacts_cycle_id ON artifacts(cycle_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_session_id ON artifacts(session_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_source_mode ON artifacts(source_mode);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_artifact_links_target ON artifact_links(target_path, relation_type);
    CREATE INDEX IF NOT EXISTS idx_cycle_links_target ON cycle_links(target_cycle_id, relation_type);
    CREATE INDEX IF NOT EXISTS idx_session_cycle_links_cycle ON session_cycle_links(cycle_id, relation_type);
    CREATE INDEX IF NOT EXISTS idx_session_links_target ON session_links(target_session_id, relation_type);
    CREATE INDEX IF NOT EXISTS idx_migration_findings_run ON migration_findings(migration_run_id);
    CREATE INDEX IF NOT EXISTS idx_repair_decisions_scope ON repair_decisions(relation_scope, decision);
  `);
  db.exec(`
    DROP VIEW IF EXISTS v_session_cycle_context;
    CREATE VIEW v_session_cycle_context AS
    SELECT
      scl.session_id,
      scl.cycle_id,
      scl.relation_type,
      scl.confidence,
      scl.inference_source,
      scl.source_mode,
      scl.relation_status,
      scl.ambiguity_status,
      scl.updated_at,
      s.branch_name AS session_branch_name,
      s.state AS session_state,
      s.owner AS session_owner,
      s.parent_session,
      s.branch_kind,
      s.cycle_branch,
      s.intermediate_branch,
      s.integration_target_cycle,
      s.carry_over_pending,
      s.source_mode AS session_source_mode,
      s.source_confidence AS session_source_confidence,
      c.state AS cycle_state,
      c.outcome AS cycle_outcome,
      c.branch_name AS cycle_branch_name,
      c.updated_at AS cycle_updated_at
    FROM session_cycle_links scl
    LEFT JOIN sessions s ON s.session_id = scl.session_id
    LEFT JOIN cycles c ON c.cycle_id = scl.cycle_id;

    DROP VIEW IF EXISTS v_session_link_context;
    CREATE VIEW v_session_link_context AS
    SELECT
      sl.source_session_id,
      sl.target_session_id,
      sl.relation_type,
      sl.confidence,
      sl.inference_source,
      sl.source_mode,
      sl.relation_status,
      sl.updated_at,
      ss.branch_name AS source_branch_name,
      ss.state AS source_state,
      ss.parent_session AS source_parent_session,
      ts.branch_name AS target_branch_name,
      ts.state AS target_state
    FROM session_links sl
    LEFT JOIN sessions ss ON ss.session_id = sl.source_session_id
    LEFT JOIN sessions ts ON ts.session_id = sl.target_session_id;

    DROP VIEW IF EXISTS v_artifact_link_context;
    CREATE VIEW v_artifact_link_context AS
    SELECT
      al.source_path,
      al.target_path,
      al.relation_type,
      al.confidence,
      al.inference_source,
      al.source_mode,
      al.relation_status,
      al.updated_at,
      sa.kind AS source_kind,
      sa.family AS source_family,
      sa.subtype AS source_subtype,
      sa.cycle_id AS source_cycle_id,
      sa.session_id AS source_session_id,
      ta.kind AS target_kind,
      ta.family AS target_family,
      ta.subtype AS target_subtype,
      ta.cycle_id AS target_cycle_id,
      ta.session_id AS target_session_id,
      ta.source_mode AS target_source_mode,
      ta.entity_confidence AS target_entity_confidence,
      ta.updated_at AS target_updated_at
    FROM artifact_links al
    LEFT JOIN artifacts sa ON sa.path = al.source_path
    LEFT JOIN artifacts ta ON ta.path = al.target_path;

    DROP VIEW IF EXISTS v_repair_findings_open;
    CREATE VIEW v_repair_findings_open AS
    SELECT
      migration_run_id,
      severity,
      finding_type,
      entity_type,
      entity_id,
      artifact_path,
      message,
      confidence,
      suggested_action,
      created_at
    FROM migration_findings
    WHERE severity IN ('warning', 'error');
  `);
}

function getTableColumns(db, tableName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName});`).all();
  const out = new Set();
  for (const row of rows) {
    if (typeof row?.name === "string") {
      out.add(row.name);
    }
  }
  return out;
}

function ensureColumn(db, tableName, columnName, sqlTypeClause) {
  const columns = getTableColumns(db, tableName);
  if (columns.has(columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlTypeClause};`);
}

function getMeta(db, key) {
  const stmt = db.prepare("SELECT value FROM index_meta WHERE key = ?");
  const row = stmt.get(key);
  return row?.value ?? null;
}

function setMeta(db, key, value) {
  const stmt = db.prepare(`
    INSERT INTO index_meta (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at;
  `);
  stmt.run(key, value, new Date().toISOString());
}

function writeSqliteIndex(outputPath, payload, schemaFile) {
  const DatabaseSync = getDatabaseSync();
  const absolute = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const nextDigest = payloadDigest(payload);
  const existedBefore = fs.existsSync(absolute);
  const sizeBefore = existedBefore ? fs.statSync(absolute).size : 0;

  const db = new DatabaseSync(absolute);
  try {
    db.exec("PRAGMA foreign_keys=OFF;");
    ensureWorkflowDbSchema({
      db,
      sqliteFile: absolute,
      schemaFile,
      role: "index-store",
    });
    const prevDigest = getMeta(db, "payload_digest");
    if (prevDigest === nextDigest) {
      return {
        path: absolute,
        written: false,
        bytes_written: 0,
      };
    }

    db.exec("BEGIN TRANSACTION;");
    try {
      db.exec("DELETE FROM artifact_tags;");
      db.exec("DELETE FROM tags;");
      db.exec("DELETE FROM file_map;");
      db.exec("DELETE FROM artifacts;");
      db.exec("DELETE FROM cycles;");
      db.exec("DELETE FROM run_metrics;");
      db.exec("DELETE FROM artifact_links;");
      db.exec("DELETE FROM cycle_links;");
      db.exec("DELETE FROM session_cycle_links;");
      db.exec("DELETE FROM session_links;");
      db.exec("DELETE FROM sessions;");
      db.exec("DELETE FROM migration_findings;");
      db.exec("DELETE FROM migration_runs;");
      db.exec("DELETE FROM repair_decisions;");

      const cycles = Array.isArray(payload.cycles) ? payload.cycles : [];
      const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
      const fileMap = Array.isArray(payload.file_map) ? payload.file_map : [];
      const tags = Array.isArray(payload.tags) ? payload.tags : [];
      const artifactTags = Array.isArray(payload.artifact_tags) ? payload.artifact_tags : [];
      const runMetrics = Array.isArray(payload.run_metrics) ? payload.run_metrics : [];
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      const artifactLinks = Array.isArray(payload.artifact_links) ? payload.artifact_links : [];
      const cycleLinks = Array.isArray(payload.cycle_links) ? payload.cycle_links : [];
      const sessionCycleLinks = Array.isArray(payload.session_cycle_links) ? payload.session_cycle_links : [];
      const sessionLinks = Array.isArray(payload.session_links) ? payload.session_links : [];
      const migrationRuns = Array.isArray(payload.migration_runs) ? payload.migration_runs : [];
      const migrationFindings = Array.isArray(payload.migration_findings) ? payload.migration_findings : [];
      const repairDecisions = Array.isArray(payload.repair_decisions) ? payload.repair_decisions : [];

      const cycleStmt = db.prepare(`
        INSERT INTO cycles (
          cycle_id, session_id, state, outcome, branch_name, dor_state,
          continuity_rule, continuity_base_branch, continuity_latest_cycle_branch, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cycle_id) DO UPDATE SET
          session_id = excluded.session_id,
          state = excluded.state,
          outcome = excluded.outcome,
          branch_name = excluded.branch_name,
          dor_state = excluded.dor_state,
          continuity_rule = excluded.continuity_rule,
          continuity_base_branch = excluded.continuity_base_branch,
          continuity_latest_cycle_branch = excluded.continuity_latest_cycle_branch,
          updated_at = excluded.updated_at;
      `);
      runInsert(cycleStmt, cycles, (row) => ([
        row.cycle_id ?? null,
        row.session_id ?? null,
        row.state ?? "UNKNOWN",
        row.outcome ?? null,
        row.branch_name ?? null,
        row.dor_state ?? null,
        row.continuity_rule ?? null,
        row.continuity_base_branch ?? null,
        row.continuity_latest_cycle_branch ?? null,
        row.updated_at ?? new Date().toISOString(),
      ]));

      const artifactStmt = db.prepare(`
        INSERT INTO artifacts (
          path, kind, family, subtype, gate_relevance, classification_reason, content_format, content, canonical_format, canonical_json, sha256, size_bytes, mtime_ns, session_id, cycle_id, source_mode, entity_confidence, legacy_origin, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);
      runInsert(artifactStmt, artifacts, (row) => ([
        row.path ?? null,
        row.kind ?? "other",
        row.family ?? "unknown",
        row.subtype ?? null,
        Number(row.gate_relevance ?? 0),
        row.classification_reason ?? null,
        row.content_format ?? null,
        row.content ?? null,
        row.canonical_format ?? null,
        canonicalToJson(row.canonical),
        row.sha256 ?? null,
        Number(row.size_bytes ?? 0),
        Number(row.mtime_ns ?? 0),
        row.session_id ?? null,
        row.cycle_id ?? null,
        row.source_mode ?? "explicit",
        Number(row.entity_confidence ?? 1),
        row.legacy_origin ?? null,
        row.updated_at ?? new Date().toISOString(),
      ]));

      const sessionStmt = db.prepare(`
        INSERT INTO sessions (
          session_id, branch_name, state, owner, parent_session, branch_kind, cycle_branch, intermediate_branch, integration_target_cycle, carry_over_pending, started_at, ended_at, source_artifact_path, source_confidence, source_mode, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);
      runInsert(sessionStmt, sessions, (row) => ([
        row.session_id ?? null,
        row.branch_name ?? null,
        row.state ?? null,
        row.owner ?? null,
        row.parent_session ?? null,
        row.branch_kind ?? null,
        row.cycle_branch ?? null,
        row.intermediate_branch ?? null,
        row.integration_target_cycle ?? null,
        row.carry_over_pending ?? null,
        row.started_at ?? null,
        row.ended_at ?? null,
        row.source_artifact_path ?? null,
        Number(row.source_confidence ?? 1),
        row.source_mode ?? "explicit",
        row.updated_at ?? new Date().toISOString(),
      ]));

      const fileMapStmt = db.prepare(`
        INSERT INTO file_map (cycle_id, path, role, relation, last_seen_at)
        VALUES (?, ?, ?, ?, ?);
      `);
      runInsert(fileMapStmt, fileMap, (row) => ([
        row.cycle_id ?? null,
        row.path ?? null,
        row.role ?? null,
        row.relation ?? "unknown",
        row.last_seen_at ?? new Date().toISOString(),
      ]));

      const tagStmt = db.prepare("INSERT INTO tags (tag) VALUES (?);");
      runInsert(tagStmt, tags, (row) => [row.tag ?? ""]);

      const artifactIdStmt = db.prepare("SELECT artifact_id FROM artifacts WHERE path = ?;");
      const tagIdStmt = db.prepare("SELECT tag_id FROM tags WHERE tag = ?;");
      const artifactTagStmt = db.prepare("INSERT INTO artifact_tags (artifact_id, tag_id) VALUES (?, ?);");
      for (const row of artifactTags) {
        const artifactId = artifactIdStmt.get(row.path ?? "")?.artifact_id ?? null;
        const tagId = tagIdStmt.get(row.tag ?? "")?.tag_id ?? null;
        if (artifactId == null || tagId == null) {
          continue;
        }
        artifactTagStmt.run(artifactId, tagId);
      }

      const runMetricsStmt = db.prepare(`
        INSERT INTO run_metrics (
          run_id, started_at, ended_at, overhead_ratio, artifacts_churn, gates_frequency
        ) VALUES (?, ?, ?, ?, ?, ?);
      `);
      runInsert(runMetricsStmt, runMetrics, (row) => ([
        row.run_id ?? null,
        row.started_at ?? new Date().toISOString(),
        row.ended_at ?? null,
        row.overhead_ratio ?? null,
        row.artifacts_churn ?? null,
        row.gates_frequency ?? null,
      ]));

      const artifactLinkStmt = db.prepare(`
        INSERT INTO artifact_links (
          source_path, target_path, relation_type, confidence, inference_source, source_mode, relation_status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `);
      runInsert(artifactLinkStmt, artifactLinks, (row) => ([
        row.source_path ?? null,
        row.target_path ?? null,
        row.relation_type ?? null,
        Number(row.confidence ?? 1),
        row.inference_source ?? null,
        row.source_mode ?? "explicit",
        row.relation_status ?? "explicit",
        row.updated_at ?? new Date().toISOString(),
      ]));

      const cycleLinkStmt = db.prepare(`
        INSERT INTO cycle_links (
          source_cycle_id, target_cycle_id, relation_type, confidence, inference_source, source_mode, relation_status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `);
      runInsert(cycleLinkStmt, cycleLinks, (row) => ([
        row.source_cycle_id ?? null,
        row.target_cycle_id ?? null,
        row.relation_type ?? null,
        Number(row.confidence ?? 1),
        row.inference_source ?? null,
        row.source_mode ?? "explicit",
        row.relation_status ?? "explicit",
        row.updated_at ?? new Date().toISOString(),
      ]));

      const sessionCycleLinkStmt = db.prepare(`
        INSERT INTO session_cycle_links (
          session_id, cycle_id, relation_type, confidence, inference_source, source_mode, relation_status, ambiguity_status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);
      runInsert(sessionCycleLinkStmt, sessionCycleLinks, (row) => ([
        row.session_id ?? null,
        row.cycle_id ?? null,
        row.relation_type ?? null,
        Number(row.confidence ?? 1),
        row.inference_source ?? null,
        row.source_mode ?? "explicit",
        row.relation_status ?? "explicit",
        row.ambiguity_status ?? null,
        row.updated_at ?? new Date().toISOString(),
      ]));

      const sessionLinkStmt = db.prepare(`
        INSERT INTO session_links (
          source_session_id, target_session_id, relation_type, confidence, inference_source, source_mode, relation_status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `);
      runInsert(sessionLinkStmt, sessionLinks, (row) => ([
        row.source_session_id ?? null,
        row.target_session_id ?? null,
        row.relation_type ?? null,
        Number(row.confidence ?? 1),
        row.inference_source ?? null,
        row.source_mode ?? "explicit",
        row.relation_status ?? "explicit",
        row.updated_at ?? new Date().toISOString(),
      ]));

      const migrationRunStmt = db.prepare(`
        INSERT INTO migration_runs (
          migration_run_id, engine_version, started_at, ended_at, status, target_root, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?);
      `);
      runInsert(migrationRunStmt, migrationRuns, (row) => ([
        row.migration_run_id ?? null,
        row.engine_version ?? "unknown",
        row.started_at ?? new Date().toISOString(),
        row.ended_at ?? null,
        row.status ?? "pending",
        row.target_root ?? null,
        row.notes ?? null,
      ]));

      const migrationFindingStmt = db.prepare(`
        INSERT INTO migration_findings (
          migration_run_id, severity, finding_type, entity_type, entity_id, artifact_path, message, confidence, suggested_action, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);
      runInsert(migrationFindingStmt, migrationFindings, (row) => ([
        row.migration_run_id ?? null,
        row.severity ?? "info",
        row.finding_type ?? "unknown",
        row.entity_type ?? null,
        row.entity_id ?? null,
        row.artifact_path ?? null,
        row.message ?? "",
        row.confidence ?? null,
        row.suggested_action ?? null,
        row.created_at ?? new Date().toISOString(),
      ]));

      const repairDecisionStmt = db.prepare(`
        INSERT INTO repair_decisions (
          relation_scope, source_ref, target_ref, relation_type, decision, decided_at, decided_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `);
      runInsert(repairDecisionStmt, repairDecisions, (row) => ([
        row.relation_scope ?? null,
        row.source_ref ?? null,
        row.target_ref ?? null,
        row.relation_type ?? null,
        row.decision ?? null,
        row.decided_at ?? new Date().toISOString(),
        row.decided_by ?? null,
        row.notes ?? null,
      ]));

      setMeta(db, "payload_digest", nextDigest);
      setMeta(db, "schema_version", String(payload?.schema_version ?? 2));
      setMeta(db, "structure_kind", String(payload?.summary?.structure_kind ?? "unknown"));
      setMeta(db, "target_root", String(payload?.target_root ?? ""));
      setMeta(db, "audit_root", String(payload?.audit_root ?? ""));
      setMeta(db, "structure_profile_json", JSON.stringify(payload?.structure_profile ?? null));
      setMeta(db, "repair_layer_meta_json", JSON.stringify(payload?.repair_layer_meta ?? null));
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  } finally {
    try {
      db.exec("PRAGMA foreign_keys=ON;");
    } catch {
    }
    db.close();
  }

  const sizeAfter = fs.existsSync(absolute) ? fs.statSync(absolute).size : sizeBefore;
  return {
    path: absolute,
    written: true,
    bytes_written: sizeAfter,
  };
}

export function createIndexStore(options = {}) {
  const mode = String(options.mode ?? "file").trim().toLowerCase();
  const jsonOutput = options.jsonOutput ?? ".aidn/runtime/index/workflow-index.json";
  const sqlOutput = options.sqlOutput ?? ".aidn/runtime/index/workflow-index.sql";
  const sqliteOutput = options.sqliteOutput ?? ".aidn/runtime/index/workflow-index.sqlite";
  const schemaFile = options.schemaFile ?? path.join(LIB_DIR, "..", "..", "..", "tools", "perf", "sql", "schema.sql");
  const includeSchema = options.includeSchema !== false;

  if (!["file", "sql", "dual", "sqlite", "dual-sqlite", "all"].includes(mode)) {
    throw new Error(`Invalid --store mode: ${mode}. Expected file|sql|dual|sqlite|dual-sqlite|all.`);
  }

  return {
    mode,
    write(payload) {
      const outputs = [];
      if (mode === "file" || mode === "dual" || mode === "dual-sqlite" || mode === "all") {
        const out = writeJsonIndex(jsonOutput, payload);
        outputs.push({ kind: "file", path: out.path, written: out.written, bytes_written: out.bytes_written });
      }
      if (mode === "sql" || mode === "dual" || mode === "all") {
        const out = writeSqlIndex(sqlOutput, payload, schemaFile, includeSchema);
        outputs.push({ kind: "sql", path: out.path, written: out.written, bytes_written: out.bytes_written });
      }
      if (mode === "sqlite" || mode === "dual-sqlite" || mode === "all") {
        const out = writeSqliteIndex(sqliteOutput, payload, schemaFile);
        outputs.push({ kind: "sqlite", path: out.path, written: out.written, bytes_written: out.bytes_written });
      }
      return outputs;
    },
  };
}
