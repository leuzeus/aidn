#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { restoreSharedCoordination } from "../runtime/shared-coordination-restore.mjs";
import { writeSharedRuntimeLocator } from "../../src/lib/config/shared-runtime-locator-config-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [path.resolve(process.cwd(), "bin/aidn.mjs"), ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    json: String(result.stdout ?? "").trim() ? JSON.parse(String(result.stdout ?? "{}")) : null,
  };
}

function createBackupPayload(workspaceId = "workspace-restore") {
  return {
    ts: "2026-03-29T18:00:00.000Z",
    workspace: {
      workspace_id: workspaceId,
      worktree_id: "worktree-source",
    },
    snapshot: {
      planning_read: {
        status: "found",
        planning_state: {
          workspace_id: workspaceId,
          planning_key: "session:S201",
          session_id: "S201",
          backlog_artifact_ref: "docs/audit/sessions/S201/BACKLOG.md",
          backlog_artifact_sha256: "abc123",
          planning_status: "promoted",
          planning_arbitration_status: "resolved",
          next_dispatch_scope: "cycle",
          next_dispatch_action: "implement",
          backlog_next_step: "restore snapshot",
          selected_execution_scope: "cycle:C201",
          dispatch_ready: true,
          source_worktree_id: "worktree-source",
          payload: {
            linked_cycles: ["C201"],
          },
        },
      },
      handoff_read: {
        status: "found",
        handoff_relay: {
          workspace_id: workspaceId,
          relay_id: "handoff:restore:1",
          session_id: "S201",
          cycle_id: "C201",
          scope_type: "cycle",
          scope_id: "C201",
          source_worktree_id: "worktree-source",
          handoff_status: "ready",
          from_agent_role: "planner",
          from_agent_action: "handoff",
          recommended_next_agent_role: "executor",
          recommended_next_agent_action: "implement",
          handoff_packet_ref: "docs/audit/HANDOFF-PACKET.md",
          handoff_packet_sha256: "def456",
          prioritized_artifacts: ["docs/audit/CURRENT-STATE.md"],
          metadata_json: {
            note: "restored relay",
          },
        },
      },
      coordination_read: {
        status: "found",
        record_count: 2,
        records: [
          {
            workspace_id: workspaceId,
            record_id: "coord:restore:1",
            record_type: "coordinator_dispatch",
            session_id: "S201",
            cycle_id: "C201",
            scope_type: "cycle",
            scope_id: "C201",
            source_worktree_id: "worktree-source",
            actor_role: "coordinator",
            actor_action: "dispatch",
            status: "queued",
            coordination_log_ref: "docs/audit/coordination/log.ndjson",
            coordination_summary_ref: "docs/audit/coordination/summary.md",
            payload_json: {
              ts: "2026-03-29T18:01:00.000Z",
            },
            created_at: "2026-03-29T18:01:00.000Z",
          },
          {
            workspace_id: workspaceId,
            record_id: "coord:restore:2",
            record_type: "coordinator_dispatch",
            session_id: "S201",
            cycle_id: "C201",
            scope_type: "cycle",
            scope_id: "C201",
            source_worktree_id: "worktree-source",
            actor_role: "coordinator",
            actor_action: "dispatch",
            status: "executed",
            coordination_log_ref: "docs/audit/coordination/log.ndjson",
            coordination_summary_ref: "docs/audit/coordination/summary.md",
            payload_json: {
              ts: "2026-03-29T18:02:00.000Z",
            },
            created_at: "2026-03-29T18:02:00.000Z",
          },
        ],
      },
    },
  };
}

function createFakeResolution(state) {
  return {
    enabled: true,
    configured: true,
    backend_kind: "postgres",
    status: "ready",
    reason: "fake restore store",
    connection: {
      connection_ref: "env:AIDN_PG_URL",
      status: "resolved",
      driver: {
        package_name: "pg",
      },
    },
    contract: {
      scope: "shared-coordination-only",
      schema_name: "aidn_shared",
      schema_version: 1,
      driver: {
        package_name: "pg",
      },
    },
    store: {
      async bootstrap() {
        return {
          ok: true,
          schema_name: "aidn_shared",
          schema_version: 1,
        };
      },
      async healthcheck() {
        return {
          ok: true,
          database_name: "aidn_test",
          schema_name: "aidn_shared",
          current_schema_name: "public",
          expected_schema_version: 1,
          applied_schema_versions: [1],
          latest_applied_schema_version: 1,
          tables_present: [
            "coordination_records",
            "handoff_relays",
            "planning_states",
            "schema_migrations",
            "workspace_registry",
            "worktree_registry",
          ],
          tables_missing: [],
          schema_status: "ready",
          schema_ok: true,
        };
      },
      async registerWorkspace(input) {
        state.workspace = input;
        return { ok: true, workspace: input };
      },
      async registerWorktreeHeartbeat(input) {
        state.worktree = input;
        return { ok: true, worktree: input };
      },
      async upsertPlanningState(input) {
        state.planning = input;
        return { ok: true, planning_state: input };
      },
      async appendHandoffRelay(input) {
        state.handoff = input;
        return { ok: true, handoff_relay: input };
      },
      async appendCoordinationRecord(input) {
        state.coordination.push(input);
        return { ok: true, coordination_record: input };
      },
      describeContract() {
        return { backend_kind: "postgres" };
      },
    },
  };
}

async function main() {
  let tempRoot = "";
  try {
    const disabled = runCli(["runtime", "shared-coordination-restore", "--target", "tests/fixtures/repo-installed-core", "--json"]);
    assert(disabled.status === 1, "restore CLI should fail when shared coordination is disabled");
    assert(disabled.json?.status === "disabled", "disabled restore CLI should report disabled status");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-coordination-restore-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.mkdirSync(path.join(targetRoot, ".aidn", "runtime"), { recursive: true });
    writeSharedRuntimeLocator(targetRoot, {
      enabled: true,
      workspaceId: "workspace-restore",
      backend: {
        kind: "postgres",
        connectionRef: "env:AIDN_PG_URL",
      },
    });

    const backupFile = path.join(targetRoot, ".aidn", "runtime", "shared-coordination-backup.json");
    fs.writeFileSync(backupFile, JSON.stringify(createBackupPayload(), null, 2));

    const missingEnv = runCli(["runtime", "shared-coordination-restore", "--target", targetRoot, "--json"]);
    assert(missingEnv.status === 1, "restore CLI should fail when PostgreSQL env is missing");
    assert(missingEnv.json?.status === "missing-env", "restore CLI should surface missing-env");

    const state = {
      workspace: null,
      worktree: null,
      planning: null,
      handoff: null,
      coordination: [],
    };
    const fakeResolution = createFakeResolution(state);

    const dryRun = await restoreSharedCoordination({
      targetRoot,
      input: ".aidn/runtime/shared-coordination-backup.json",
      sharedCoordination: fakeResolution,
    });
    assert(dryRun.ok === true, "direct restore dry-run should succeed");
    assert(dryRun.status === "dry-run", "direct restore should default to dry-run");
    assert(state.planning === null, "dry-run should not mutate the backend");

    const writeResult = await restoreSharedCoordination({
      targetRoot,
      input: ".aidn/runtime/shared-coordination-backup.json",
      write: true,
      sharedCoordination: fakeResolution,
    });
    assert(writeResult.ok === true, "direct restore write should succeed");
    assert(writeResult.status === "restored", "direct restore write should report restored");
    assert(state.workspace?.workspaceId === "workspace-restore", "restore should register workspace");
    assert(state.worktree?.worktreeId, "restore should register worktree");
    assert(state.planning?.planningKey === "session:S201", "restore should replay planning state");
    assert(state.handoff?.relayId === "handoff:restore:1", "restore should replay handoff relay");
    assert(state.coordination.length === 2, "restore should replay coordination records");
    assert(state.coordination[0]?.recordId === "coord:restore:1", "restore should replay coordination records oldest-first");

    fs.writeFileSync(backupFile, JSON.stringify(createBackupPayload("workspace-other"), null, 2));
    const mismatch = await restoreSharedCoordination({
      targetRoot,
      input: ".aidn/runtime/shared-coordination-backup.json",
      sharedCoordination: fakeResolution,
    });
    assert(mismatch.ok === false, "workspace mismatch should fail");
    assert(mismatch.status === "workspace-mismatch", "workspace mismatch should be explicit");

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
