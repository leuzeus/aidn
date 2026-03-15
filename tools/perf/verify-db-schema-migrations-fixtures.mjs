#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";
import { readIndexFromSqlite } from "../../src/lib/sqlite/index-sqlite-lib.mjs";
import {
  getDatabaseSync,
  getDefaultWorkflowSchemaFile,
  readSchemaFile,
  toIdempotentSchema,
  ensureMetaTable,
} from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";

function countBackupFiles(sqliteFile) {
  const backupDir = path.join(path.dirname(sqliteFile), "backups");
  if (!fs.existsSync(backupDir)) {
    return 0;
  }
  return fs.readdirSync(backupDir)
    .filter((name) => name.endsWith(".pre-migration.sqlite"))
    .length;
}

function readMigrationRows(sqliteFile) {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(sqliteFile);
  try {
    return db.prepare(`
      SELECT migration_id, checksum, role, engine_version, applied_at, notes
      FROM schema_migrations
      ORDER BY applied_at ASC, migration_id ASC
    `).all();
  } finally {
    db.close();
  }
}

function seedLegacyDb(sqliteFile) {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(sqliteFile);
  try {
    const schemaSql = toIdempotentSchema(readSchemaFile(getDefaultWorkflowSchemaFile()));
    db.exec(schemaSql);
    ensureMetaTable(db);
    db.prepare(`
      INSERT INTO index_meta (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run("schema_version", "1", "2026-03-01T00:00:00.000Z");
    db.prepare(`
      INSERT INTO artifacts (
        path, kind, family, subtype, gate_relevance, classification_reason, content_format, content, canonical_format, canonical_json, sha256, size_bytes, mtime_ns, session_id, cycle_id, source_mode, entity_confidence, legacy_origin, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "snapshots/context-snapshot.md",
      "snapshot",
      "normative",
      null,
      0,
      null,
      "utf8",
      "# Snapshot\n",
      null,
      null,
      "legacy-sha",
      11,
      1,
      null,
      null,
      "explicit",
      1,
      "legacy-fixture",
      "2026-03-01T00:00:00.000Z",
    );
  } finally {
    db.close();
  }
}

function countArtifacts(sqliteFile) {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(sqliteFile);
  try {
    return Number(db.prepare("SELECT COUNT(*) AS count FROM artifacts").get()?.count ?? 0);
  } finally {
    db.close();
  }
}

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-db-schema-migrations-"));

    const freshSqlite = path.join(tempRoot, "fresh", "workflow-index.sqlite");
    fs.mkdirSync(path.dirname(freshSqlite), { recursive: true });
    const freshStore = createArtifactStore({
      sqliteFile: freshSqlite,
    });
    freshStore.close();

    const freshMigrations = readMigrationRows(freshSqlite);
    assert.equal(freshMigrations.length, 1, "fresh DB should apply baseline migration");
    assert.equal(countBackupFiles(freshSqlite), 0, "fresh DB should not create a pre-migration backup");

    const legacySqlite = path.join(tempRoot, "legacy", "workflow-index.sqlite");
    fs.mkdirSync(path.dirname(legacySqlite), { recursive: true });
    seedLegacyDb(legacySqlite);
    assert.equal(countArtifacts(legacySqlite), 1, "legacy DB should contain seeded artifact before migration adoption");

    const legacyStore = createArtifactStore({
      sqliteFile: legacySqlite,
    });
    legacyStore.close();

    const legacyMigrations = readMigrationRows(legacySqlite);
    assert.equal(legacyMigrations.length, 1, "legacy DB should record baseline migration adoption");
    assert.equal(countBackupFiles(legacySqlite), 1, "legacy DB should create a pre-migration backup on first adoption");
    assert.equal(countArtifacts(legacySqlite), 1, "baseline migration adoption should preserve existing artifact rows");

    const legacyPayload = readIndexFromSqlite(legacySqlite);
    assert.equal(Number(legacyPayload?.payload?.schema_version ?? 0), 2, "migrated DB should expose schema version 2");

    const result = {
      ts: new Date().toISOString(),
      checks: {
        fresh_baseline_migration_recorded: freshMigrations.length === 1,
        fresh_backup_not_created: countBackupFiles(freshSqlite) === 0,
        legacy_backup_created: countBackupFiles(legacySqlite) === 1,
        legacy_migration_recorded: legacyMigrations.length === 1,
        legacy_rows_preserved_during_adoption: countArtifacts(legacySqlite) === 1,
        sqlite_reader_sees_schema_v2: Number(legacyPayload?.payload?.schema_version ?? 0) === 2,
      },
      samples: {
        fresh_migration_ids: freshMigrations.map((row) => row.migration_id),
        legacy_migration_ids: legacyMigrations.map((row) => row.migration_id),
        legacy_backup_count: countBackupFiles(legacySqlite),
        legacy_artifacts_after_adoption: countArtifacts(legacySqlite),
      },
      pass: true,
    };

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
