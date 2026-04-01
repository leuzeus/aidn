#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { writeSharedRuntimeLocator } from "../../src/lib/config/shared-runtime-locator-config-lib.mjs";
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

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-workspace-resolution-"));
    const mainRoot = path.join(tempRoot, "repo");
    const linkedRoot = path.join(tempRoot, "repo-linked");

    fs.mkdirSync(mainRoot, { recursive: true });
    runGit(mainRoot, ["init", "--initial-branch=main"]);
    runGit(mainRoot, ["config", "user.name", "aidn"]);
    runGit(mainRoot, ["config", "user.email", "aidn@example.test"]);
    fs.writeFileSync(path.join(mainRoot, "README.md"), "# fixture\n", "utf8");
    runGit(mainRoot, ["add", "README.md"]);
    runGit(mainRoot, ["commit", "-m", "initial"]);
    runGit(mainRoot, ["worktree", "add", linkedRoot, "-b", "feature/worktree-resolution"]);

    const mainContext = resolveWorkspaceContext({
      targetRoot: mainRoot,
      env: {},
    });
    const linkedContext = resolveWorkspaceContext({
      targetRoot: linkedRoot,
      env: {},
    });
    const explicitSharedContext = resolveWorkspaceContext({
      targetRoot: linkedRoot,
      env: {},
      sharedRuntimeRoot: ".aidn-shared",
      sharedBackendKind: "postgres",
      sharedRuntimeEnabled: true,
    });

    assert(mainContext.is_git_repo === true, "expected main checkout to be detected as git repo");
    assert(mainContext.is_linked_worktree === false, "expected main checkout not to be linked worktree");
    assert(linkedContext.is_linked_worktree === true, "expected linked checkout to be detected as linked worktree");
    assert(mainContext.workspace_id === linkedContext.workspace_id, "expected both worktrees to resolve the same workspace id");
    assert(mainContext.worktree_id !== linkedContext.worktree_id, "expected different worktree ids for different checkouts");
    assert(canonicalizePath(mainContext.git_common_dir) === canonicalizePath(linkedContext.git_common_dir), "expected both worktrees to share the same git common dir");
    assert(canonicalizePath(mainContext.repo_root) === canonicalizePath(mainRoot), "expected main repo root to match main checkout");
    assert(canonicalizePath(linkedContext.repo_root) === canonicalizePath(linkedRoot), "expected linked repo root to match linked checkout");
    assert(mainContext.shared_runtime_mode === "local-only", "expected default workspace mode to stay local-only");
    assert(mainContext.shared_backend_kind === "none", "expected default shared backend to be none");

    assert(explicitSharedContext.shared_runtime_enabled === true, "expected explicit shared runtime flag to be honored");
    assert(explicitSharedContext.shared_runtime_mode === "shared-runtime", "expected explicit shared runtime mode");
    assert(explicitSharedContext.shared_backend_kind === "postgres", "expected explicit postgres backend");
    assert(explicitSharedContext.shared_runtime_root.endsWith("/.aidn-shared"), "expected relative shared runtime root to resolve from worktree root");

    const envSharedContext = resolveWorkspaceContext({
      targetRoot: mainRoot,
      env: {
        AIDN_WORKSPACE_ID: "workspace-explicit",
        AIDN_SHARED_RUNTIME_ENABLED: "true",
        AIDN_SHARED_BACKEND_KIND: "sqlite-file",
        AIDN_SHARED_RUNTIME_ROOT: ".aidn-shared-env",
      },
    });

    assert(envSharedContext.workspace_id === "workspace-explicit", "expected env workspace id to override derived identity");
    assert(envSharedContext.workspace_id_source === "env", "expected env workspace id source");
    assert(envSharedContext.shared_runtime_enabled === true, "expected env shared runtime enabled");
    assert(envSharedContext.shared_backend_kind === "sqlite-file", "expected env backend kind");
    assert(envSharedContext.shared_runtime_root.endsWith("/.aidn-shared-env"), "expected env shared root to resolve from worktree root");

    writeSharedRuntimeLocator(mainRoot, {
      enabled: true,
      workspaceId: "workspace-locator",
      backend: {
        kind: "postgres",
        connectionRef: "env:AIDN_PG_URL",
      },
      projection: {
        localIndexMode: "preserve-current",
      },
    });
    writeSharedRuntimeLocator(linkedRoot, {
      enabled: true,
      workspaceId: "workspace-locator",
      backend: {
        kind: "sqlite-file",
        root: ".aidn-shared-locator",
      },
      projection: {
        localIndexMode: "preserve-current",
      },
    });

    const locatorMainContext = resolveWorkspaceContext({
      targetRoot: mainRoot,
      env: {},
    });
    const locatorLinkedContext = resolveWorkspaceContext({
      targetRoot: linkedRoot,
      env: {},
    });

    assert(locatorMainContext.workspace_id === "workspace-locator", "expected locator workspace id to override git-derived identity");
    assert(locatorMainContext.workspace_id_source === "locator", "expected locator workspace id source");
    assert(locatorMainContext.shared_runtime_mode === "shared-runtime", "expected locator-enabled shared runtime mode");
    assert(locatorMainContext.shared_backend_kind === "postgres", "expected locator postgres backend");
    assert(locatorMainContext.shared_runtime_connection_ref === "env:AIDN_PG_URL", "expected locator connection ref to be exposed");
    assert(locatorMainContext.shared_runtime_locator_ref === ".aidn/project/shared-runtime.locator.json", "expected logical locator ref");
    assert(locatorLinkedContext.shared_runtime_root.endsWith("/.aidn-shared-locator"), "expected locator root to resolve from the linked worktree");
    assert(locatorLinkedContext.shared_backend_kind === "sqlite-file", "expected linked locator backend kind");

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

main();
