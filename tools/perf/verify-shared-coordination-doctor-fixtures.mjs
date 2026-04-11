#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { doctorSharedCoordination } from "../runtime/shared-coordination-doctor.mjs";
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

function createFakeResolution({
  schemaStatus = "ready",
  latestSchemaVersion = 2,
  legacyWorkspaceRows = 0,
} = {}) {
  return {
    enabled: true,
    configured: true,
    backend_kind: "postgres",
    status: "ready",
    reason: "fake doctor store",
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
      async healthcheck() {
        return {
          ok: true,
          database_name: "aidn_test",
          schema_name: "aidn_shared",
          current_schema_name: "public",
          expected_schema_version: 2,
          applied_schema_versions: latestSchemaVersion > 0 ? [latestSchemaVersion] : [],
          latest_applied_schema_version: latestSchemaVersion,
          tables_present: [
            "coordination_records",
            "handoff_relays",
            "planning_states",
            "project_registry",
            "schema_migrations",
            "workspace_registry",
            "worktree_registry",
          ],
          tables_missing: schemaStatus === "schema-drift" ? ["handoff_relays"] : [],
          schema_status: schemaStatus,
          compatibility_status: legacyWorkspaceRows > 0 ? "mixed-legacy-v2" : (schemaStatus === "ready" ? "project-scoped" : "schema-not-ready"),
          migration_diagnostics: legacyWorkspaceRows > 0 ? [`${legacyWorkspaceRows} workspace_registry rows still need project_id backfill`] : [],
          schema_ok: schemaStatus === "ready" && legacyWorkspaceRows === 0,
          registered_project_count: 1,
          legacy_workspace_rows: legacyWorkspaceRows,
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
    const disabled = runCli(["runtime", "shared-coordination-doctor", "--target", "tests/fixtures/repo-installed-core", "--json"]);
    assert(disabled.status === 0, "doctor CLI should succeed with informational disabled status");
    assert(disabled.json?.status === "pass", "disabled doctor CLI should remain pass/info");
    assert(disabled.json?.findings?.[0]?.code === "shared-runtime-disabled", "disabled doctor should explain the disabled state");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-coordination-doctor-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.mkdirSync(targetRoot, { recursive: true });
    writeSharedRuntimeLocator(targetRoot, {
      enabled: true,
      projectId: "project-doctor",
      workspaceId: "workspace-doctor",
      backend: {
        kind: "postgres",
        connectionRef: "env:AIDN_PG_URL",
      },
    });

    const missingEnv = runCli(["runtime", "shared-coordination-doctor", "--target", targetRoot, "--json"]);
    assert(missingEnv.status === 1, "doctor CLI should fail when PostgreSQL env is missing");
    assert(missingEnv.json?.findings?.some((item) => item.code === "missing-env"), "doctor CLI should surface missing-env");

    const ready = await doctorSharedCoordination({
      targetRoot,
      sharedCoordination: createFakeResolution({
        schemaStatus: "ready",
        latestSchemaVersion: 2,
      }),
    });
    assert(ready.ok === true, "doctor should pass for a healthy aligned schema");
    assert(ready.health?.schema_status === "ready", "doctor should expose ready schema status");
    assert(ready.health?.compatibility_status === "project-scoped", "doctor should expose project-scoped compatibility status");

    const behind = await doctorSharedCoordination({
      targetRoot,
      sharedCoordination: createFakeResolution({
        schemaStatus: "version-behind",
        latestSchemaVersion: 0,
      }),
    });
    assert(behind.ok === false, "doctor should fail when the schema is behind");
    assert(behind.findings?.some((item) => item.code === "version-behind"), "doctor should report version-behind");
    assert(behind.recommended_actions?.some((item) => item.includes("shared-coordination-migrate --dry-run")), "doctor should recommend reviewing the upgrade plan before applying it");

    const mixedState = await doctorSharedCoordination({
      targetRoot,
      sharedCoordination: createFakeResolution({
        schemaStatus: "ready",
        latestSchemaVersion: 2,
        legacyWorkspaceRows: 3,
      }),
    });
    assert(mixedState.ok === false, "doctor should fail when legacy workspace rows remain");
    assert(mixedState.findings?.some((item) => item.code === "mixed-legacy-v2"), "doctor should report mixed legacy/v2 state");

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
