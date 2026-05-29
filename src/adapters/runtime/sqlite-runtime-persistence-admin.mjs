import path from "node:path";
import {
  backupWorkflowDbFile,
  getDefaultWorkflowSchemaFile,
  inspectWorkflowDbSchema,
  migrateWorkflowDbFile,
} from "../../lib/sqlite/workflow-db-schema-lib.mjs";
import { assertRuntimePersistenceAdmin } from "../../core/ports/runtime-persistence-admin-port.mjs";

export function createSqliteRuntimePersistenceAdmin(options = {}) {
  const sqliteFile = path.resolve(process.cwd(), options.sqliteFile ?? ".aidn/runtime/index/workflow-index.sqlite");
  const schemaFile = options.schemaFile
    ? path.resolve(process.cwd(), options.schemaFile)
    : getDefaultWorkflowSchemaFile();
  const role = String(options.role ?? "runtime-persistence-admin");

  function describeBackend() {
    return {
      backend_kind: "sqlite",
      sqlite_file: sqliteFile,
      schema_file: schemaFile,
      role,
      scope: "runtime-artifact-persistence",
    };
  }

  function inspectSchema() {
    return inspectWorkflowDbSchema({
      sqliteFile,
      schemaFile,
      role,
    });
  }

  function migrateSchema({ backupRoot = "" } = {}) {
    return migrateWorkflowDbFile({
      sqliteFile,
      schemaFile,
      role,
      ...(backupRoot ? { backupRoot } : {}),
    });
  }

  function backupPersistence({ backupRoot = "" } = {}) {
    return backupWorkflowDbFile({
      sqliteFile,
      ...(backupRoot ? { backupRoot } : {}),
    });
  }

  return assertRuntimePersistenceAdmin({
    describeBackend,
    inspectSchema,
    migrateSchema,
    backupPersistence,
  }, "SqliteRuntimePersistenceAdmin");
}
