#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { bootstrapSharedCoordination } from "../runtime/shared-coordination-bootstrap.mjs";
import { projectSharedCoordinationStatus } from "../runtime/shared-coordination-status.mjs";
import { writeSharedRuntimeLocator } from "../../src/lib/config/shared-runtime-locator-config-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(args, env = {}) {
  const childEnv = {
    ...process.env,
    ...env,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === null) {
      delete childEnv[key];
    }
  }
  const stdout = execFileSync(process.execPath, [path.resolve(process.cwd(), "bin/aidn.mjs"), ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: childEnv,
  });
  return JSON.parse(stdout);
}

function createFakeResolution() {
  const planningState = {
    project_id: "project-cli",
    workspace_id: "workspace-cli",
    planning_key: "session:S101",
    session_id: "S101",
    backlog_artifact_ref: "backlog/BL-S101-session-planning.md",
    planning_status: "promoted",
    planning_arbitration_status: "resolved",
    next_dispatch_scope: "cycle",
    next_dispatch_action: "implement",
    backlog_next_step: "implement alpha feature validation",
    dispatch_ready: true,
    payload: {
      linked_cycles: ["C101"],
    },
    updated_at: "2026-03-28T10:00:00Z",
  };
  const handoffRelay = {
    project_id: "project-cli",
    workspace_id: "workspace-cli",
    relay_id: "handoff:worktree:2026-03-28T10:05:00Z",
    session_id: "S101",
    cycle_id: "C101",
    scope_type: "cycle",
    scope_id: "C101",
    handoff_status: "ready",
    recommended_next_agent_role: "executor",
    recommended_next_agent_action: "implement",
    created_at: "2026-03-28T10:05:00Z",
  };
  const records = [
    {
      project_id: "project-cli",
      workspace_id: "workspace-cli",
      record_id: "coordinator:1",
      record_type: "coordinator_dispatch",
      session_id: "S101",
      cycle_id: "C101",
      scope_type: "cycle",
      scope_id: "C101",
      status: "executed",
      payload: {
        event: "coordinator_dispatch",
      },
      created_at: "2026-03-28T10:06:00Z",
    },
  ];
  return {
    enabled: true,
    configured: true,
    backend_kind: "postgres",
    status: "ready",
    reason: "fake store",
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
      driver: {
        package_name: "pg",
      },
    },
    store: {
      async bootstrap() {
        return {
          ok: true,
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
          compatibility_status: "project-scoped",
          migration_diagnostics: [],
          registered_project_count: 1,
          legacy_workspace_rows: 0,
        };
      },
      async registerWorkspace(input) {
        return {
          ok: true,
          workspace: input,
        };
      },
      async registerWorktreeHeartbeat(input) {
        return {
          ok: true,
          worktree: input,
        };
      },
      async getPlanningState() {
        return {
          ok: true,
          planning_state: planningState,
        };
      },
      async getLatestHandoffRelay() {
        return {
          ok: true,
          handoff_relay: handoffRelay,
        };
      },
      async listCoordinationRecords() {
        return {
          ok: true,
          records,
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
    const disabledStatus = runJson(["runtime", "shared-coordination-status", "--target", "tests/fixtures/repo-installed-core", "--json"]);
    assert(disabledStatus.shared_coordination_backend.status === "disabled", "status CLI should report disabled backend by default");
    assert(disabledStatus.operations?.scope === "shared-coordination-only", "disabled status should expose shared coordination operations scope");
    assert(disabledStatus.operations?.connection_secret_exposed === false, "disabled status should not expose connection secrets");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-coordination-cli-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.mkdirSync(targetRoot, { recursive: true });
    writeSharedRuntimeLocator(targetRoot, {
      enabled: true,
      projectId: "project-cli",
      workspaceId: "workspace-cli",
      backend: {
        kind: "postgres",
        connectionRef: "env:AIDN_PG_URL",
      },
    });

    const missingEnvStatus = runJson(["runtime", "shared-coordination-status", "--target", targetRoot, "--json"], {
      AIDN_PG_URL: null,
    });
    assert(missingEnvStatus.shared_coordination_backend.status === "missing-env", "status CLI should surface missing postgres env");
    assert(missingEnvStatus.operations?.schema_status === "missing-env", "missing env status should expose operational schema status");
    assert(missingEnvStatus.operations?.connection_ref === "env:AIDN_PG_URL", "missing env status should expose env connection reference only");
    assert(missingEnvStatus.source_of_truth?.concept === "coordination_records", "status CLI should expose the governing source-of-truth concept");
    assert(missingEnvStatus.metadata?.concept === "workspace", "status CLI should expose the governing metadata concept");

    const fakeResolution = createFakeResolution();
    const directStatus = await projectSharedCoordinationStatus({
      targetRoot,
      sharedCoordination: fakeResolution,
    });
    assert(directStatus.ok === true, "direct status projection should succeed with fake store");
    assert(directStatus.workspace.project_id === "project-cli", "direct status projection should expose project identity");
    assert(directStatus.health?.ok === true, "direct status projection should expose health");
    assert(directStatus.health?.schema_status === "ready", "direct status projection should expose ready schema status");
    assert(directStatus.health?.compatibility_status === "project-scoped", "direct status projection should expose compatibility status");
    assert(directStatus.operations?.schema_status === "ready", "direct status should expose operational schema status");
    assert(directStatus.operations?.source_of_truth_status === "covered", "direct status should expose source-of-truth coverage");
    assert(typeof directStatus.operations?.metadata_status === "string", "direct status should expose metadata status");
    assert(directStatus.operations?.freshness_status === "inspectable", "direct status should expose inspectable freshness");
    assert(directStatus.operations?.backup_command === "aidn runtime shared-coordination-backup --target . --json", "direct status should expose backup command");
    assert(directStatus.source_of_truth?.source_of_truth_status === "covered", "direct status should resolve the source-of-truth policy");
    assert(directStatus.metadata?.concept === "workspace", "direct status should project workspace metadata policy");
    assert(directStatus.snapshot?.handoff_read?.status === "found", "direct status projection should expose handoff snapshot");
    assert(directStatus.snapshot?.handoff_read?.governance?.artifact_family === "handoff_relay", "direct status projection should expose handoff governance family");
    assert(directStatus.snapshot?.coordination_read?.status === "found", "direct status projection should expose coordination snapshot");
    assert(directStatus.snapshot?.coordination_read?.governance?.artifact_family === "coordination_record", "direct status projection should expose coordination governance family");

    const bootstrap = await bootstrapSharedCoordination({
      targetRoot,
      sharedCoordination: fakeResolution,
    });
    assert(bootstrap.ok === true, "bootstrap projection should succeed with fake store");
    assert(bootstrap.shared_coordination_bootstrap.status === "registered", "bootstrap should register workspace/worktree");

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
