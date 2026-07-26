#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createRuntimePersistenceAdmin,
  resolveEffectiveRuntimePersistence,
} from "../../src/application/runtime/runtime-persistence-service.mjs";
import { normalizeRuntimePersistenceBackend } from "../../src/lib/config/aidn-config-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    backend: "",
    sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    schemaFile: "",
    backupRoot: "",
    write: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--backend") {
      args.backend = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--schema-file") {
      args.schemaFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--backup-root") {
      args.backupRoot = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--write") {
      args.write = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (args.backend && !normalizeRuntimePersistenceBackend(args.backend)) {
    throw new Error("Invalid --backend. Expected sqlite|postgres");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime db-migrate --target . --json                         # preview");
  console.log("  npx aidn runtime db-migrate --target . --write --json                 # apply");
  console.log("  npx aidn runtime persistence-migrate --target . --backend sqlite --json");
  console.log("  npx aidn runtime persistence-migrate --target . --backend sqlite --write --json");
}

function deriveRuntimeBackendDiagnostic(payload) {
  const migration = payload?.migration ?? {};
  const status = payload?.status ?? {};
  const appliedIds = Array.isArray(migration.applied_ids) ? migration.applied_ids : [];
  const pendingIds = Array.isArray(status.pending_ids) ? status.pending_ids : [];
  const schemaStatus = pendingIds.length === 0
    ? "ready"
    : (payload?.exists === true ? "pending" : "missing");
  const recommendedAction = pendingIds.length === 0
    ? "no further runtime schema migration is required"
    : (payload?.write_requested === true
      ? "review the remaining pending migrations before relying on the selected runtime backend"
      : "review the preview, then rerun with --write to apply the pending migrations");
  return {
    scope: "runtime-persistence-migration",
    backend: String(payload?.runtime_persistence?.backend ?? "unknown").trim() || "unknown",
    backend_source: String(payload?.runtime_persistence?.source ?? "unknown").trim() || "unknown",
    schema_status: schemaStatus,
    applied_migration_count: appliedIds.length,
    pending_migration_count: pendingIds.length,
    backup_created: typeof migration.backup_file === "string" && migration.backup_file.length > 0,
    summary: pendingIds.length === 0
      ? `runtime schema migration converged with ${appliedIds.length} applied migration(s)`
      : `runtime schema migration left ${pendingIds.length} pending migration(s)`,
    recommended_action: recommendedAction,
  };
}

export async function migrateRuntimePersistence({
  targetRoot = ".",
  backend = "",
  sqliteFile = ".aidn/runtime/index/workflow-index.sqlite",
  schemaFile = "",
  backupRoot = "",
  write = false,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot);
  const absoluteSqliteFile = path.isAbsolute(sqliteFile)
    ? sqliteFile
    : path.resolve(absoluteTargetRoot, sqliteFile);
  const absoluteSchemaFile = schemaFile
    ? (path.isAbsolute(schemaFile) ? schemaFile : path.resolve(process.cwd(), schemaFile))
    : "";
  const absoluteBackupRoot = backupRoot
    ? (path.isAbsolute(backupRoot) ? backupRoot : path.resolve(absoluteTargetRoot, backupRoot))
    : "";
  if (absoluteSchemaFile && !fs.existsSync(absoluteSchemaFile)) {
    throw new Error(`Schema file not found: ${absoluteSchemaFile}`);
  }
  const runtimePersistence = resolveEffectiveRuntimePersistence({
    targetRoot: absoluteTargetRoot,
    backend,
  });
  const admin = createRuntimePersistenceAdmin({
    targetRoot: absoluteTargetRoot,
    backend: runtimePersistence.backend,
    connectionRef: runtimePersistence.connectionRef ?? "",
    sqliteFile: absoluteSqliteFile,
    ...(absoluteSchemaFile ? { schemaFile: absoluteSchemaFile } : {}),
    role: "runtime-cli",
  });
  const result = write
    ? await admin.migrateSchema({
      ...(absoluteBackupRoot ? { backupRoot: absoluteBackupRoot } : {}),
    })
    : await previewRuntimePersistenceMigration(admin);
  const effectClass = write ? "mutating" : "preview";
  return {
    ts: new Date().toISOString(),
    effect_class: effectClass,
    write_requested: write,
    target_root: absoluteTargetRoot,
    runtime_persistence: runtimePersistence,
    runtime_backend: admin.describeBackend(),
    ...result,
    runtime_backend_diagnostic: deriveRuntimeBackendDiagnostic({
      runtime_persistence: runtimePersistence,
      write_requested: write,
      ...result,
    }),
  };
}

async function previewRuntimePersistenceMigration(admin) {
  const status = await admin.inspectSchema();
  const pendingIds = Array.isArray(status?.pending_ids) ? status.pending_ids : [];
  return {
    ok: status?.ok !== false,
    ...(Object.prototype.hasOwnProperty.call(status ?? {}, "exists")
      ? { exists: status.exists }
      : {}),
    ...(typeof status?.sqlite_file === "string" ? { sqlite_file: status.sqlite_file } : {}),
    ...(typeof status?.schema_file === "string" ? { schema_file: status.schema_file } : {}),
    migration: {
      preview_only: true,
      write_requested: false,
      planned_ids: pendingIds,
      applied_ids: [],
      migration_count: 0,
      backup_file: null,
    },
    status,
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const payload = await migrateRuntimePersistence({
      targetRoot: args.target,
      backend: args.backend,
      sqliteFile: args.sqliteFile,
      schemaFile: args.schemaFile,
      backupRoot: args.backupRoot,
      write: args.write,
    });
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`Runtime backend: ${payload.runtime_persistence?.backend ?? "unknown"} (${payload.runtime_persistence?.source ?? "unknown"})`);
    console.log(`Effect: ${payload.effect_class} (write requested: ${payload.write_requested})`);
    console.log(`SQLite DB: ${payload.sqlite_file}`);
    console.log(`${payload.write_requested ? "Applied" : "Planned"} migrations: ${
      (payload.write_requested ? payload.migration?.applied_ids : payload.migration?.planned_ids)?.join(", ") || "none"
    }`);
    console.log(`Backup file: ${payload.migration?.backup_file ?? "none"}`);
    console.log(`Pending migrations after run: ${payload.status?.pending_ids?.join(", ") || "none"}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
