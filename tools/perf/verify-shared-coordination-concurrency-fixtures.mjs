#!/usr/bin/env node
import { createPostgresSharedCoordinationStore } from "../../src/adapters/runtime/postgres-shared-coordination-store.mjs";
import { createConcurrentFakePgClientFactory } from "./shared-coordination-fake-pg-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  try {
    const fake = createConcurrentFakePgClientFactory();
    const storeA = createPostgresSharedCoordinationStore({
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: fake.factory,
    });
    const storeB = createPostgresSharedCoordinationStore({
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: fake.factory,
    });

    assert((await storeA.bootstrap()).ok === true, "bootstrap A should succeed");
    assert((await storeB.bootstrap()).ok === true, "bootstrap B should succeed");
    assert((await storeA.registerWorkspace({
      workspaceId: "workspace-concurrent",
      workspaceIdSource: "git-common-dir",
      sharedBackendKind: "postgres",
    })).ok === true, "workspace registration should succeed");

    const worktreeRegistrations = await Promise.all([
      storeA.registerWorktreeHeartbeat({
        workspaceId: "workspace-concurrent",
        worktreeId: "worktree-1",
        worktreeRoot: "/tmp/worktree-1",
        gitDir: "/tmp/worktree-1/.git",
        isLinkedWorktree: true,
      }),
      storeB.registerWorktreeHeartbeat({
        workspaceId: "workspace-concurrent",
        worktreeId: "worktree-2",
        worktreeRoot: "/tmp/worktree-2",
        gitDir: "/tmp/worktree-2/.git",
        isLinkedWorktree: true,
      }),
    ]);
    assert(worktreeRegistrations.every((item) => item.ok === true), "both worktree registrations should succeed");

    const planningWrites = await Promise.all([
      storeA.upsertPlanningState({
        workspaceId: "workspace-concurrent",
        planningKey: "session:S900",
        sessionId: "S900",
        backlogArtifactRef: "docs/audit/backlog/BL-S900-A.md",
        planningStatus: "promoted",
        planningArbitrationStatus: "review_requested",
        nextDispatchScope: "session",
        nextDispatchAction: "coordinate",
        backlogNextStep: "plan from worktree 1",
        selectedExecutionScope: "same_cycle",
        dispatchReady: false,
        sourceWorktreeId: "worktree-1",
        payload: {
          writer: "worktree-1",
        },
      }),
      storeB.upsertPlanningState({
        workspaceId: "workspace-concurrent",
        planningKey: "session:S900",
        sessionId: "S900",
        backlogArtifactRef: "docs/audit/backlog/BL-S900-B.md",
        planningStatus: "promoted",
        planningArbitrationStatus: "resolved",
        nextDispatchScope: "cycle",
        nextDispatchAction: "implement",
        backlogNextStep: "plan from worktree 2",
        selectedExecutionScope: "new_cycle",
        dispatchReady: true,
        sourceWorktreeId: "worktree-2",
        payload: {
          writer: "worktree-2",
        },
      }),
    ]);
    assert(planningWrites.every((item) => item.ok === true), "both planning writes should succeed");
    const planningRead = await storeA.getPlanningState({
      workspaceId: "workspace-concurrent",
      planningKey: "session:S900",
    });
    assert(planningRead.ok === true, "planning read should succeed after concurrent writes");
    assert(planningRead.planning_state.revision === 1, "planning revision should increment after two concurrent writers");
    assert(["worktree-1", "worktree-2"].includes(planningRead.planning_state.source_worktree_id), "planning state should track one of the concurrent writers");
    assert(["plan from worktree 1", "plan from worktree 2"].includes(planningRead.planning_state.backlog_next_step), "planning state should reflect a valid concurrent write");

    const handoffWrites = await Promise.all([
      storeA.appendHandoffRelay({
        workspaceId: "workspace-concurrent",
        relayId: "handoff:1",
        sessionId: "S900",
        cycleId: "C900",
        scopeType: "cycle",
        scopeId: "C900",
        sourceWorktreeId: "worktree-1",
        handoffStatus: "ready",
        fromAgentRole: "coordinator",
        fromAgentAction: "relay",
        recommendedNextAgentRole: "auditor",
        recommendedNextAgentAction: "audit",
        metadata: {
          writer: "worktree-1",
        },
      }),
      storeB.appendHandoffRelay({
        workspaceId: "workspace-concurrent",
        relayId: "handoff:2",
        sessionId: "S900",
        cycleId: "C900",
        scopeType: "cycle",
        scopeId: "C900",
        sourceWorktreeId: "worktree-2",
        handoffStatus: "ready",
        fromAgentRole: "coordinator",
        fromAgentAction: "relay",
        recommendedNextAgentRole: "executor",
        recommendedNextAgentAction: "implement",
        metadata: {
          writer: "worktree-2",
        },
      }),
    ]);
    assert(handoffWrites.every((item) => item.ok === true), "both handoff writes should succeed");
    const latestHandoff = await storeA.getLatestHandoffRelay({
      workspaceId: "workspace-concurrent",
      sessionId: "S900",
      scopeType: "cycle",
      scopeId: "C900",
    });
    assert(latestHandoff.ok === true, "latest handoff read should succeed");
    assert(latestHandoff.handoff_relay.relay_id === "handoff:2", "latest handoff should expose the deterministically latest concurrent relay");

    const coordinationWrites = await Promise.all([
      storeA.appendCoordinationRecord({
        workspaceId: "workspace-concurrent",
        recordId: "coord:1",
        recordType: "coordinator_dispatch",
        sessionId: "S900",
        cycleId: "C900",
        scopeType: "cycle",
        scopeId: "C900",
        sourceWorktreeId: "worktree-1",
        actorRole: "coordinator",
        actorAction: "coordinate",
        status: "dry_run",
        payload: {
          writer: "worktree-1",
        },
      }),
      storeB.appendCoordinationRecord({
        workspaceId: "workspace-concurrent",
        recordId: "coord:2",
        recordType: "coordinator_dispatch",
        sessionId: "S900",
        cycleId: "C900",
        scopeType: "cycle",
        scopeId: "C900",
        sourceWorktreeId: "worktree-2",
        actorRole: "coordinator",
        actorAction: "coordinate",
        status: "executed",
        payload: {
          writer: "worktree-2",
        },
      }),
    ]);
    assert(coordinationWrites.every((item) => item.ok === true), "both coordination writes should succeed");
    const coordinationList = await storeA.listCoordinationRecords({
      workspaceId: "workspace-concurrent",
      recordType: "coordinator_dispatch",
      sessionId: "S900",
      scopeType: "cycle",
      scopeId: "C900",
      limit: 5,
    });
    assert(coordinationList.ok === true, "coordination list should succeed after concurrent writes");
    assert(coordinationList.records.length === 2, "coordination list should keep both concurrent records");
    assert(new Set(coordinationList.records.map((item) => item.source_worktree_id)).size === 2, "coordination list should preserve both writer identities");

    const health = await storeA.healthcheck();
    assert(health.ok === true, "healthcheck should still succeed after concurrent writes");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

await main();
