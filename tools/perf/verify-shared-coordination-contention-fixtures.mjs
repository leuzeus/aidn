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

function buildPlanningPayload(index, writerLabel) {
  return {
    session_id: "S940",
    planning_status: "promoted",
    planning_arbitration_status: index % 2 === 0 ? "resolved" : "review_requested",
    next_dispatch_scope: index % 2 === 0 ? "cycle" : "session",
    next_dispatch_action: index % 2 === 0 ? "implement" : "coordinate",
    backlog_next_step: `contention planning step ${index} from ${writerLabel}`,
    selected_execution_scope: index % 2 === 0 ? "new_cycle" : "current_cycle",
    dispatch_ready: index % 2 === 0,
    iteration: index,
    writer: writerLabel,
  };
}

async function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-coordination-contention-"));
    const mainRoot = path.join(tempRoot, "repo");
    const linkedRoot = path.join(tempRoot, "repo-linked");
    const env = {
      AIDN_TEST_PG_URL: "postgres://aidn:test@localhost:5432/aidn",
    };

    fs.mkdirSync(mainRoot, { recursive: true });
    runGit(mainRoot, ["init", "--initial-branch=main"]);
    runGit(mainRoot, ["config", "user.name", "aidn"]);
    runGit(mainRoot, ["config", "user.email", "aidn@example.test"]);
    fs.writeFileSync(path.join(mainRoot, "README.md"), "# contention fixture\n", "utf8");
    runGit(mainRoot, ["add", "README.md"]);
    runGit(mainRoot, ["commit", "-m", "initial"]);
    runGit(mainRoot, ["worktree", "add", linkedRoot, "-b", "feature/contention"]);

    const locator = {
      enabled: true,
      workspaceId: "workspace-contention",
      backend: {
        kind: "postgres",
        connectionRef: "env:AIDN_TEST_PG_URL",
      },
      projection: {
        localIndexMode: "preserve-current",
      },
    };
    writeSharedRuntimeLocator(mainRoot, locator);
    writeSharedRuntimeLocator(linkedRoot, locator);

    const mainWorkspace = resolveWorkspaceContext({
      targetRoot: mainRoot,
      env,
    });
    const linkedWorkspace = resolveWorkspaceContext({
      targetRoot: linkedRoot,
      env,
    });

    const fake = createConcurrentFakePgClientFactory({
      planningLaterSourceWorktreeId: linkedWorkspace.worktree_id,
      handoffLaterSourceWorktreeId: linkedWorkspace.worktree_id,
      coordinationLaterSourceWorktreeId: linkedWorkspace.worktree_id,
    });
    const [mainResolution, linkedResolution] = await Promise.all([
      resolveSharedCoordinationStore({
        targetRoot: mainRoot,
        workspace: mainWorkspace,
        env,
        clientFactory: fake.factory,
      }),
      resolveSharedCoordinationStore({
        targetRoot: linkedRoot,
        workspace: linkedWorkspace,
        env,
        clientFactory: fake.factory,
      }),
    ]);

    const planningKey = "session:S940";
    const iterations = 12;
    const planningWrites = [];
    const handoffWrites = [];
    const coordinationWrites = [];

    for (let index = 0; index < iterations; index += 1) {
      const useLinked = index % 2 === 1;
      const resolution = useLinked ? linkedResolution : mainResolution;
      const workspace = useLinked ? linkedWorkspace : mainWorkspace;
      const writerLabel = useLinked ? "linked" : "main";
      planningWrites.push(syncSharedPlanningState(resolution, {
        workspace,
        planningKey,
        backlogFile: `docs/audit/backlog/BL-S940-${writerLabel}-${index}.md`,
        backlogSha256: `sha-${writerLabel}-${index}`,
        payload: buildPlanningPayload(index, writerLabel),
      }));
      handoffWrites.push(appendSharedHandoffRelay(resolution, {
        workspace,
        outputFile: "docs/audit/HANDOFF-PACKET.md",
        packetSha256: `handoff-${writerLabel}-${index}`,
        packet: {
          updated_at: `2030-01-01T00:01:${String(index).padStart(2, "0")}.000Z`,
          active_session: "S940",
          active_cycle: "C940",
          scope_type: "cycle",
          scope_id: "C940",
          handoff_status: "ready",
          handoff_from_agent_role: "coordinator",
          handoff_from_agent_action: "relay",
          recommended_next_agent_role: useLinked ? "executor" : "auditor",
          recommended_next_agent_action: useLinked ? "implement" : "audit",
          prioritized_artifacts: ["docs/audit/HANDOFF-PACKET.md"],
          iteration: index,
          writer: writerLabel,
        },
      }));
      coordinationWrites.push(appendSharedCoordinationRecord(resolution, {
        workspace,
        recordType: "coordinator_dispatch",
        recordId: `coord:${writerLabel}:${index}`,
        status: useLinked ? "executed" : "dry_run",
        sessionId: "S940",
        cycleId: "C940",
        scopeType: "cycle",
        scopeId: "C940",
        actorRole: "coordinator",
        actorAction: "coordinate",
        payload: {
          writer: writerLabel,
          iteration: index,
          ts: `2030-01-01T00:02:${String(index).padStart(2, "0")}.000Z`,
        },
      }));
    }

    const planningResults = await Promise.all(planningWrites);
    const handoffResults = await Promise.all(handoffWrites);
    const coordinationResults = await Promise.all(coordinationWrites);
    assert(planningResults.every((item) => item.ok === true), "all sustained planning writes should succeed");
    assert(handoffResults.every((item) => item.ok === true), "all sustained handoff writes should succeed");
    assert(coordinationResults.every((item) => item.ok === true), "all sustained coordination writes should succeed");

    const planningRead = await readSharedPlanningState(mainResolution, {
      workspace: mainWorkspace,
      planningKey,
    });
    assert(planningRead.ok === true, "sustained planning read should succeed");
    assert(planningRead.planning_state?.revision === iterations - 1, "planning revision should reflect every overlapping upsert");
    assert(planningRead.planning_state?.source_worktree_id === linkedWorkspace.worktree_id, "the slower linked writer should own the final planning revision");
    assert(planningRead.planning_state?.payload?.writer === "linked", "final planning payload should come from the slower linked writer");

    const latestHandoff = await readLatestSharedHandoffRelay(mainResolution, {
      workspace: mainWorkspace,
      sessionId: "S940",
      scopeType: "cycle",
      scopeId: "C940",
    });
    assert(latestHandoff.ok === true, "sustained handoff read should succeed");
    assert(fake.state.handoffRelays.size === iterations, "all sustained handoff relays should remain visible in the shared store");
    assert(latestHandoff.handoff_relay?.source_worktree_id === linkedWorkspace.worktree_id, "latest handoff relay should resolve to the slower linked writer");
    assert(latestHandoff.handoff_relay?.metadata?.writer === "linked", "latest handoff metadata should preserve the winning writer");

    const coordinationRead = await readSharedCoordinationRecords(mainResolution, {
      workspace: mainWorkspace,
      recordType: "coordinator_dispatch",
      sessionId: "S940",
      scopeType: "cycle",
      scopeId: "C940",
      limit: iterations,
    });
    assert(coordinationRead.ok === true, "sustained coordination read should succeed");
    assert(coordinationRead.records.length === iterations, "all sustained coordination records should remain visible");
    assert(new Set(coordinationRead.records.map((item) => item.record_id)).size === iterations, "sustained coordination should not silently drop or duplicate record ids");
    assert(new Set(coordinationRead.records.map((item) => item.source_worktree_id)).size === 2, "sustained coordination should preserve both worktree identities");
    assert(fake.state.worktreeRegistry.size === 2, "both worktrees should remain registered during sustained contention");

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
