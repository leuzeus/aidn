import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const POSTGRES_SHARED_COORDINATION_SCHEMA_NAME = "aidn_shared";
export const POSTGRES_SHARED_COORDINATION_SCHEMA_VERSION = 5;
export const POSTGRES_SHARED_COORDINATION_DRIVER = Object.freeze({
  backend_kind: "postgres",
  package_name: "pg",
  module_specifier: "pg",
  import_style: "dynamic-import",
  packaging_decision: "optional-dependency",
  package_scope: "optionalDependencies",
  rationale: "Ship PostgreSQL support as an optional dependency so SQLite-only installs remain valid while shared coordination can be enabled explicitly.",
});

export const POSTGRES_SHARED_COORDINATION_OPERATIONS = Object.freeze([
  "registerWorkspace",
  "registerWorktreeHeartbeat",
  "upsertPlanningState",
  "appendHandoffRelay",
  "appendCoordinationRecord",
  "getPlanningState",
  "getLatestHandoffRelay",
  "listCoordinationRecords",
  "healthcheck",
]);

export const POSTGRES_SHARED_COORDINATION_TABLES = Object.freeze([
  Object.freeze({
    table: "schema_migrations",
    purpose: "track shared coordination schema bootstrap and upgrades",
    lifecycle: "append-only",
    primary_key: ["schema_name", "schema_version"],
  }),
  Object.freeze({
    table: "project_registry",
    purpose: "store canonical shared project identity and backend binding for multi-project shared coordination",
    lifecycle: "upsert",
    primary_key: ["project_id"],
  }),
  Object.freeze({
    table: "workspace_registry",
    purpose: "store canonical shared workspace identity scoped inside a project",
    lifecycle: "upsert",
    primary_key: ["project_id", "workspace_id"],
  }),
  Object.freeze({
    table: "worktree_registry",
    purpose: "record distinct checkout identities and heartbeats per project workspace",
    lifecycle: "upsert",
    primary_key: ["project_id", "workspace_id", "worktree_id"],
  }),
  Object.freeze({
    table: "planning_states",
    purpose: "persist shared planning and dispatch metadata without replacing versioned backlog artifacts",
    lifecycle: "upsert-with-revision",
    primary_key: ["project_id", "workspace_id", "planning_key"],
  }),
  Object.freeze({
    table: "handoff_relays",
    purpose: "append relay metadata for cross-worktree handoff coordination while keeping HANDOFF-PACKET.md versioned",
    lifecycle: "append-only",
    primary_key: ["project_id", "workspace_id", "relay_id"],
  }),
  Object.freeze({
    table: "coordination_records",
    purpose: "append dispatch, arbitration, and coordination digest records shared across worktrees",
    lifecycle: "append-only",
    primary_key: ["project_id", "workspace_id", "record_id"],
  }),
  Object.freeze({ table: "execution_runs", purpose: "reserve a canonical scope for one bounded execution run", lifecycle: "transactional-with-revision", primary_key: ["run_id"] }),
  Object.freeze({ table: "execution_tasks", purpose: "retain the frozen delegated tasks of a run", lifecycle: "transactional-with-revision", primary_key: ["run_id", "task_id"] }),
  Object.freeze({ table: "execution_attempts", purpose: "retain attempt ownership, launch intent, delegation and terminal evidence", lifecycle: "transactional-with-generation", primary_key: ["attempt_id"] }),
  Object.freeze({ table: "execution_events", purpose: "retain immutable idempotent execution events", lifecycle: "append-only", primary_key: ["attempt_id", "event_id"] }),
  Object.freeze({ table: "execution_supervisors", purpose: "fence supervisor generations and retain termination proofs", lifecycle: "transactional-with-generation", primary_key: ["run_id", "generation"] }),
  Object.freeze({ table: "execution_acceptances", purpose: "retain immutable supervisor task acceptance", lifecycle: "append-only", primary_key: ["attempt_id"] }),
  Object.freeze({ table: "execution_integrations", purpose: "retain prepared and applied Git integration evidence", lifecycle: "append-only", primary_key: ["run_id", "integration_id"] }),
  Object.freeze({ table: "execution_run_validations", purpose: "retain final validation and audit on the integrated SHA", lifecycle: "append-only", primary_key: ["run_id"] }),
  Object.freeze({ table: "execution_integration_intents", purpose: "reserve immutable Git preparation intent before local effects", lifecycle: "append-only", primary_key: ["run_id", "integration_id"] }),
]);

export const POSTGRES_SHARED_COORDINATION_NON_GOALS = Object.freeze([
  "Do not replace the local workflow-index.sqlite projection on day one.",
  "Do not externalize docs/audit/* or other versioned workflow artifacts into PostgreSQL.",
  "Do not move artifact blobs or fileless reconstruction payloads into PostgreSQL in phase 1.",
  "Do not rename current SQLite db-* admin flows to pretend they operate on PostgreSQL.",
]);

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function normalizeEnvKey(value) {
  const envKey = normalizeScalar(value);
  if (!envKey) {
    return "";
  }
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(envKey) ? envKey : "";
}

export function getPostgresSharedCoordinationSchemaFile() {
  return path.resolve(THIS_DIR, "..", "..", "..", "tools", "perf", "sql", "shared-coordination-postgres.sql");
}

export function getPostgresSharedCoordinationMigrationFiles() {
  return [
    { version: 2, file: getPostgresSharedCoordinationSchemaFile() },
    { version: 3, file: path.resolve(THIS_DIR, "..", "..", "..", "tools", "perf", "sql", "shared-coordination-postgres-v3.sql") },
    { version: 4, file: path.resolve(THIS_DIR, "..", "..", "..", "tools", "perf", "sql", "shared-coordination-postgres-v4.sql") },
    { version: 5, file: path.resolve(THIS_DIR, "..", "..", "..", "tools", "perf", "sql", "shared-coordination-postgres-v5.sql") },
  ];
}

export function listPostgresSharedCoordinationTables() {
  return POSTGRES_SHARED_COORDINATION_TABLES.map((table) => ({
    ...table,
  }));
}

export function listPostgresSharedCoordinationTableNames() {
  return POSTGRES_SHARED_COORDINATION_TABLES.map((table) => table.table);
}

export function resolvePostgresSharedCoordinationConnection({
  workspace = null,
  connectionString = "",
  connectionRef = "",
  env = process.env,
} = {}) {
  const explicitConnectionString = normalizeScalar(connectionString);
  if (explicitConnectionString) {
    return {
      ok: true,
      status: "resolved",
      source: "explicit",
      driver: POSTGRES_SHARED_COORDINATION_DRIVER,
      connection_ref: "explicit",
      connection_string: explicitConnectionString,
      env_key: "",
      message: "connection string supplied explicitly",
    };
  }

  const candidateRef = normalizeScalar(connectionRef || workspace?.shared_runtime_connection_ref);
  if (!candidateRef) {
    return {
      ok: false,
      status: "not-configured",
      source: "none",
      driver: POSTGRES_SHARED_COORDINATION_DRIVER,
      connection_ref: "",
      connection_string: "",
      env_key: "",
      message: "no PostgreSQL connection reference configured",
    };
  }

  if (!candidateRef.startsWith("env:")) {
    return {
      ok: false,
      status: "invalid-ref",
      source: "locator",
      driver: POSTGRES_SHARED_COORDINATION_DRIVER,
      connection_ref: candidateRef,
      connection_string: "",
      env_key: "",
      message: "unsupported PostgreSQL connection reference; use env:VAR_NAME or pass an explicit connection string",
    };
  }

  const envKey = normalizeEnvKey(candidateRef.slice(4));
  if (!envKey) {
    return {
      ok: false,
      status: "invalid-ref",
      source: "locator",
      driver: POSTGRES_SHARED_COORDINATION_DRIVER,
      connection_ref: candidateRef,
      connection_string: "",
      env_key: "",
      message: "invalid PostgreSQL environment variable reference",
    };
  }

  const resolvedConnectionString = normalizeScalar(env?.[envKey]);
  if (!resolvedConnectionString) {
    return {
      ok: false,
      status: "missing-env",
      source: "env",
      driver: POSTGRES_SHARED_COORDINATION_DRIVER,
      connection_ref: candidateRef,
      connection_string: "",
      env_key: envKey,
      message: `environment variable ${envKey} is not set`,
    };
  }

  return {
    ok: true,
    status: "resolved",
    source: "env",
    driver: POSTGRES_SHARED_COORDINATION_DRIVER,
    connection_ref: candidateRef,
    connection_string: resolvedConnectionString,
    env_key: envKey,
    message: `resolved PostgreSQL connection string from ${envKey}`,
  };
}

export function describePostgresSharedCoordinationBootstrap(options = {}) {
  const connection = resolvePostgresSharedCoordinationConnection(options);
  return {
    backend_kind: "postgres",
    schema_name: POSTGRES_SHARED_COORDINATION_SCHEMA_NAME,
    schema_version: POSTGRES_SHARED_COORDINATION_SCHEMA_VERSION,
    schema_file: getPostgresSharedCoordinationSchemaFile(),
    driver: POSTGRES_SHARED_COORDINATION_DRIVER,
    connection,
    bootstrap_steps: [
      "Resolve the connection string from an explicit option or an env-backed locator reference.",
      "Acquire the stable migration advisory lock and reread the applied version inside a transaction.",
      "Reject newer schemas and apply only missing versioned migrations, including shared-coordination-postgres-v3.sql through shared-coordination-postgres-v5.sql.",
      "Record the applied schema version in aidn_shared.schema_migrations.",
      "Run a lightweight healthcheck before enabling shared coordination writes.",
    ],
  };
}

export function getPostgresSharedCoordinationContract(options = {}) {
  return {
    backend_kind: "postgres",
    scope: "shared-coordination-only",
    schema_name: POSTGRES_SHARED_COORDINATION_SCHEMA_NAME,
    schema_version: POSTGRES_SHARED_COORDINATION_SCHEMA_VERSION,
    driver: POSTGRES_SHARED_COORDINATION_DRIVER,
    operations: [...POSTGRES_SHARED_COORDINATION_OPERATIONS],
    tables: listPostgresSharedCoordinationTables(),
    schema_file: getPostgresSharedCoordinationSchemaFile(),
    bootstrap: describePostgresSharedCoordinationBootstrap(options),
    non_goals: [...POSTGRES_SHARED_COORDINATION_NON_GOALS],
  };
}
