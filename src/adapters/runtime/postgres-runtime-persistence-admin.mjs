import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
  POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION,
  getPostgresRuntimePersistenceSchemaFile,
  listPostgresRuntimePersistenceTableNames,
  resolvePostgresRuntimePersistenceConnection,
} from "../../application/runtime/postgres-runtime-persistence-contract-service.mjs";
import { assertRuntimePersistenceAdmin } from "../../core/ports/runtime-persistence-admin-port.mjs";

const require = createRequire(import.meta.url);

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

async function loadPgModule(moduleLoader) {
  if (typeof moduleLoader === "function") {
    return moduleLoader("pg");
  }
  return import("pg");
}

async function createPgClient({
  connectionString,
  clientFactory = null,
  moduleLoader = null,
}) {
  if (typeof clientFactory === "function") {
    return clientFactory({ connectionString });
  }
  const pgModule = await loadPgModule(moduleLoader);
  const Client = pgModule?.Client ?? pgModule?.default?.Client ?? require("pg").Client;
  if (typeof Client !== "function") {
    throw new Error("The pg package does not expose a Client constructor");
  }
  return new Client({ connectionString });
}

async function withClient(runtime, fn) {
  const client = await createPgClient(runtime);
  let connected = false;
  try {
    if (typeof client.connect === "function") {
      await client.connect();
      connected = true;
    }
    return await fn(client);
  } finally {
    if (connected && typeof client.end === "function") {
      await client.end();
    }
  }
}

async function bootstrapSchema(runtime) {
  const schemaSql = fs.readFileSync(getPostgresRuntimePersistenceSchemaFile(), "utf8");
  return withClient(runtime, async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(schemaSql);
      await client.query(
        `
        INSERT INTO aidn_runtime.schema_migrations (
          schema_name,
          schema_version,
          applied_by,
          notes
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (schema_name, schema_version) DO NOTHING
        `,
        [
          POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
          POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION,
          "aidn",
          "runtime artifact bootstrap",
        ],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

function buildBackupFile(targetRoot) {
  const backupDir = path.join(targetRoot, ".aidn", "runtime", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(backupDir, `runtime-postgres.${stamp}.json`);
}

export function createPostgresRuntimePersistenceAdmin({
  targetRoot = ".",
  connectionString = "",
  connectionRef = "",
  env = process.env,
  clientFactory = null,
  moduleLoader = null,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const connection = resolvePostgresRuntimePersistenceConnection({
    connectionString,
    connectionRef,
    env,
  });
  const runtime = {
    connectionString: connection.connection_string,
    clientFactory,
    moduleLoader,
  };
  const scopeKey = absoluteTargetRoot;

  async function inspectSchema() {
    if (!connection.ok) {
      return {
        ok: false,
        backend_kind: "postgres",
        supported: false,
        reason: connection.message,
        exists: false,
        tables_present: [],
        tables_missing: listPostgresRuntimePersistenceTableNames(),
        payload_rows: 0,
        pending_ids: [String(POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION)],
        applied_ids: [],
      };
    }
    try {
      const out = await withClient(runtime, async (client) => {
        const expectedTables = listPostgresRuntimePersistenceTableNames();
        const tableResult = await client.query(
          `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = $1
            AND table_name = ANY($2::text[])
          ORDER BY table_name
          `,
          [POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME, expectedTables],
        );
        const tablesPresent = Array.isArray(tableResult.rows)
          ? tableResult.rows.map((row) => normalizeScalar(row.table_name)).filter(Boolean)
          : [];
        const migrationResult = tablesPresent.includes("schema_migrations")
          ? await client.query(
            `
            SELECT schema_version
            FROM aidn_runtime.schema_migrations
            WHERE schema_name = $1
            ORDER BY schema_version ASC
            `,
            [POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME],
          )
          : { rows: [] };
        const payloadResult = tablesPresent.includes("runtime_snapshots")
          ? await client.query(
            `
            SELECT COUNT(*)::int AS count
            FROM aidn_runtime.runtime_snapshots
            WHERE scope_key = $1
            `,
            [scopeKey],
          )
          : { rows: [{ count: 0 }] };
        const appliedIds = Array.isArray(migrationResult.rows)
          ? migrationResult.rows.map((row) => String(row.schema_version))
          : [];
        return {
          tablesPresent,
          tablesMissing: expectedTables.filter((table) => !tablesPresent.includes(table)),
          appliedIds,
          payloadRows: Number(payloadResult.rows?.[0]?.count ?? 0) || 0,
        };
      });
      return {
        ok: true,
        backend_kind: "postgres",
        exists: out.tablesPresent.length > 0,
        schema_name: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
        schema_version: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION,
        scope_key: scopeKey,
        tables_present: out.tablesPresent,
        tables_missing: out.tablesMissing,
        payload_rows: out.payloadRows,
        applied_ids: out.appliedIds,
        pending_ids: out.appliedIds.includes(String(POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION))
          ? []
          : [String(POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION)],
      };
    } catch (error) {
      return {
        ok: false,
        backend_kind: "postgres",
        exists: false,
        reason: normalizeScalar(error?.message || error),
        tables_present: [],
        tables_missing: listPostgresRuntimePersistenceTableNames(),
        payload_rows: 0,
        applied_ids: [],
        pending_ids: [String(POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION)],
      };
    }
  }

  async function migrateSchema() {
    if (!connection.ok) {
      throw new Error(connection.message);
    }
    await bootstrapSchema(runtime);
    const status = await inspectSchema();
    return {
      ok: true,
      schema_name: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
      scope_key: scopeKey,
      migration: {
        ok: true,
        had_existing_schema: status.exists,
        backup_file: null,
        pending_before: status.pending_ids,
        applied_ids: [String(POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION)],
        migration_count: 1,
      },
      status,
    };
  }

  async function backupPersistence() {
    if (!connection.ok) {
      throw new Error(connection.message);
    }
    const payload = await withClient(runtime, async (client) => {
      const result = await client.query(
        `
        SELECT scope_key, project_root_ref, payload_json, payload_digest, payload_schema_version, updated_at
        FROM aidn_runtime.runtime_snapshots
        WHERE scope_key = $1
        LIMIT 1
        `,
        [scopeKey],
      );
      return result.rows?.[0] ?? null;
    });
    const backupFile = buildBackupFile(absoluteTargetRoot);
    fs.writeFileSync(backupFile, `${JSON.stringify({
      ts: new Date().toISOString(),
      backend_kind: "postgres",
      schema_name: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
      schema_version: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION,
      scope_key: scopeKey,
      snapshot: payload,
    }, null, 2)}\n`, "utf8");
    return {
      ok: true,
      backup_created: true,
      backup_file: backupFile,
      sqlite_file: null,
    };
  }

  return assertRuntimePersistenceAdmin({
    describeBackend() {
      return {
        backend_kind: "postgres",
        scope: "runtime-artifact-persistence",
        schema_name: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
        schema_version: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION,
        connection,
        scope_key: scopeKey,
        target_root: absoluteTargetRoot,
      };
    },
    inspectSchema,
    migrateSchema,
    backupPersistence,
  }, "PostgresRuntimePersistenceAdmin");
}
