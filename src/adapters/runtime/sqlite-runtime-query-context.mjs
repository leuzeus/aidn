import fs from "node:fs";
import path from "node:path";
import { getDatabaseSync } from "../../lib/sqlite/workflow-db-schema-lib.mjs";

export function openSqliteRuntimeQueryContext({
  indexFile,
  role = "runtime-snapshot-query",
} = {}) {
  const absolute = path.resolve(process.cwd(), indexFile ?? "");
  if (!fs.existsSync(absolute)) {
    throw new Error(`SQLite index file not found: ${absolute}`);
  }
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(absolute, { readOnly: true });
  return {
    absolute,
    db,
    role,
  };
}
