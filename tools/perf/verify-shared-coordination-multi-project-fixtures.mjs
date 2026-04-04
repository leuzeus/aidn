#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import {
  appendSharedCoordinationRecord,
  appendSharedHandoffRelay,
  readLatestSharedHandoffRelay,
  readSharedCoordinationRecords,
  readSharedPlanningState,
  resolveSharedCoordinationStore,
  syncSharedPlanningState,
} from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { writeSharedRuntimeLocator } from "../../src/lib/config/shared-runtime-locator-config-lib.mjs";
import { createConcurrentFakePgClientFactory } from "./shared-coordination-fake-pg-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runGit(targetRoot, args) {
  const result = spawnSync("git", ["-C", targetRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return String(result.stdout ?? "").trim();
}

async function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-coordination-multi-project-"));
    const alphaRoot = path.join(tempRoot, "project-alpha");
    const betaRoot = path.join(tempRoot, "project-beta");
    const env = {
      AIDN_TEST_PG_URL: "postgres://aidn:test@localhost:5432/aidn",
    };

    for (const targetRoot of [alphaRoot, betaRoot]) {
      fs.mkdirSync(targetRoot, { recursive: true });
      runGit(targetRoot, ["init", "--initial-branch=main"]);
      runGit(targetRoot, ["config", "user.name", "aidn"]);
      runGit(targetRoot, ["config", "user.email", "aidn@example.test"]);
      fs.writeFileSync(path.join(targetRoot, "README.md"), `# ${path.basename(targetRoot)}\n`, "utf8");
      runGit(targetRoot, ["add", "README.md"]);
      runGit(targetRoot, ["commit", "-m", "initial"]);
    }

    writeSharedRuntimeLocator(alphaRoot, {
      enabled: true,
      projectId: "project-alpha",
      workspaceId: "workspace-shared",
      backend: {
        kind: "postgres",
        connectionRef: "env:AIDN_TEST_PG_URL",
      },
    });
    writeSharedRuntimeLocator(betaRoot, {
      enabled: true,
      projectId: "project-beta",
      workspaceId: "workspace-shared",
      backend: {
        kind: "postgres",
        connectionRef: "env:AIDN_TEST_PG_URL",
      },
    });

    const alphaWorkspace = resolveWorkspaceContext({
      targetRoot: alphaRoot,
      env,
    });
    const betaWorkspace = resolveWorkspaceContext({
      targetRoot: betaRoot,
      env,
    });
    const fake = createConcurrentFakePgClientFactory();
    const [alphaResolution, betaResolution] = await Promise.all([
      resolveSharedCoordinationStore({
        targetRoot: alphaRoot,
        workspace: alphaWorkspace,
        env,
        clientFactory: fake.factory,
      }),
      resolveSharedCoordinationStore({
        targetRoot: betaRoot,
        workspace: betaWorkspace,
        env,
        clientFactory: fake.factory,
      }),
    ]);

    const sharedPlanningKey = "session:S200";
    const sharedRecordId = "coord:shared";
    const sharedSessionId = "S200";
    const sharedCycleId = "C200";

    const alphaPlanning = await syncSharedPlanningState(alphaResolution, {
      workspace: alphaWorkspace,
      planningKey: sharedPlanningKey,
      backlogFile: "docs/audit/backlog/BL-alpha.md",
      backlogSha256: "alpha-sha",
      payload: {
        session_id: sharedSessionId,
        planning_status: "promoted",
        planning_arbitration_status: "resolved",
        next_dispatch_scope: "cycle",
        next_dispatch_action: "implement",
        backlog_next_step: "alpha-next-step",
        selected_execution_scope: "new_cycle",
        dispatch_ready: true,
        owner: "alpha",
      },
    });
    const betaPlanning = await syncSharedPlanningState(betaResolution, {
      workspace: betaWorkspace,
      planningKey: sharedPlanningKey,
      backlogFile: "docs/audit/backlog/BL-beta.md",
      backlogSha256: "beta-sha",
      payload: {
        session_id: sharedSessionId,
        planning_status: "promoted",
        planning_arbitration_status: "resolved",
        next_dispatch_scope: "cycle",
        next_dispatch_action: "implement",
        backlog_next_step: "beta-next-step",
        selected_execution_scope: "new_cycle",
        dispatch_ready: true,
        owner: "beta",
      },
    });
    assert(alphaPlanning.ok === true && betaPlanning.ok === true, "multi-project planning sync should succeed for both projects");

    const alphaHandoff = await appendSharedHandoffRelay(alphaResolution, {
      workspace: alphaWorkspace,
      outputFile: "docs/audit/HANDOFF-PACKET.md",
      packetSha256: "alpha-handoff",
      packet: {
        updated_at: "2030-01-01T00:01:00.000Z",
        active_session: sharedSessionId,
        active_cycle: sharedCycleId,
        scope_type: "cycle",
        scope_id: sharedCycleId,
        handoff_status: "ready",
        handoff_from_agent_role: "coordinator",
        handoff_from_agent_action: "relay",
        recommended_next_agent_role: "executor",
        recommended_next_agent_action: "implement",
        prioritized_artifacts: ["docs/audit/HANDOFF-PACKET.md"],
        owner: "alpha",
      },
    });
    const betaHandoff = await appendSharedHandoffRelay(betaResolution, {
      workspace: betaWorkspace,
      outputFile: "docs/audit/HANDOFF-PACKET.md",
      packetSha256: "beta-handoff",
      packet: {
        updated_at: "2030-01-01T00:01:00.000Z",
        active_session: sharedSessionId,
        active_cycle: sharedCycleId,
        scope_type: "cycle",
        scope_id: sharedCycleId,
        handoff_status: "ready",
        handoff_from_agent_role: "coordinator",
        handoff_from_agent_action: "relay",
        recommended_next_agent_role: "auditor",
        recommended_next_agent_action: "audit",
        prioritized_artifacts: ["docs/audit/HANDOFF-PACKET.md"],
        owner: "beta",
      },
    });
    assert(alphaHandoff.ok === true && betaHandoff.ok === true, "multi-project handoff sync should succeed for both projects");

    const alphaCoordination = await appendSharedCoordinationRecord(alphaResolution, {
      workspace: alphaWorkspace,
      recordType: "coordinator_dispatch",
      recordId: sharedRecordId,
      status: "executed",
      sessionId: sharedSessionId,
      cycleId: sharedCycleId,
      scopeType: "cycle",
      scopeId: sharedCycleId,
      actorRole: "coordinator",
      actorAction: "coordinate",
      payload: {
        owner: "alpha",
      },
    });
    const betaCoordination = await appendSharedCoordinationRecord(betaResolution, {
      workspace: betaWorkspace,
      recordType: "coordinator_dispatch",
      recordId: sharedRecordId,
      status: "dry_run",
      sessionId: sharedSessionId,
      cycleId: sharedCycleId,
      scopeType: "cycle",
      scopeId: sharedCycleId,
      actorRole: "coordinator",
      actorAction: "coordinate",
      payload: {
        owner: "beta",
      },
    });
    assert(alphaCoordination.ok === true && betaCoordination.ok === true, "multi-project coordination sync should succeed for both projects");

    const alphaPlanningRead = await readSharedPlanningState(alphaResolution, {
      workspace: alphaWorkspace,
      planningKey: sharedPlanningKey,
    });
    const betaPlanningRead = await readSharedPlanningState(betaResolution, {
      workspace: betaWorkspace,
      planningKey: sharedPlanningKey,
    });
    assert(alphaPlanningRead.planning_state?.payload?.owner === "alpha", "project alpha should read only its planning payload");
    assert(betaPlanningRead.planning_state?.payload?.owner === "beta", "project beta should read only its planning payload");

    const alphaHandoffRead = await readLatestSharedHandoffRelay(alphaResolution, {
      workspace: alphaWorkspace,
      sessionId: sharedSessionId,
      scopeType: "cycle",
      scopeId: sharedCycleId,
    });
    const betaHandoffRead = await readLatestSharedHandoffRelay(betaResolution, {
      workspace: betaWorkspace,
      sessionId: sharedSessionId,
      scopeType: "cycle",
      scopeId: sharedCycleId,
    });
    assert(alphaHandoffRead.handoff_relay?.metadata?.owner === "alpha", "project alpha should read only its handoff relay");
    assert(betaHandoffRead.handoff_relay?.metadata?.owner === "beta", "project beta should read only its handoff relay");

    const alphaCoordinationRead = await readSharedCoordinationRecords(alphaResolution, {
      workspace: alphaWorkspace,
      recordType: "coordinator_dispatch",
      sessionId: sharedSessionId,
      scopeType: "cycle",
      scopeId: sharedCycleId,
      limit: 5,
    });
    const betaCoordinationRead = await readSharedCoordinationRecords(betaResolution, {
      workspace: betaWorkspace,
      recordType: "coordinator_dispatch",
      sessionId: sharedSessionId,
      scopeType: "cycle",
      scopeId: sharedCycleId,
      limit: 5,
    });
    assert(alphaCoordinationRead.records.length === 1, "project alpha should see one coordination record");
    assert(betaCoordinationRead.records.length === 1, "project beta should see one coordination record");
    assert(alphaCoordinationRead.records[0]?.payload?.owner === "alpha", "project alpha should see only its coordination payload");
    assert(betaCoordinationRead.records[0]?.payload?.owner === "beta", "project beta should see only its coordination payload");

    const projects = await alphaResolution.store.listProjects();
    assert(projects.ok === true, "project enumeration should succeed");
    assert(projects.projects.length === 2, "project enumeration should list both isolated projects");

    const inspectedAlpha = await alphaResolution.store.inspectProject({
      projectId: "project-alpha",
    });
    assert(inspectedAlpha.project?.project_id === "project-alpha", "project inspect should return the requested project");
    assert(inspectedAlpha.workspaces.length === 1, "project inspect should keep workspace scope isolated");

    assert(fake.state.planningStates.size === 2, "shared store should keep both planning rows isolated by project");
    assert(fake.state.handoffRelays.size === 2, "shared store should keep both handoff rows isolated by project");
    assert(fake.state.coordinationRecords.length === 2, "shared store should keep both coordination rows isolated by project");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

await main();
