#!/usr/bin/env node
import fs from "node:fs";
import {
  POSTGRES_RUNTIME_PERSISTENCE_DRIVER,
  getPostgresRuntimePersistenceContract,
  getPostgresRuntimePersistenceSchemaFile,
  resolvePostgresRuntimePersistenceConnection,
} from "../../src/application/runtime/postgres-runtime-persistence-contract-service.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  try {
    const contract = getPostgresRuntimePersistenceContract({
      connectionRef: "env:AIDN_PG_URL",
      env: {
        AIDN_PG_URL: "postgres://aidn:test@localhost:5432/aidn",
      },
    });
    const tableNames = new Set(contract.tables.map((table) => table.table));
    const schemaFile = getPostgresRuntimePersistenceSchemaFile();
    const schemaSql = fs.readFileSync(schemaFile, "utf8");

    assert(contract.backend_kind === "postgres", "expected postgres backend kind");
    assert(contract.scope === "runtime-artifact-persistence", "expected runtime artifact persistence scope");
    assert(contract.driver.package_name === "pg", "expected pg driver selection");
    assert(contract.driver.packaging_decision === "optional-dependency", "expected optional packaging decision");
    assert(contract.driver.package_scope === "optionalDependencies", "expected optional dependency package scope");
    assert(POSTGRES_RUNTIME_PERSISTENCE_DRIVER.module_specifier === "pg", "expected pg module specifier");
    assert(contract.schema_version === 2, "expected runtime persistence schema version 2");

    for (const tableName of ["schema_migrations", "index_meta", "artifacts", "runtime_heads", "adoption_events"]) {
      assert(tableNames.has(tableName), `expected contract table ${tableName}`);
      assert(schemaSql.includes(`aidn_runtime.${tableName}`), `expected schema to declare ${tableName}`);
    }
    assert(contract.legacy_compatibility_tables.some((entity) => entity.name === "runtime_snapshots"), "expected runtime_snapshots legacy compatibility table");

    assert(contract.non_goals.some((item) => item.includes("shared coordination")), "expected shared coordination boundary non-goal");
    assert(contract.non_goals.some((item) => item.includes("docs/audit/*")), "expected docs/audit non-goal");
    assert(contract.bootstrap.connection.status === "resolved", "expected env-backed bootstrap resolution");
    assert(contract.bootstrap.bootstrap_steps.some((item) => item.includes("runtime-artifacts-postgres-relational-v2.sql")), "expected bootstrap to mention relational v2 schema application");
    assert(contract.bootstrap.bootstrap_steps.some((item) => item.includes("read runtime_snapshots through an explicit legacy compatibility fallback")), "expected bootstrap to classify runtime_snapshots as explicit legacy compatibility");

    const resolvedFromEnv = resolvePostgresRuntimePersistenceConnection({
      connectionRef: "env:AIDN_PG_URL",
      env: {
        AIDN_PG_URL: "postgres://aidn:test@localhost:5432/aidn",
      },
    });
    assert(resolvedFromEnv.ok === true, "expected env connection resolution to succeed");
    assert(resolvedFromEnv.source === "env", "expected env connection resolution source");
    assert(resolvedFromEnv.env_key === "AIDN_PG_URL", "expected env key to be exposed");

    const missingEnv = resolvePostgresRuntimePersistenceConnection({
      connectionRef: "env:AIDN_PG_URL",
      env: {},
    });
    assert(missingEnv.status === "missing-env", "expected missing env status");

    const invalidRef = resolvePostgresRuntimePersistenceConnection({
      connectionRef: "literal:postgres://aidn:test@localhost:5432/aidn",
    });
    assert(invalidRef.status === "invalid-ref", "expected invalid ref status");

    const explicitConnection = resolvePostgresRuntimePersistenceConnection({
      connectionString: "postgres://aidn:explicit@localhost:5432/aidn",
      connectionRef: "env:AIDN_PG_URL",
      env: {},
    });
    assert(explicitConnection.ok === true, "expected explicit connection string to override env reference");
    assert(explicitConnection.source === "explicit", "expected explicit connection source");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
