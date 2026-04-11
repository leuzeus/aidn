#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { loadSharedStateSnapshot } from "../../src/application/runtime/shared-state-backend-service.mjs";
import { writeSharedRuntimeLocator } from "../../src/lib/config/shared-runtime-locator-config-lib.mjs";
import { projectSharedCoordinationStatus } from "../runtime/shared-coordination-status.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runGit(targetRoot, args) {
  execFileSync("git", ["-C", targetRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runJson(script, args, env = {}) {
  const stdout = execFileSync(process.execPath, [path.resolve(process.cwd(), script), ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  return JSON.parse(stdout);
}

function rmIfExists(filePath) {
  fs.rmSync(filePath, { force: true, recursive: true });
}

function canonicalizePath(value) {
  return path.resolve(String(value ?? "")).replace(/\\/g, "/").toLowerCase();
}

async function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-sqlite-boundary-"));
    const mainRoot = path.join(tempRoot, "repo");
    const linkedRoot = path.join(tempRoot, "repo-linked");
    const sharedRoot = path.join(tempRoot, "shared-sqlite");
    const env = {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    };

    fs.cpSync(path.resolve(process.cwd(), "tests/fixtures/perf-handoff/ready"), mainRoot, { recursive: true });
    runGit(mainRoot, ["init", "--initial-branch=main"]);
    runGit(mainRoot, ["config", "user.name", "aidn"]);
    runGit(mainRoot, ["config", "user.email", "aidn@example.test"]);
    runGit(mainRoot, ["add", "."]);
    runGit(mainRoot, ["commit", "-m", "fixture"]);
    runGit(mainRoot, ["worktree", "add", linkedRoot, "-b", "feature/shared-sqlite"]);

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      mainRoot,
      "--store",
      "sqlite",
      "--with-content",
      "--json",
    ], env);

    const localSqliteFile = path.join(mainRoot, ".aidn", "runtime", "index", "workflow-index.sqlite");
    const sharedSqliteFile = path.join(sharedRoot, "index", "workflow-index.sqlite");
    fs.mkdirSync(path.dirname(sharedSqliteFile), { recursive: true });
    fs.copyFileSync(localSqliteFile, sharedSqliteFile);

    const locator = {
      enabled: true,
      workspaceId: "workspace-shared-sqlite-boundary",
      backend: {
        kind: "sqlite-file",
        root: sharedRoot,
      },
      projection: {
        localIndexMode: "preserve-current",
      },
    };
    writeSharedRuntimeLocator(mainRoot, locator);
    writeSharedRuntimeLocator(linkedRoot, locator);

    rmIfExists(localSqliteFile);
    rmIfExists(path.join(linkedRoot, ".aidn", "runtime", "index", "workflow-index.sqlite"));
    rmIfExists(path.join(mainRoot, "docs", "audit", "CURRENT-STATE.md"));
    rmIfExists(path.join(linkedRoot, "docs", "audit", "CURRENT-STATE.md"));
    rmIfExists(path.join(mainRoot, "docs", "audit", "RUNTIME-STATE.md"));
    rmIfExists(path.join(linkedRoot, "docs", "audit", "RUNTIME-STATE.md"));

    const mainWorkspace = resolveWorkspaceContext({
      targetRoot: mainRoot,
      env,
    });
    const linkedWorkspace = resolveWorkspaceContext({
      targetRoot: linkedRoot,
      env,
    });
    assert(mainWorkspace.shared_runtime_mode === "shared-runtime", "main worktree should resolve shared-runtime mode");
    assert(linkedWorkspace.shared_runtime_mode === "shared-runtime", "linked worktree should resolve shared-runtime mode");
    assert(mainWorkspace.shared_backend_kind === "sqlite-file", "main worktree should resolve sqlite-file backend");
    assert(linkedWorkspace.shared_backend_kind === "sqlite-file", "linked worktree should resolve sqlite-file backend");
    assert(mainWorkspace.workspace_id === linkedWorkspace.workspace_id, "linked worktrees should share the same workspace id");
    assert(mainWorkspace.worktree_id !== linkedWorkspace.worktree_id, "linked worktrees should keep distinct worktree ids");

    const mainSnapshot = loadSharedStateSnapshot({
      targetRoot: mainRoot,
      workspace: mainWorkspace,
    });
    const linkedSnapshot = loadSharedStateSnapshot({
      targetRoot: linkedRoot,
      workspace: linkedWorkspace,
    });
    assert(mainSnapshot.exists === true, "main worktree should resolve shared sqlite snapshot");
    assert(linkedSnapshot.exists === true, "linked worktree should resolve shared sqlite snapshot");
    assert(mainSnapshot.backend?.projection_scope === "shared-runtime-root", "main worktree should expose shared-runtime-root projection");
    assert(linkedSnapshot.backend?.projection_scope === "shared-runtime-root", "linked worktree should expose shared-runtime-root projection");
    assert(canonicalizePath(mainSnapshot.sqliteFile) === canonicalizePath(sharedSqliteFile), "main worktree should point to the shared sqlite file");
    assert(canonicalizePath(linkedSnapshot.sqliteFile) === canonicalizePath(sharedSqliteFile), "linked worktree should point to the shared sqlite file");

    const mainRuntimeState = runJson("tools/runtime/project-runtime-state.mjs", [
      "--target",
      mainRoot,
      "--json",
    ], env);
    const linkedRuntimeState = runJson("tools/runtime/project-runtime-state.mjs", [
      "--target",
      linkedRoot,
      "--json",
    ], env);
    assert(mainRuntimeState.shared_state_backend?.projection_scope === "shared-runtime-root", "main runtime-state should expose shared-runtime-root projection");
    assert(linkedRuntimeState.shared_state_backend?.projection_scope === "shared-runtime-root", "linked runtime-state should expose shared-runtime-root projection");
    assert(mainRuntimeState.digest?.current_state_source === "sqlite", "main runtime-state should recover CURRENT-STATE from shared sqlite");
    assert(linkedRuntimeState.digest?.current_state_source === "sqlite", "linked runtime-state should recover CURRENT-STATE from shared sqlite");

    const mainStatus = await projectSharedCoordinationStatus({
      targetRoot: mainRoot,
    });
    const linkedStatus = await projectSharedCoordinationStatus({
      targetRoot: linkedRoot,
    });
    assert(mainStatus.shared_coordination_backend.backend_kind === "sqlite-file", "main shared-coordination status should expose sqlite-file backend kind");
    assert(linkedStatus.shared_coordination_backend.backend_kind === "sqlite-file", "linked shared-coordination status should expose sqlite-file backend kind");
    assert(mainStatus.shared_coordination_backend.status === "disabled", "sqlite-file should not activate the shared PostgreSQL coordination store");
    assert(linkedStatus.shared_coordination_backend.status === "disabled", "sqlite-file should keep shared coordination disabled in linked worktrees");

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
