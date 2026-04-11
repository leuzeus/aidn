import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION,
  POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
  getPostgresRuntimeRelationalSchemaFile,
  listPostgresRuntimeLegacyCompatibilityTableNames,
  listPostgresRuntimeRelationalTargetStructures,
  resolvePostgresRuntimePersistenceConnection,
} from "../../application/runtime/postgres-runtime-persistence-contract-service.mjs";
import { assertRuntimePersistenceAdmin } from "../../core/ports/runtime-persistence-admin-port.mjs";
import { payloadDigest } from "./artifact-projector-adapter.mjs";
import { createPostgresRuntimeArtifactStore } from "./postgres-runtime-artifact-store.mjs";

const require = createRequire(import.meta.url);

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function parseJsonOrNull(value) {
  if (value == null || (typeof value === "string" && value.trim().length === 0)) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function resolveRuntimeCompatibilityStatus({
  exists = false,
  tablesPresent = [],
  canonicalTablesMissing = [],
  canonicalPayloadRows = 0,
  legacySnapshotRows = 0,
} = {}) {
  if (!exists) {
    return "empty";
  }
  if (Number(canonicalPayloadRows ?? 0) > 0 && Number(legacySnapshotRows ?? 0) > 0) {
    return "mixed-legacy-v2";
  }
  if (Number(canonicalPayloadRows ?? 0) > 0) {
    return "relational-ready";
  }
  if (Number(legacySnapshotRows ?? 0) > 0) {
    return "legacy-only";
  }
  if (Array.isArray(canonicalTablesMissing) && canonicalTablesMissing.length === 0) {
    return "empty-relational";
  }
  if (Array.isArray(tablesPresent) && tablesPresent.length > 0) {
    return "schema-partial";
  }
  return "empty";
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
  const relationalSchemaSql = fs.readFileSync(getPostgresRuntimeRelationalSchemaFile(), "utf8");
  return withClient(runtime, async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(relationalSchemaSql);
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
          POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION,
          "aidn",
          "runtime relational canonical bootstrap",
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

async function purgeLegacySnapshot(runtime, scopeKey) {
  return withClient(runtime, async (client) => {
    await client.query(
      `
      DELETE FROM aidn_runtime.runtime_snapshots
      WHERE scope_key = $1
      `,
      [scopeKey],
    );
    return true;
  });
}

async function readLegacySnapshotCompatibility(runtime, scopeKey) {
  return withClient(runtime, async (client) => {
    try {
      const result = await client.query(
        `
        SELECT scope_key, project_root_ref, payload_json, payload_digest, payload_schema_version, source_backend, source_sqlite_file, adoption_status, adoption_metadata_json, updated_at
        FROM aidn_runtime.runtime_snapshots
        WHERE scope_key = $1
        LIMIT 1
        `,
        [scopeKey],
      );
      const row = result.rows?.[0] ?? null;
      if (!row) {
        return {
          exists: false,
          payload: null,
          runtimeHeads: {},
          compatibility_fallback_used: false,
          storage_policy: "relational-canonical",
          warning: "",
        };
      }
      const payload = row.payload_json && typeof row.payload_json === "object"
        ? row.payload_json
        : parseJsonOrNull(row.payload_json);
      return {
        exists: true,
        payload,
        payload_digest: normalizeScalar(row.payload_digest) || (payload ? payloadDigest(payload) : null),
        payload_schema_version: Number(row.payload_schema_version ?? 0) || null,
        source_backend: normalizeScalar(row.source_backend) || null,
        source_sqlite_file: normalizeScalar(row.source_sqlite_file) || null,
        adoption_status: normalizeScalar(row.adoption_status) || null,
        adoption_metadata: parseJsonOrNull(row.adoption_metadata_json),
        compatibility_fallback_used: true,
        storage_policy: "legacy-snapshot-compat",
        updated_at: row.updated_at ?? null,
        runtimeHeads: {},
        warning: "",
      };
    } catch (error) {
      if (String(error?.code ?? "") === "42P01") {
        return {
          exists: false,
          payload: null,
          runtimeHeads: {},
          compatibility_fallback_used: false,
          storage_policy: "relational-canonical",
          warning: "",
        };
      }
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
  const expectedLegacyTables = listPostgresRuntimeLegacyCompatibilityTableNames();
  const expectedCanonicalTables = listPostgresRuntimeRelationalTargetStructures()
    .filter((entity) => entity.kind === "table")
    .map((entity) => entity.name);
  const runtimeStore = createPostgresRuntimeArtifactStore({
    targetRoot: absoluteTargetRoot,
    connectionString,
    connectionRef,
    env,
    clientFactory,
    moduleLoader,
  });

  async function inspectSchema() {
    if (!connection.ok) {
      return {
        ok: false,
        backend_kind: "postgres",
        supported: false,
        reason: connection.message,
        exists: false,
        schema_name: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
        schema_version: POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION,
        scope_key: scopeKey,
        tables_present: [],
        tables_missing: expectedCanonicalTables,
        legacy_tables_present: [],
        legacy_tables_missing: expectedLegacyTables,
        payload_rows: 0,
        canonical_payload_rows: 0,
        legacy_snapshot_rows: 0,
        storage_policy: "relational-canonical",
        compatibility_status: "target-unavailable",
        pending_ids: [String(POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION)],
        applied_ids: [],
      };
    }
    try {
      const out = await withClient(runtime, async (client) => {
        const expectedTables = Array.from(new Set([...expectedLegacyTables, ...expectedCanonicalTables]));
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
        const canonicalPayloadResult = tablesPresent.includes("index_meta")
          ? await client.query(
            `
            SELECT COUNT(*)::int AS count
            FROM aidn_runtime.index_meta
            WHERE scope_key = $1
              AND key = 'payload_schema_version'
            `,
            [scopeKey],
          )
          : { rows: [{ count: 0 }] };
        const legacyPayloadResult = tablesPresent.includes("runtime_snapshots")
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
        const canonicalPayloadRows = Number(canonicalPayloadResult.rows?.[0]?.count ?? 0) || 0;
        const legacySnapshotRows = Number(legacyPayloadResult.rows?.[0]?.count ?? 0) || 0;
        return {
          tablesPresent,
          canonicalTablesMissing: expectedCanonicalTables.filter((table) => !tablesPresent.includes(table)),
          legacyTablesMissing: expectedLegacyTables.filter((table) => !tablesPresent.includes(table)),
          appliedIds,
          canonicalPayloadRows,
          legacySnapshotRows,
        };
      });
      const compatibilityStatus = resolveRuntimeCompatibilityStatus({
        exists: out.tablesPresent.length > 0,
        tablesPresent: out.tablesPresent,
        canonicalTablesMissing: out.canonicalTablesMissing,
        canonicalPayloadRows: out.canonicalPayloadRows,
        legacySnapshotRows: out.legacySnapshotRows,
      });
      return {
        ok: true,
        backend_kind: "postgres",
        exists: out.tablesPresent.length > 0,
        schema_name: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
        schema_version: POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION,
        scope_key: scopeKey,
        storage_policy: "relational-canonical",
        tables_present: out.tablesPresent.filter((tableName) => expectedCanonicalTables.includes(tableName)),
        tables_missing: out.canonicalTablesMissing,
        legacy_tables_present: out.tablesPresent.filter((tableName) => expectedLegacyTables.includes(tableName)),
        legacy_tables_missing: out.legacyTablesMissing,
        payload_rows: out.canonicalPayloadRows || out.legacySnapshotRows,
        canonical_payload_rows: out.canonicalPayloadRows,
        legacy_snapshot_rows: out.legacySnapshotRows,
        applied_ids: out.appliedIds,
        compatibility_status: compatibilityStatus,
        pending_ids: out.appliedIds.includes(String(POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION))
          ? []
          : [String(POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION)],
      };
    } catch (error) {
      return {
        ok: false,
        backend_kind: "postgres",
        exists: false,
        reason: normalizeScalar(error?.message || error),
        schema_name: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
        schema_version: POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION,
        scope_key: scopeKey,
        tables_present: [],
        tables_missing: expectedCanonicalTables,
        legacy_tables_present: [],
        legacy_tables_missing: expectedLegacyTables,
        payload_rows: 0,
        canonical_payload_rows: 0,
        legacy_snapshot_rows: 0,
        storage_policy: "relational-canonical",
        compatibility_status: "target-unavailable",
        applied_ids: [],
        pending_ids: [String(POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION)],
      };
    }
  }

  async function migrateSchema() {
    if (!connection.ok) {
      throw new Error(connection.message);
    }
    const statusBefore = await inspectSchema();
    await bootstrapSchema(runtime);
    let backfill = null;
    if (Number(statusBefore.canonical_payload_rows ?? 0) === 0) {
      const legacySnapshot = await readLegacySnapshotCompatibility(runtime, scopeKey);
      if (legacySnapshot.exists === true && !legacySnapshot.warning && legacySnapshot.payload) {
        await runtimeStore.writeIndexProjection({
          payload: legacySnapshot.payload,
          sourceBackend: normalizeScalar(legacySnapshot.source_backend) || "postgres-legacy-snapshot",
          sourceSqliteFile: normalizeScalar(legacySnapshot.source_sqlite_file) || "",
          adoptionStatus: normalizeScalar(legacySnapshot.adoption_status) || "legacy-backfill",
          adoptionMetadata: {
            legacy_snapshot_backfill: true,
            migrated_at: new Date().toISOString(),
            prior_adoption_metadata: legacySnapshot.adoption_metadata ?? null,
          },
        });
        backfill = {
          legacy_snapshot_backfill: true,
          source_backend: normalizeScalar(legacySnapshot.source_backend) || "postgres-legacy-snapshot",
        };
        await purgeLegacySnapshot(runtime, scopeKey);
      }
    }
    const status = await inspectSchema();
    return {
      ok: true,
      schema_name: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
      scope_key: scopeKey,
      migration: {
        ok: true,
        had_existing_schema: statusBefore.exists,
        backup_file: null,
        pending_before: statusBefore.pending_ids,
        applied_ids: [String(POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION)],
        migration_count: 1,
        backfill,
      },
      status,
    };
  }

  async function backupPersistence() {
    if (!connection.ok) {
      throw new Error(connection.message);
    }
    let snapshot = await runtimeStore.loadSnapshot({
      includePayload: true,
      includeRuntimeHeads: true,
    });
    if (snapshot.exists !== true || snapshot.payload == null) {
      snapshot = await readLegacySnapshotCompatibility(runtime, scopeKey);
    }
    const backupFile = buildBackupFile(absoluteTargetRoot);
    fs.writeFileSync(backupFile, `${JSON.stringify({
      ts: new Date().toISOString(),
      backend_kind: "postgres",
      schema_name: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
      schema_version: POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION,
      storage_policy: "relational-canonical",
      compatibility_fallback_used: snapshot.compatibility_fallback_used === true,
      scope_key: scopeKey,
      snapshot,
    }, null, 2)}\n`, "utf8");
    return {
      ok: true,
      backup_created: true,
      backup_file: backupFile,
      compatibility_fallback_used: snapshot.compatibility_fallback_used === true,
      sqlite_file: null,
    };
  }

  return assertRuntimePersistenceAdmin({
    describeBackend() {
      return {
        backend_kind: "postgres",
        scope: "runtime-artifact-persistence",
        schema_name: POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
        schema_version: POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION,
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
