#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";
import { readIndexFromSqlite, readRuntimeHeadArtifactsFromSqlite } from "../../src/lib/sqlite/index-sqlite-lib.mjs";
import {
  getDatabaseSync,
  getDefaultWorkflowSchemaFile,
  readSchemaFile,
  toIdempotentSchema,
  ensureMetaTable,
} from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveAuditArtifactText } from "../runtime/db-first-runtime-view-lib.mjs";

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
      "CURRENT-STATE.md",
      "other",
      "normative",
      null,
      0,
      null,
      "utf8",
      "# Current State\n",
      null,
      null,
      "legacy-current-state-sha",
      16,
      1,
      "S001",
      "C001",
      "explicit",
      1,
      "legacy-fixture",
      "2026-03-01T00:00:00.000Z",
    );
    db.prepare(`
      INSERT INTO artifacts (
        path, kind, family, subtype, gate_relevance, classification_reason, content_format, content, canonical_format, canonical_json, sha256, size_bytes, mtime_ns, session_id, cycle_id, source_mode, entity_confidence, legacy_origin, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "AGENT-HEALTH-SUMMARY.md",
      "other",
      "normative",
      "agent_health_summary",
      0,
      null,
      "utf8",
      "# Agent Health Summary\n",
      null,
      null,
      "legacy-agent-health-sha",
      23,
      2,
      "S001",
      "C001",
      "explicit",
      1,
      "legacy-fixture",
      "2026-03-02T00:00:00.000Z",
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

function countRuntimeHeads(sqliteFile) {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(sqliteFile);
  try {
    return Number(db.prepare("SELECT COUNT(*) AS count FROM runtime_heads").get()?.count ?? 0);
  } finally {
    db.close();
  }
}

function countArtifactBlobs(sqliteFile) {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(sqliteFile);
  try {
    return Number(db.prepare("SELECT COUNT(*) AS count FROM artifact_blobs").get()?.count ?? 0);
  } finally {
    db.close();
  }
}

function readArtifactBlobs(sqliteFile) {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(sqliteFile);
  try {
    return db.prepare(`
      SELECT artifact_id, content_format, content, canonical_format, canonical_json, sha256, size_bytes, updated_at
      FROM artifact_blobs
      ORDER BY artifact_id ASC
    `).all();
  } finally {
    db.close();
  }
}

function readMaterializableArtifacts(sqliteFile) {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(sqliteFile);
  try {
    return db.prepare(`
      SELECT path, content_format, content, canonical_format, canonical_json, sha256, size_bytes, updated_at
      FROM v_materializable_artifacts
      ORDER BY path ASC
    `).all();
  } finally {
    db.close();
  }
}

function readRuntimeHeads(sqliteFile) {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(sqliteFile);
  try {
    return db.prepare(`
      SELECT head_key, artifact_path, artifact_sha256, session_id, cycle_id, subtype, updated_at
      FROM runtime_heads
      ORDER BY head_key ASC
    `).all();
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
    assert.equal(freshMigrations.length, 4, "fresh DB should apply baseline, runtime-head, artifact-blob, and materialization-view migrations");
    assert.equal(countBackupFiles(freshSqlite), 0, "fresh DB should not create a pre-migration backup");
    assert.equal(countRuntimeHeads(freshSqlite), 0, "fresh DB should create runtime_heads table even when no hot artifacts exist yet");
    assert.equal(countArtifactBlobs(freshSqlite), 0, "fresh DB should create artifact_blobs table even when no artifacts exist yet");

    const legacySqlite = path.join(tempRoot, "legacy", "workflow-index.sqlite");
    fs.mkdirSync(path.dirname(legacySqlite), { recursive: true });
    seedLegacyDb(legacySqlite);
    assert.equal(countArtifacts(legacySqlite), 2, "legacy DB should contain seeded artifacts before migration adoption");

    const legacyStore = createArtifactStore({
      sqliteFile: legacySqlite,
    });
    legacyStore.close();

    const legacyMigrations = readMigrationRows(legacySqlite);
    assert.equal(legacyMigrations.length, 4, "legacy DB should record baseline, runtime-head, artifact-blob, and materialization-view migration adoption");
    assert.equal(countBackupFiles(legacySqlite), 1, "legacy DB should create a pre-migration backup on first adoption");
    assert.equal(countArtifacts(legacySqlite), 2, "migration adoption should preserve existing artifact rows");
    assert.equal(countRuntimeHeads(legacySqlite), 2, "runtime-head migration should backfill the seeded hot artifacts");
    assert.equal(countArtifactBlobs(legacySqlite), 2, "artifact-blob migration should backfill reconstructible payloads from legacy artifacts");

    const legacyPayload = readIndexFromSqlite(legacySqlite);
    assert.equal(Number(legacyPayload?.payload?.schema_version ?? 0), 5, "migrated DB should expose schema version 5");
    const runtimeHeadsPayload = readRuntimeHeadArtifactsFromSqlite(legacySqlite);
    const artifactBlobs = readArtifactBlobs(legacySqlite);
    const materializableArtifacts = readMaterializableArtifacts(legacySqlite);
    const materializedCurrentState = materializableArtifacts.find((row) => row.path === "CURRENT-STATE.md");

    const runtimeHeads = readRuntimeHeads(legacySqlite);
    const currentStateHead = runtimeHeads.find((row) => row.head_key === "current_state");
    const agentHealthHead = runtimeHeads.find((row) => row.head_key === "agent_health_summary");
    assert(currentStateHead, "legacy DB should backfill current_state head from path fallback");
    assert.equal(currentStateHead.artifact_path, "CURRENT-STATE.md", "current_state head should point at CURRENT-STATE.md");
    assert(agentHealthHead, "legacy DB should backfill agent_health_summary head from subtype");
    assert.equal(agentHealthHead.artifact_path, "AGENT-HEALTH-SUMMARY.md", "agent_health_summary head should point at AGENT-HEALTH-SUMMARY.md");
    assert.equal(artifactBlobs[0]?.content_format, "utf8", "artifact blob backfill should preserve content format");
    assert.match(String(artifactBlobs[0]?.content ?? ""), /Current State/i, "artifact blob backfill should preserve reconstructible content");
    assert.match(String(materializedCurrentState?.content ?? ""), /Current State/i, "materializable view should expose reconstructible content");
    const runtimeHeadOnlyResolution = resolveAuditArtifactText({
      targetRoot: path.join(tempRoot, "legacy"),
      candidatePath: "docs/audit/CURRENT-STATE.md",
      dbBacked: true,
      sqlitePayload: null,
      sqliteRuntimeHeads: runtimeHeadsPayload.heads,
    });
    assert(runtimeHeadOnlyResolution.exists, "runtime-head-only resolution should resolve CURRENT-STATE.md");
    assert.equal(runtimeHeadOnlyResolution.source, "sqlite", "runtime-head-only resolution should report sqlite source");
    assert.match(runtimeHeadOnlyResolution.text, /Current State/i, "runtime-head-only resolution should return stored content");
    const materializedTarget = path.join(tempRoot, "materialized");
    fs.mkdirSync(materializedTarget, { recursive: true });
    const migratedStore = createArtifactStore({
      sqliteFile: legacySqlite,
    });
    const materializeResult = migratedStore.materializeArtifacts({
      targetRoot: materializedTarget,
      onlyPaths: ["CURRENT-STATE.md", "AGENT-HEALTH-SUMMARY.md"],
    });
    migratedStore.close();
    const materializedCurrentStateFile = path.join(materializedTarget, "docs", "audit", "CURRENT-STATE.md");
    const materializedAgentHealthFile = path.join(materializedTarget, "docs", "audit", "AGENT-HEALTH-SUMMARY.md");
    assert.equal(materializeResult.exported, 2, "materialization should export the reconstructible legacy artifacts");
    assert(fs.existsSync(materializedCurrentStateFile), "materialization should recreate CURRENT-STATE.md");
    assert(fs.existsSync(materializedAgentHealthFile), "materialization should recreate AGENT-HEALTH-SUMMARY.md");
    assert.match(fs.readFileSync(materializedCurrentStateFile, "utf8"), /Current State/i, "materialized CURRENT-STATE.md should preserve content");

    const result = {
      ts: new Date().toISOString(),
      checks: {
        fresh_baseline_runtime_heads_artifact_blobs_and_materialization_view_migrations_recorded: freshMigrations.length === 4,
        fresh_backup_not_created: countBackupFiles(freshSqlite) === 0,
        fresh_runtime_heads_table_present: countRuntimeHeads(freshSqlite) === 0,
        fresh_artifact_blobs_table_present: countArtifactBlobs(freshSqlite) === 0,
        legacy_backup_created: countBackupFiles(legacySqlite) === 1,
        legacy_migrations_recorded: legacyMigrations.length === 4,
        legacy_rows_preserved_during_adoption: countArtifacts(legacySqlite) === 2,
        runtime_heads_backfilled_from_legacy_artifacts: countRuntimeHeads(legacySqlite) === 2,
        artifact_blobs_backfilled_from_legacy_artifacts: countArtifactBlobs(legacySqlite) === 2,
        current_state_head_backfilled_by_path: currentStateHead?.artifact_path === "CURRENT-STATE.md",
        agent_health_head_backfilled_by_subtype: agentHealthHead?.artifact_path === "AGENT-HEALTH-SUMMARY.md",
        runtime_head_only_resolution_works: runtimeHeadOnlyResolution.exists === true,
        materializable_view_exposes_reconstructible_content: /Current State/i.test(String(materializedCurrentState?.content ?? "")),
        dual_materialization_roundtrip_works: materializeResult.exported === 2 && fs.existsSync(materializedCurrentStateFile) && fs.existsSync(materializedAgentHealthFile),
        sqlite_reader_sees_schema_v5: Number(legacyPayload?.payload?.schema_version ?? 0) === 5,
      },
      samples: {
        fresh_migration_ids: freshMigrations.map((row) => row.migration_id),
        legacy_migration_ids: legacyMigrations.map((row) => row.migration_id),
        legacy_backup_count: countBackupFiles(legacySqlite),
        legacy_artifacts_after_adoption: countArtifacts(legacySqlite),
        legacy_runtime_heads: runtimeHeads,
        legacy_artifact_blobs: artifactBlobs,
        legacy_materializable_artifacts: materializableArtifacts,
        materialize_result: materializeResult,
        runtime_head_only_resolution: runtimeHeadOnlyResolution,
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
