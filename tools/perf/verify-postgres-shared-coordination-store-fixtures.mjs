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
    projectRegistry: new Map(),
    workspaceRegistry: new Map(),
    worktreeRegistry: new Map(),
    schemaMigrations: [2],
  };

  function buildProjectSummaryRows(projectId = "") {
    return Array.from(state.projectRegistry.values())
      .filter((row) => !projectId || row.project_id === projectId)
      .sort((left, right) => String(left.project_id).localeCompare(String(right.project_id)))
      .map((row) => ({
        ...row,
        workspace_count: Array.from(state.workspaceRegistry.values()).filter((item) => item.project_id === row.project_id).length,
        worktree_count: Array.from(state.worktreeRegistry.values()).filter((item) => item.project_id === row.project_id).length,
        planning_state_count: Array.from(state.planningStates.values()).filter((item) => item.project_id === row.project_id).length,
        handoff_relay_count: Array.from(state.handoffRelays.values()).filter((item) => item.project_id === row.project_id).length,
        coordination_record_count: state.coordinationRecords.filter((item) => item.project_id === row.project_id).length,
      }));
  }

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
              project_id: values[0],
              project_id_source: values[1],
              project_root_ref: values[2],
              workspace_id: values[3],
              workspace_id_source: values[4],
              locator_ref: values[5],
              git_common_dir: values[6],
              repo_root: values[7],
              shared_backend_kind: values[8],
            };
            state.workspaceRegistry.set(`${row.project_id}:${row.workspace_id}`, row);
            return { rows: [row] };
          }
          if (sql.includes("INSERT INTO aidn_shared.project_registry")) {
            const row = {
              project_id: values[0],
              project_id_source: values[1],
              project_root_ref: values[2],
              locator_ref: values[3],
              shared_backend_kind: values[4],
            };
            state.projectRegistry.set(row.project_id, row);
            return { rows: [row] };
          }
          if (sql.includes("INSERT INTO aidn_shared.worktree_registry")) {
            const row = {
              project_id: values[0],
              workspace_id: values[1],
              worktree_id: values[2],
              worktree_root: values[3],
              git_dir: values[4],
              is_linked_worktree: values[5],
              last_seen_at: new Date().toISOString(),
            };
            state.worktreeRegistry.set(`${row.project_id}:${row.workspace_id}:${row.worktree_id}`, row);
            return { rows: [row] };
          }
          if (sql.includes("INSERT INTO aidn_shared.planning_states")) {
            const key = `${values[0]}:${values[1]}:${values[2]}`;
            const previous = state.planningStates.get(key);
            const row = {
              project_id: values[0],
              workspace_id: values[1],
              planning_key: values[2],
              session_id: values[3],
              backlog_artifact_ref: values[4],
              backlog_artifact_sha256: values[5],
              planning_status: values[6],
              planning_arbitration_status: values[7],
              next_dispatch_scope: values[8],
              next_dispatch_action: values[9],
              backlog_next_step: values[10],
              selected_execution_scope: values[11],
              dispatch_ready: values[12],
              source_worktree_id: values[13],
              payload_json: JSON.parse(values[14]),
              revision: previous ? previous.revision + 1 : 0,
              created_at: previous?.created_at ?? new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            state.planningStates.set(key, row);
            return { rows: [row] };
          }
          if (sql.includes("INSERT INTO aidn_shared.handoff_relays")) {
            const key = `${values[0]}:${values[1]}:${values[2]}`;
            const row = {
              project_id: values[0],
              workspace_id: values[1],
              relay_id: values[2],
              session_id: values[3],
              cycle_id: values[4],
              scope_type: values[5],
              scope_id: values[6],
              source_worktree_id: values[7],
              handoff_status: values[8],
              from_agent_role: values[9],
              from_agent_action: values[10],
              recommended_next_agent_role: values[11],
              recommended_next_agent_action: values[12],
              handoff_packet_ref: values[13],
              handoff_packet_sha256: values[14],
              prioritized_artifacts: JSON.parse(values[15]),
              metadata_json: JSON.parse(values[16]),
              created_at: new Date().toISOString(),
            };
            state.handoffRelays.set(key, row);
            return { rows: [row] };
          }
          if (sql.includes("INSERT INTO aidn_shared.coordination_records")) {
            const key = `${values[0]}:${values[1]}:${values[2]}`;
            const row = {
              project_id: values[0],
              workspace_id: values[1],
              record_id: values[2],
              record_type: values[3],
              session_id: values[4],
              cycle_id: values[5],
              scope_type: values[6],
              scope_id: values[7],
              source_worktree_id: values[8],
              actor_role: values[9],
              actor_action: values[10],
              status: values[11],
              coordination_log_ref: values[12],
              coordination_summary_ref: values[13],
              payload_json: JSON.parse(values[14]),
              created_at: new Date().toISOString(),
            };
            const existingIndex = state.coordinationRecords.findIndex((item) => `${item.project_id}:${item.workspace_id}:${item.record_id}` === key);
            if (existingIndex >= 0) {
              state.coordinationRecords.splice(existingIndex, 1, row);
            } else {
              state.coordinationRecords.push(row);
            }
            return { rows: [row] };
          }
          if (sql.includes("FROM aidn_shared.project_registry") && sql.includes("workspace_count")) {
            const rows = buildProjectSummaryRows(String(values[0] ?? "").trim());
            return { rows: sql.includes("LIMIT 1") ? rows.slice(0, 1) : rows };
          }
          if (sql.includes("FROM aidn_shared.workspace_registry") && sql.includes("ORDER BY workspace_id ASC")) {
            const rows = Array.from(state.workspaceRegistry.values())
              .filter((row) => row.project_id === values[0])
              .slice()
              .sort((left, right) => String(left.workspace_id).localeCompare(String(right.workspace_id)));
            return { rows };
          }
          if (sql.includes("FROM aidn_shared.planning_states")) {
            const row = state.planningStates.get(`${values[0]}:${values[1]}:${values[2]}`) ?? null;
            return { rows: row ? [row] : [] };
          }
          if (sql.includes("FROM aidn_shared.handoff_relays")) {
            const rows = Array.from(state.handoffRelays.values())
              .filter((row) => row.project_id === values[0])
              .filter((row) => row.workspace_id === values[1])
              .filter((row) => !values[2] || row.session_id === values[2])
              .filter((row) => !values[3] || row.scope_type === values[3])
              .filter((row) => !values[4] || row.scope_id === values[4])
              .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
            return { rows: rows.slice(0, 1) };
          }
          if (sql.includes("FROM aidn_shared.coordination_records")) {
            const rows = state.coordinationRecords
              .filter((row) => row.project_id === values[0])
              .filter((row) => row.workspace_id === values[1])
              .filter((row) => !values[2] || row.record_type === values[2])
              .filter((row) => !values[3] || row.session_id === values[3])
              .filter((row) => !values[4] || row.scope_type === values[4])
              .filter((row) => !values[5] || row.scope_id === values[5])
              .slice()
              .reverse()
              .slice(0, Number(values[6] ?? 20));
            return { rows };
          }
          if (sql.includes("FROM information_schema.tables")) {
            return {
              rows: [
                { table_name: "coordination_records" },
                { table_name: "handoff_relays" },
                { table_name: "planning_states" },
                { table_name: "project_registry" },
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
          if (sql.includes("COUNT(*)::int AS registered_project_count")) {
            return {
              rows: [{ registered_project_count: state.projectRegistry.size }],
            };
          }
          if (sql.includes("COUNT(*)::int AS legacy_workspace_rows")) {
            const legacyWorkspaceRows = Array.from(state.workspaceRegistry.values())
              .filter((row) => !String(row.project_id ?? "").trim())
              .length;
            return {
              rows: [{ legacy_workspace_rows: legacyWorkspaceRows }],
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
      projectId: "project-1",
      projectIdSource: "git-common-dir",
      projectRootRef: "/tmp/repo",
      workspaceId: "workspace-1",
      workspaceIdSource: "git-common-dir",
      locatorRef: ".aidn/project/shared-runtime.locator.json",
      gitCommonDir: "/tmp/common.git",
      repoRoot: "/tmp/repo",
      sharedBackendKind: "postgres",
    });
    assert(workspaceRegistration.ok === true, "workspace registration should succeed");

    const worktreeHeartbeat = await store.registerWorktreeHeartbeat({
      projectId: "project-1",
      workspaceId: "workspace-1",
      worktreeId: "worktree-1",
      worktreeRoot: "/tmp/repo-worktree",
      gitDir: "/tmp/repo-worktree/.git",
      isLinkedWorktree: true,
    });
    assert(worktreeHeartbeat.ok === true, "worktree heartbeat should succeed");

    const planningWrite = await store.upsertPlanningState({
      projectId: "project-1",
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
      projectId: "project-1",
      workspaceId: "workspace-1",
      planningKey: "session:S101",
    });
    assert(planningRead.ok === true, "planning read should succeed");
    assert(planningRead.planning_state.planning_status === "promoted", "planning read should expose planning status");

    const handoffWrite = await store.appendHandoffRelay({
      projectId: "project-1",
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
      projectId: "project-1",
      workspaceId: "workspace-1",
      sessionId: "S101",
      scopeType: "cycle",
      scopeId: "C101",
    });
    assert(latestHandoff.ok === true, "handoff read should succeed");
    assert(latestHandoff.handoff_relay.recommended_next_agent_role === "executor", "handoff read should expose next agent role");

    const coordinationWrite = await store.appendCoordinationRecord({
      projectId: "project-1",
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
      projectId: "project-1",
      workspaceId: "workspace-1",
      recordType: "coordinator_dispatch",
      scopeType: "cycle",
      scopeId: "C101",
      limit: 5,
    });
    assert(coordinationList.ok === true, "coordination list should succeed");
    assert(coordinationList.records.length === 1, "coordination list should return the inserted record");

    const projectList = await store.listProjects();
    assert(projectList.ok === true, "project list should succeed");
    assert(projectList.projects.length === 1, "project list should expose one registered project");
    assert(projectList.projects[0].project_id === "project-1", "project list should expose the registered project id");
    assert(projectList.projects[0].workspace_count === 1, "project list should expose workspace counts");

    const projectInspect = await store.inspectProject({
      projectId: "project-1",
    });
    assert(projectInspect.ok === true, "project inspect should succeed");
    assert(projectInspect.project?.project_id === "project-1", "project inspect should expose the requested project");
    assert(projectInspect.workspaces.length === 1, "project inspect should expose registered workspaces");
    assert(projectInspect.workspaces[0].workspace_id === "workspace-1", "project inspect should expose workspace details");

    const health = await store.healthcheck();
    assert(health.ok === true, "healthcheck should succeed");
    assert(health.schema_status === "ready", "healthcheck should expose ready schema status");
    assert(health.latest_applied_schema_version === 2, "healthcheck should expose latest schema version");
    assert(health.registered_project_count === 1, "healthcheck should expose registered project count");
    assert(health.compatibility_status === "project-scoped", "healthcheck should expose project-scoped compatibility when no legacy rows remain");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

await main();
