#!/usr/bin/env node
import fs from "node:fs";
import {
  POSTGRES_SHARED_COORDINATION_DRIVER,
  getPostgresSharedCoordinationContract,
  getPostgresSharedCoordinationSchemaFile,
  resolvePostgresSharedCoordinationConnection,
} from "../../src/application/runtime/postgres-shared-coordination-contract-service.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  try {
    const contract = getPostgresSharedCoordinationContract({
      workspace: {
        shared_runtime_connection_ref: "env:AIDN_PG_URL",
      },
      env: {
        AIDN_PG_URL: "postgres://aidn:test@localhost:5432/aidn",
      },
    });
    const tableNames = new Set(contract.tables.map((table) => table.table));
    const schemaFile = getPostgresSharedCoordinationSchemaFile();
    const schemaSql = fs.readFileSync(schemaFile, "utf8");

    assert(contract.backend_kind === "postgres", "expected postgres backend kind");
    assert(contract.scope === "shared-coordination-only", "expected explicit shared-coordination scope");
    assert(contract.driver.package_name === "pg", "expected pg driver selection");
    assert(contract.driver.packaging_decision === "optional-dependency", "expected optional packaging decision");
    assert(contract.driver.package_scope === "optionalDependencies", "expected optional dependency package scope");
    assert(POSTGRES_SHARED_COORDINATION_DRIVER.module_specifier === "pg", "expected pg module specifier");

    for (const tableName of ["schema_migrations", "project_registry", "workspace_registry", "worktree_registry", "planning_states", "handoff_relays", "coordination_records"]) {
      assert(tableNames.has(tableName), `expected contract table ${tableName}`);
      assert(schemaSql.includes(`aidn_shared.${tableName}`), `expected schema to declare ${tableName}`);
    }

    assert(contract.schema_version === 2, "expected shared coordination schema version 2");

    for (const operation of ["registerWorkspace", "registerWorktreeHeartbeat", "upsertPlanningState", "appendHandoffRelay", "appendCoordinationRecord", "healthcheck"]) {
      assert(contract.operations.includes(operation), `expected operation ${operation}`);
    }

    assert(contract.non_goals.some((item) => item.includes("workflow-index.sqlite")), "expected local sqlite projection non-goal");
    assert(contract.non_goals.some((item) => item.includes("docs/audit/*")), "expected docs/audit non-goal");
    assert(contract.bootstrap.connection.status === "resolved", "expected env-backed bootstrap resolution");

    const resolvedFromEnv = resolvePostgresSharedCoordinationConnection({
      workspace: {
        shared_runtime_connection_ref: "env:AIDN_PG_URL",
      },
      env: {
        AIDN_PG_URL: "postgres://aidn:test@localhost:5432/aidn",
      },
    });
    assert(resolvedFromEnv.ok === true, "expected env connection resolution to succeed");
    assert(resolvedFromEnv.source === "env", "expected env connection resolution source");
    assert(resolvedFromEnv.env_key === "AIDN_PG_URL", "expected env key to be exposed");

    const missingEnv = resolvePostgresSharedCoordinationConnection({
      workspace: {
        shared_runtime_connection_ref: "env:AIDN_PG_URL",
      },
      env: {},
    });
    assert(missingEnv.status === "missing-env", "expected missing env status");

    const invalidRef = resolvePostgresSharedCoordinationConnection({
      workspace: {
        shared_runtime_connection_ref: "literal:postgres://aidn:test@localhost:5432/aidn",
      },
    });
    assert(invalidRef.status === "invalid-ref", "expected invalid ref status");

    const explicitConnection = resolvePostgresSharedCoordinationConnection({
      workspace: {
        shared_runtime_connection_ref: "env:AIDN_PG_URL",
      },
      connectionString: "postgres://aidn:explicit@localhost:5432/aidn",
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
