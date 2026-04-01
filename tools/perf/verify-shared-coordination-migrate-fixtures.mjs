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
      schema_version: 1,
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
      describeContract() {
        return {
          backend_kind: "postgres",
        };
      },
    },
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

    const direct = await migrateSharedCoordination({
      targetRoot,
      sharedCoordination: createFakeResolution(),
    });
    assert(direct.ok === true, "direct migrate projection should succeed with fake store");
    assert(direct.shared_coordination_migration?.status === "ready", "direct migrate projection should report ready status");
    assert(direct.shared_coordination_migration?.health?.schema_status === "ready", "direct migrate projection should expose ready schema status");
    assert(direct.contract?.schema_name === "aidn_shared", "direct migrate projection should expose schema contract");
    assert(direct.shared_coordination_backend?.driver_package === "pg", "direct migrate projection should expose pg driver package");

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
