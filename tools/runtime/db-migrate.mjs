#!/usr/bin/env node
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
  console.log("  npx aidn runtime db-migrate --target . --json");
  console.log("  npx aidn runtime persistence-migrate --target . --backend sqlite --json");
  console.log("  npx aidn runtime db-migrate --target . --sqlite-file .aidn/runtime/index/workflow-index.sqlite --json");
}

export async function migrateRuntimePersistence({
  targetRoot = ".",
  backend = "",
  sqliteFile = ".aidn/runtime/index/workflow-index.sqlite",
  schemaFile = "",
  backupRoot = "",
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
  const result = await admin.migrateSchema({
    ...(absoluteBackupRoot ? { backupRoot: absoluteBackupRoot } : {}),
  });
  return {
    ts: new Date().toISOString(),
    target_root: absoluteTargetRoot,
    runtime_persistence: runtimePersistence,
    runtime_backend: admin.describeBackend(),
    ...result,
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
    });
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`Runtime backend: ${payload.runtime_persistence?.backend ?? "unknown"} (${payload.runtime_persistence?.source ?? "unknown"})`);
    console.log(`SQLite DB: ${payload.sqlite_file}`);
    console.log(`Applied migrations: ${payload.migration?.applied_ids?.join(", ") || "none"}`);
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
