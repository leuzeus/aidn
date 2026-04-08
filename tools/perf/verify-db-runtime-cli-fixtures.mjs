#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  ensureMetaTable,
  getDatabaseSync,
  getDefaultWorkflowSchemaFile,
  readSchemaFile,
  toIdempotentSchema,
} from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function seedLegacyDb(sqliteFile) {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(sqliteFile);
  try {
    db.exec(toIdempotentSchema(readSchemaFile(getDefaultWorkflowSchemaFile())));
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
      "current_state",
      0,
      null,
      "utf8",
      "# Current State\n",
      null,
      null,
      "legacy-sha",
      16,
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

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-db-runtime-cli-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.mkdirSync(targetRoot, { recursive: true });

    const sqliteRelative = ".aidn/runtime/index/workflow-index.sqlite";
    const sqliteFile = path.join(targetRoot, ".aidn", "runtime", "index", "workflow-index.sqlite");

    const statusBefore = runJson("bin/aidn.mjs", [
      "runtime",
      "db-status",
      "--target",
      targetRoot,
      "--sqlite-file",
      sqliteRelative,
      "--json",
    ]);

    const migrateFresh = runJson("bin/aidn.mjs", [
      "runtime",
      "db-migrate",
      "--target",
      targetRoot,
      "--sqlite-file",
      sqliteRelative,
      "--json",
    ]);

    const statusAfter = runJson("bin/aidn.mjs", [
      "runtime",
      "db-status",
      "--target",
      targetRoot,
      "--sqlite-file",
      sqliteRelative,
      "--json",
    ]);
    const persistenceAliasStatus = runJson("bin/aidn.mjs", [
      "runtime",
      "persistence-status",
      "--target",
      targetRoot,
      "--sqlite-file",
      sqliteRelative,
      "--backend",
      "sqlite",
      "--json",
    ]);

    const legacyTarget = path.join(tempRoot, "legacy");
    fs.mkdirSync(path.dirname(path.join(legacyTarget, sqliteRelative)), { recursive: true });
    const legacySqlite = path.join(legacyTarget, ".aidn", "runtime", "index", "workflow-index.sqlite");
    seedLegacyDb(legacySqlite);
    const migrateLegacy = runJson("bin/aidn.mjs", [
      "runtime",
      "db-migrate",
      "--target",
      legacyTarget,
      "--sqlite-file",
      sqliteRelative,
      "--json",
    ]);
    const backupFresh = runJson("bin/aidn.mjs", [
      "runtime",
      "db-backup",
      "--target",
      targetRoot,
      "--sqlite-file",
      sqliteRelative,
      "--json",
    ]);
    const adoptDryRunBlocked = runJson("bin/aidn.mjs", [
      "runtime",
      "persistence-adopt",
      "--target",
      targetRoot,
      "--backend",
      "postgres",
      "--dry-run",
      "--json",
    ]);

    const checks = {
      status_before_reports_missing_db: statusBefore.exists === false,
      status_before_reports_runtime_backend_resolution: statusBefore.runtime_persistence?.backend === "sqlite",
      status_before_reports_local_scope: statusBefore.sqlite_scope === "explicit-path",
      status_before_reports_pending_baseline: Array.isArray(statusBefore.pending_ids) && statusBefore.pending_ids.includes("0001_workflow_index_baseline_v2"),
      migrate_fresh_applies_baseline: Array.isArray(migrateFresh?.migration?.applied_ids) && migrateFresh.migration.applied_ids.includes("0001_workflow_index_baseline_v2"),
      status_after_no_pending: Array.isArray(statusAfter.pending_ids) && statusAfter.pending_ids.length === 0,
      status_after_reports_applied: Array.isArray(statusAfter.applied_ids) && statusAfter.applied_ids.includes("0001_workflow_index_baseline_v2"),
      status_after_reports_resolved_projection: statusAfter.resolved_projection_backend?.projection_scope === "local-target",
      persistence_alias_reports_sqlite_backend: persistenceAliasStatus.runtime_persistence?.backend === "sqlite" && persistenceAliasStatus.runtime_persistence?.source === "cli",
      persistence_adopt_alias_exposes_blocked_plan: adoptDryRunBlocked?.runtime_backend_adoption_plan?.action === "blocked-conflict"
        && adoptDryRunBlocked?.runtime_backend_adoption_plan?.reason_code === "target-unavailable"
        && adoptDryRunBlocked?.runtime_backend_adoption?.execution_status === "blocked",
      backup_fresh_created: typeof backupFresh?.backup_file === "string" && fs.existsSync(backupFresh.backup_file),
      legacy_migrate_creates_backup: typeof migrateLegacy?.migration?.backup_file === "string" && fs.existsSync(migrateLegacy.migration.backup_file),
      legacy_migrate_applies_baseline: Array.isArray(migrateLegacy?.migration?.applied_ids) && migrateLegacy.migration.applied_ids.includes("0001_workflow_index_baseline_v2"),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      checks,
      samples: {
        status_before: {
          exists: statusBefore.exists,
          runtime_persistence: statusBefore.runtime_persistence,
          sqlite_scope: statusBefore.sqlite_scope,
          pending_ids: statusBefore.pending_ids,
        },
        migrate_fresh: migrateFresh,
        status_after: {
          exists: statusAfter.exists,
          runtime_persistence: statusAfter.runtime_persistence,
          resolved_projection_backend: statusAfter.resolved_projection_backend,
          applied_ids: statusAfter.applied_ids,
          pending_ids: statusAfter.pending_ids,
        },
        persistence_alias_status: {
          runtime_persistence: persistenceAliasStatus.runtime_persistence,
        },
        adopt_dry_run_blocked: {
          plan: adoptDryRunBlocked?.runtime_backend_adoption_plan ?? null,
          execution_status: adoptDryRunBlocked?.runtime_backend_adoption?.execution_status ?? null,
        },
        backup_fresh: {
          backup_file: backupFresh?.backup_file ?? null,
        },
        migrate_legacy: {
          backup_file: migrateLegacy?.migration?.backup_file ?? null,
          applied_ids: migrateLegacy?.migration?.applied_ids ?? [],
        },
      },
      pass,
    };

    console.log(JSON.stringify(output, null, 2));
    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
