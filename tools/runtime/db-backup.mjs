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
  console.log("  npx aidn runtime db-backup --target . --json");
  console.log("  npx aidn runtime persistence-backup --target . --backend sqlite --json");
  console.log("  npx aidn runtime persistence-backup --target . --backend postgres --json");
  console.log("  npx aidn runtime db-backup --target . --sqlite-file .aidn/runtime/index/workflow-index.sqlite --json");
}

export async function backupRuntimePersistence({
  targetRoot = ".",
  backend = "",
  sqliteFile = ".aidn/runtime/index/workflow-index.sqlite",
  backupRoot = "",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot);
  const absoluteSqliteFile = path.isAbsolute(sqliteFile)
    ? sqliteFile
    : path.resolve(absoluteTargetRoot, sqliteFile);
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
  });
  const result = await admin.backupPersistence({
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
    const payload = await backupRuntimePersistence({
      targetRoot: args.target,
      backend: args.backend,
      sqliteFile: args.sqliteFile,
      backupRoot: args.backupRoot,
    });
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`Runtime backend: ${payload.runtime_persistence?.backend ?? "unknown"} (${payload.runtime_persistence?.source ?? "unknown"})`);
    if (payload.sqlite_file) {
      console.log(`SQLite projection DB: ${payload.sqlite_file}`);
    }
    if (payload.runtime_backend?.schema_version) {
      console.log(`Schema version: ${payload.runtime_backend.schema_version}`);
    }
    if (payload.compatibility_fallback_used === true) {
      console.log("Legacy compatibility fallback used: yes");
    }
    console.log(`Backup created: ${payload.backup_created ? "yes" : "no"}`);
    console.log(`Backup file: ${payload.backup_file ?? "none"}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
