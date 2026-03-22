#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    handoffFixturesRoot: "tests/fixtures/perf-handoff",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--handoff-fixtures-root") {
      args.handoffFixturesRoot = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-coordinator-loop-fixtures.mjs");
  console.log("  node tools/perf/verify-coordinator-loop-fixtures.mjs --json");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(script, args, repoRoot, expectStatus = 0, env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== expectStatus) {
    throw new Error(`Command failed (${path.basename(script)}): ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "{}"));
}

function appendHistoryEvent(targetRoot, event) {
  const historyFile = path.join(targetRoot, ".aidn", "runtime", "context", "coordination-history.ndjson");
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.appendFileSync(historyFile, `${JSON.stringify(event)}\n`, "utf8");
}

function buildEvent({ ts, role, action, goal, executionStatus = "executed", dispatchStatus = "ready", stopRequired = false }) {
  return {
    ts,
    event: "coordinator_dispatch",
    selected_agent: "codex",
    recommended_role: role,
    recommended_action: action,
    goal,
    dispatch_status: dispatchStatus,
    execution_status: executionStatus,
    entrypoint_kind: "skill",
    entrypoint_name: "branch-cycle-audit",
    stop_required: stopRequired,
    executed: executionStatus === "executed",
    executed_steps: [],
  };
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const handoffFixturesRoot = path.resolve(repoRoot, args.handoffFixturesRoot);
    const handoffProjectScript = path.resolve(repoRoot, "tools", "runtime", "project-handoff-packet.mjs");
    const summaryScript = path.resolve(repoRoot, "tools", "runtime", "project-coordination-summary.mjs");
    const loopScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-loop.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-coordinator-loop-"));
    const readyTarget = path.join(tempRoot, "ready");
    const blockedTarget = path.join(tempRoot, "blocked");
    const failedTarget = path.join(tempRoot, "failed");
    const repeatedTarget = path.join(tempRoot, "repeated");
    const dbOnlyFilelessTarget = path.join(tempRoot, "db-only-fileless");
    const dbOnlySummaryFilelessTarget = path.join(tempRoot, "db-only-summary-fileless");

    fs.cpSync(path.join(handoffFixturesRoot, "ready"), readyTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "blocked"), blockedTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), failedTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), repeatedTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), dbOnlyFilelessTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), dbOnlySummaryFilelessTarget, { recursive: true });

    runJson(handoffProjectScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", blockedTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", failedTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", repeatedTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", dbOnlyFilelessTarget, "--json"], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    runJson(handoffProjectScript, ["--target", dbOnlySummaryFilelessTarget, "--json"], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    runJson(path.resolve(repoRoot, "tools", "perf", "index-sync.mjs"), [
      "--target", dbOnlyFilelessTarget,
      "--store", "sqlite",
      "--with-content",
      "--json",
    ], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    for (const rel of [
      "docs/audit/CURRENT-STATE.md",
      "docs/audit/RUNTIME-STATE.md",
      "docs/audit/HANDOFF-PACKET.md",
      "docs/audit/sessions/S101-alpha.md",
      "docs/audit/cycles/C101-feature-alpha/status.md",
    ]) {
      fs.rmSync(path.join(dbOnlyFilelessTarget, rel), { force: true });
    }

    runJson(summaryScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    runJson(summaryScript, ["--target", blockedTarget, "--json"], repoRoot, 0);

    appendHistoryEvent(failedTarget, buildEvent({
      ts: "2026-03-09T02:00:00Z",
      role: "executor",
      action: "implement",
      goal: "implement alpha feature validation",
      executionStatus: "failed",
      dispatchStatus: "ready",
    }));
    appendHistoryEvent(failedTarget, buildEvent({
      ts: "2026-03-09T02:05:00Z",
      role: "executor",
      action: "implement",
      goal: "implement alpha feature validation",
      executionStatus: "failed",
      dispatchStatus: "ready",
    }));
    runJson(summaryScript, ["--target", failedTarget, "--json"], repoRoot, 0);

    appendHistoryEvent(repeatedTarget, buildEvent({
      ts: "2026-03-09T02:00:00Z",
      role: "executor",
      action: "implement",
      goal: "implement alpha feature validation",
    }));
    appendHistoryEvent(repeatedTarget, buildEvent({
      ts: "2026-03-09T02:05:00Z",
      role: "executor",
      action: "implement",
      goal: "implement alpha feature validation",
    }));
    appendHistoryEvent(repeatedTarget, buildEvent({
      ts: "2026-03-09T02:10:00Z",
      role: "executor",
      action: "implement",
      goal: "implement alpha feature validation",
    }));
    runJson(summaryScript, ["--target", repeatedTarget, "--json"], repoRoot, 0);
    appendHistoryEvent(dbOnlySummaryFilelessTarget, buildEvent({
      ts: "2026-03-09T02:00:00Z",
      role: "executor",
      action: "implement",
      goal: "implement alpha feature validation",
    }));
    runJson(summaryScript, ["--target", dbOnlySummaryFilelessTarget, "--json"], repoRoot, 0);
    runJson(path.resolve(repoRoot, "tools", "perf", "index-sync.mjs"), [
      "--target", dbOnlySummaryFilelessTarget,
      "--store", "sqlite",
      "--with-content",
      "--json",
    ], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    fs.rmSync(path.join(dbOnlySummaryFilelessTarget, "docs", "audit", "COORDINATION-SUMMARY.md"), { force: true });

    const ready = runJson(loopScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    const blocked = runJson(loopScript, ["--target", blockedTarget, "--json"], repoRoot, 0);
    const failed = runJson(loopScript, ["--target", failedTarget, "--json"], repoRoot, 0);
    const repeated = runJson(loopScript, ["--target", repeatedTarget, "--json"], repoRoot, 0);
    const dbOnlyFileless = runJson(loopScript, ["--target", dbOnlyFilelessTarget, "--json"], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    const dbOnlySummaryFileless = runJson(loopScript, ["--target", dbOnlySummaryFilelessTarget, "--json"], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });

    assert(ready.loop.status === "history_empty", "ready loop should report empty history");
    assert(ready.recommendation.role === "executor", "ready loop should preserve executor relay");
    assert(ready.recommendation.action === "implement", "ready loop should preserve implement relay");
    assert(ready.loop.summary_alignment.status === "aligned" || ready.loop.summary_alignment.status === "not_required", "ready summary should be aligned or not required");
    assert(ready.loop.escalation.level === "none", "ready loop should not escalate");

    assert(blocked.loop.status === "gated", "blocked loop should stay gated");
    assert(blocked.recommendation.role === "repair", "blocked loop should route to repair");
    assert(blocked.recommendation.action === "repair", "blocked loop should keep repair action");
    assert(blocked.loop.escalation.level === "watch", "blocked loop should remain in watch escalation");

    assert(failed.loop.status === "reanchor_after_failure", "failed loop should require reanchor");
    assert(failed.recommendation.role === "coordinator", "failed loop should route back to coordinator");
    assert(failed.recommendation.action === "coordinate", "failed loop should route to coordination after escalation");
    assert(failed.recommendation.source === "coordination-escalation", "failed loop should cite escalation");
    assert(failed.loop.escalation.level === "user_arbitration_required", "failed loop should escalate after repeated failures");

    assert(repeated.loop.status === "repeat_detected", "repeated loop should detect repeated relay");
    assert(repeated.recommendation.role === "coordinator", "repeated loop should route to coordinator");
    assert(repeated.recommendation.action === "coordinate", "repeated loop should coordinate instead of replaying blindly");
    assert(repeated.loop.history.repeated_dispatch_count === 3, "repeated loop should count repeated relays");
    assert(repeated.loop.escalation.level === "none", "three repeated relays should not yet force human arbitration");
    assert(dbOnlyFileless.loop.status === "history_empty", "db-only fileless loop should still report empty history");
    assert(dbOnlyFileless.recommendation.role === "executor", "db-only fileless loop should preserve executor relay");
    assert(dbOnlyFileless.recommendation.action === "implement", "db-only fileless loop should preserve implement relay");
    assert(dbOnlyFileless.context.current_state_source === "sqlite", "db-only fileless loop should load current state from SQLite");
    assert(dbOnlyFileless.context.packet_source === "sqlite", "db-only fileless loop should load packet from SQLite");
    assert(dbOnlySummaryFileless.loop.history.total_dispatches === 1, "db-only summary fileless loop should preserve history");
    assert(dbOnlySummaryFileless.loop.summary_source === "sqlite", "db-only summary fileless loop should load coordination summary from SQLite");
    assert(dbOnlySummaryFileless.loop.summary_alignment.status === "aligned", "db-only summary fileless loop should keep summary alignment");

    const output = {
      ts: new Date().toISOString(),
      ready,
      blocked,
      failed,
      repeated,
      db_only_fileless: dbOnlyFileless,
      db_only_summary_fileless: dbOnlySummaryFileless,
      pass: true,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log("PASS");
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
