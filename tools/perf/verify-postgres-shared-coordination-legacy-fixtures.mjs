#!/usr/bin/env node
import { createPostgresSharedCoordinationStore } from "../../src/adapters/runtime/postgres-shared-coordination-store.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createLegacyFakePgClientFactory() {
  const state = {
    workspaceRegistry: [
      {
        workspace_id: "workspace-alpha",
        workspace_id_source: "git-common-dir",
        locator_ref: ".aidn/project/shared-runtime.locator.json",
        git_common_dir: "/tmp/alpha/.git",
        repo_root: "/tmp/alpha",
        shared_backend_kind: "postgres",
        updated_at: "2026-04-03T09:00:00Z",
      },
      {
        workspace_id: "workspace-beta",
        workspace_id_source: "git-common-dir",
        locator_ref: ".aidn/project/shared-runtime.locator.json",
        git_common_dir: "/tmp/beta/.git",
        repo_root: "/tmp/beta",
        shared_backend_kind: "postgres",
        updated_at: "2026-04-03T09:05:00Z",
      },
    ],
    worktreeRegistry: [
      { workspace_id: "workspace-alpha" },
      { workspace_id: "workspace-alpha" },
      { workspace_id: "workspace-beta" },
    ],
    planningStates: [
      { workspace_id: "workspace-alpha" },
      { workspace_id: "workspace-beta" },
    ],
    handoffRelays: [
      { workspace_id: "workspace-alpha" },
      { workspace_id: "workspace-alpha" },
      { workspace_id: "workspace-beta" },
    ],
    coordinationRecords: [
      { workspace_id: "workspace-alpha" },
      { workspace_id: "workspace-beta" },
      { workspace_id: "workspace-beta" },
    ],
    schemaMigrations: [1],
  };

  function buildLegacyProjectRows(workspaceId = "") {
    return state.workspaceRegistry
      .filter((row) => !workspaceId || row.workspace_id === workspaceId)
      .sort((left, right) => String(left.workspace_id).localeCompare(String(right.workspace_id)))
      .map((row) => ({
        project_id: row.workspace_id,
        project_id_source: "legacy-workspace",
        project_root_ref: row.repo_root,
        locator_ref: row.locator_ref,
        shared_backend_kind: row.shared_backend_kind,
        updated_at: row.updated_at,
        workspace_count: 1,
        worktree_count: state.worktreeRegistry.filter((item) => item.workspace_id === row.workspace_id).length,
        planning_state_count: state.planningStates.filter((item) => item.workspace_id === row.workspace_id).length,
        handoff_relay_count: state.handoffRelays.filter((item) => item.workspace_id === row.workspace_id).length,
        coordination_record_count: state.coordinationRecords.filter((item) => item.workspace_id === row.workspace_id).length,
      }));
  }

  return {
    factory() {
      return {
        async connect() {},
        async end() {},
        async query(text, values = []) {
          const sql = String(text).trim();
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
          if (sql.includes("SELECT COUNT(*)::int AS legacy_workspace_rows FROM aidn_shared.workspace_registry WHERE project_id IS NULL OR project_id = ''")) {
            const error = new Error("column project_id does not exist");
            error.code = "42703";
            throw error;
          }
          if (sql.includes("SELECT COUNT(*)::int AS legacy_workspace_rows FROM aidn_shared.workspace_registry")) {
            return {
              rows: [{ legacy_workspace_rows: state.workspaceRegistry.length }],
            };
          }
          if (sql.includes("FROM aidn_shared.project_registry")) {
            const error = new Error("relation aidn_shared.project_registry does not exist");
            error.code = "42P01";
            throw error;
          }
          if (sql.includes("FROM aidn_shared.workspace_registry wr") && sql.includes("workspace_id_source")) {
            const rows = state.workspaceRegistry
              .filter((row) => row.workspace_id === values[0])
              .map((row) => ({
                project_id: row.workspace_id,
                project_id_source: "legacy-workspace",
                project_root_ref: row.repo_root,
                workspace_id: row.workspace_id,
                workspace_id_source: row.workspace_id_source,
                locator_ref: row.locator_ref,
                git_common_dir: row.git_common_dir,
                repo_root: row.repo_root,
                shared_backend_kind: row.shared_backend_kind,
                updated_at: row.updated_at,
              }));
            return { rows };
          }
          if (sql.includes("FROM aidn_shared.workspace_registry wr") && sql.includes("workspace_id AS project_id")) {
            const rows = buildLegacyProjectRows(String(values[0] ?? "").trim());
            return { rows: sql.includes("LIMIT 1") ? rows.slice(0, 1) : rows };
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
          throw new Error(`Unhandled legacy fake pg query: ${sql}`);
        },
      };
    },
  };
}

async function main() {
  try {
    const fake = createLegacyFakePgClientFactory();
    const store = createPostgresSharedCoordinationStore({
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: fake.factory,
      workspace: {
        project_id: "workspace-alpha",
        workspace_id: "workspace-alpha",
      },
    });

    const projectList = await store.listProjects();
    assert(projectList.ok === true, "legacy project list should succeed");
    assert(projectList.projects.length === 2, "legacy project list should infer one project per workspace");
    assert(projectList.projects[0].project_id === "workspace-alpha", "legacy project list should infer project id from workspace id");

    const projectInspect = await store.inspectProject({
      projectId: "workspace-beta",
    });
    assert(projectInspect.ok === true, "legacy project inspect should succeed");
    assert(projectInspect.project?.project_id === "workspace-beta", "legacy project inspect should infer the requested workspace as project id");
    assert(projectInspect.workspaces.length === 1, "legacy project inspect should expose exactly one workspace");
    assert(projectInspect.workspaces[0].workspace_id === "workspace-beta", "legacy project inspect should expose the legacy workspace row");

    const health = await store.healthcheck();
    assert(health.ok === true, "legacy healthcheck should succeed");
    assert(health.schema_status === "schema-drift", "legacy healthcheck should expose schema drift before migration");
    assert(health.compatibility_status === "legacy-workspace-only", "legacy healthcheck should expose legacy compatibility status");
    assert(health.legacy_workspace_rows === 2, "legacy healthcheck should count all legacy workspace rows");
    assert(health.registered_project_count === 2, "legacy healthcheck should infer project count from legacy workspace rows");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

await main();
