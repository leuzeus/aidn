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

function canonicalizePath(value) {
  return path.resolve(String(value ?? "")).replace(/\\/g, "/").toLowerCase();
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
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-worktree-concurrency-"));
    const mainRoot = path.join(tempRoot, "repo");
    const linkedRoot = path.join(tempRoot, "repo-linked");
    const env = {
      AIDN_TEST_PG_URL: "postgres://aidn:test@localhost:5432/aidn",
    };

    fs.mkdirSync(mainRoot, { recursive: true });
    runGit(mainRoot, ["init", "--initial-branch=main"]);
    runGit(mainRoot, ["config", "user.name", "aidn"]);
    runGit(mainRoot, ["config", "user.email", "aidn@example.test"]);
    fs.writeFileSync(path.join(mainRoot, "README.md"), "# fixture\n", "utf8");
    runGit(mainRoot, ["add", "README.md"]);
    runGit(mainRoot, ["commit", "-m", "initial"]);
    runGit(mainRoot, ["worktree", "add", linkedRoot, "-b", "feature/shared-coordination"]);

    const locator = {
      enabled: true,
      workspaceId: "workspace-worktree-concurrent",
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

    assert(mainWorkspace.shared_runtime_mode === "shared-runtime", "expected main worktree to resolve shared-runtime mode");
    assert(linkedWorkspace.shared_runtime_mode === "shared-runtime", "expected linked worktree to resolve shared-runtime mode");
    assert(mainWorkspace.shared_backend_kind === "postgres", "expected main worktree postgres backend");
    assert(linkedWorkspace.shared_backend_kind === "postgres", "expected linked worktree postgres backend");
    assert(mainWorkspace.workspace_id === linkedWorkspace.workspace_id, "expected both worktrees to share the same workspace id");
    assert(mainWorkspace.worktree_id !== linkedWorkspace.worktree_id, "expected distinct worktree ids across linked checkouts");
    assert(canonicalizePath(mainWorkspace.git_common_dir) === canonicalizePath(linkedWorkspace.git_common_dir), "expected both worktrees to share the same git common dir");

    const fake = createConcurrentFakePgClientFactory({
      planningLaterSourceWorktreeId: mainWorkspace.worktree_id,
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

    assert(mainResolution.configured === true && mainResolution.store, "expected main shared coordination resolution to be configured");
    assert(linkedResolution.configured === true && linkedResolution.store, "expected linked shared coordination resolution to be configured");

    const planningKey = "session:S930";
    const [planningA, planningB] = await Promise.all([
      syncSharedPlanningState(mainResolution, {
        workspace: mainWorkspace,
        planningKey,
        backlogFile: "docs/audit/backlog/BL-S930-main.md",
        backlogSha256: "sha-main",
        payload: {
          session_id: "S930",
          planning_status: "promoted",
          planning_arbitration_status: "review_requested",
          next_dispatch_scope: "session",
          next_dispatch_action: "coordinate",
          backlog_next_step: "plan from main worktree",
          selected_execution_scope: "same_cycle",
          dispatch_ready: false,
        },
      }),
      syncSharedPlanningState(linkedResolution, {
        workspace: linkedWorkspace,
        planningKey,
        backlogFile: "docs/audit/backlog/BL-S930-linked.md",
        backlogSha256: "sha-linked",
        payload: {
          session_id: "S930",
          planning_status: "promoted",
          planning_arbitration_status: "resolved",
          next_dispatch_scope: "cycle",
          next_dispatch_action: "implement",
          backlog_next_step: "plan from linked worktree",
          selected_execution_scope: "new_cycle",
          dispatch_ready: true,
        },
      }),
    ]);
    assert(planningA.ok === true && planningB.ok === true, "expected both worktrees to sync planning state");

    const planningRead = await readSharedPlanningState(mainResolution, {
      workspace: mainWorkspace,
      planningKey,
    });
    assert(planningRead.ok === true, "expected shared planning read to succeed");
    assert(planningRead.planning_state?.revision === 1, "expected planning revision to increment after concurrent worktree writes");
    assert(new Set([mainWorkspace.worktree_id, linkedWorkspace.worktree_id]).has(planningRead.planning_state?.source_worktree_id), "expected planning source worktree id to come from one of the linked worktrees");

    const [handoffA, handoffB] = await Promise.all([
      appendSharedHandoffRelay(mainResolution, {
        workspace: mainWorkspace,
        outputFile: "docs/audit/HANDOFF-PACKET.md",
        packetSha256: "sha-handoff-main",
        packet: {
          updated_at: "2030-01-01T00:00:01.000Z",
          active_session: "S930",
          active_cycle: "C930",
          scope_type: "cycle",
          scope_id: "C930",
          handoff_status: "ready",
          handoff_from_agent_role: "coordinator",
          handoff_from_agent_action: "relay",
          recommended_next_agent_role: "auditor",
          recommended_next_agent_action: "audit",
          prioritized_artifacts: ["docs/audit/HANDOFF-PACKET.md"],
        },
      }),
      appendSharedHandoffRelay(linkedResolution, {
        workspace: linkedWorkspace,
        outputFile: "docs/audit/HANDOFF-PACKET.md",
        packetSha256: "sha-handoff-linked",
        packet: {
          updated_at: "2030-01-01T00:00:02.000Z",
          active_session: "S930",
          active_cycle: "C930",
          scope_type: "cycle",
          scope_id: "C930",
          handoff_status: "ready",
          handoff_from_agent_role: "coordinator",
          handoff_from_agent_action: "relay",
          recommended_next_agent_role: "executor",
          recommended_next_agent_action: "implement",
          prioritized_artifacts: ["docs/audit/HANDOFF-PACKET.md"],
        },
      }),
    ]);
    assert(handoffA.ok === true && handoffB.ok === true, "expected both worktrees to append handoff relays");

    const latestHandoff = await readLatestSharedHandoffRelay(mainResolution, {
      workspace: mainWorkspace,
      sessionId: "S930",
      scopeType: "cycle",
      scopeId: "C930",
    });
    assert(latestHandoff.ok === true, "expected shared handoff relay read to succeed");
    assert(latestHandoff.handoff_relay?.source_worktree_id === linkedWorkspace.worktree_id, "expected latest handoff relay to resolve from the configured later linked worktree writer");
    assert(latestHandoff.handoff_relay?.recommended_next_agent_role === "executor", "expected latest handoff relay payload to come from the linked worktree write");

    const [coordinationA, coordinationB] = await Promise.all([
      appendSharedCoordinationRecord(mainResolution, {
        workspace: mainWorkspace,
        recordType: "coordinator_dispatch",
        recordId: "coord:main",
        status: "dry_run",
        sessionId: "S930",
        cycleId: "C930",
        scopeType: "cycle",
        scopeId: "C930",
        actorRole: "coordinator",
        actorAction: "coordinate",
        payload: {
          writer: "main",
          ts: "2030-01-01T00:00:03.000Z",
        },
      }),
      appendSharedCoordinationRecord(linkedResolution, {
        workspace: linkedWorkspace,
        recordType: "coordinator_dispatch",
        recordId: "coord:linked",
        status: "executed",
        sessionId: "S930",
        cycleId: "C930",
        scopeType: "cycle",
        scopeId: "C930",
        actorRole: "coordinator",
        actorAction: "coordinate",
        payload: {
          writer: "linked",
          ts: "2030-01-01T00:00:04.000Z",
        },
      }),
    ]);
    assert(coordinationA.ok === true && coordinationB.ok === true, "expected both worktrees to append coordination records");

    const coordinationRead = await readSharedCoordinationRecords(mainResolution, {
      workspace: mainWorkspace,
      recordType: "coordinator_dispatch",
      sessionId: "S930",
      scopeType: "cycle",
      scopeId: "C930",
      limit: 5,
    });
    assert(coordinationRead.ok === true, "expected shared coordination record list to succeed");
    assert(coordinationRead.records.length === 2, "expected both concurrent coordination records to remain visible");
    assert(new Set(coordinationRead.records.map((item) => item.source_worktree_id)).size === 2, "expected coordination records to preserve both worktree identities");
    assert(fake.state.worktreeRegistry.size === 2, "expected both linked worktrees to register against the shared backend");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      removePathWithRetry(tempRoot);
    }
  }
}

await main();
