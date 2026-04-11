import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listPostgresRuntimeRelationalParityRequiredEntityNames,
  listPostgresRuntimeRelationalV2Entities,
  listPostgresRuntimeSnapshotV1Entities,
  listSqliteRuntimeCanonicalEntities,
  listSqliteRuntimeSchemaEntities,
} from "./runtime-relational-schema-catalog-service.mjs";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME = "aidn_runtime";
export const POSTGRES_RUNTIME_LEGACY_COMPAT_SCHEMA_VERSION = 1;
export const POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION = 2;
export const POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION = POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION;
export const POSTGRES_RUNTIME_PERSISTENCE_DRIVER = Object.freeze({
  backend_kind: "postgres",
  package_name: "pg",
  module_specifier: "pg",
  import_style: "dynamic-import",
  packaging_decision: "optional-dependency",
  package_scope: "optionalDependencies",
  rationale: "Ship runtime PostgreSQL persistence as an optional dependency so SQLite-only installs remain valid while runtime backend adoption can be explicit.",
});

const POSTGRES_RUNTIME_PERSISTENCE_TABLES = Object.freeze(
  listPostgresRuntimeRelationalV2Entities()
    .filter((entity) => entity.kind === "table")
    .map((entity) => Object.freeze({
      table: entity.name,
      purpose: entity.classification === "canonical"
        ? "store canonical runtime state in relational form"
        : (entity.classification === "legacy_snapshot"
          ? "store the legacy snapshot-based runtime payload model"
          : (entity.classification === "optimization"
            ? "store optimization and hot-path projections"
            : "track runtime persistence administration")),
      lifecycle: entity.classification === "canonical"
        ? "replace-per-scope"
        : (entity.classification === "legacy_snapshot"
          ? "compatibility-only"
          : (entity.classification === "optimization" ? "replace-per-scope" : "append-only")),
      primary_key: entity.name === "schema_migrations"
        ? ["schema_name", "schema_version"]
        : (entity.name === "runtime_snapshots"
          ? ["scope_key"]
          : (entity.name === "runtime_heads" ? ["scope_key", "head_key"] : ["event_id"])),
      classification: entity.classification,
      parity_required: entity.parity_required,
    })));

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
  return getPostgresRuntimeRelationalSchemaFile();
}

export function getPostgresRuntimeRelationalSchemaFile() {
  return path.resolve(THIS_DIR, "..", "..", "..", "tools", "perf", "sql", "runtime-artifacts-postgres-relational-v2.sql");
}

export function listPostgresRuntimePersistenceTables() {
  return POSTGRES_RUNTIME_PERSISTENCE_TABLES.map((table) => ({ ...table }));
}

export function listPostgresRuntimePersistenceTableNames() {
  return POSTGRES_RUNTIME_PERSISTENCE_TABLES.map((table) => table.table);
}

export function listPostgresRuntimeLegacyCompatibilityTableNames() {
  return listPostgresRuntimeSnapshotV1Entities()
    .filter((entity) => entity.classification === "legacy_snapshot")
    .map((entity) => entity.name);
}

export function listSqliteRuntimeCanonicalStructures() {
  return listSqliteRuntimeSchemaEntities();
}

export function listPostgresRuntimeRelationalTargetStructures() {
  return listPostgresRuntimeRelationalV2Entities();
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
      "Apply runtime-artifacts-postgres-relational-v2.sql inside a bootstrap transaction.",
      "Record the relational canonical schema version in aidn_runtime.schema_migrations.",
      "Validate relational canonical tables first and only read runtime_snapshots through an explicit legacy compatibility fallback when it already exists.",
    ],
  };
}

export function getPostgresRuntimePersistenceContract(options = {}) {
  return {
    backend_kind: "postgres",
    scope: "runtime-artifact-persistence",
    schema_name: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
    schema_version: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION,
    driver: POSTGRES_RUNTIME_PERSISTENCE_DRIVER,
    tables: listPostgresRuntimePersistenceTables(),
    schema_file: getPostgresRuntimePersistenceSchemaFile(),
    bootstrap: describePostgresRuntimePersistenceBootstrap(options),
    legacy_compatibility_tables: listPostgresRuntimeSnapshotV1Entities().filter((entity) => entity.classification === "legacy_snapshot"),
    non_goals: [
      "Do not replace shared coordination tables or ownership with runtime artifact persistence.",
      "Do not externalize docs/audit/*, AGENTS.md, or .codex/* into PostgreSQL.",
      "Do not overload install.artifactImportStore or runtime.stateMode with canonical backend meaning.",
    ],
  };
}

export function getPostgresRuntimeRelationalTargetContract(options = {}) {
  return {
    backend_kind: "postgres",
    scope: "runtime-relational-parity-target",
    schema_name: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
    schema_version: POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION,
    schema_file: getPostgresRuntimeRelationalSchemaFile(),
    driver: POSTGRES_RUNTIME_PERSISTENCE_DRIVER,
    connection: resolvePostgresRuntimePersistenceConnection(options),
    sqlite_source_entities: listSqliteRuntimeCanonicalStructures(),
    sqlite_canonical_entities: listSqliteRuntimeCanonicalEntities(),
    target_entities: listPostgresRuntimeRelationalTargetStructures(),
    parity_required_entity_names: listPostgresRuntimeRelationalParityRequiredEntityNames(),
    legacy_snapshot_entities: listPostgresRuntimeSnapshotV1Entities().filter((entity) => entity.classification === "legacy_snapshot"),
    policy: {
      canonical_storage: "relational",
      runtime_snapshots: "explicit_legacy_fallback_only",
      runtime_heads: "optimization_symmetric",
      adoption_events: "admin_symmetric",
      schema_migrations: "admin_symmetric",
    },
  };
}
