#!/usr/bin/env node
import {
  appendSharedHandoffRelay,
  ensureSharedCoordinationReady,
  readLatestSharedHandoffRelay,
  readSharedCoordinationRecords,
  readSharedPlanningState,
  syncSharedPlanningState,
} from "../../src/application/runtime/shared-coordination-store-service.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createFakeResolution({
  schemaStatus = "ready",
  schemaOk = true,
  compatibilityStatus = "project-scoped",
  healthDetails = {},
} = {}) {
  const state = {
    bootstraps: 0,
    workspaceRegistrations: 0,
    worktreeRegistrations: 0,
    planningWrites: 0,
    handoffWrites: 0,
    planningReads: 0,
  };
  return {
    resolution: {
      enabled: true,
      configured: true,
      backend_kind: "postgres",
      status: "ready",
      reason: "fake policy store",
      workspace: {
        project_id: "project-policy",
        workspace_id: "workspace-policy",
        worktree_id: "worktree-policy",
        project_id_source: "locator",
        workspace_id_source: "locator",
        project_root: "/tmp/project-policy",
        shared_runtime_locator_ref: ".aidn/project/shared-runtime.locator.json",
        git_common_dir: "/tmp/project-policy/.git",
        repo_root: "/tmp/project-policy",
        worktree_root: "/tmp/project-policy",
        git_dir: "/tmp/project-policy/.git",
        is_linked_worktree: false,
      },
      store: {
        async bootstrap() {
          state.bootstraps += 1;
          return {
            ok: true,
          };
        },
        async healthcheck() {
          return {
            ok: true,
            schema_status: schemaStatus,
            schema_ok: schemaOk,
            compatibility_status: compatibilityStatus,
            ...healthDetails,
          };
        },
        async registerWorkspace(input) {
          state.workspaceRegistrations += 1;
          return {
            ok: true,
            workspace: input,
          };
        },
        async registerWorktreeHeartbeat(input) {
          state.worktreeRegistrations += 1;
          return {
            ok: true,
            worktree: input,
          };
        },
        async upsertPlanningState(input) {
          state.planningWrites += 1;
          return {
            ok: true,
            planning_state: input,
          };
        },
        async appendHandoffRelay(input) {
          state.handoffWrites += 1;
          return {
            ok: true,
            handoff_relay: input,
          };
        },
        async getPlanningState() {
          state.planningReads += 1;
          return {
            ok: true,
            planning_state: {
              planning_key: "session:S900",
            },
          };
        },
        async getLatestHandoffRelay() { return { ok: true, handoff_relay: null }; },
        async listCoordinationRecords() { return { ok: true, records: [] }; },
      },
    },
    state,
  };
}

async function main() {
  try {
    const ready = createFakeResolution();
    const readyPlanningWrite = await syncSharedPlanningState(ready.resolution, {
      workspace: ready.resolution.workspace,
      planningKey: "session:S900",
      payload: {
        session_id: "S900",
        planning_status: "promoted",
      },
    });
    assert(readyPlanningWrite.ok === true, "ready backend should allow planning sync");
    assert(readyPlanningWrite.governance?.artifact_family === "planning_state", "ready backend should expose planning governance on write");
    assert(ready.state.workspaceRegistrations === 1, "ready backend should register workspace once");
    assert(ready.state.planningWrites === 1, "ready backend should perform planning write");
    assert(ready.state.bootstraps === 0, "normal planning sync must not invoke bootstrap");

    const reads = createFakeResolution();
    assert((await ensureSharedCoordinationReady(reads.resolution)).ok, "ready healthcheck should be sufficient");
    assert((await readSharedPlanningState(reads.resolution, { planningKey: "session:S900" })).ok, "ready planning read should succeed");
    assert((await readLatestSharedHandoffRelay(reads.resolution)).ok, "ready handoff read should succeed");
    assert((await readSharedCoordinationRecords(reads.resolution)).ok, "ready coordination read should succeed");
    assert(reads.state.bootstraps === 0, "readiness and reads must never bootstrap DDL");
    assert(reads.state.workspaceRegistrations === 0 && reads.state.worktreeRegistrations === 0, "reads must never register or heartbeat");
    assert(reads.state.planningWrites === 0 && reads.state.handoffWrites === 0, "reads must never mutate shared records");

    const v2Health = {
      latest_applied_schema_version: 2, expected_schema_version: 5, legacy_workspace_rows: 0,
      tables_present: ["schema_migrations", "project_registry", "workspace_registry", "worktree_registry", "planning_states", "handoff_relays", "coordination_records"],
      tables_missing: ["execution_runs", "execution_tasks", "execution_attempts", "execution_events", "execution_supervisors", "execution_acceptances", "execution_integrations", "execution_run_validations", "execution_integration_intents"],
    };
    const v2 = createFakeResolution({ schemaStatus: "version-behind", schemaOk: false, compatibilityStatus: "schema-not-ready", healthDetails: v2Health });
    const v2Read = await readSharedPlanningState(v2.resolution, { planningKey: "session:S900" });
    assert(v2Read.ok && v2Read.registration.status === "ready-read-only", "intact v2 must remain readable for pre-migration backup");
    assert(!(await syncSharedPlanningState(v2.resolution, { planningKey: "session:S900" })).ok, "read-compatible v2 must still refuse ordinary writes");
    assert(v2.state.bootstraps === 0 && v2.state.workspaceRegistrations === 0, "v2 compatible reads never migrate or register");
    const v3 = createFakeResolution({ schemaStatus: "version-behind", schemaOk: false, compatibilityStatus: "schema-not-ready", healthDetails: {
      ...v2Health, latest_applied_schema_version: 3,
      tables_present: [...v2Health.tables_present,"execution_runs","execution_tasks","execution_attempts","execution_events"],
      tables_missing: ["execution_supervisors","execution_acceptances","execution_integrations","execution_run_validations","execution_integration_intents"],
    } });
    assert((await readSharedPlanningState(v3.resolution, { planningKey: "session:S900" })).ok, "intact v3 remains readable before explicit v5 migration");
    assert(!(await syncSharedPlanningState(v3.resolution, { planningKey: "session:S900" })).ok, "v3 compatibility must not permit implicit migration or writes");
    assert(v3.state.bootstraps === 0 && v3.state.workspaceRegistrations === 0, "v3 historical read remains effect free");
    const v4=createFakeResolution({schemaStatus:"version-behind",schemaOk:false,compatibilityStatus:"schema-not-ready",healthDetails:{
      ...v2Health,latest_applied_schema_version:4,tables_present:[...v2Health.tables_present,...v2Health.tables_missing.filter(table=>table!=="execution_integration_intents")],tables_missing:["execution_integration_intents"],
    }});
    assert((await readSharedPlanningState(v4.resolution)).ok,"intact v4 remains readable before explicit v5 migration");
    assert(!(await syncSharedPlanningState(v4.resolution)).ok && v4.state.bootstraps===0,"v4 reads never authorize implicit migration or writes");
    for (const healthDetails of [
      { ...v2Health, latest_applied_schema_version: 5 },
      { ...v2Health, legacy_workspace_rows: 1 },
      { ...v2Health, tables_present: v2Health.tables_present.filter(table => table !== "planning_states") },
      { ...v2Health, tables_missing: ["planning_states"] },
    ]) {
      const invalid = createFakeResolution({ schemaStatus: "version-behind", schemaOk: false, healthDetails });
      assert(!(await readSharedPlanningState(invalid.resolution)).ok, "v2 compatibility must refuse future, mixed or incomplete schemas");
      assert(invalid.state.planningReads === 0, "refused compatibility must not read planning records");
    }

    const versionBehind = createFakeResolution({
      schemaStatus: "version-behind",
      schemaOk: false,
      compatibilityStatus: "schema-not-ready",
    });
    const blockedPlanningWrite = await syncSharedPlanningState(versionBehind.resolution, {
      workspace: versionBehind.resolution.workspace,
      planningKey: "session:S900",
      payload: {
        session_id: "S900",
      },
    });
    assert(blockedPlanningWrite.ok === false, "version-behind backend should block planning sync");
    assert(blockedPlanningWrite.status === "schema-not-ready", "version-behind backend should expose schema-not-ready status");
    assert(blockedPlanningWrite.diagnostic?.recommended_action?.includes("shared-coordination-migrate --dry-run"), "version-behind backend should expose upgrade guidance in sync diagnostic");
    assert(versionBehind.state.workspaceRegistrations === 0, "version-behind backend should not register workspace");
    assert(versionBehind.state.planningWrites === 0, "version-behind backend should not write planning state");
    assert(versionBehind.state.bootstraps === 0, "normal sync must not upgrade a behind schema implicitly");

    const mixedState = createFakeResolution({
      schemaStatus: "ready",
      schemaOk: false,
      compatibilityStatus: "mixed-legacy-v2",
    });
    const blockedPlanningRead = await readSharedPlanningState(mixedState.resolution, {
      workspace: mixedState.resolution.workspace,
      planningKey: "session:S900",
    });
    assert(blockedPlanningRead.ok === false, "mixed legacy/v2 backend should block planning read");
    assert(blockedPlanningRead.status === "compatibility-not-ready", "mixed legacy/v2 backend should expose compatibility-not-ready status");
    assert(mixedState.state.workspaceRegistrations === 0, "mixed legacy/v2 backend should not register workspace");
    assert(mixedState.state.planningReads === 0, "mixed legacy/v2 backend should not read planning state");

    const legacyOnly = createFakeResolution({
      schemaStatus: "ready",
      schemaOk: false,
      compatibilityStatus: "legacy-workspace-only",
    });
    const blockedHandoffWrite = await appendSharedHandoffRelay(legacyOnly.resolution, {
      workspace: legacyOnly.resolution.workspace,
      outputFile: "docs/audit/HANDOFF-PACKET.md",
      packetSha256: "policy",
      packet: {
        updated_at: "2030-01-01T00:00:00.000Z",
      },
    });
    assert(blockedHandoffWrite.ok === false, "legacy-only backend should block handoff sync");
    assert(blockedHandoffWrite.status === "compatibility-not-ready", "legacy-only backend should expose compatibility-not-ready status");
    assert(blockedHandoffWrite.diagnostic?.recommended_action?.includes("compatibility migration"), "legacy-only backend should expose compatibility guidance in sync diagnostic");
    assert(legacyOnly.state.handoffWrites === 0, "legacy-only backend should not append handoff relay");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

await main();
