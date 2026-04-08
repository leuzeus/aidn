import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME = "aidn_runtime";
export const POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION = 1;
export const POSTGRES_RUNTIME_PERSISTENCE_DRIVER = Object.freeze({
  backend_kind: "postgres",
  package_name: "pg",
  module_specifier: "pg",
  import_style: "dynamic-import",
  packaging_decision: "optional-dependency",
  package_scope: "optionalDependencies",
  rationale: "Ship runtime PostgreSQL persistence as an optional dependency so SQLite-only installs remain valid while runtime backend adoption can be explicit.",
});

const POSTGRES_RUNTIME_PERSISTENCE_TABLES = Object.freeze([
  Object.freeze({
    table: "schema_migrations",
    purpose: "track runtime artifact schema bootstrap and upgrades",
    lifecycle: "append-only",
    primary_key: ["schema_name", "schema_version"],
  }),
  Object.freeze({
    table: "runtime_snapshots",
    purpose: "store the canonical runtime artifact payload snapshot for one resolved project root",
    lifecycle: "upsert",
    primary_key: ["scope_key"],
  }),
  Object.freeze({
    table: "runtime_heads",
    purpose: "store hot runtime head lookups derived from the canonical runtime snapshot",
    lifecycle: "replace-per-scope",
    primary_key: ["scope_key", "head_key"],
  }),
  Object.freeze({
    table: "adoption_events",
    purpose: "record explicit backend adoption, transfer, and repair outcomes",
    lifecycle: "append-only",
    primary_key: ["event_id"],
  }),
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

export function getPostgresRuntimePersistenceSchemaFile() {
  return path.resolve(THIS_DIR, "..", "..", "..", "tools", "perf", "sql", "runtime-artifacts-postgres.sql");
}

export function listPostgresRuntimePersistenceTables() {
  return POSTGRES_RUNTIME_PERSISTENCE_TABLES.map((table) => ({ ...table }));
}

export function listPostgresRuntimePersistenceTableNames() {
  return POSTGRES_RUNTIME_PERSISTENCE_TABLES.map((table) => table.table);
}

export function resolvePostgresRuntimePersistenceConnection({
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
      driver: POSTGRES_RUNTIME_PERSISTENCE_DRIVER,
      connection_ref: "explicit",
      connection_string: explicitConnectionString,
      env_key: "",
      message: "connection string supplied explicitly",
    };
  }

  const candidateRef = normalizeScalar(connectionRef);
  if (!candidateRef) {
    return {
      ok: false,
      status: "not-configured",
      source: "none",
      driver: POSTGRES_RUNTIME_PERSISTENCE_DRIVER,
      connection_ref: "",
      connection_string: "",
      env_key: "",
      message: "no PostgreSQL runtime persistence connection reference configured",
    };
  }

  if (!candidateRef.startsWith("env:")) {
    return {
      ok: false,
      status: "invalid-ref",
      source: "locator",
      driver: POSTGRES_RUNTIME_PERSISTENCE_DRIVER,
      connection_ref: candidateRef,
      connection_string: "",
      env_key: "",
      message: "unsupported PostgreSQL runtime connection reference; use env:VAR_NAME or pass an explicit connection string",
    };
  }

  const envKey = normalizeEnvKey(candidateRef.slice(4));
  if (!envKey) {
    return {
      ok: false,
      status: "invalid-ref",
      source: "locator",
      driver: POSTGRES_RUNTIME_PERSISTENCE_DRIVER,
      connection_ref: candidateRef,
      connection_string: "",
      env_key: "",
      message: "invalid PostgreSQL runtime environment variable reference",
    };
  }

  const resolvedConnectionString = normalizeScalar(env?.[envKey]);
  if (!resolvedConnectionString) {
    return {
      ok: false,
      status: "missing-env",
      source: "env",
      driver: POSTGRES_RUNTIME_PERSISTENCE_DRIVER,
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
    driver: POSTGRES_RUNTIME_PERSISTENCE_DRIVER,
    connection_ref: candidateRef,
    connection_string: resolvedConnectionString,
    env_key: envKey,
    message: `resolved PostgreSQL runtime connection string from ${envKey}`,
  };
}

export function describePostgresRuntimePersistenceBootstrap(options = {}) {
  const connection = resolvePostgresRuntimePersistenceConnection(options);
  return {
    backend_kind: "postgres",
    schema_name: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
    schema_version: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION,
    schema_file: getPostgresRuntimePersistenceSchemaFile(),
    driver: POSTGRES_RUNTIME_PERSISTENCE_DRIVER,
    connection,
    bootstrap_steps: [
      "Resolve the connection string from an explicit option or env-backed reference.",
      `Create schema ${POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME} if it does not exist.`,
      "Apply runtime-artifacts-postgres.sql inside a transaction.",
      "Record the applied schema version in aidn_runtime.schema_migrations.",
      "Validate runtime_snapshots and runtime_heads readiness before adoption.",
    ],
  };
}

export function getPostgresRuntimePersistenceContract(options = {}) {
  return {
    backend_kind: "postgres",
    scope: "runtime-artifact-persistence-only",
    schema_name: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
    schema_version: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION,
    driver: POSTGRES_RUNTIME_PERSISTENCE_DRIVER,
    tables: listPostgresRuntimePersistenceTables(),
    schema_file: getPostgresRuntimePersistenceSchemaFile(),
    bootstrap: describePostgresRuntimePersistenceBootstrap(options),
    non_goals: [
      "Do not replace shared coordination tables or ownership with runtime artifact persistence.",
      "Do not externalize docs/audit/*, AGENTS.md, or .codex/* into PostgreSQL.",
      "Do not overload install.artifactImportStore or runtime.stateMode with canonical backend meaning.",
    ],
  };
}
