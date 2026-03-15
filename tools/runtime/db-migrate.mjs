#!/usr/bin/env node
import path from "node:path";
import { migrateWorkflowDbFile } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime db-migrate --target . --json");
  console.log("  npx aidn runtime db-migrate --target . --sqlite-file .aidn/runtime/index/workflow-index.sqlite --json");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const sqliteFile = path.isAbsolute(args.sqliteFile)
      ? args.sqliteFile
      : path.resolve(targetRoot, args.sqliteFile);
    const schemaFile = args.schemaFile
      ? (path.isAbsolute(args.schemaFile) ? args.schemaFile : path.resolve(process.cwd(), args.schemaFile))
      : "";
    const backupRoot = args.backupRoot
      ? (path.isAbsolute(args.backupRoot) ? args.backupRoot : path.resolve(targetRoot, args.backupRoot))
      : "";
    const result = migrateWorkflowDbFile({
      sqliteFile,
      ...(schemaFile ? { schemaFile } : {}),
      ...(backupRoot ? { backupRoot } : {}),
      role: "runtime-cli",
    });
    const payload = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      ...result,
    };
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
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

main();
