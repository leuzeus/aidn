#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sharedCoordinationProjects } from "../runtime/shared-coordination-projects.mjs";
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
  const projects = [
    {
      project_id: "project-alpha",
      project_id_source: "locator",
      project_root_ref: "/tmp/project-alpha",
      locator_ref: ".aidn/project/shared-runtime.locator.json",
      shared_backend_kind: "postgres",
      workspace_count: 1,
      worktree_count: 2,
      planning_state_count: 3,
      handoff_relay_count: 4,
      coordination_record_count: 5,
      updated_at: "2026-04-03T10:00:00Z",
    },
    {
      project_id: "project-beta",
      project_id_source: "locator",
      project_root_ref: "/tmp/project-beta",
      locator_ref: ".aidn/project/shared-runtime.locator.json",
      shared_backend_kind: "postgres",
      workspace_count: 1,
      worktree_count: 1,
      planning_state_count: 1,
      handoff_relay_count: 1,
      coordination_record_count: 1,
      updated_at: "2026-04-03T10:05:00Z",
    },
  ];
  const workspaces = {
    "project-alpha": [
      {
        project_id: "project-alpha",
        workspace_id: "workspace-shared",
        workspace_id_source: "locator",
        project_id_source: "locator",
        project_root_ref: "/tmp/project-alpha",
        locator_ref: ".aidn/project/shared-runtime.locator.json",
        git_common_dir: "/tmp/project-alpha/.git",
        repo_root: "/tmp/project-alpha",
        shared_backend_kind: "postgres",
        updated_at: "2026-04-03T10:00:00Z",
      },
    ],
    "project-beta": [
      {
        project_id: "project-beta",
        workspace_id: "workspace-shared",
        workspace_id_source: "locator",
        project_id_source: "locator",
        project_root_ref: "/tmp/project-beta",
        locator_ref: ".aidn/project/shared-runtime.locator.json",
        git_common_dir: "/tmp/project-beta/.git",
        repo_root: "/tmp/project-beta",
        shared_backend_kind: "postgres",
        updated_at: "2026-04-03T10:05:00Z",
      },
    ],
  };
  return {
    enabled: true,
    configured: true,
    backend_kind: "postgres",
    status: "ready",
    reason: "fake project store",
    connection: {
      connection_ref: "env:AIDN_PG_URL",
      status: "resolved",
      driver: {
        package_name: "pg",
      },
    },
    store: {
      async listProjects() {
        return {
          ok: true,
          projects,
        };
      },
      async inspectProject({ projectId }) {
        return {
          ok: true,
          project: projects.find((item) => item.project_id === projectId) ?? null,
          workspaces: workspaces[projectId] ?? [],
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
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-coordination-projects-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.mkdirSync(targetRoot, { recursive: true });
    writeSharedRuntimeLocator(targetRoot, {
      enabled: true,
      projectId: "project-alpha",
      workspaceId: "workspace-shared",
      backend: {
        kind: "postgres",
        connectionRef: "env:AIDN_PG_URL",
      },
    });

    const missingEnv = runCli(["runtime", "shared-coordination-projects", "--target", targetRoot, "--json"]);
    assert(missingEnv.status === 1, "projects CLI should fail when PostgreSQL env is missing");
    assert(missingEnv.json?.ok === false, "projects CLI should fail when PostgreSQL env is missing");
    assert(missingEnv.json?.status === "missing-env", "projects CLI should surface missing-env status");

    const direct = await sharedCoordinationProjects({
      targetRoot,
      sharedCoordination: createFakeResolution(),
    });
    assert(direct.ok === true, "direct projects projection should succeed");
    assert(direct.projects.length === 2, "projects projection should list registered projects");

    const inspected = await sharedCoordinationProjects({
      targetRoot,
      projectId: "project-alpha",
      sharedCoordination: createFakeResolution(),
    });
    assert(inspected.ok === true, "project inspect projection should succeed");
    assert(inspected.inspected_project?.project_id === "project-alpha", "project inspect should expose the requested project");
    assert(inspected.inspected_workspaces.length === 1, "project inspect should expose workspace details");

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
