#!/usr/bin/env node
import os from "node:os";
import path from "node:path";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sanitizeError(error, connectionString) {
  let message = String(error?.message ?? error ?? "unknown error");
  if (connectionString) {
    message = message.replaceAll(connectionString, "[redacted]");
  }
  return message.replace(/\bpostgres(?:ql)?:\/\/[^\s]+/gi, "[redacted]");
}

function createSyntheticScope() {
  const stamp = `${Date.now()}-${process.pid}`;
  return {
    projectId: `project-smoke-${stamp}`,
    workspaceId: `workspace-smoke-${stamp}`,
    worktreeIds: [`worktree-smoke-a-${stamp}`, `worktree-smoke-b-${stamp}`],
    planningKey: `session:smoke-${stamp}`,
    relayIds: [`handoff:${stamp}:a`, `handoff:${stamp}:b`],
    recordIds: [`coord:${stamp}:a`, `coord:${stamp}:b`],
  };
}

async function cleanupSyntheticScope(connectionString, scope) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  const deleted = {};
  try {
    await client.connect();
    await client.query("BEGIN");
    const statements = [
      [
        "coordination_records",
        `DELETE FROM aidn_shared.coordination_records
         WHERE project_id = $1 AND workspace_id = $2 AND record_id = ANY($3::text[])`,
        [scope.projectId, scope.workspaceId, scope.recordIds],
      ],
      [
        "handoff_relays",
        `DELETE FROM aidn_shared.handoff_relays
         WHERE project_id = $1 AND workspace_id = $2 AND relay_id = ANY($3::text[])`,
        [scope.projectId, scope.workspaceId, scope.relayIds],
      ],
      [
        "planning_states",
        `DELETE FROM aidn_shared.planning_states
         WHERE project_id = $1 AND workspace_id = $2 AND planning_key = $3`,
        [scope.projectId, scope.workspaceId, scope.planningKey],
      ],
      [
        "worktree_registry",
        `DELETE FROM aidn_shared.worktree_registry
         WHERE project_id = $1 AND workspace_id = $2 AND worktree_id = ANY($3::text[])`,
        [scope.projectId, scope.workspaceId, scope.worktreeIds],
      ],
      [
        "workspace_registry",
        `DELETE FROM aidn_shared.workspace_registry
         WHERE project_id = $1 AND workspace_id = $2`,
        [scope.projectId, scope.workspaceId],
      ],
      [
        "project_registry",
        `DELETE FROM aidn_shared.project_registry AS project
         WHERE project.project_id = $1
           AND NOT EXISTS (
             SELECT 1
             FROM aidn_shared.workspace_registry AS workspace
             WHERE workspace.project_id = project.project_id
           )`,
        [scope.projectId],
      ],
    ];
    for (const [name, sql, values] of statements) {
      const result = await client.query(sql, values);
      deleted[name] = Number(result.rowCount ?? 0);
    }
    await client.query("COMMIT");

    const verification = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM aidn_shared.project_registry WHERE project_id = $1) AS projects,
         (SELECT COUNT(*)::int FROM aidn_shared.workspace_registry WHERE project_id = $1 AND workspace_id = $2) AS workspaces,
         (SELECT COUNT(*)::int FROM aidn_shared.worktree_registry WHERE project_id = $1 AND workspace_id = $2) AS worktrees,
         (SELECT COUNT(*)::int FROM aidn_shared.planning_states WHERE project_id = $1 AND workspace_id = $2) AS planning,
         (SELECT COUNT(*)::int FROM aidn_shared.handoff_relays WHERE project_id = $1 AND workspace_id = $2) AS relays,
         (SELECT COUNT(*)::int FROM aidn_shared.coordination_records WHERE project_id = $1 AND workspace_id = $2) AS coordination`,
      [scope.projectId, scope.workspaceId],
    );
    const remaining = verification.rows[0] ?? {};
    const remainingCounts = Object.fromEntries(
      Object.entries(remaining).map(([key, value]) => [key, Number(value)]),
    );
    assert(
      Object.values(remainingCounts).every((value) => value === 0),
      `synthetic PostgreSQL cleanup left rows: ${JSON.stringify(remainingCounts)}`,
    );
    return {
      ok: true,
      deleted,
      remaining: remainingCounts,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
    }
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

async function runSmoke(connectionString, scope) {
  const { createPostgresSharedCoordinationStore } = await import(
    "../../src/adapters/runtime/postgres-shared-coordination-store.mjs"
  );
  const [worktreeIdA, worktreeIdB] = scope.worktreeIds;
  const [relayIdA, relayIdB] = scope.relayIds;
  const [recordIdA, recordIdB] = scope.recordIds;
  const worktreeRootBase = path.join(os.tmpdir(), "aidn-pg-smoke");
  const storeA = createPostgresSharedCoordinationStore({ connectionString });
  const storeB = createPostgresSharedCoordinationStore({ connectionString });

  const bootstrapA = await storeA.bootstrap();
  const bootstrapB = await storeB.bootstrap();
  assert(bootstrapA.ok === true, "live bootstrap A should succeed");
  assert(bootstrapB.ok === true, "live bootstrap B should succeed");

  const workspaceRegistration = await storeA.registerWorkspace({
    projectId: scope.projectId,
    projectIdSource: "explicit-smoke",
    workspaceId: scope.workspaceId,
    workspaceIdSource: "explicit-smoke",
    sharedBackendKind: "postgres",
  });
  assert(workspaceRegistration.ok === true, "live workspace registration should succeed");
  assert(
    workspaceRegistration.workspace?.project_id === scope.projectId,
    "live workspace registration should preserve the synthetic project id",
  );

  const worktreeRegistrations = await Promise.all([
    storeA.registerWorktreeHeartbeat({
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      worktreeId: worktreeIdA,
      worktreeRoot: path.join(worktreeRootBase, "a"),
      gitDir: path.join(worktreeRootBase, "a", ".git"),
      isLinkedWorktree: false,
    }),
    storeB.registerWorktreeHeartbeat({
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      worktreeId: worktreeIdB,
      worktreeRoot: path.join(worktreeRootBase, "b"),
      gitDir: path.join(worktreeRootBase, "b", ".git"),
      isLinkedWorktree: true,
    }),
  ]);
  assert(worktreeRegistrations.every((item) => item.ok === true), "live worktree heartbeats should succeed");

  const planningWrites = await Promise.all([
    storeA.upsertPlanningState({
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      planningKey: scope.planningKey,
      sessionId: "SMOKE",
      planningStatus: "promoted",
      planningArbitrationStatus: "review_requested",
      nextDispatchScope: "session",
      nextDispatchAction: "coordinate",
      backlogNextStep: "smoke-a",
      selectedExecutionScope: "same_cycle",
      dispatchReady: false,
      sourceWorktreeId: worktreeIdA,
      payload: { smoke: true, writer: "a" },
    }),
    storeB.upsertPlanningState({
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      planningKey: scope.planningKey,
      sessionId: "SMOKE",
      planningStatus: "promoted",
      planningArbitrationStatus: "resolved",
      nextDispatchScope: "cycle",
      nextDispatchAction: "implement",
      backlogNextStep: "smoke-b",
      selectedExecutionScope: "new_cycle",
      dispatchReady: true,
      sourceWorktreeId: worktreeIdB,
      payload: { smoke: true, writer: "b" },
    }),
  ]);
  assert(planningWrites.every((item) => item.ok === true), "live concurrent planning writes should succeed");

  const handoffWrites = await Promise.all([
    storeA.appendHandoffRelay({
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
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
      metadata: { smoke: true, writer: "a" },
    }),
    storeB.appendHandoffRelay({
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
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
      metadata: { smoke: true, writer: "b" },
    }),
  ]);
  assert(handoffWrites.every((item) => item.ok === true), "live concurrent handoff writes should succeed");

  const coordinationWrites = await Promise.all([
    storeA.appendCoordinationRecord({
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      recordId: recordIdA,
      recordType: "smoke",
      sessionId: "SMOKE",
      scopeType: "session",
      scopeId: "SMOKE",
      sourceWorktreeId: worktreeIdA,
      actorRole: "coordinator",
      actorAction: "coordinate",
      status: "dry_run",
      payload: { smoke: true, writer: "a" },
    }),
    storeB.appendCoordinationRecord({
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      recordId: recordIdB,
      recordType: "smoke",
      sessionId: "SMOKE",
      scopeType: "session",
      scopeId: "SMOKE",
      sourceWorktreeId: worktreeIdB,
      actorRole: "coordinator",
      actorAction: "coordinate",
      status: "ok",
      payload: { smoke: true, writer: "b" },
    }),
  ]);
  assert(coordinationWrites.every((item) => item.ok === true), "live concurrent coordination writes should succeed");

  if (process.env.AIDN_TEST_PG_SMOKE_FAIL_AFTER === "coordination-writes") {
    throw new Error("injected PostgreSQL smoke failure after coordination writes");
  }

  const planningRead = await storeA.getPlanningState({
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
    planningKey: scope.planningKey,
  });
  assert(planningRead.ok === true && planningRead.planning_state != null, "live planning read should succeed");
  assert(planningRead.planning_state.revision >= 1, "live planning revision should reflect overlapping writes");

  const latestHandoff = await storeA.getLatestHandoffRelay({
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
    sessionId: "SMOKE",
    scopeType: "session",
    scopeId: "SMOKE",
  });
  assert(latestHandoff.ok === true && latestHandoff.handoff_relay != null, "live latest handoff read should succeed");
  assert(scope.relayIds.includes(latestHandoff.handoff_relay.relay_id), "live latest handoff should match one concurrent relay");

  const coordinationList = await storeA.listCoordinationRecords({
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
    recordType: "smoke",
    limit: 5,
  });
  assert(coordinationList.ok === true && coordinationList.records.length >= 2, "live coordination list should include both concurrent writes");

  const health = await storeA.healthcheck();
  assert(health.ok === true, "live healthcheck should succeed");
  assert(health.schema_status === "ready", "live healthcheck should expose a ready shared schema");

  return {
    planning_revision: planningRead.planning_state.revision,
    latest_handoff_relay_matches_synthetic_scope: scope.relayIds.includes(
      latestHandoff.handoff_relay.relay_id,
    ),
    coordination_record_count: coordinationList.records.length,
    database_name: health.database_name,
    schema_name: health.schema_name,
    schema_status: health.schema_status,
    latest_schema_version: health.latest_applied_schema_version,
  };
}

async function main() {
  const connectionString = normalizeScalar(process.env.AIDN_PG_SMOKE_URL);
  if (!connectionString) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: "AIDN_PG_SMOKE_URL is not set",
    }, null, 2));
    return;
  }

  const scope = createSyntheticScope();
  let result = null;
  let primaryError = null;
  let cleanup = null;
  let cleanupError = null;
  try {
    result = await runSmoke(connectionString, scope);
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      cleanup = await cleanupSyntheticScope(connectionString, scope);
    } catch (error) {
      cleanupError = error;
    }
  }

  if (primaryError || cleanupError || cleanup?.ok !== true) {
    console.error(JSON.stringify({
      ok: false,
      skipped: false,
      status: "FAIL",
      error: primaryError ? sanitizeError(primaryError, connectionString) : null,
      cleanup_error: cleanupError ? sanitizeError(cleanupError, connectionString) : null,
      cleanup,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    skipped: false,
    status: "PASS",
    synthetic_scope: true,
    ...result,
    cleanup,
  }, null, 2));
}

await main();
