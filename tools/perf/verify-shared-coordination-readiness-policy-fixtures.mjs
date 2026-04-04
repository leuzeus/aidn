#!/usr/bin/env node
import {
  appendSharedHandoffRelay,
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
} = {}) {
  const state = {
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
    assert(ready.state.workspaceRegistrations === 1, "ready backend should register workspace once");
    assert(ready.state.planningWrites === 1, "ready backend should perform planning write");

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
    assert(versionBehind.state.workspaceRegistrations === 0, "version-behind backend should not register workspace");
    assert(versionBehind.state.planningWrites === 0, "version-behind backend should not write planning state");

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
    assert(legacyOnly.state.handoffWrites === 0, "legacy-only backend should not append handoff relay");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

await main();
