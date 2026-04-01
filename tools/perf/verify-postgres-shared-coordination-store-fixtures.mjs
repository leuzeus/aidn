#!/usr/bin/env node
import { createPostgresSharedCoordinationStore } from "../../src/adapters/runtime/postgres-shared-coordination-store.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createFakePgClientFactory() {
  const state = {
    planningStates: new Map(),
    handoffRelays: new Map(),
    coordinationRecords: [],
    workspaceRegistry: new Map(),
    worktreeRegistry: new Map(),
    schemaMigrations: [1],
  };

  return {
    state,
    factory() {
      return {
        async connect() {},
        async end() {},
        async query(text, values = []) {
          const sql = String(text).trim();
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
              last_seen_at: new Date().toISOString(),
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
              created_at: previous?.created_at ?? new Date().toISOString(),
              updated_at: new Date().toISOString(),
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
              created_at: new Date().toISOString(),
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
              created_at: new Date().toISOString(),
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
              .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
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
              .reverse()
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

async function main() {
  try {
    const fake = createFakePgClientFactory();
    const store = createPostgresSharedCoordinationStore({
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: fake.factory,
    });

    const bootstrap = await store.bootstrap();
    assert(bootstrap.ok === true, "bootstrap should succeed");

    const workspaceRegistration = await store.registerWorkspace({
      workspaceId: "workspace-1",
      workspaceIdSource: "git-common-dir",
      locatorRef: ".aidn/project/shared-runtime.locator.json",
      gitCommonDir: "/tmp/common.git",
      repoRoot: "/tmp/repo",
      sharedBackendKind: "postgres",
    });
    assert(workspaceRegistration.ok === true, "workspace registration should succeed");

    const worktreeHeartbeat = await store.registerWorktreeHeartbeat({
      workspaceId: "workspace-1",
      worktreeId: "worktree-1",
      worktreeRoot: "/tmp/repo-worktree",
      gitDir: "/tmp/repo-worktree/.git",
      isLinkedWorktree: true,
    });
    assert(worktreeHeartbeat.ok === true, "worktree heartbeat should succeed");

    const planningWrite = await store.upsertPlanningState({
      workspaceId: "workspace-1",
      planningKey: "session:S101",
      sessionId: "S101",
      backlogArtifactRef: "docs/audit/backlog/BL-S101.md",
      planningStatus: "promoted",
      planningArbitrationStatus: "resolved",
      nextDispatchScope: "cycle",
      nextDispatchAction: "implement",
      backlogNextStep: "implement feature",
      selectedExecutionScope: "new_cycle",
      dispatchReady: true,
      sourceWorktreeId: "worktree-1",
      payload: {
        session_id: "S101",
        planning_status: "promoted",
      },
    });
    assert(planningWrite.ok === true, "planning upsert should succeed");
    assert(planningWrite.planning_state.revision === 0, "first planning revision should be 0");

    const planningRead = await store.getPlanningState({
      workspaceId: "workspace-1",
      planningKey: "session:S101",
    });
    assert(planningRead.ok === true, "planning read should succeed");
    assert(planningRead.planning_state.planning_status === "promoted", "planning read should expose planning status");

    const handoffWrite = await store.appendHandoffRelay({
      workspaceId: "workspace-1",
      relayId: "handoff:1",
      sessionId: "S101",
      cycleId: "C101",
      scopeType: "cycle",
      scopeId: "C101",
      sourceWorktreeId: "worktree-1",
      handoffStatus: "ready",
      fromAgentRole: "coordinator",
      fromAgentAction: "relay",
      recommendedNextAgentRole: "executor",
      recommendedNextAgentAction: "implement",
      handoffPacketRef: "docs/audit/HANDOFF-PACKET.md",
      prioritizedArtifacts: ["docs/audit/CURRENT-STATE.md"],
      metadata: {
        active_session: "S101",
      },
    });
    assert(handoffWrite.ok === true, "handoff write should succeed");

    const latestHandoff = await store.getLatestHandoffRelay({
      workspaceId: "workspace-1",
      sessionId: "S101",
      scopeType: "cycle",
      scopeId: "C101",
    });
    assert(latestHandoff.ok === true, "handoff read should succeed");
    assert(latestHandoff.handoff_relay.recommended_next_agent_role === "executor", "handoff read should expose next agent role");

    const coordinationWrite = await store.appendCoordinationRecord({
      workspaceId: "workspace-1",
      recordId: "coord:1",
      recordType: "coordinator_dispatch",
      sessionId: "S101",
      cycleId: "C101",
      scopeType: "cycle",
      scopeId: "C101",
      sourceWorktreeId: "worktree-1",
      actorRole: "coordinator",
      actorAction: "coordinate",
      status: "dry_run",
      coordinationSummaryRef: "docs/audit/COORDINATION-SUMMARY.md",
      payload: {
        execution_status: "dry_run",
      },
    });
    assert(coordinationWrite.ok === true, "coordination write should succeed");

    const coordinationList = await store.listCoordinationRecords({
      workspaceId: "workspace-1",
      recordType: "coordinator_dispatch",
      scopeType: "cycle",
      scopeId: "C101",
      limit: 5,
    });
    assert(coordinationList.ok === true, "coordination list should succeed");
    assert(coordinationList.records.length === 1, "coordination list should return the inserted record");

    const health = await store.healthcheck();
    assert(health.ok === true, "healthcheck should succeed");
    assert(health.schema_status === "ready", "healthcheck should expose ready schema status");
    assert(health.latest_applied_schema_version === 1, "healthcheck should expose latest schema version");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

await main();
