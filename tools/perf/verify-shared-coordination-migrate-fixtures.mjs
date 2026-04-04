#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { migrateSharedCoordination } from "../runtime/shared-coordination-migrate.mjs";
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
  const state = {
    schemaStatus: "ready",
    latestSchemaVersion: 2,
  };
  return {
    enabled: true,
    configured: true,
    backend_kind: "postgres",
    status: "ready",
    reason: "fake migrate store",
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
        state.schemaStatus = "ready";
        state.latestSchemaVersion = 2;
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
          applied_schema_versions: state.latestSchemaVersion > 0 ? [state.latestSchemaVersion] : [],
          latest_applied_schema_version: state.latestSchemaVersion,
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
          schema_status: state.schemaStatus,
          schema_ok: state.schemaStatus === "ready",
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
        return { ok: true, planning_state: null };
      },
      async getLatestHandoffRelay() {
        return { ok: true, handoff_relay: null };
      },
      async listCoordinationRecords() {
        return { ok: true, records: [] };
      },
      describeContract() {
        return {
          backend_kind: "postgres",
        };
      },
    },
    state,
  };
}

async function main() {
  let tempRoot = "";
  try {
    const disabled = runCli(["runtime", "shared-coordination-migrate", "--target", "tests/fixtures/repo-installed-core", "--json"]);
    assert(disabled.status === 1, "migrate CLI should fail when shared coordination is disabled");
    assert(disabled.json?.shared_coordination_migration?.status === "disabled", "disabled migrate CLI should report disabled status");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-coordination-migrate-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.mkdirSync(targetRoot, { recursive: true });
    writeSharedRuntimeLocator(targetRoot, {
      enabled: true,
      projectId: "project-migrate",
      workspaceId: "workspace-migrate",
      backend: {
        kind: "postgres",
        connectionRef: "env:AIDN_PG_URL",
      },
    });

    const missingEnv = runCli(["runtime", "shared-coordination-migrate", "--target", targetRoot, "--json"]);
    assert(missingEnv.status === 1, "migrate CLI should fail when PostgreSQL env is missing");
    assert(missingEnv.json?.shared_coordination_migration?.status === "missing-env", "migrate CLI should surface missing-env");
    assert(missingEnv.json?.shared_coordination_backend?.backend_kind === "postgres", "migrate CLI should still identify postgres backend");

    const directReady = await migrateSharedCoordination({
      targetRoot,
      sharedCoordination: createFakeResolution(),
    });
    assert(directReady.ok === true, "direct migrate projection should succeed with fake store");
    assert(directReady.shared_coordination_migration?.status === "ready", "direct migrate projection should report ready status");
    assert(directReady.migration_plan?.action === "noop", "ready migrate projection should report a noop migration plan");
    assert(directReady.shared_coordination_migration?.health?.schema_status === "ready", "direct migrate projection should expose ready schema status");
    assert(directReady.contract?.schema_name === "aidn_shared", "direct migrate projection should expose schema contract");
    assert(directReady.shared_coordination_backend?.driver_package === "pg", "direct migrate projection should expose pg driver package");

    const upgradeResolution = createFakeResolution();
    upgradeResolution.state.schemaStatus = "version-behind";
    upgradeResolution.state.latestSchemaVersion = 0;
    const dryRun = await migrateSharedCoordination({
      targetRoot,
      write: false,
      rollbackOut: ".aidn/runtime/upgrade-rollback.json",
      sharedCoordination: upgradeResolution,
    });
    assert(dryRun.ok === true, "dry-run upgrade projection should succeed");
    assert(dryRun.shared_coordination_migration?.status === "dry-run", "dry-run upgrade projection should report dry-run");
    assert(dryRun.migration_plan?.action === "upgrade", "dry-run should report an upgrade migration plan");
    assert(dryRun.rollback_hint?.restore_command?.includes("shared-coordination-restore"), "dry-run should expose the planned rollback command");

    const writeResult = await migrateSharedCoordination({
      targetRoot,
      rollbackOut: ".aidn/runtime/upgrade-rollback.json",
      sharedCoordination: upgradeResolution,
    });
    assert(writeResult.ok === true, "upgrade migrate projection should succeed");
    assert(writeResult.pre_migration_health?.schema_status === "version-behind", "upgrade migrate should expose the pre-migration schema status");
    assert(writeResult.shared_coordination_migration?.health?.schema_status === "ready", "upgrade migrate should converge to a ready schema");
    assert(writeResult.rollback_snapshot?.output_file?.endsWith("upgrade-rollback.json"), "upgrade migrate should write a rollback snapshot");
    assert(writeResult.rollback_hint?.restore_command?.includes("upgrade-rollback.json"), "upgrade migrate should expose the rollback restore command");

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
