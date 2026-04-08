import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { assertRuntimeArtifactStore } from "../../core/ports/runtime-artifact-store-port.mjs";
import {
  payloadDigest,
  stablePayloadProjection,
} from "./artifact-projector-adapter.mjs";
import {
  POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
  POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_VERSION,
  getPostgresRuntimePersistenceSchemaFile,
  resolvePostgresRuntimePersistenceConnection,
} from "../../application/runtime/postgres-runtime-persistence-contract-service.mjs";

const require = createRequire(import.meta.url);

const RUNTIME_HEAD_DEFINITIONS = Object.freeze([
  ["current_state", ["current_state"], ["CURRENT-STATE.md"]],
  ["runtime_state", ["runtime_state"], ["RUNTIME-STATE.md"]],
  ["handoff_packet", ["handoff_packet"], ["HANDOFF-PACKET.md"]],
  ["agent_roster", ["agent_roster"], ["AGENT-ROSTER.md"]],
  ["agent_health_summary", ["agent_health_summary"], ["AGENT-HEALTH-SUMMARY.md"]],
  ["agent_selection_summary", ["agent_selection_summary"], ["AGENT-SELECTION-SUMMARY.md"]],
  ["multi_agent_status", ["multi_agent_status"], ["MULTI-AGENT-STATUS.md"]],
  ["coordination_summary", ["coordination_summary"], ["COORDINATION-SUMMARY.md"]],
]);

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function normalizeArtifactPath(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

function resolveRuntimeHeadDefinition(artifact) {
  const subtype = normalizeScalar(artifact?.subtype).toLowerCase();
  if (subtype) {
    for (const [headKey, subtypes] of RUNTIME_HEAD_DEFINITIONS) {
      if (subtypes.includes(subtype)) {
        return { headKey };
      }
    }
  }
  const fileName = normalizeArtifactPath(artifact?.path).split("/").pop() ?? "";
  if (!fileName) {
    return null;
  }
  for (const [headKey, , fileNames] of RUNTIME_HEAD_DEFINITIONS) {
    if (fileNames.includes(fileName)) {
      return { headKey };
    }
  }
  return null;
}

function buildRuntimeHeadRows(payload) {
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
  const rows = [];
  const seen = new Set();
  const ordered = artifacts.slice().sort((left, right) =>
    String(right?.updated_at ?? "").localeCompare(String(left?.updated_at ?? "")));
  for (const artifact of ordered) {
    const definition = resolveRuntimeHeadDefinition(artifact);
    if (!definition || seen.has(definition.headKey)) {
      continue;
    }
    seen.add(definition.headKey);
    rows.push({
      head_key: definition.headKey,
      artifact_path: normalizeArtifactPath(artifact?.path),
      artifact_sha256: normalizeScalar(artifact?.sha256) || null,
      payload_json: JSON.stringify({
        head_key: definition.headKey,
        artifact_path: normalizeArtifactPath(artifact?.path),
        artifact_sha256: normalizeScalar(artifact?.sha256) || null,
        session_id: artifact?.session_id ?? null,
        cycle_id: artifact?.cycle_id ?? null,
        kind: artifact?.kind ?? null,
        subtype: artifact?.subtype ?? null,
        updated_at: artifact?.updated_at ?? null,
      }),
      updated_at: normalizeScalar(artifact?.updated_at) || new Date().toISOString(),
    });
  }
  return rows;
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

function classifyPostgresRuntimePersistenceError(error) {
  const code = normalizeScalar(error?.code);
  const message = normalizeScalar(error?.message || error);
  if (message.includes("Cannot find package 'pg'") || message.includes("Cannot find module 'pg'")) {
    return { category: "driver-missing", code, message };
  }
  if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET"].includes(code)) {
    return { category: "connectivity", code, message };
  }
  if (code.startsWith("42")) {
    return { category: "schema", code, message };
  }
  if (code.startsWith("28")) {
    return { category: "authentication", code, message };
  }
  return { category: "unknown", code, message };
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
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return true;
  });
}

export function createPostgresRuntimeArtifactStore({
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

  async function loadSnapshot({
    includePayload = true,
    includeRuntimeHeads = true,
  } = {}) {
    if (!connection.ok) {
      return {
        exists: false,
        payload: null,
        runtimeHeads: {},
        warning: connection.message,
      };
    }
    try {
      const snapshot = await withClient(runtime, async (client) => {
        const snapshotResult = await client.query(
          `
          SELECT scope_key, project_root_ref, payload_json, payload_digest, payload_schema_version, updated_at
          FROM aidn_runtime.runtime_snapshots
          WHERE scope_key = $1
          LIMIT 1
          `,
          [scopeKey],
        );
        const row = snapshotResult.rows?.[0] ?? null;
        let heads = {};
        if (includeRuntimeHeads) {
          const headResult = await client.query(
            `
            SELECT head_key, artifact_path, artifact_sha256, payload_json, updated_at
            FROM aidn_runtime.runtime_heads
            WHERE scope_key = $1
            ORDER BY head_key ASC
            `,
            [scopeKey],
          );
          for (const headRow of headResult.rows ?? []) {
            try {
              heads[String(headRow.head_key ?? "")] = JSON.parse(String(headRow.payload_json ?? "{}"));
            } catch {
              heads[String(headRow.head_key ?? "")] = {
                head_key: headRow.head_key ?? null,
                artifact_path: headRow.artifact_path ?? null,
                artifact_sha256: headRow.artifact_sha256 ?? null,
                updated_at: headRow.updated_at ?? null,
              };
            }
          }
        }
        return {
          row,
          heads,
        };
      });
      const parsedPayload = includePayload && snapshot.row
        ? (typeof snapshot.row.payload_json === "object"
          ? snapshot.row.payload_json
          : JSON.parse(String(snapshot.row.payload_json ?? "{}")))
        : null;
      return {
        exists: Boolean(snapshot.row),
        payload: parsedPayload,
        payload_digest: normalizeScalar(snapshot.row?.payload_digest) || (parsedPayload ? payloadDigest(parsedPayload) : null),
        payload_schema_version: Number(snapshot.row?.payload_schema_version ?? 0) || null,
        source_backend: normalizeScalar(snapshot.row?.source_backend) || null,
        source_sqlite_file: normalizeScalar(snapshot.row?.source_sqlite_file) || null,
        adoption_status: normalizeScalar(snapshot.row?.adoption_status) || null,
        adoption_metadata: snapshot.row?.adoption_metadata_json && typeof snapshot.row.adoption_metadata_json === "object"
          ? snapshot.row.adoption_metadata_json
          : (snapshot.row?.adoption_metadata_json
            ? JSON.parse(String(snapshot.row.adoption_metadata_json))
            : null),
        updated_at: snapshot.row?.updated_at ?? null,
        runtimeHeads: snapshot.heads,
        warning: "",
      };
    } catch (error) {
      return {
        exists: false,
        payload: null,
        runtimeHeads: {},
        warning: classifyPostgresRuntimePersistenceError(error).message,
      };
    }
  }

  async function writeIndexProjection({
    payload,
    sourceBackend = "",
    sourceSqliteFile = "",
    adoptionStatus = "",
    adoptionMetadata = null,
  }) {
    if (!connection.ok) {
      throw new Error(connection.message);
    }
    const stablePayload = stablePayloadProjection(payload);
    const digest = payloadDigest(stablePayload);
    const headRows = buildRuntimeHeadRows(stablePayload);
    const sourceBackendValue = normalizeScalar(sourceBackend) || "postgres";
    const sourceSqliteFileValue = normalizeScalar(sourceSqliteFile) || null;
    const adoptionStatusValue = normalizeScalar(adoptionStatus) || "ready";
    const adoptionMetadataValue = adoptionMetadata && typeof adoptionMetadata === "object"
      ? adoptionMetadata
      : { payload_digest: digest };
    await bootstrapSchema(runtime);
    await withClient(runtime, async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
          `
          INSERT INTO aidn_runtime.runtime_snapshots (
            scope_key,
            project_root_ref,
            payload_json,
            payload_digest,
            payload_schema_version,
            source_backend,
            source_sqlite_file,
            adoption_status,
            adoption_metadata_json,
            updated_at
          ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9::jsonb, NOW())
          ON CONFLICT (scope_key) DO UPDATE SET
            project_root_ref = EXCLUDED.project_root_ref,
            payload_json = EXCLUDED.payload_json,
            payload_digest = EXCLUDED.payload_digest,
            payload_schema_version = EXCLUDED.payload_schema_version,
            source_backend = EXCLUDED.source_backend,
            source_sqlite_file = EXCLUDED.source_sqlite_file,
            adoption_status = EXCLUDED.adoption_status,
            adoption_metadata_json = EXCLUDED.adoption_metadata_json,
            updated_at = NOW()
          `,
          [
            scopeKey,
            absoluteTargetRoot,
            JSON.stringify(stablePayload),
            digest,
            Number(stablePayload?.schema_version ?? 1),
            sourceBackendValue,
            sourceSqliteFileValue,
            adoptionStatusValue,
            JSON.stringify(adoptionMetadataValue),
          ],
        );
        await client.query(
          `
          DELETE FROM aidn_runtime.runtime_heads
          WHERE scope_key = $1
          `,
          [scopeKey],
        );
        for (const row of headRows) {
          await client.query(
            `
            INSERT INTO aidn_runtime.runtime_heads (
              scope_key,
              head_key,
              artifact_path,
              artifact_sha256,
              payload_json,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
            `,
            [
              scopeKey,
              row.head_key,
              row.artifact_path,
              row.artifact_sha256,
              row.payload_json,
              row.updated_at,
            ],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
    return [{
      kind: "postgres",
      path: `postgres://${POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME}/${scopeKey}`,
      written: true,
      bytes_written: Buffer.byteLength(JSON.stringify(stablePayload), "utf8"),
    }];
  }

  async function loadRuntimeHeads() {
    const snapshot = await loadSnapshot({
      includePayload: false,
      includeRuntimeHeads: true,
    });
    return snapshot.runtimeHeads ?? {};
  }

  async function recordAdoptionEvent({
    action = "",
    status = "",
    sourceBackend = "",
    targetBackend = "postgres",
    sourcePayloadDigest = "",
    targetPayloadDigest = "",
    payload = null,
  } = {}) {
    if (!connection.ok) {
      throw new Error(connection.message);
    }
    await bootstrapSchema(runtime);
    const eventId = crypto.randomUUID();
    await withClient(runtime, async (client) => {
      await client.query(
        `
        INSERT INTO aidn_runtime.adoption_events (
          event_id,
          scope_key,
          action,
          status,
          source_backend,
          target_backend,
          source_payload_digest,
          target_payload_digest,
          payload_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        `,
        [
          eventId,
          scopeKey,
          normalizeScalar(action) || "runtime-adoption",
          normalizeScalar(status) || "unknown",
          normalizeScalar(sourceBackend) || null,
          normalizeScalar(targetBackend) || "postgres",
          normalizeScalar(sourcePayloadDigest) || null,
          normalizeScalar(targetPayloadDigest) || null,
          JSON.stringify(payload && typeof payload === "object" ? payload : {}),
        ],
      );
    });
    return {
      ok: true,
      event_id: eventId,
      scope_key: scopeKey,
    };
  }

  return assertRuntimeArtifactStore({
    mode: "postgres",
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
    loadSnapshot,
    loadRuntimeHeads,
    writeIndexProjection,
    recordAdoptionEvent,
  }, "PostgresRuntimeArtifactStore");
}
