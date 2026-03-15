import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const SQLITE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function getDatabaseSync() {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch (error) {
    throw new Error(`SQLite backend unavailable: ${error.message}`);
  }
}

export function readSchemaFile(schemaFile) {
  const absolute = path.isAbsolute(schemaFile)
    ? schemaFile
    : path.resolve(process.cwd(), schemaFile);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Schema file not found: ${absolute}`);
  }
  return fs.readFileSync(absolute, "utf8");
}

export function toIdempotentSchema(schemaText) {
  return String(schemaText).replace(/CREATE TABLE\s+/gi, "CREATE TABLE IF NOT EXISTS ");
}

export function getDefaultWorkflowSchemaFile() {
  return path.resolve(SQLITE_DIR, "..", "..", "..", "tools", "perf", "sql", "schema.sql");
}

export function getTableColumns(db, tableName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName});`).all();
  const out = new Set();
  for (const row of rows) {
    if (typeof row?.name === "string") {
      out.add(row.name);
    }
  }
  return out;
}

export function ensureColumn(db, tableName, columnName, sqlTypeClause) {
  const columns = getTableColumns(db, tableName);
  if (columns.has(columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlTypeClause};`);
}

export function ensureMetaTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );
  `);
}

function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO index_meta (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at;
  `).run(key, value, new Date().toISOString());
}

export function ensureRepairLayerTables(db) {
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

function ensureLatestColumns(db) {
  ensureColumn(db, "artifacts", "family", "TEXT NOT NULL DEFAULT 'unknown'");
  ensureColumn(db, "artifacts", "subtype", "TEXT");
  ensureColumn(db, "artifacts", "gate_relevance", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "artifacts", "classification_reason", "TEXT");
  ensureColumn(db, "artifacts", "content_format", "TEXT");
  ensureColumn(db, "artifacts", "content", "TEXT");
  ensureColumn(db, "artifacts", "canonical_format", "TEXT");
  ensureColumn(db, "artifacts", "canonical_json", "TEXT");
  ensureColumn(db, "artifacts", "source_mode", "TEXT NOT NULL DEFAULT 'explicit'");
  ensureColumn(db, "artifacts", "entity_confidence", "REAL NOT NULL DEFAULT 1.0");
  ensureColumn(db, "artifacts", "legacy_origin", "TEXT");
  ensureColumn(db, "file_map", "relation", "TEXT NOT NULL DEFAULT 'unknown'");
  ensureColumn(db, "sessions", "parent_session", "TEXT");
  ensureColumn(db, "sessions", "branch_kind", "TEXT");
  ensureColumn(db, "sessions", "cycle_branch", "TEXT");
  ensureColumn(db, "sessions", "intermediate_branch", "TEXT");
  ensureColumn(db, "sessions", "integration_target_cycle", "TEXT");
  ensureColumn(db, "sessions", "carry_over_pending", "TEXT");
  ensureColumn(db, "artifact_links", "relation_status", "TEXT NOT NULL DEFAULT 'explicit'");
  ensureColumn(db, "cycle_links", "relation_status", "TEXT NOT NULL DEFAULT 'explicit'");
  ensureColumn(db, "session_cycle_links", "relation_status", "TEXT NOT NULL DEFAULT 'explicit'");
  ensureColumn(db, "session_cycle_links", "ambiguity_status", "TEXT");
  ensureColumn(db, "session_links", "relation_status", "TEXT NOT NULL DEFAULT 'explicit'");
}

function applyBaselineWorkflowSchema(db, schemaFile) {
  const schemaText = toIdempotentSchema(readSchemaFile(schemaFile));
  db.exec(schemaText);
  ensureMetaTable(db);
  ensureLatestColumns(db);
  ensureRepairLayerTables(db);
  setMeta(db, "schema_version", "2");
}

function ensureSchemaMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      description TEXT,
      role TEXT,
      engine_version TEXT,
      applied_at TEXT NOT NULL,
      notes TEXT
    );
  `);
}

function listUserTables(db) {
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name != 'schema_migrations'
    ORDER BY name ASC
  `).all().map((row) => String(row?.name ?? "")).filter((name) => name.length > 0);
}

function listAppliedMigrationIds(db) {
  const rows = db.prepare(`
    SELECT migration_id
    FROM schema_migrations
    ORDER BY applied_at ASC, migration_id ASC
  `).all();
  return new Set(rows.map((row) => String(row?.migration_id ?? "")).filter((value) => value.length > 0));
}

function recordMigration(db, migration, role, engineVersion, notes = null) {
  db.prepare(`
    INSERT INTO schema_migrations (
      migration_id, checksum, description, role, engine_version, applied_at, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    migration.id,
    migration.checksum,
    migration.description,
    role,
    engineVersion,
    new Date().toISOString(),
    notes,
  );
}

function buildMigrationChecksum(seed) {
  return crypto.createHash("sha256").update(String(seed)).digest("hex");
}

function resolveBackupFile(sqliteFile, backupRoot) {
  const absolute = path.resolve(process.cwd(), sqliteFile);
  const backupDir = backupRoot
    ? path.resolve(process.cwd(), backupRoot)
    : path.join(path.dirname(absolute), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stem = path.basename(absolute, path.extname(absolute));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(backupDir, `${stem}.${stamp}.pre-migration.sqlite`);
}

function createBackupIfNeeded(sqliteFile, backupRoot) {
  const absolute = path.resolve(process.cwd(), sqliteFile);
  if (!fs.existsSync(absolute)) {
    return null;
  }
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size === 0) {
    return null;
  }
  const backupFile = resolveBackupFile(absolute, backupRoot);
  fs.copyFileSync(absolute, backupFile);
  return backupFile;
}

function getWorkflowDbMigrations(schemaFile) {
  return [
    {
      id: "0001_workflow_index_baseline_v2",
      description: "Bootstrap workflow runtime schema registry and current v2-compatible tables, columns, indexes, and views",
      checksum: buildMigrationChecksum(`0001|${schemaFile}|workflow-index-baseline-v2`),
      up(db) {
        applyBaselineWorkflowSchema(db, schemaFile);
      },
    },
  ];
}

export function ensureWorkflowDbSchema(options = {}) {
  const db = options.db;
  if (!db) {
    throw new Error("ensureWorkflowDbSchema requires db");
  }
  const sqliteFile = options.sqliteFile ?? "";
  const role = String(options.role ?? "runtime");
  const engineVersion = String(options.engineVersion ?? "unknown");
  const schemaFile = path.resolve(
    process.cwd(),
    options.schemaFile ?? getDefaultWorkflowSchemaFile(),
  );
  const backupRoot = options.backupRoot ?? "";

  const hadExistingSchema = listUserTables(db).length > 0;
  ensureSchemaMigrationsTable(db);
  const migrations = getWorkflowDbMigrations(schemaFile);
  const applied = listAppliedMigrationIds(db);
  const pending = migrations.filter((migration) => !applied.has(migration.id));

  let backupFile = null;
  if (pending.length > 0 && hadExistingSchema && sqliteFile) {
    backupFile = createBackupIfNeeded(sqliteFile, backupRoot);
  }

  const appliedIds = [];
  for (const migration of pending) {
    db.exec("BEGIN TRANSACTION;");
    try {
      migration.up(db);
      ensureMetaTable(db);
      setMeta(db, "migration_engine_version", engineVersion);
      recordMigration(
        db,
        migration,
        role,
        engineVersion,
        hadExistingSchema ? "baseline adoption on existing sqlite schema" : "fresh schema bootstrap",
      );
      db.exec("COMMIT;");
      appliedIds.push(migration.id);
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }

  return {
    ok: true,
    schema_file: schemaFile,
    had_existing_schema: hadExistingSchema,
    backup_file: backupFile,
    pending_before: pending.map((migration) => migration.id),
    applied_ids: appliedIds,
    migration_count: appliedIds.length,
  };
}
