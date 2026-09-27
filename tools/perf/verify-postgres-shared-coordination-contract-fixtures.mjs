#!/usr/bin/env node
import fs from "node:fs";
import {
  POSTGRES_SHARED_COORDINATION_DRIVER,
  getPostgresSharedCoordinationContract,
  getPostgresSharedCoordinationSchemaFile,
  getPostgresSharedCoordinationMigrationFiles,
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

    assert(contract.schema_version === 5, "expected shared coordination schema version 5");
    const migrations = getPostgresSharedCoordinationMigrationFiles();
    assert(JSON.stringify(migrations.map(item => item.version)) === "[2,3,4,5]", "expected ordered explicit additive migrations");
    const supervisionSql = fs.readFileSync(migrations[1].file, "utf8");
    for (const tableName of ["execution_runs", "execution_tasks", "execution_attempts", "execution_events"]) {
      assert(tableNames.has(tableName), `expected supervision contract table ${tableName}`);
      assert(supervisionSql.includes(`aidn_shared.${tableName}`), `expected v3 to declare ${tableName}`);
    }
    const schedulerSql = fs.readFileSync(migrations[2].file, "utf8");
    for (const tableName of ["execution_supervisors", "execution_acceptances", "execution_integrations", "execution_run_validations"]) {
      assert(tableNames.has(tableName), `expected supervised contract table ${tableName}`);
      assert(schedulerSql.includes(`CREATE TABLE aidn_shared.${tableName}`), `expected v4 to declare ${tableName}`);
    }
    assert(schedulerSql.includes("DEFAULT 'legacy'"), "expected existing runs to remain historical");
    assert(schedulerSql.includes("run_deadline_at TIMESTAMPTZ"), "expected durable database deadline");
    const consolidationSql=fs.readFileSync(migrations[3].file,"utf8");
    assert(tableNames.has("execution_integration_intents") && consolidationSql.includes("CREATE TABLE aidn_shared.execution_integration_intents"), "expected durable intention before Git effects");
    assert(consolidationSql.includes("evidence_verification_sha256") && !consolidationSql.includes("DROP "), "expected additive authenticated evidence without rewriting history");

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
