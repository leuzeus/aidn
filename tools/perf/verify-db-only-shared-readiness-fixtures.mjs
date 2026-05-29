#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assessDbOnlyReadiness } from "../../src/application/runtime/db-only-readiness-service.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function installCurrentStateBacklogPointer(targetRoot) {
  const currentStateFile = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
  const currentStateText = fs.readFileSync(currentStateFile, "utf8");
  if (currentStateText.includes("active_backlog: backlog/BL-S101-session-planning.md")) {
    return;
  }
  fs.writeFileSync(currentStateFile, currentStateText.replace(
    "first_plan_step: implement alpha feature validation",
    [
      "first_plan_step: implement alpha feature validation",
      "active_backlog: backlog/BL-S101-session-planning.md",
      "backlog_status: promoted",
      "backlog_next_step: stale local backlog next step",
      "planning_arbitration_status: review_requested",
    ].join("\n"),
  ), "utf8");
}

function runIndexSync(targetRoot, repoRoot) {
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, "tools", "perf", "index-sync.mjs"),
    "--target",
    targetRoot,
    "--store",
    "sqlite",
    "--with-content",
    "--json",
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`index-sync failed: ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
}

function createFakeResolution() {
  const planningState = {
    workspace_id: "workspace-db-only-readiness",
    planning_key: "session:S101",
    session_id: "S101",
    backlog_artifact_ref: "backlog/BL-S101-session-planning.md",
    planning_status: "promoted",
    planning_arbitration_status: "resolved",
    next_dispatch_scope: "cycle",
    next_dispatch_action: "implement",
    backlog_next_step: "implement alpha feature validation",
    selected_execution_scope: "current_cycle",
    dispatch_ready: true,
    source_worktree_id: "worktree-main",
    payload: {
      planning_status: "promoted",
      planning_arbitration_status: "resolved",
      next_dispatch_scope: "cycle",
      next_dispatch_action: "implement",
      backlog_next_step: "implement alpha feature validation",
      selected_execution_scope: "current_cycle",
    },
    updated_at: "2030-01-01T00:00:00Z",
  };

  return {
    enabled: true,
    configured: true,
    backend_kind: "postgres",
    status: "ready",
    reason: "fake postgres store",
    connection: {
      connection_ref: "env:AIDN_PG_URL",
      status: "resolved",
      driver: {
        package_name: "pg",
      },
    },
    contract: {
      driver: {
        package_name: "pg",
      },
    },
    store: {
      describeContract() {
        return {
          backend_kind: "postgres",
        };
      },
      async bootstrap() {
        return { ok: true };
      },
      async healthcheck() {
        return {
          ok: true,
          database_name: "aidn_test",
          schema_name: "aidn_shared",
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
      async getPlanningState({ planningKey } = {}) {
        return {
          ok: true,
          planning_state: planningKey === "session:S101" ? planningState : null,
        };
      },
    },
  };
}

async function withDbOnlyEnv(fn) {
  const previousStateMode = process.env.AIDN_STATE_MODE;
  const previousIndexStoreMode = process.env.AIDN_INDEX_STORE_MODE;
  process.env.AIDN_STATE_MODE = "db-only";
  process.env.AIDN_INDEX_STORE_MODE = "sqlite";
  try {
    return await fn();
  } finally {
    if (previousStateMode == null) {
      delete process.env.AIDN_STATE_MODE;
    } else {
      process.env.AIDN_STATE_MODE = previousStateMode;
    }
    if (previousIndexStoreMode == null) {
      delete process.env.AIDN_INDEX_STORE_MODE;
    } else {
      process.env.AIDN_INDEX_STORE_MODE = previousIndexStoreMode;
    }
  }
}

async function main() {
  let tempRoot = "";
  try {
    const repoRoot = process.cwd();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-db-only-shared-readiness-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.cpSync(path.resolve(repoRoot, "tests", "fixtures", "perf-handoff", "ready"), targetRoot, { recursive: true });
    installCurrentStateBacklogPointer(targetRoot);
    runIndexSync(targetRoot, repoRoot);
    fs.rmSync(path.join(targetRoot, "docs", "audit", "backlog", "BL-S101-session-planning.md"), { force: true });

    const baseline = await withDbOnlyEnv(() => assessDbOnlyReadiness({
      targetRoot,
    }));
    assert(baseline.status === "fail", "db-only readiness should fail when the promoted backlog is missing locally");
    assert(baseline.checks.some((check) => check.id === "active_backlog_resolvable" && check.pass === false), "db-only readiness should fail the active backlog check without shared planning");

    const withSharedPlanning = await withDbOnlyEnv(() => assessDbOnlyReadiness({
      targetRoot,
      sharedCoordination: createFakeResolution(),
    }));
    assert(withSharedPlanning.status === "pass", "db-only readiness should pass when shared coordination exposes the promoted backlog");
    assert(withSharedPlanning.shared_planning.source === "shared-coordination", "db-only readiness should expose shared planning provenance");
    assert(withSharedPlanning.shared_planning.read_status === "found", "db-only readiness should expose a successful shared planning read");
    assert(withSharedPlanning.checks.some((check) => (
      check.id === "active_backlog_resolvable"
      && check.pass === true
      && String(check.details).includes("shared coordination")
    )), "db-only readiness should accept a missing local backlog when shared coordination carries it");
    assert(withSharedPlanning.resolutions.backlog_artifact.shared_planning_backed === true, "db-only readiness should mark the missing backlog as shared-planning-backed");

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
