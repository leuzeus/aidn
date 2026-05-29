import fs from "node:fs";
import path from "node:path";
import { ensureWorkflowDbSchema, getDatabaseSync } from "../../lib/sqlite/workflow-db-schema-lib.mjs";

export function openSqliteRuntimeQueryContext({
  indexFile,
  role = "runtime-snapshot-query",
} = {}) {
  const absolute = path.resolve(process.cwd(), indexFile ?? "");
  if (!fs.existsSync(absolute)) {
    throw new Error(`SQLite index file not found: ${absolute}`);
  }
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(absolute);
  ensureWorkflowDbSchema({
    db,
    sqliteFile: absolute,
    role,
  });
  return {
    absolute,
    db,
  };
}
