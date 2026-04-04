#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { backupSharedCoordination } from "../runtime/shared-coordination-backup.mjs";
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

function createFakeResolution() {
  return {
    enabled: true,
    configured: true,
    backend_kind: "postgres",
    status: "ready",
    reason: "fake backup store",
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
      schema_version: 2,
      schema_file: path.resolve(process.cwd(), "tools/perf/sql/shared-coordination-postgres.sql"),
      driver: {
        package_name: "pg",
      },
    },
    store: {
      async bootstrap() {
        return {
          ok: true,
          schema_name: "aidn_shared",
          schema_version: 2,
        };
      },
      async healthcheck() {
        return {
          ok: true,
          database_name: "aidn_test",
          schema_name: "aidn_shared",
          current_schema_name: "public",
          expected_schema_version: 2,
          applied_schema_versions: [2],
          latest_applied_schema_version: 2,
          tables_present: [
            "coordination_records",
            "handoff_relays",
            "planning_states",
            "project_registry",
            "schema_migrations",
            "workspace_registry",
            "worktree_registry",
          ],
          tables_missing: [],
          schema_status: "ready",
          schema_ok: true,
          registered_project_count: 1,
          legacy_workspace_rows: 0,
        };
      },
      async registerWorkspace(input) {
        return { ok: true, workspace: input };
      },
      async registerWorktreeHeartbeat(input) {
        return { ok: true, worktree: input };
      },
      async getPlanningState() {
        return {
          ok: true,
          planning_state: {
            project_id: "project-backup",
            workspace_id: "workspace-backup",
            planning_key: "session:S101",
            planning_status: "promoted",
          },
        };
      },
      async getLatestHandoffRelay() {
        return {
          ok: true,
          handoff_relay: {
            project_id: "project-backup",
            workspace_id: "workspace-backup",
            relay_id: "handoff:backup:1",
            handoff_status: "ready",
          },
        };
      },
      async listCoordinationRecords() {
        return {
          ok: true,
          records: [
            { project_id: "project-backup", workspace_id: "workspace-backup", record_id: "coord:backup:1", record_type: "coordinator_dispatch" },
            { project_id: "project-backup", workspace_id: "workspace-backup", record_id: "coord:backup:2", record_type: "coordinator_dispatch" },
          ],
        };
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
    const disabled = runCli(["runtime", "shared-coordination-backup", "--target", "tests/fixtures/repo-installed-core", "--json"]);
    assert(disabled.status === 1, "backup CLI should fail when shared coordination is disabled");
    assert(disabled.json?.status === "disabled", "disabled backup CLI should report disabled status");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-coordination-backup-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.mkdirSync(targetRoot, { recursive: true });
    writeSharedRuntimeLocator(targetRoot, {
      enabled: true,
      projectId: "project-backup",
      workspaceId: "workspace-backup",
      backend: {
        kind: "postgres",
        connectionRef: "env:AIDN_PG_URL",
      },
    });

    const missingEnv = runCli(["runtime", "shared-coordination-backup", "--target", targetRoot, "--json"]);
    assert(missingEnv.status === 1, "backup CLI should fail when PostgreSQL env is missing");
    assert(missingEnv.json?.status === "missing-env", "backup CLI should surface missing-env");

    const outFile = path.join(targetRoot, ".aidn", "runtime", "shared-coordination-backup.json");
    const direct = await backupSharedCoordination({
      targetRoot,
      out: outFile,
      limit: 10,
      sharedCoordination: createFakeResolution(),
    });
    assert(direct.ok === true, "direct backup should succeed with fake store");
    assert(direct.health?.schema_status === "ready", "direct backup should expose schema status");
    assert(direct.backup?.workspace?.project_id === "project-backup", "direct backup should expose project identity");
    assert(direct.backup?.schema_snapshot?.latest_applied_schema_version === 2, "direct backup should expose the applied schema version snapshot");
    assert(direct.backup?.snapshot?.coordination_read?.record_count === 2, "direct backup should export coordination records");
    assert(fs.existsSync(outFile), "direct backup should write the backup file");

    const writtenPayload = JSON.parse(fs.readFileSync(outFile, "utf8"));
    assert(writtenPayload.shared_coordination_backend?.backend_kind === "postgres", "written backup should expose postgres backend");
    assert(writtenPayload.workspace?.project_id === "project-backup", "written backup should expose project id");
    assert(writtenPayload.contract?.source_schema_version === 2, "written backup should expose the source schema version");
    assert(writtenPayload.snapshot?.handoff_read?.handoff_relay?.relay_id === "handoff:backup:1", "written backup should contain latest handoff relay");

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
