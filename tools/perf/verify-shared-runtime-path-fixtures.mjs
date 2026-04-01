#!/usr/bin/env node
import {
  canonicalizeRuntimePath,
  isSameOrChildRuntimePath,
  resolveRuntimePath,
} from "../../src/application/runtime/shared-runtime-path-lib.mjs";
import { validateSharedRuntimeContext } from "../../src/application/runtime/shared-runtime-validation-service.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  try {
    const winSharedRoot = resolveRuntimePath("C:\\Repo\\Main", ".aidn-shared", {
      platform: "win32",
    });
    const linuxSharedRoot = resolveRuntimePath("/repo/main", ".aidn-shared", {
      platform: "linux",
    });
    assert(winSharedRoot === "c:/repo/main/.aidn-shared", "expected win32 relative path resolution to normalize drive letter and separators");
    assert(linuxSharedRoot === "/repo/main/.aidn-shared", "expected linux relative path resolution to stay posix");
    assert(canonicalizeRuntimePath("C:/Repo/Main/Docs/", {
      platform: "win32",
    }) === "c:/repo/main/docs", "expected win32 canonicalization to lower-case and trim trailing separators");
    assert(isSameOrChildRuntimePath("C:\\Repo\\Main\\Docs\\Audit", "c:/repo/main/docs", {
      platform: "win32",
    }) === true, "expected win32 path containment to work across slash styles");
    assert(isSameOrChildRuntimePath("/repo/main/docs/audit", "/repo/main/docs", {
      platform: "linux",
    }) === true, "expected linux path containment to work");

    const winRejected = validateSharedRuntimeContext({
      targetRoot: "C:\\Repo\\Main",
      workspace: {
        target_root: "C:\\Repo\\Main",
        worktree_root: "C:\\Repo\\Main",
        git_dir: "C:\\Repo\\Main\\.git",
        shared_runtime_mode: "shared-runtime",
        shared_runtime_root: "C:\\Repo\\Main\\docs\\audit\\shared-runtime",
        shared_backend_kind: "sqlite-file",
        shared_runtime_connection_ref: null,
        workspace_id: "workspace-win",
        workspace_id_source: "locator",
        is_linked_worktree: false,
      },
      locatorState: {
        exists: true,
        ref: ".aidn/project/shared-runtime.locator.json",
        data: {
          enabled: true,
          workspaceId: "workspace-win",
          backend: {
            kind: "sqlite-file",
            root: "C:\\Repo\\Main\\docs\\audit\\shared-runtime",
            connectionRef: "",
          },
          projection: {
            localIndexMode: "preserve-current",
          },
        },
      },
      platform: "win32",
    });
    assert(winRejected.ok === false, "expected win32 docs/audit overlap to be rejected");
    assert(winRejected.status === "reject", "expected win32 overlap validation status reject");
    assert(winRejected.issues.some((item) => String(item).includes("overlaps versioned workflow artifacts")), "expected win32 overlap rejection reason");

    const linuxRejected = validateSharedRuntimeContext({
      targetRoot: "/repo/main",
      workspace: {
        target_root: "/repo/main",
        worktree_root: "/repo/main",
        git_dir: "/repo/main/.git",
        shared_runtime_mode: "shared-runtime",
        shared_runtime_root: "/repo/main/.git/shared-runtime",
        shared_backend_kind: "sqlite-file",
        shared_runtime_connection_ref: null,
        workspace_id: "workspace-linux",
        workspace_id_source: "locator",
        is_linked_worktree: false,
      },
      locatorState: {
        exists: true,
        ref: ".aidn/project/shared-runtime.locator.json",
        data: {
          enabled: true,
          workspaceId: "workspace-linux",
          backend: {
            kind: "sqlite-file",
            root: "/repo/main/.git/shared-runtime",
            connectionRef: "",
          },
          projection: {
            localIndexMode: "preserve-current",
          },
        },
      },
      platform: "linux",
    });
    assert(linuxRejected.ok === false, "expected linux .git overlap to be rejected");
    assert(linuxRejected.issues.some((item) => String(item).includes("overlaps git metadata")), "expected linux .git overlap rejection reason");

    const linuxValid = validateSharedRuntimeContext({
      targetRoot: "/repo/main",
      workspace: {
        target_root: "/repo/main",
        worktree_root: "/repo/main",
        git_dir: "/repo/main/.git",
        shared_runtime_mode: "shared-runtime",
        shared_runtime_root: "/srv/aidn/workspace-shared",
        shared_backend_kind: "sqlite-file",
        shared_runtime_connection_ref: null,
        workspace_id: "workspace-linux",
        workspace_id_source: "locator",
        is_linked_worktree: true,
      },
      locatorState: {
        exists: true,
        ref: ".aidn/project/shared-runtime.locator.json",
        data: {
          enabled: true,
          workspaceId: "workspace-linux",
          backend: {
            kind: "sqlite-file",
            root: "/srv/aidn/workspace-shared",
            connectionRef: "",
          },
          projection: {
            localIndexMode: "preserve-current",
          },
        },
      },
      platform: "linux",
    });
    assert(linuxValid.ok === true, "expected linux shared root outside the worktree to validate");
    assert(linuxValid.status === "clear", "expected linux shared root outside the worktree to be clear");

    const workspaceMismatch = validateSharedRuntimeContext({
      targetRoot: "C:\\Repo\\Main",
      workspace: {
        target_root: "C:\\Repo\\Main",
        worktree_root: "C:\\Repo\\Main",
        git_dir: "C:\\Repo\\Main\\.git",
        shared_runtime_mode: "shared-runtime",
        shared_runtime_root: "D:\\aidn\\shared",
        shared_backend_kind: "sqlite-file",
        shared_runtime_connection_ref: null,
        workspace_id: "workspace-env",
        workspace_id_source: "env",
        is_linked_worktree: false,
      },
      env: {
        AIDN_WORKSPACE_ID: "workspace-env",
      },
      locatorState: {
        exists: true,
        ref: ".aidn/project/shared-runtime.locator.json",
        data: {
          enabled: true,
          workspaceId: "workspace-locator",
          backend: {
            kind: "sqlite-file",
            root: "D:\\aidn\\shared",
            connectionRef: "",
          },
          projection: {
            localIndexMode: "preserve-current",
          },
        },
      },
      platform: "win32",
    });
    assert(workspaceMismatch.ok === false, "expected locator/env workspace mismatch to be rejected");
    assert(workspaceMismatch.issues.some((item) => String(item).includes("workspace_id mismatch")), "expected locator/env workspace mismatch reason");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
