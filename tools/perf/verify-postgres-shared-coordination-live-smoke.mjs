#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { createPostgresSharedCoordinationStore } from "../../src/adapters/runtime/postgres-shared-coordination-store.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  try {
    const connectionString = normalizeScalar(process.env.AIDN_PG_SMOKE_URL);
    if (!connectionString) {
      console.log(JSON.stringify({
        ok: true,
        skipped: true,
        reason: "AIDN_PG_SMOKE_URL is not set",
      }, null, 2));
      return;
    }

    const stamp = Date.now();
    const workspaceId = `workspace-smoke-${stamp}`;
    const worktreeIdA = `worktree-smoke-a-${stamp}`;
    const worktreeIdB = `worktree-smoke-b-${stamp}`;
    const planningKey = `session:smoke-${stamp}`;
    const relayIdA = `handoff:${stamp}:a`;
    const relayIdB = `handoff:${stamp}:b`;
    const recordIdA = `coord:${stamp}:a`;
    const recordIdB = `coord:${stamp}:b`;
    const worktreeRootBase = path.join(os.tmpdir(), "aidn-pg-smoke");
    const storeA = createPostgresSharedCoordinationStore({
      connectionString,
    });
    const storeB = createPostgresSharedCoordinationStore({
      connectionString,
    });

    const bootstrapA = await storeA.bootstrap();
    const bootstrapB = await storeB.bootstrap();
    assert(bootstrapA.ok === true, "live bootstrap A should succeed");
    assert(bootstrapB.ok === true, "live bootstrap B should succeed");

    const workspaceRegistration = await storeA.registerWorkspace({
      workspaceId,
      workspaceIdSource: "explicit",
      sharedBackendKind: "postgres",
    });
    assert(workspaceRegistration.ok === true, "live workspace registration should succeed");

    const worktreeRegistrations = await Promise.all([
      storeA.registerWorktreeHeartbeat({
        workspaceId,
        worktreeId: worktreeIdA,
        worktreeRoot: path.join(worktreeRootBase, "a"),
        gitDir: path.join(worktreeRootBase, "a", ".git"),
        isLinkedWorktree: false,
      }),
      storeB.registerWorktreeHeartbeat({
        workspaceId,
        worktreeId: worktreeIdB,
        worktreeRoot: path.join(worktreeRootBase, "b"),
        gitDir: path.join(worktreeRootBase, "b", ".git"),
        isLinkedWorktree: true,
      }),
    ]);
    assert(worktreeRegistrations.every((item) => item.ok === true), "live worktree heartbeats should succeed");

    const planningWrites = await Promise.all([
      storeA.upsertPlanningState({
        workspaceId,
        planningKey,
        sessionId: "SMOKE",
        planningStatus: "promoted",
        planningArbitrationStatus: "review_requested",
        nextDispatchScope: "session",
        nextDispatchAction: "coordinate",
        backlogNextStep: "smoke-a",
        selectedExecutionScope: "same_cycle",
        dispatchReady: false,
        sourceWorktreeId: worktreeIdA,
        payload: {
          smoke: true,
          writer: "a",
        },
      }),
      storeB.upsertPlanningState({
        workspaceId,
        planningKey,
        sessionId: "SMOKE",
        planningStatus: "promoted",
        planningArbitrationStatus: "resolved",
        nextDispatchScope: "cycle",
        nextDispatchAction: "implement",
        backlogNextStep: "smoke-b",
        selectedExecutionScope: "new_cycle",
        dispatchReady: true,
        sourceWorktreeId: worktreeIdB,
        payload: {
          smoke: true,
          writer: "b",
        },
      }),
    ]);
    assert(planningWrites.every((item) => item.ok === true), "live concurrent planning writes should succeed");

    const handoffWrites = await Promise.all([
      storeA.appendHandoffRelay({
        workspaceId,
        relayId: relayIdA,
        sessionId: "SMOKE",
        scopeType: "session",
        scopeId: "SMOKE",
        sourceWorktreeId: worktreeIdA,
        handoffStatus: "ready",
        fromAgentRole: "coordinator",
        fromAgentAction: "relay",
        recommendedNextAgentRole: "auditor",
        recommendedNextAgentAction: "audit",
        metadata: {
          smoke: true,
          writer: "a",
        },
      }),
      storeB.appendHandoffRelay({
        workspaceId,
        relayId: relayIdB,
        sessionId: "SMOKE",
        scopeType: "session",
        scopeId: "SMOKE",
        sourceWorktreeId: worktreeIdB,
        handoffStatus: "ready",
        fromAgentRole: "coordinator",
        fromAgentAction: "relay",
        recommendedNextAgentRole: "executor",
        recommendedNextAgentAction: "implement",
        metadata: {
          smoke: true,
          writer: "b",
        },
      }),
    ]);
    assert(handoffWrites.every((item) => item.ok === true), "live concurrent handoff writes should succeed");

    const coordinationWrites = await Promise.all([
      storeA.appendCoordinationRecord({
        workspaceId,
        recordId: recordIdA,
        recordType: "smoke",
        sessionId: "SMOKE",
        scopeType: "session",
        scopeId: "SMOKE",
        sourceWorktreeId: worktreeIdA,
        actorRole: "coordinator",
        actorAction: "coordinate",
        status: "dry_run",
        payload: {
          smoke: true,
          writer: "a",
        },
      }),
      storeB.appendCoordinationRecord({
        workspaceId,
        recordId: recordIdB,
        recordType: "smoke",
        sessionId: "SMOKE",
        scopeType: "session",
        scopeId: "SMOKE",
        sourceWorktreeId: worktreeIdB,
        actorRole: "coordinator",
        actorAction: "coordinate",
        status: "ok",
        payload: {
          smoke: true,
          writer: "b",
        },
      }),
    ]);
    assert(coordinationWrites.every((item) => item.ok === true), "live concurrent coordination writes should succeed");

    const planningRead = await storeA.getPlanningState({
      workspaceId,
      planningKey,
    });
    assert(planningRead.ok === true && planningRead.planning_state != null, "live planning read should succeed");
    assert(planningRead.planning_state.revision >= 1, "live planning revision should reflect overlapping writes");

    const latestHandoff = await storeA.getLatestHandoffRelay({
      workspaceId,
      sessionId: "SMOKE",
      scopeType: "session",
      scopeId: "SMOKE",
    });
    assert(latestHandoff.ok === true && latestHandoff.handoff_relay != null, "live latest handoff read should succeed");
    assert([relayIdA, relayIdB].includes(latestHandoff.handoff_relay.relay_id), "live latest handoff should match one concurrent relay");

    const coordinationList = await storeA.listCoordinationRecords({
      workspaceId,
      recordType: "smoke",
      limit: 5,
    });
    assert(coordinationList.ok === true && coordinationList.records.length >= 2, "live coordination list should include both concurrent writes");

    const health = await storeA.healthcheck();
    assert(health.ok === true, "live healthcheck should succeed");
    assert(health.schema_status === "ready", "live healthcheck should expose a ready shared schema");

    console.log(JSON.stringify({
      ok: true,
      skipped: false,
      workspace_id: workspaceId,
      worktree_ids: [worktreeIdA, worktreeIdB],
      planning_key: planningKey,
      relay_ids: [relayIdA, relayIdB],
      record_ids: [recordIdA, recordIdB],
      planning_revision: planningRead.planning_state.revision,
      latest_handoff_relay_id: latestHandoff.handoff_relay.relay_id,
      coordination_record_count: coordinationList.records.length,
      database_name: health.database_name,
      schema_name: health.schema_name,
      schema_status: health.schema_status,
      latest_schema_version: health.latest_applied_schema_version,
    }, null, 2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

await main();
