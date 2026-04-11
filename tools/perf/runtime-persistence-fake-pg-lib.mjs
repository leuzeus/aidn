function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createUndefinedTableError(tableName) {
  const error = new Error(`relation "aidn_runtime.${tableName}" does not exist`);
  error.code = "42P01";
  return error;
}

function compareNullableStrings(left, right, direction = "asc") {
  const leftValue = normalizeScalar(left);
  const rightValue = normalizeScalar(right);
  const result = leftValue.localeCompare(rightValue);
  return direction === "desc" ? -result : result;
}

function sortRowsForTable(tableName, rows) {
  const copy = rows.slice();
  switch (tableName) {
    case "index_meta":
      return copy.sort((left, right) => compareNullableStrings(left.key, right.key));
    case "cycles":
      return copy.sort((left, right) => compareNullableStrings(left.cycle_id, right.cycle_id));
    case "sessions":
      return copy.sort((left, right) => compareNullableStrings(left.session_id, right.session_id));
    case "artifacts":
      return copy.sort((left, right) => compareNullableStrings(left.path, right.path));
    case "artifact_blobs":
      return copy.sort((left, right) => Number(left.artifact_id ?? 0) - Number(right.artifact_id ?? 0));
    case "file_map":
      return copy.sort((left, right) =>
        compareNullableStrings(left.cycle_id, right.cycle_id) || compareNullableStrings(left.path, right.path));
    case "tags":
      return copy.sort((left, right) => compareNullableStrings(left.tag, right.tag));
    case "artifact_tags":
      return copy.sort((left, right) =>
        (Number(left.artifact_id ?? 0) - Number(right.artifact_id ?? 0))
        || (Number(left.tag_id ?? 0) - Number(right.tag_id ?? 0)));
    case "run_metrics":
      return copy.sort((left, right) =>
        compareNullableStrings(left.started_at, right.started_at, "desc") || compareNullableStrings(left.run_id, right.run_id));
    case "artifact_links":
      return copy.sort((left, right) =>
        compareNullableStrings(left.source_path, right.source_path)
        || compareNullableStrings(left.target_path, right.target_path)
        || compareNullableStrings(left.relation_type, right.relation_type));
    case "cycle_links":
      return copy.sort((left, right) =>
        compareNullableStrings(left.source_cycle_id, right.source_cycle_id)
        || compareNullableStrings(left.target_cycle_id, right.target_cycle_id)
        || compareNullableStrings(left.relation_type, right.relation_type));
    case "session_cycle_links":
      return copy.sort((left, right) =>
        compareNullableStrings(left.session_id, right.session_id)
        || compareNullableStrings(left.cycle_id, right.cycle_id)
        || compareNullableStrings(left.relation_type, right.relation_type));
    case "session_links":
      return copy.sort((left, right) =>
        compareNullableStrings(left.source_session_id, right.source_session_id)
        || compareNullableStrings(left.target_session_id, right.target_session_id)
        || compareNullableStrings(left.relation_type, right.relation_type));
    case "migration_runs":
      return copy.sort((left, right) =>
        compareNullableStrings(left.started_at, right.started_at, "desc") || compareNullableStrings(left.migration_run_id, right.migration_run_id));
    case "migration_findings":
      return copy.sort((left, right) =>
        compareNullableStrings(left.created_at, right.created_at, "desc") || (Number(left.finding_id ?? 0) - Number(right.finding_id ?? 0)));
    case "repair_decisions":
      return copy.sort((left, right) =>
        compareNullableStrings(left.relation_scope, right.relation_scope)
        || compareNullableStrings(left.source_ref, right.source_ref)
        || compareNullableStrings(left.target_ref, right.target_ref)
        || compareNullableStrings(left.relation_type, right.relation_type));
    case "runtime_heads":
      return copy.sort((left, right) => compareNullableStrings(left.head_key, right.head_key));
    default:
      return copy;
  }
}

export function createRuntimePersistenceFakePgClientFactory({
  initialTables = [],
  initialSchemaMigrations = [1],
  initialSnapshots = [],
  initialHeads = [],
} = {}) {
  const knownTables = [
    "schema_migrations",
    "runtime_snapshots",
    "runtime_heads",
    "adoption_events",
    "index_meta",
    "cycles",
    "artifacts",
    "sessions",
    "file_map",
    "tags",
    "artifact_tags",
    "run_metrics",
    "artifact_links",
    "cycle_links",
    "session_cycle_links",
    "session_links",
    "repair_decisions",
    "migration_runs",
    "migration_findings",
    "artifact_blobs",
  ];
  const state = {
    tablesPresent: new Set(initialTables),
    schemaMigrations: Array.from(new Set(initialSchemaMigrations.map((value) => Number(value)).filter(Number.isFinite))).sort((left, right) => left - right),
    runtimeSnapshots: new Map(),
    runtimeHeads: new Map(),
    adoptionEvents: [],
    relationalRows: Object.fromEntries(knownTables.map((tableName) => [tableName, []])),
    queryLog: [],
    sequence: 0,
  };

  function nextTimestamp() {
    state.sequence += 1;
    const instant = new Date(Date.UTC(2030, 0, 1, 0, 0, state.sequence));
    return instant.toISOString();
  }

  function ensureAllRuntimeTables() {
    for (const tableName of knownTables) {
      state.tablesPresent.add(tableName);
    }
  }

  function requireTable(tableName) {
    if (!state.tablesPresent.has(tableName)) {
      throw createUndefinedTableError(tableName);
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
            || sql.includes("CREATE TABLE IF NOT EXISTS aidn_runtime.")) {
            for (const tableName of knownTables) {
              if (sql.includes(`CREATE TABLE IF NOT EXISTS aidn_runtime.${tableName}`)) {
                state.tablesPresent.add(tableName);
              }
            }
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
            requireTable("schema_migrations");
            return {
              rows: state.schemaMigrations.map((schemaVersion) => ({
                schema_version: schemaVersion,
              })),
            };
          }
          if (sql.includes("COUNT(*)::int AS count")
            && sql.includes("FROM aidn_runtime.runtime_snapshots")) {
            requireTable("runtime_snapshots");
            const row = state.runtimeSnapshots.get(String(values[0] ?? "").trim());
            return {
              rows: [{ count: row ? 1 : 0 }],
            };
          }
          if (sql.includes("COUNT(*)::int AS count")
            && sql.includes("FROM aidn_runtime.index_meta")) {
            requireTable("index_meta");
            const scopeKey = normalizeScalar(values[0]);
            const rows = state.relationalRows.index_meta.filter((row) =>
              normalizeScalar(row.scope_key) === scopeKey
              && normalizeScalar(row.key) === "payload_schema_version");
            return {
              rows: [{ count: rows.length }],
            };
          }
          if (sql.includes("SELECT scope_key, project_root_ref, payload_json, payload_digest, payload_schema_version")
            && sql.includes("FROM aidn_runtime.runtime_snapshots")) {
            requireTable("runtime_snapshots");
            const row = state.runtimeSnapshots.get(String(values[0] ?? "").trim()) ?? null;
            return {
              rows: row ? [clone(row)] : [],
            };
          }
          if (sql.includes("FROM aidn_runtime.runtime_heads")
            && sql.includes("WHERE scope_key = $1")) {
            requireTable("runtime_heads");
            const scopeKey = normalizeScalar(values[0]);
            const rows = Array.from(state.runtimeHeads.values())
              .filter((row) => row.scope_key === scopeKey)
              .sort((left, right) => String(left.head_key).localeCompare(String(right.head_key)))
              .map((row) => clone(row));
            return { rows };
          }
          const scopedSelectMatch = sql.match(/^SELECT[\s\S]+FROM aidn_runtime\.([a-z_]+)\s+WHERE scope_key = \$1\s+ORDER BY[\s\S]*$/i);
          if (scopedSelectMatch) {
            const tableName = normalizeScalar(scopedSelectMatch[1]).toLowerCase();
            if (!knownTables.includes(tableName) || ["runtime_snapshots", "adoption_events", "schema_migrations", "runtime_heads"].includes(tableName)) {
              throw new Error(`Unhandled fake pg scoped select for table: ${tableName}`);
            }
            requireTable(tableName);
            const scopeKey = normalizeScalar(values[0]);
            const rows = sortRowsForTable(
              tableName,
              state.relationalRows[tableName].filter((row) => normalizeScalar(row.scope_key) === scopeKey),
            ).map((row) => clone(row));
            return { rows };
          }
          if (sql.includes("INSERT INTO aidn_runtime.runtime_snapshots")) {
            requireTable("runtime_snapshots");
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
          if (sql.includes("DELETE FROM aidn_runtime.runtime_snapshots")) {
            requireTable("runtime_snapshots");
            const scopeKey = normalizeScalar(values[0]);
            state.runtimeSnapshots.delete(scopeKey);
            return { rows: [] };
          }
          if (sql.includes("DELETE FROM aidn_runtime.runtime_heads")) {
            requireTable("runtime_heads");
            const scopeKey = normalizeScalar(values[0]);
            for (const key of Array.from(state.runtimeHeads.keys())) {
              if (key.startsWith(`${scopeKey}:`)) {
                state.runtimeHeads.delete(key);
              }
            }
            state.relationalRows.runtime_heads = state.relationalRows.runtime_heads
              .filter((row) => normalizeScalar(row.scope_key) !== scopeKey);
            return { rows: [] };
          }
          if (sql.includes("INSERT INTO aidn_runtime.runtime_heads")) {
            requireTable("runtime_heads");
            const insertMatch = sql.match(/^INSERT INTO aidn_runtime\.runtime_heads\s*\(([\s\S]+?)\)\s*VALUES/i);
            if (!insertMatch) {
              throw new Error("runtime_heads insert is missing a column list");
            }
            const columns = String(insertMatch[1])
              .split(",")
              .map((item) => normalizeScalar(item))
              .filter(Boolean);
            const row = {};
            for (let index = 0; index < columns.length; index += 1) {
              const column = columns[index];
              const value = values[index];
              row[column] = typeof value === "string" && column === "payload_json"
                ? JSON.parse(value)
                : clone(value);
            }
            row.scope_key = normalizeScalar(row.scope_key);
            row.head_key = normalizeScalar(row.head_key);
            row.artifact_path = normalizeScalar(row.artifact_path);
            row.artifact_sha256 = normalizeScalar(row.artifact_sha256) || null;
            row.updated_at = row.updated_at ?? nextTimestamp();
            if (!row.scope_key || !row.head_key || !row.artifact_path) {
              throw new Error("runtime_heads insert requires scope_key, head_key, and artifact_path");
            }
            state.runtimeHeads.set(`${row.scope_key}:${row.head_key}`, row);
            state.relationalRows.runtime_heads = state.relationalRows.runtime_heads
              .filter((item) => !(normalizeScalar(item.scope_key) === normalizeScalar(row.scope_key) && normalizeScalar(item.head_key) === normalizeScalar(row.head_key)));
            state.relationalRows.runtime_heads.push(clone(row));
            return { rows: [clone(row)] };
          }
          if (sql.includes("INSERT INTO aidn_runtime.adoption_events")) {
            requireTable("adoption_events");
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
          const deleteMatch = sql.match(/^DELETE FROM aidn_runtime\.([a-z_]+)\s+WHERE scope_key = \$1$/i);
          if (deleteMatch) {
            const tableName = normalizeScalar(deleteMatch[1]).toLowerCase();
            if (!knownTables.includes(tableName)) {
              throw new Error(`Unknown relational table delete in fake pg: ${tableName}`);
            }
            requireTable(tableName);
            const scopeKey = normalizeScalar(values[0]);
            state.relationalRows[tableName] = state.relationalRows[tableName]
              .filter((row) => normalizeScalar(row.scope_key) !== scopeKey);
            return { rows: [] };
          }
          const insertMatch = sql.match(/^INSERT INTO aidn_runtime\.([a-z_]+)\s*\(([\s\S]+?)\)\s*VALUES/i);
          if (insertMatch) {
            const tableName = normalizeScalar(insertMatch[1]).toLowerCase();
            if (!knownTables.includes(tableName) || ["runtime_snapshots", "adoption_events", "schema_migrations"].includes(tableName)) {
              throw new Error(`Unhandled fake pg insert for table: ${tableName}`);
            }
            requireTable(tableName);
            const columns = String(insertMatch[2])
              .split(",")
              .map((item) => normalizeScalar(item))
              .filter(Boolean);
            const row = {};
            for (let index = 0; index < columns.length; index += 1) {
              const column = columns[index];
              const value = values[index];
              row[column] = typeof value === "string" && (column === "canonical_json" || column === "payload_json")
                ? JSON.parse(value)
                : clone(value);
            }
            state.relationalRows[tableName].push(row);
            return { rows: [clone(row)] };
          }
          throw new Error(`Unhandled fake pg query: ${sql}`);
        },
      };
    },
  };
}
