#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectRuntimeState } from "../runtime/project-runtime-state.mjs";
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

function createFakeResolution() {
  const planningState = {
    workspace_id: "workspace-runtime-state",
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

async function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-state-shared-planning-"));
    const targetRoot = path.join(tempRoot, "repo");
    const outFile = path.join(tempRoot, "RUNTIME-STATE.md");
    fs.cpSync(path.resolve(process.cwd(), "tests", "fixtures", "perf-handoff", "ready"), targetRoot, { recursive: true });
    installCurrentStateBacklogPointer(targetRoot);
    fs.rmSync(path.join(targetRoot, "docs", "audit", "backlog", "BL-S101-session-planning.md"), { force: true });

    const result = await projectRuntimeState({
      targetRoot,
      out: outFile,
      sharedCoordination: createFakeResolution(),
    });
    const markdown = fs.readFileSync(outFile, "utf8");

    assert(result.digest.shared_planning_source === "shared-coordination", "runtime-state should expose shared planning provenance");
    assert(result.digest.shared_planning_read_status === "found", "runtime-state should expose a successful shared planning read");
    assert(result.digest.active_backlog === "backlog/BL-S101-session-planning.md", "runtime-state should expose the shared planning backlog");
    assert(result.digest.backlog_status === "promoted", "runtime-state should expose the shared planning backlog status");
    assert(result.digest.backlog_next_step === "implement alpha feature validation", "runtime-state should expose the shared planning next step");
    assert(result.digest.planning_arbitration_status === "resolved", "runtime-state should expose the shared planning arbitration status");
    assert(result.digest.prioritized_artifacts.includes("docs/audit/backlog/BL-S101-session-planning.md"), "runtime-state should prioritize the shared backlog artifact path");
    assert(markdown.includes("shared_planning_source: shared-coordination"), "runtime-state markdown should record shared planning provenance");
    assert(markdown.includes("active_backlog: backlog/BL-S101-session-planning.md"), "runtime-state markdown should record the shared backlog");

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
