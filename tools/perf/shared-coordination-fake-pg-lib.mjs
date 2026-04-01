function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldUseLongDelay(actualValue, preferredValue) {
  const actual = normalizeScalar(actualValue);
  const preferred = normalizeScalar(preferredValue);
  return preferred ? actual === preferred : false;
}

export function createConcurrentFakePgClientFactory({
  planningLaterSourceWorktreeId = "worktree-1",
  handoffLaterSourceWorktreeId = "worktree-2",
  coordinationLaterSourceWorktreeId = "worktree-2",
} = {}) {
  const state = {
    planningStates: new Map(),
    handoffRelays: new Map(),
    coordinationRecords: [],
    workspaceRegistry: new Map(),
    worktreeRegistry: new Map(),
    schemaMigrations: [1],
    queryLog: [],
    sequence: 0,
  };

  function nextTimestamp() {
    state.sequence += 1;
    const second = String(state.sequence % 60).padStart(2, "0");
    return `2030-01-01T00:00:${second}.000Z`;
  }

  async function maybeDelay(sql, values) {
    if (sql.includes("INSERT INTO aidn_shared.planning_states")) {
      await delay(shouldUseLongDelay(values[12], planningLaterSourceWorktreeId) ? 15 : 5);
      return;
    }
    if (sql.includes("INSERT INTO aidn_shared.handoff_relays")) {
      await delay(shouldUseLongDelay(values[6], handoffLaterSourceWorktreeId) ? 15 : 5);
      return;
    }
    if (sql.includes("INSERT INTO aidn_shared.coordination_records")) {
      await delay(shouldUseLongDelay(values[7], coordinationLaterSourceWorktreeId) ? 15 : 5);
    }
  }

  return {
    state,
    factory() {
      return {
        async connect() {},
        async end() {},
        async query(text, values = []) {
          const sql = String(text).trim();
          await maybeDelay(sql, values);
          state.queryLog.push({
            sql,
            values,
          });
          if (!sql || sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql.startsWith("CREATE SCHEMA") || sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX")) {
            return { rows: [] };
          }
          if (sql.includes("INSERT INTO aidn_shared.schema_migrations")) {
            const version = Number(values[1]);
            if (Number.isFinite(version) && !state.schemaMigrations.includes(version)) {
              state.schemaMigrations.push(version);
              state.schemaMigrations.sort((left, right) => left - right);
            }
            return { rows: [] };
          }
          if (sql.includes("INSERT INTO aidn_shared.workspace_registry")) {
            const row = {
              workspace_id: values[0],
              workspace_id_source: values[1],
              locator_ref: values[2],
              git_common_dir: values[3],
              repo_root: values[4],
              shared_backend_kind: values[5],
              updated_at: nextTimestamp(),
            };
            state.workspaceRegistry.set(row.workspace_id, row);
            return { rows: [row] };
          }
          if (sql.includes("INSERT INTO aidn_shared.worktree_registry")) {
            const row = {
              workspace_id: values[0],
              worktree_id: values[1],
              worktree_root: values[2],
              git_dir: values[3],
              is_linked_worktree: values[4],
              last_seen_at: nextTimestamp(),
            };
            state.worktreeRegistry.set(`${row.workspace_id}:${row.worktree_id}`, row);
            return { rows: [row] };
          }
          if (sql.includes("INSERT INTO aidn_shared.planning_states")) {
            const key = `${values[0]}:${values[1]}`;
            const previous = state.planningStates.get(key);
            const row = {
              workspace_id: values[0],
              planning_key: values[1],
              session_id: values[2],
              backlog_artifact_ref: values[3],
              backlog_artifact_sha256: values[4],
              planning_status: values[5],
              planning_arbitration_status: values[6],
              next_dispatch_scope: values[7],
              next_dispatch_action: values[8],
              backlog_next_step: values[9],
              selected_execution_scope: values[10],
              dispatch_ready: values[11],
              source_worktree_id: values[12],
              payload_json: JSON.parse(values[13]),
              revision: previous ? previous.revision + 1 : 0,
              created_at: previous?.created_at ?? nextTimestamp(),
              updated_at: nextTimestamp(),
            };
            state.planningStates.set(key, row);
            return { rows: [row] };
          }
          if (sql.includes("INSERT INTO aidn_shared.handoff_relays")) {
            const key = `${values[0]}:${values[1]}`;
            const row = {
              workspace_id: values[0],
              relay_id: values[1],
              session_id: values[2],
              cycle_id: values[3],
              scope_type: values[4],
              scope_id: values[5],
              source_worktree_id: values[6],
              handoff_status: values[7],
              from_agent_role: values[8],
              from_agent_action: values[9],
              recommended_next_agent_role: values[10],
              recommended_next_agent_action: values[11],
              handoff_packet_ref: values[12],
              handoff_packet_sha256: values[13],
              prioritized_artifacts: JSON.parse(values[14]),
              metadata_json: JSON.parse(values[15]),
              created_at: nextTimestamp(),
            };
            state.handoffRelays.set(key, row);
            return { rows: [row] };
          }
          if (sql.includes("INSERT INTO aidn_shared.coordination_records")) {
            const key = `${values[0]}:${values[1]}`;
            const row = {
              workspace_id: values[0],
              record_id: values[1],
              record_type: values[2],
              session_id: values[3],
              cycle_id: values[4],
              scope_type: values[5],
              scope_id: values[6],
              source_worktree_id: values[7],
              actor_role: values[8],
              actor_action: values[9],
              status: values[10],
              coordination_log_ref: values[11],
              coordination_summary_ref: values[12],
              payload_json: JSON.parse(values[13]),
              created_at: nextTimestamp(),
            };
            const existingIndex = state.coordinationRecords.findIndex((item) => `${item.workspace_id}:${item.record_id}` === key);
            if (existingIndex >= 0) {
              state.coordinationRecords.splice(existingIndex, 1, row);
            } else {
              state.coordinationRecords.push(row);
            }
            return { rows: [row] };
          }
          if (sql.includes("FROM aidn_shared.planning_states")) {
            const row = state.planningStates.get(`${values[0]}:${values[1]}`) ?? null;
            return { rows: row ? [row] : [] };
          }
          if (sql.includes("FROM aidn_shared.handoff_relays")) {
            const rows = Array.from(state.handoffRelays.values())
              .filter((row) => row.workspace_id === values[0])
              .filter((row) => !values[1] || row.session_id === values[1])
              .filter((row) => !values[2] || row.scope_type === values[2])
              .filter((row) => !values[3] || row.scope_id === values[3])
              .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)) || String(right.relay_id).localeCompare(String(left.relay_id)));
            return { rows: rows.slice(0, 1) };
          }
          if (sql.includes("FROM aidn_shared.coordination_records")) {
            const rows = state.coordinationRecords
              .filter((row) => row.workspace_id === values[0])
              .filter((row) => !values[1] || row.record_type === values[1])
              .filter((row) => !values[2] || row.session_id === values[2])
              .filter((row) => !values[3] || row.scope_type === values[3])
              .filter((row) => !values[4] || row.scope_id === values[4])
              .slice()
              .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)) || String(right.record_id).localeCompare(String(left.record_id)))
              .slice(0, Number(values[5] ?? 20));
            return { rows };
          }
          if (sql.includes("FROM information_schema.tables")) {
            return {
              rows: [
                { table_name: "coordination_records" },
                { table_name: "handoff_relays" },
                { table_name: "planning_states" },
                { table_name: "schema_migrations" },
                { table_name: "workspace_registry" },
                { table_name: "worktree_registry" },
              ],
            };
          }
          if (sql.includes("FROM aidn_shared.schema_migrations")) {
            return {
              rows: state.schemaMigrations.map((schemaVersion) => ({
                schema_version: schemaVersion,
              })),
            };
          }
          if (sql.includes("SELECT") && sql.includes("current_database()")) {
            return {
              rows: [{
                database_name: "aidn_test",
                current_schema_name: "public",
                ok: 1,
              }],
            };
          }
          throw new Error(`Unhandled fake pg query: ${sql}`);
        },
      };
    },
  };
}
