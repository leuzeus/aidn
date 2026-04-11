export const RUNTIME_SCHEMA_ENTITY_CLASSIFICATION = Object.freeze({
  canonical: "canonical",
  admin: "admin",
  optimization: "optimization",
  compatibility: "compatibility",
  legacy_snapshot: "legacy_snapshot",
});

export const RUNTIME_SCHEMA_ENTITY_KIND = Object.freeze({
  table: "table",
  view: "view",
  index: "index",
});

const SQLITE_RUNTIME_SCHEMA_ENTITIES = Object.freeze([
  Object.freeze({ name: "cycles", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "artifacts", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "sessions", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "file_map", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "tags", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "artifact_tags", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "run_metrics", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "artifact_links", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "cycle_links", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "session_cycle_links", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "session_links", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "repair_decisions", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "migration_runs", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "migration_findings", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "artifact_blobs", kind: "table", classification: "optimization", parity_required: true }),
  Object.freeze({ name: "runtime_heads", kind: "table", classification: "optimization", parity_required: true }),
  Object.freeze({ name: "index_meta", kind: "table", classification: "admin", parity_required: false }),
  Object.freeze({ name: "schema_migrations", kind: "table", classification: "admin", parity_required: true }),
  Object.freeze({ name: "v_session_cycle_context", kind: "view", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "v_session_link_context", kind: "view", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "v_artifact_link_context", kind: "view", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "v_repair_findings_open", kind: "view", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "v_materializable_artifacts", kind: "view", classification: "optimization", parity_required: true }),
]);

const POSTGRES_RUNTIME_SNAPSHOT_V1_ENTITIES = Object.freeze([
  Object.freeze({ name: "schema_migrations", kind: "table", classification: "admin", parity_required: true }),
  Object.freeze({ name: "runtime_snapshots", kind: "table", classification: "legacy_snapshot", parity_required: false }),
  Object.freeze({ name: "runtime_heads", kind: "table", classification: "optimization", parity_required: true }),
  Object.freeze({ name: "adoption_events", kind: "table", classification: "admin", parity_required: true }),
]);

const POSTGRES_RUNTIME_RELATIONAL_V2_ENTITIES = Object.freeze([
  Object.freeze({ name: "schema_migrations", kind: "table", classification: "admin", parity_required: true }),
  Object.freeze({ name: "index_meta", kind: "table", classification: "admin", parity_required: false }),
  Object.freeze({ name: "cycles", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "artifacts", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "sessions", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "file_map", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "tags", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "artifact_tags", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "run_metrics", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "artifact_links", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "cycle_links", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "session_cycle_links", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "session_links", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "repair_decisions", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "migration_runs", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "migration_findings", kind: "table", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "artifact_blobs", kind: "table", classification: "optimization", parity_required: true }),
  Object.freeze({ name: "runtime_heads", kind: "table", classification: "optimization", parity_required: true }),
  Object.freeze({ name: "adoption_events", kind: "table", classification: "admin", parity_required: true }),
  Object.freeze({ name: "v_session_cycle_context", kind: "view", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "v_session_link_context", kind: "view", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "v_artifact_link_context", kind: "view", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "v_repair_findings_open", kind: "view", classification: "canonical", parity_required: true }),
  Object.freeze({ name: "v_materializable_artifacts", kind: "view", classification: "optimization", parity_required: true }),
]);

function cloneEntities(entities) {
  return entities.map((entity) => ({ ...entity }));
}

export function listSqliteRuntimeSchemaEntities() {
  return cloneEntities(SQLITE_RUNTIME_SCHEMA_ENTITIES);
}

export function listSqliteRuntimeCanonicalEntities() {
  return listSqliteRuntimeSchemaEntities().filter((entity) => entity.classification === RUNTIME_SCHEMA_ENTITY_CLASSIFICATION.canonical);
}

export function listPostgresRuntimeSnapshotV1Entities() {
  return cloneEntities(POSTGRES_RUNTIME_SNAPSHOT_V1_ENTITIES);
}

export function listPostgresRuntimeRelationalV2Entities() {
  return cloneEntities(POSTGRES_RUNTIME_RELATIONAL_V2_ENTITIES);
}

export function listPostgresRuntimeRelationalParityRequiredEntityNames() {
  return listPostgresRuntimeRelationalV2Entities()
    .filter((entity) => entity.parity_required === true)
    .map((entity) => entity.name);
}

export function classifyPostgresRuntimeTablePolicy(tableName) {
  const normalized = String(tableName ?? "").trim();
  return listPostgresRuntimeSnapshotV1Entities().find((entity) => entity.name === normalized)
    ?? listPostgresRuntimeRelationalV2Entities().find((entity) => entity.name === normalized)
    ?? null;
}
