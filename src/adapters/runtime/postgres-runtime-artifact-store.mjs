import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { assertRuntimeArtifactStore } from "../../core/ports/runtime-artifact-store-port.mjs";
import {
  payloadDigest,
  stablePayloadProjection,
} from "./artifact-projector-adapter.mjs";
import { projectRuntimePayloadToRelationalRows } from "../../application/runtime/runtime-relational-projection-service.mjs";
import {
  buildRuntimeMetaMap,
  rehydrateRuntimePayloadFromRelationalRows,
} from "../../application/runtime/runtime-relational-snapshot-rehydration-service.mjs";
import {
  POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION,
  POSTGRES_RUNTIME_PERSISTENCE_SCHEMA_NAME,
  getPostgresRuntimeRelationalSchemaFile,
  resolvePostgresRuntimePersistenceConnection,
} from "../../application/runtime/postgres-runtime-persistence-contract-service.mjs";

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
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return true;
  });
}

const RELATIONAL_TABLE_SPECS = Object.freeze([
  ["index_meta", ["scope_key", "key", "value", "updated_at"]],
  ["cycles", ["scope_key", "cycle_id", "session_id", "state", "outcome", "branch_name", "dor_state", "continuity_rule", "continuity_base_branch", "continuity_latest_cycle_branch", "updated_at"]],
  ["sessions", ["scope_key", "session_id", "branch_name", "state", "owner", "parent_session", "branch_kind", "cycle_branch", "intermediate_branch", "integration_target_cycle", "carry_over_pending", "started_at", "ended_at", "source_artifact_path", "source_confidence", "source_mode", "updated_at"]],
  ["artifacts", ["scope_key", "artifact_id", "path", "kind", "family", "subtype", "gate_relevance", "classification_reason", "content_format", "content", "canonical_format", "canonical_json", "sha256", "size_bytes", "mtime_ns", "session_id", "cycle_id", "source_mode", "entity_confidence", "legacy_origin", "updated_at"]],
  ["file_map", ["scope_key", "cycle_id", "path", "role", "relation", "last_seen_at"]],
  ["tags", ["scope_key", "tag_id", "tag"]],
  ["artifact_tags", ["scope_key", "artifact_id", "tag_id"]],
  ["run_metrics", ["scope_key", "run_id", "started_at", "ended_at", "overhead_ratio", "artifacts_churn", "gates_frequency"]],
  ["artifact_links", ["scope_key", "source_path", "target_path", "relation_type", "confidence", "inference_source", "source_mode", "relation_status", "updated_at"]],
  ["cycle_links", ["scope_key", "source_cycle_id", "target_cycle_id", "relation_type", "confidence", "inference_source", "source_mode", "relation_status", "updated_at"]],
  ["session_cycle_links", ["scope_key", "session_id", "cycle_id", "relation_type", "confidence", "inference_source", "source_mode", "relation_status", "ambiguity_status", "updated_at"]],
  ["session_links", ["scope_key", "source_session_id", "target_session_id", "relation_type", "confidence", "inference_source", "source_mode", "relation_status", "updated_at"]],
  ["repair_decisions", ["scope_key", "relation_scope", "source_ref", "target_ref", "relation_type", "decision", "decided_at", "decided_by", "notes"]],
  ["migration_runs", ["scope_key", "migration_run_id", "engine_version", "started_at", "ended_at", "status", "target_root", "notes"]],
  ["migration_findings", ["scope_key", "finding_id", "migration_run_id", "severity", "finding_type", "entity_type", "entity_id", "artifact_path", "message", "confidence", "suggested_action", "created_at"]],
  ["artifact_blobs", ["scope_key", "artifact_id", "content_format", "content", "canonical_format", "canonical_json", "sha256", "size_bytes", "updated_at"]],
  ["runtime_heads", ["scope_key", "head_key", "artifact_id", "artifact_path", "artifact_sha256", "session_id", "cycle_id", "kind", "subtype", "updated_at", "payload_json"]],
]);

function normalizeCellValue(column, value) {
  if ((column === "canonical_json" || column === "payload_json") && value != null && typeof value === "object") {
    return JSON.stringify(value);
  }
  return value ?? null;
}

async function replaceRelationalProjectionRows(client, scopeKey, rowsByTable) {
  const deleteOrder = RELATIONAL_TABLE_SPECS.map(([tableName]) => tableName).slice().reverse();
  for (const tableName of deleteOrder) {
    await client.query(
      `DELETE FROM aidn_runtime.${tableName} WHERE scope_key = $1`,
      [scopeKey],
    );
  }

  for (const [tableName, columns] of RELATIONAL_TABLE_SPECS) {
    const rows = Array.isArray(rowsByTable?.[tableName]) ? rowsByTable[tableName] : [];
    if (rows.length === 0) {
      continue;
    }
    const placeholders = columns.map((_, index) => {
      const column = columns[index];
      return column === "canonical_json" || column === "payload_json"
        ? `$${index + 1}::jsonb`
        : `$${index + 1}`;
    }).join(", ");
    const sql = `
      INSERT INTO aidn_runtime.${tableName} (
        ${columns.join(", ")}
      ) VALUES (${placeholders})
    `;
    for (const row of rows) {
      await client.query(
        sql,
        columns.map((column) => normalizeCellValue(column, row?.[column])),
      );
    }
  }
}

async function purgeLegacySnapshotRow(client, scopeKey) {
  try {
    await client.query(
      `
      DELETE FROM aidn_runtime.runtime_snapshots
      WHERE scope_key = $1
      `,
      [scopeKey],
    );
  } catch (error) {
    const classification = classifyPostgresRuntimePersistenceError(error);
    if (classification.category !== "schema") {
      throw error;
    }
  }
}

const RELATIONAL_SELECT_SPECS = Object.freeze({
  index_meta: Object.freeze({
    columns: "key, value, updated_at",
    orderBy: "key ASC",
  }),
  cycles: Object.freeze({
    columns: "cycle_id, session_id, state, outcome, branch_name, dor_state, continuity_rule, continuity_base_branch, continuity_latest_cycle_branch, updated_at",
    orderBy: "cycle_id ASC",
  }),
  sessions: Object.freeze({
    columns: "session_id, branch_name, state, owner, started_at, ended_at, source_artifact_path, source_confidence, source_mode, updated_at, parent_session, branch_kind, cycle_branch, intermediate_branch, integration_target_cycle, carry_over_pending",
    orderBy: "session_id ASC",
  }),
  artifacts: Object.freeze({
    columns: "artifact_id, path, kind, family, subtype, gate_relevance, classification_reason, content_format, content, canonical_format, canonical_json, sha256, size_bytes, mtime_ns, session_id, cycle_id, source_mode, entity_confidence, legacy_origin, updated_at",
    orderBy: "path ASC",
  }),
  artifact_blobs: Object.freeze({
    columns: "artifact_id, content_format, content, canonical_format, canonical_json, sha256, size_bytes, updated_at",
    orderBy: "artifact_id ASC",
  }),
  file_map: Object.freeze({
    columns: "cycle_id, path, role, relation, last_seen_at",
    orderBy: "cycle_id ASC, path ASC",
  }),
  tags: Object.freeze({
    columns: "tag_id, tag",
    orderBy: "tag ASC",
  }),
  artifact_tags: Object.freeze({
    columns: "artifact_id, tag_id",
    orderBy: "artifact_id ASC, tag_id ASC",
  }),
  run_metrics: Object.freeze({
    columns: "run_id, started_at, ended_at, overhead_ratio, artifacts_churn, gates_frequency",
    orderBy: "started_at DESC, run_id ASC",
  }),
  artifact_links: Object.freeze({
    columns: "source_path, target_path, relation_type, confidence, inference_source, source_mode, relation_status, updated_at",
    orderBy: "source_path ASC, target_path ASC, relation_type ASC",
  }),
  cycle_links: Object.freeze({
    columns: "source_cycle_id, target_cycle_id, relation_type, confidence, inference_source, source_mode, relation_status, updated_at",
    orderBy: "source_cycle_id ASC, target_cycle_id ASC, relation_type ASC",
  }),
  session_cycle_links: Object.freeze({
    columns: "session_id, cycle_id, relation_type, confidence, inference_source, source_mode, relation_status, ambiguity_status, updated_at",
    orderBy: "session_id ASC, cycle_id ASC, relation_type ASC",
  }),
  session_links: Object.freeze({
    columns: "source_session_id, target_session_id, relation_type, confidence, inference_source, source_mode, relation_status, updated_at",
    orderBy: "source_session_id ASC, target_session_id ASC, relation_type ASC",
  }),
  migration_runs: Object.freeze({
    columns: "migration_run_id, engine_version, started_at, ended_at, status, target_root, notes",
    orderBy: "started_at DESC, migration_run_id ASC",
  }),
  migration_findings: Object.freeze({
    columns: "finding_id, migration_run_id, severity, finding_type, entity_type, entity_id, artifact_path, message, confidence, suggested_action, created_at",
    orderBy: "created_at DESC, finding_id ASC",
  }),
  repair_decisions: Object.freeze({
    columns: "relation_scope, source_ref, target_ref, relation_type, decision, decided_at, decided_by, notes",
    orderBy: "relation_scope ASC, source_ref ASC, target_ref ASC, relation_type ASC",
  }),
  runtime_heads: Object.freeze({
    columns: "head_key, artifact_path, artifact_sha256, payload_json, updated_at",
    orderBy: "head_key ASC",
  }),
});

async function selectScopedRows(client, tableName, scopeKey) {
  const spec = RELATIONAL_SELECT_SPECS[tableName];
  if (!spec) {
    throw new Error(`Unsupported relational runtime table: ${tableName}`);
  }
  const result = await client.query(
    `
    SELECT ${spec.columns}
    FROM aidn_runtime.${tableName}
    WHERE scope_key = $1
    ORDER BY ${spec.orderBy}
    `,
    [scopeKey],
  );
  return Array.isArray(result.rows) ? result.rows : [];
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
        let metaRows = [];
        let runtimeHeadRows = [];
        let meta = {};
        let hasRelationalPayload = false;
        let payload = null;
        try {
          metaRows = await selectScopedRows(client, "index_meta", scopeKey);
          meta = buildRuntimeMetaMap(metaRows);
          hasRelationalPayload = metaRows.length > 0;
          runtimeHeadRows = includeRuntimeHeads
            ? await selectScopedRows(client, "runtime_heads", scopeKey)
            : [];
          if (includePayload && hasRelationalPayload) {
            const [
              cycleRows,
              sessionRows,
              artifactRows,
              artifactBlobRows,
              fileMapRows,
              tagRows,
              artifactTagRows,
              runMetricRows,
              artifactLinkRows,
              cycleLinkRows,
              sessionCycleLinkRows,
              sessionLinkRows,
              migrationRunRows,
              migrationFindingRows,
              repairDecisionRows,
            ] = await Promise.all([
              selectScopedRows(client, "cycles", scopeKey),
              selectScopedRows(client, "sessions", scopeKey),
              selectScopedRows(client, "artifacts", scopeKey),
              selectScopedRows(client, "artifact_blobs", scopeKey),
              selectScopedRows(client, "file_map", scopeKey),
              selectScopedRows(client, "tags", scopeKey),
              selectScopedRows(client, "artifact_tags", scopeKey),
              selectScopedRows(client, "run_metrics", scopeKey),
              selectScopedRows(client, "artifact_links", scopeKey),
              selectScopedRows(client, "cycle_links", scopeKey),
              selectScopedRows(client, "session_cycle_links", scopeKey),
              selectScopedRows(client, "session_links", scopeKey),
              selectScopedRows(client, "migration_runs", scopeKey),
              selectScopedRows(client, "migration_findings", scopeKey),
              selectScopedRows(client, "repair_decisions", scopeKey),
            ]);
            payload = rehydrateRuntimePayloadFromRelationalRows({
              scopeKey,
              meta,
              cycles: cycleRows,
              sessions: sessionRows,
              artifacts: artifactRows,
              artifactBlobs: artifactBlobRows,
              fileMap: fileMapRows,
              tags: tagRows,
              artifactTags: artifactTagRows,
              runMetrics: runMetricRows,
              artifactLinks: artifactLinkRows,
              cycleLinks: cycleLinkRows,
              sessionCycleLinks: sessionCycleLinkRows,
              sessionLinks: sessionLinkRows,
              migrationRuns: migrationRunRows,
              migrationFindings: migrationFindingRows,
              repairDecisions: repairDecisionRows,
            });
          }
        } catch (error) {
          const classification = classifyPostgresRuntimePersistenceError(error);
          if (classification.category !== "schema") {
            throw error;
          }
        }
        if (includeRuntimeHeads && runtimeHeadRows.length === 0) {
          try {
            runtimeHeadRows = await selectScopedRows(client, "runtime_heads", scopeKey);
          } catch (error) {
            const classification = classifyPostgresRuntimePersistenceError(error);
            if (classification.category !== "schema") {
              throw error;
            }
          }
        }
        let heads = {};
        if (includeRuntimeHeads) {
          for (const headRow of runtimeHeadRows) {
            try {
              heads[String(headRow.head_key ?? "")] = typeof headRow.payload_json === "object"
                ? headRow.payload_json
                : JSON.parse(String(headRow.payload_json ?? "{}"));
            } catch {
              heads[String(headRow.head_key ?? "")] = {
                head_key: headRow.head_key ?? null,
                artifact_id: Number(headRow.artifact_id ?? 0) || null,
                artifact_path: headRow.artifact_path ?? null,
                artifact_sha256: headRow.artifact_sha256 ?? null,
                session_id: headRow.session_id ?? null,
                cycle_id: headRow.cycle_id ?? null,
                kind: headRow.kind ?? null,
                subtype: headRow.subtype ?? null,
                updated_at: headRow.updated_at ?? null,
              };
            }
          }
        }
        return {
          meta,
          payload,
          hasRelationalPayload,
          heads,
        };
      });
      const parsedPayload = snapshot.payload ?? null;
      const adoptionMetadata = parseJsonOrNull(snapshot.meta?.adoption_metadata_json);
      return {
        exists: Boolean(snapshot.hasRelationalPayload),
        payload: parsedPayload,
        payload_digest: normalizeScalar(snapshot.meta?.payload_digest) || (parsedPayload ? payloadDigest(parsedPayload) : null),
        payload_schema_version: Number(snapshot.meta?.payload_schema_version ?? 0) || null,
        source_backend: normalizeScalar(snapshot.meta?.source_backend) || null,
        source_sqlite_file: normalizeScalar(snapshot.meta?.source_sqlite_file) || null,
        adoption_status: normalizeScalar(snapshot.meta?.adoption_status) || null,
        adoption_metadata: adoptionMetadata,
        compatibility_fallback_used: false,
        storage_policy: "relational-canonical",
        updated_at: snapshot.meta?.generated_at ?? null,
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
    const sourceBackendValue = normalizeScalar(sourceBackend) || "postgres";
    const sourceSqliteFileValue = normalizeScalar(sourceSqliteFile) || null;
    const adoptionStatusValue = normalizeScalar(adoptionStatus) || "ready";
    const adoptionMetadataValue = adoptionMetadata && typeof adoptionMetadata === "object"
      ? adoptionMetadata
      : { payload_digest: digest };
    const relationalRows = projectRuntimePayloadToRelationalRows(stablePayload, {
      scopeKey,
      generatedAt: payload?.generated_at,
      projectRootRef: absoluteTargetRoot,
      payloadDigest: digest,
      sourceBackend: sourceBackendValue,
      sourceSqliteFile: sourceSqliteFileValue,
      adoptionStatus: adoptionStatusValue,
      adoptionMetadata: adoptionMetadataValue,
    });
    await bootstrapSchema(runtime);
    await withClient(runtime, async (client) => {
      await client.query("BEGIN");
      try {
        await replaceRelationalProjectionRows(client, scopeKey, relationalRows);
        await purgeLegacySnapshotRow(client, scopeKey);
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
        schema_version: POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION,
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
