// Offline SQL transport double. Runs the actual PostgreSQL artifact command
// implementation; this is not a PostgreSQL server or concurrency qualification.
import fs from "node:fs";
import { createPostgresRuntimeArtifactStore } from "../../src/adapters/runtime/postgres-runtime-artifact-store.mjs";
import { resolveEffectiveRuntimePersistence } from "../../src/application/runtime/runtime-persistence-service.mjs";

const file = process.env.AIDN_TEST_PG_STATE;
const state = JSON.parse(fs.readFileSync(file, "utf8")), queries = [];
let working = structuredClone(state.tables), committed = false;
try {
  const request = JSON.parse(fs.readFileSync(0, "utf8"));
  if (state.unavailable) throw Error("ARTIFACT_POSTGRES_WORKER_UNAVAILABLE");
  if (request.action === "get" && state.failReadAfterWrite && state.commits > 0) throw Error("ARTIFACT_POSTGRES_COMMAND_FAILED");
  const client = { async query(source, values = []) {
    const sql = source.replace(/\s+/g, " ").trim(); queries.push(sql);
    if (/CREATE |ALTER |DROP |DELETE /i.test(sql)) throw Error("ARTIFACT_FIXTURE_UNEXPECTED_DDL");
    if (sql.startsWith("BEGIN") || sql.startsWith("SET LOCAL") || sql.startsWith("LOCK TABLE") || sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql === "COMMIT") { committed = true; return { rows: [] }; }
    if (sql === "ROLLBACK") { working = structuredClone(state.tables); return { rows: [] }; }
    if (sql.startsWith("SELECT MAX(schema_version)")) return { rows: [{ version: state.schemaVersion ?? 3 }] };
    if (sql.startsWith("SELECT DISTINCT scope_key")) return { rows: [{ scope_key: state.scope }] };
    if (sql.includes("to_regclass('aidn_shared.execution_runs')")) return { rows: [{ execution_runs: "aidn_shared.execution_runs" }] };
    if (sql.startsWith("SELECT run_id FROM aidn_shared.execution_runs")) return { rows: state.reserved ? [{ run_id: "reserved-fixture" }] : [] };
    if (sql.startsWith("SELECT * FROM aidn_runtime.v_materializable_artifacts")) return { rows: working.artifacts.filter(row => row.scope_key === values[0] && row.path === values[1]) };
    if (sql.startsWith("SELECT artifact_id FROM")) return { rows: working.artifacts.filter(row => row.scope_key === values[0] && row.path === values[1]).map(row => ({ artifact_id: row.artifact_id })) };
    if (sql.startsWith("SELECT COALESCE(MAX(artifact_id)")) return { rows: [{ id: working.artifacts.length + 1 }] };
    const insert = sql.match(/^INSERT INTO aidn_runtime\.([a-z_]+) \(([^)]+)\)/);
    if (insert) {
      const [, table, columns] = insert;
      if (state.failBlob && table === "artifact_blobs") throw Error("ARTIFACT_POSTGRES_COMMAND_FAILED");
      const row = Object.fromEntries(columns.split(",").map((key, index) => [key.trim(), values[index]]));
      if (!working[table]) throw Error("ARTIFACT_FIXTURE_UNKNOWN_TABLE");
      const existing = working[table].findIndex(item => item.scope_key === row.scope_key && (table === "artifacts" ? item.path === row.path : item.artifact_id === row.artifact_id));
      if (existing < 0) working[table].push(row); else working[table][existing] = row;
      return { rows: [] };
    }
    throw Error("ARTIFACT_FIXTURE_UNSUPPORTED_QUERY");
  } };
  const resolution = resolveEffectiveRuntimePersistence({ targetRoot: request.targetRoot });
  const store = createPostgresRuntimeArtifactStore({ targetRoot: request.targetRoot, connectionRef: resolution.connectionRef,
    clientFactory({ connectionString }) {
      if (connectionString !== process.env.AIDN_TEST_DB) throw Error("ARTIFACT_FIXTURE_CREDENTIAL_NOT_FORWARDED");
      return client;
    } });
  const result = await store.executeArtifactCommand(request.action, request.options);
  if (committed) { state.tables = working; if (["upsert", "compare-and-swap", "replace"].includes(request.action)) state.commits++; }
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: /^ARTIFACT_[A-Z_]+$/.test(error.message) ? error.message : "ARTIFACT_POSTGRES_COMMAND_FAILED" })); process.exitCode = 1;
} finally { state.queries.push(...queries); fs.writeFileSync(file, JSON.stringify(state)); }
