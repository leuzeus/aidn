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

function normalizeArtifactPath(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^docs\/audit\//i, "");
}

const RUNTIME_HEAD_DEFINITIONS = [
  {
    headKey: "current_state",
    subtypes: new Set(["current_state"]),
    fileNames: new Set(["CURRENT-STATE.md"]),
  },
  {
    headKey: "runtime_state",
    subtypes: new Set(["runtime_state"]),
    fileNames: new Set(["RUNTIME-STATE.md"]),
  },
  {
    headKey: "handoff_packet",
    subtypes: new Set(["handoff_packet"]),
    fileNames: new Set(["HANDOFF-PACKET.md"]),
  },
  {
    headKey: "agent_roster",
    subtypes: new Set(["agent_roster"]),
    fileNames: new Set(["AGENT-ROSTER.md"]),
  },
  {
    headKey: "agent_health_summary",
    subtypes: new Set(["agent_health_summary"]),
    fileNames: new Set(["AGENT-HEALTH-SUMMARY.md"]),
  },
  {
    headKey: "agent_selection_summary",
    subtypes: new Set(["agent_selection_summary"]),
    fileNames: new Set(["AGENT-SELECTION-SUMMARY.md"]),
  },
  {
    headKey: "multi_agent_status",
    subtypes: new Set(["multi_agent_status"]),
    fileNames: new Set(["MULTI-AGENT-STATUS.md"]),
  },
  {
    headKey: "coordination_summary",
    subtypes: new Set(["coordination_summary"]),
    fileNames: new Set(["COORDINATION-SUMMARY.md"]),
  },
];

function resolveRuntimeHeadDefinition(artifact) {
  const subtype = String(artifact?.subtype ?? "").trim().toLowerCase();
  if (subtype) {
    const bySubtype = RUNTIME_HEAD_DEFINITIONS.find((item) => item.subtypes.has(subtype));
    if (bySubtype) {
      return bySubtype;
    }
  }
  const normalizedPath = normalizeArtifactPath(artifact?.path);
  const fileName = normalizedPath.split("/").pop() ?? "";
  if (!fileName) {
    return null;
  }
  return RUNTIME_HEAD_DEFINITIONS.find((item) => item.fileNames.has(fileName)) ?? null;
}

function buildRuntimeHeadPayload(artifact, definition) {
  return JSON.stringify({
    head_key: definition.headKey,
    artifact_id: Number(artifact?.artifact_id ?? 0) || null,
    artifact_path: artifact?.path ?? null,
    sha256: artifact?.sha256 ?? null,
    session_id: artifact?.session_id ?? null,
    cycle_id: artifact?.cycle_id ?? null,
    kind: artifact?.kind ?? null,
    subtype: artifact?.subtype ?? null,
    updated_at: artifact?.updated_at ?? null,
  });
}

function ensureRuntimeHeadsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_heads (
      head_key TEXT PRIMARY KEY,
      artifact_id INTEGER,
      artifact_path TEXT NOT NULL,
      artifact_sha256 TEXT,
      session_id TEXT,
      cycle_id TEXT,
      kind TEXT,
      subtype TEXT,
      updated_at TEXT NOT NULL,
      payload_json TEXT,
      FOREIGN KEY (artifact_id) REFERENCES artifacts(artifact_id)
    );

    CREATE INDEX IF NOT EXISTS idx_runtime_heads_artifact_path ON runtime_heads(artifact_path);
    CREATE INDEX IF NOT EXISTS idx_runtime_heads_session_cycle_updated ON runtime_heads(session_id, cycle_id, updated_at);
  `);
}

function backfillRuntimeHeads(db) {
  if (!hasTable(db, "artifacts")) {
    return { inserted: 0, updated: 0, matched: 0 };
  }
  ensureRuntimeHeadsTable(db);
  const rows = db.prepare(`
    SELECT artifact_id, path, kind, subtype, sha256, session_id, cycle_id, updated_at
    FROM artifacts
    ORDER BY updated_at DESC, artifact_id DESC
  `).all();

  const seen = new Set();
  const upsert = db.prepare(`
    INSERT INTO runtime_heads (
      head_key, artifact_id, artifact_path, artifact_sha256, session_id, cycle_id, kind, subtype, updated_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(head_key) DO UPDATE SET
      artifact_id = excluded.artifact_id,
      artifact_path = excluded.artifact_path,
      artifact_sha256 = excluded.artifact_sha256,
      session_id = excluded.session_id,
      cycle_id = excluded.cycle_id,
      kind = excluded.kind,
      subtype = excluded.subtype,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json;
  `);

  let matched = 0;
  for (const row of rows) {
    const definition = resolveRuntimeHeadDefinition(row);
    if (!definition || seen.has(definition.headKey)) {
      continue;
    }
    seen.add(definition.headKey);
    matched += 1;
    upsert.run(
      definition.headKey,
      Number(row.artifact_id ?? 0) || null,
      String(row.path ?? ""),
      row.sha256 ?? null,
      row.session_id ?? null,
      row.cycle_id ?? null,
      row.kind ?? null,
      row.subtype ?? null,
      row.updated_at ?? new Date().toISOString(),
      buildRuntimeHeadPayload(row, definition),
    );
  }

  return {
    inserted: matched,
    updated: 0,
    matched,
  };
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

function hasTable(db, tableName) {
  const row = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName);
  return Boolean(row);
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

export function backupWorkflowDbFile(options = {}) {
  const resolved = resolveWorkflowSchemaOptions(options);
  if (!resolved.sqliteFile) {
    throw new Error("backupWorkflowDbFile requires sqliteFile");
  }
  const backupFile = createBackupIfNeeded(resolved.sqliteFile, resolved.backupRoot);
  return {
    ok: true,
    sqlite_file: resolved.sqliteFile,
    backup_file: backupFile,
    backup_created: Boolean(backupFile),
  };
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
    {
      id: "0002_runtime_heads",
      description: "Add hot runtime artifact heads for fast DB-first consultation and backfill them from artifacts",
      checksum: buildMigrationChecksum("0002|runtime-heads-v1"),
      up(db) {
        ensureRuntimeHeadsTable(db);
        backfillRuntimeHeads(db);
        setMeta(db, "schema_version", "3");
      },
    },
  ];
}

function resolveWorkflowSchemaOptions(options = {}) {
  return {
    sqliteFile: options.sqliteFile
      ? path.resolve(process.cwd(), options.sqliteFile)
      : "",
    role: String(options.role ?? "runtime"),
    engineVersion: String(options.engineVersion ?? "unknown"),
    schemaFile: path.resolve(
      process.cwd(),
      options.schemaFile ?? getDefaultWorkflowSchemaFile(),
    ),
    backupRoot: options.backupRoot ?? "",
  };
}

function listAppliedMigrationRows(db) {
  if (!hasTable(db, "schema_migrations")) {
    return [];
  }
  return db.prepare(`
    SELECT migration_id, checksum, description, role, engine_version, applied_at, notes
    FROM schema_migrations
    ORDER BY applied_at ASC, migration_id ASC
  `).all();
}

function readIndexMetaValue(db, key) {
  if (!hasTable(db, "index_meta")) {
    return null;
  }
  const row = db.prepare("SELECT value FROM index_meta WHERE key = ?").get(key);
  return row?.value ?? null;
}

export function inspectWorkflowDbSchema(options = {}) {
  const resolved = resolveWorkflowSchemaOptions(options);
  const migrations = getWorkflowDbMigrations(resolved.schemaFile);
  const expectedMigrationIds = migrations.map((migration) => migration.id);
  if (!resolved.sqliteFile || !fs.existsSync(resolved.sqliteFile)) {
    return {
      ok: true,
      sqlite_file: resolved.sqliteFile || null,
      schema_file: resolved.schemaFile,
      exists: false,
      table_count: 0,
      schema_version: null,
      schema_migrations_present: false,
      applied_migrations: [],
      applied_ids: [],
      pending_ids: expectedMigrationIds,
    };
  }

  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(resolved.sqliteFile);
  try {
    const appliedRows = listAppliedMigrationRows(db);
    const appliedIds = new Set(appliedRows.map((row) => row.migration_id));
    const tableCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).get()?.count ?? 0;
    return {
      ok: true,
      sqlite_file: resolved.sqliteFile,
      schema_file: resolved.schemaFile,
      exists: true,
      table_count: Number(tableCount),
      schema_version: readIndexMetaValue(db, "schema_version"),
      schema_migrations_present: hasTable(db, "schema_migrations"),
      applied_migrations: appliedRows,
      applied_ids: appliedRows.map((row) => row.migration_id),
      pending_ids: migrations.filter((migration) => !appliedIds.has(migration.id)).map((migration) => migration.id),
    };
  } finally {
    db.close();
  }
}

export function ensureWorkflowDbSchema(options = {}) {
  const db = options.db;
  if (!db) {
    throw new Error("ensureWorkflowDbSchema requires db");
  }
  const resolved = resolveWorkflowSchemaOptions(options);
  const sqliteFile = resolved.sqliteFile;
  const role = resolved.role;
  const engineVersion = resolved.engineVersion;
  const schemaFile = resolved.schemaFile;
  const backupRoot = resolved.backupRoot;

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

export function migrateWorkflowDbFile(options = {}) {
  const resolved = resolveWorkflowSchemaOptions(options);
  if (!resolved.sqliteFile) {
    throw new Error("migrateWorkflowDbFile requires sqliteFile");
  }
  fs.mkdirSync(path.dirname(resolved.sqliteFile), { recursive: true });
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(resolved.sqliteFile);
  try {
    db.exec("PRAGMA foreign_keys=OFF;");
    const migration = ensureWorkflowDbSchema({
      db,
      sqliteFile: resolved.sqliteFile,
      role: resolved.role,
      engineVersion: resolved.engineVersion,
      schemaFile: resolved.schemaFile,
      backupRoot: resolved.backupRoot,
    });
    const status = inspectWorkflowDbSchema({
      sqliteFile: resolved.sqliteFile,
      schemaFile: resolved.schemaFile,
      role: resolved.role,
      engineVersion: resolved.engineVersion,
      backupRoot: resolved.backupRoot,
    });
    return {
      ok: true,
      sqlite_file: resolved.sqliteFile,
      schema_file: resolved.schemaFile,
      migration,
      status,
    };
  } finally {
    try {
      db.exec("PRAGMA foreign_keys=ON;");
    } catch {
    }
    db.close();
  }
}
