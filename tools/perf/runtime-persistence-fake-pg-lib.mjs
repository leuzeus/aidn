function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function createRuntimePersistenceFakePgClientFactory({
  initialTables = [],
  initialSchemaMigrations = [1],
  initialSnapshots = [],
  initialHeads = [],
} = {}) {
  const state = {
    tablesPresent: new Set(initialTables),
    schemaMigrations: Array.from(new Set(initialSchemaMigrations.map((value) => Number(value)).filter(Number.isFinite))).sort((left, right) => left - right),
    runtimeSnapshots: new Map(),
    runtimeHeads: new Map(),
    adoptionEvents: [],
    queryLog: [],
    sequence: 0,
  };

  function nextTimestamp() {
    state.sequence += 1;
    const instant = new Date(Date.UTC(2030, 0, 1, 0, 0, state.sequence));
    return instant.toISOString();
  }

  function ensureAllRuntimeTables() {
    for (const tableName of ["schema_migrations", "runtime_snapshots", "runtime_heads", "adoption_events"]) {
      state.tablesPresent.add(tableName);
    }
  }

  for (const row of initialSnapshots) {
    const scopeKey = normalizeScalar(row.scope_key);
    if (!scopeKey) {
      continue;
    }
    state.runtimeSnapshots.set(scopeKey, {
      scope_key: scopeKey,
      project_root_ref: row.project_root_ref ?? scopeKey,
      payload_json: clone(row.payload_json ?? row.payload ?? {}),
      payload_digest: normalizeScalar(row.payload_digest),
      payload_schema_version: Number(row.payload_schema_version ?? 1) || 1,
      source_backend: normalizeScalar(row.source_backend) || "unknown",
      source_sqlite_file: normalizeScalar(row.source_sqlite_file) || null,
      adoption_status: normalizeScalar(row.adoption_status) || "unknown",
      adoption_metadata_json: clone(row.adoption_metadata_json ?? row.adoption_metadata ?? {}),
      updated_at: row.updated_at ?? nextTimestamp(),
    });
  }

  for (const row of initialHeads) {
    const scopeKey = normalizeScalar(row.scope_key);
    const headKey = normalizeScalar(row.head_key);
    if (!scopeKey || !headKey) {
      continue;
    }
    state.runtimeHeads.set(`${scopeKey}:${headKey}`, {
      scope_key: scopeKey,
      head_key: headKey,
      artifact_path: normalizeScalar(row.artifact_path),
      artifact_sha256: normalizeScalar(row.artifact_sha256) || null,
      payload_json: clone(row.payload_json ?? {}),
      updated_at: row.updated_at ?? nextTimestamp(),
    });
  }

  return {
    state,
    factory() {
      return {
        async connect() {},
        async end() {},
        async query(text, values = []) {
          const sql = String(text).trim();
          state.queryLog.push({
            sql,
            values: clone(values),
          });
          if (!sql || sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
            return { rows: [] };
          }
          if (sql.includes("CREATE SCHEMA IF NOT EXISTS aidn_runtime")
            || sql.includes("CREATE TABLE IF NOT EXISTS aidn_runtime.schema_migrations")
            || sql.includes("CREATE TABLE IF NOT EXISTS aidn_runtime.runtime_snapshots")
            || sql.includes("CREATE TABLE IF NOT EXISTS aidn_runtime.runtime_heads")
            || sql.includes("CREATE TABLE IF NOT EXISTS aidn_runtime.adoption_events")) {
            ensureAllRuntimeTables();
            return { rows: [] };
          }
          if (sql.includes("INSERT INTO aidn_runtime.schema_migrations")) {
            state.tablesPresent.add("schema_migrations");
            const version = Number(values[1]);
            if (Number.isFinite(version) && !state.schemaMigrations.includes(version)) {
              state.schemaMigrations.push(version);
              state.schemaMigrations.sort((left, right) => left - right);
            }
            return { rows: [] };
          }
          if (sql.includes("FROM information_schema.tables")) {
            const expected = Array.isArray(values[1]) ? values[1] : [];
            return {
              rows: expected
                .filter((tableName) => state.tablesPresent.has(String(tableName)))
                .sort((left, right) => String(left).localeCompare(String(right)))
                .map((tableName) => ({ table_name: String(tableName) })),
            };
          }
          if (sql.includes("FROM aidn_runtime.schema_migrations")) {
            return {
              rows: state.schemaMigrations.map((schemaVersion) => ({
                schema_version: schemaVersion,
              })),
            };
          }
          if (sql.includes("COUNT(*)::int AS count")
            && sql.includes("FROM aidn_runtime.runtime_snapshots")) {
            const row = state.runtimeSnapshots.get(String(values[0] ?? "").trim());
            return {
              rows: [{ count: row ? 1 : 0 }],
            };
          }
          if (sql.includes("SELECT scope_key, project_root_ref, payload_json, payload_digest, payload_schema_version, updated_at")
            && sql.includes("FROM aidn_runtime.runtime_snapshots")) {
            const row = state.runtimeSnapshots.get(String(values[0] ?? "").trim()) ?? null;
            return {
              rows: row ? [clone(row)] : [],
            };
          }
          if (sql.includes("SELECT head_key, artifact_path, artifact_sha256, payload_json, updated_at")
            && sql.includes("FROM aidn_runtime.runtime_heads")) {
            const scopeKey = normalizeScalar(values[0]);
            const rows = Array.from(state.runtimeHeads.values())
              .filter((row) => row.scope_key === scopeKey)
              .sort((left, right) => String(left.head_key).localeCompare(String(right.head_key)))
              .map((row) => clone(row));
            return { rows };
          }
          if (sql.includes("INSERT INTO aidn_runtime.runtime_snapshots")) {
            state.tablesPresent.add("runtime_snapshots");
            const row = {
              scope_key: values[0],
              project_root_ref: values[1],
              payload_json: typeof values[2] === "string" ? JSON.parse(values[2]) : clone(values[2]),
              payload_digest: values[3],
              payload_schema_version: Number(values[4] ?? 1) || 1,
              source_backend: values[5],
              source_sqlite_file: values[6] ?? null,
              adoption_status: values[7],
              adoption_metadata_json: typeof values[8] === "string" ? JSON.parse(values[8]) : clone(values[8]),
              updated_at: nextTimestamp(),
            };
            state.runtimeSnapshots.set(String(values[0]), row);
            return { rows: [clone(row)] };
          }
          if (sql.includes("DELETE FROM aidn_runtime.runtime_heads")) {
            state.tablesPresent.add("runtime_heads");
            const scopeKey = normalizeScalar(values[0]);
            for (const key of Array.from(state.runtimeHeads.keys())) {
              if (key.startsWith(`${scopeKey}:`)) {
                state.runtimeHeads.delete(key);
              }
            }
            return { rows: [] };
          }
          if (sql.includes("INSERT INTO aidn_runtime.runtime_heads")) {
            state.tablesPresent.add("runtime_heads");
            const row = {
              scope_key: values[0],
              head_key: values[1],
              artifact_path: values[2],
              artifact_sha256: values[3] ?? null,
              payload_json: typeof values[4] === "string" ? JSON.parse(values[4]) : clone(values[4]),
              updated_at: values[5] ?? nextTimestamp(),
            };
            state.runtimeHeads.set(`${row.scope_key}:${row.head_key}`, row);
            return { rows: [clone(row)] };
          }
          if (sql.includes("INSERT INTO aidn_runtime.adoption_events")) {
            state.tablesPresent.add("adoption_events");
            const row = {
              event_id: values[0],
              scope_key: values[1],
              action: values[2],
              status: values[3],
              source_backend: values[4] ?? null,
              target_backend: values[5],
              source_payload_digest: values[6] ?? null,
              target_payload_digest: values[7] ?? null,
              payload_json: typeof values[8] === "string" ? JSON.parse(values[8]) : clone(values[8]),
              created_at: nextTimestamp(),
            };
            state.adoptionEvents.push(row);
            return { rows: [clone(row)] };
          }
          throw new Error(`Unhandled fake pg query: ${sql}`);
        },
      };
    },
  };
}
