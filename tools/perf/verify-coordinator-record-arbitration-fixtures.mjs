#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function parseArgs(argv) {
  const args = {
    handoffFixturesRoot: "tests/fixtures/perf-handoff",
    integrationFixturesRoot: "tests/fixtures/perf-integration-risk",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--handoff-fixtures-root") {
      args.handoffFixturesRoot = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--integration-fixtures-root") {
      args.integrationFixturesRoot = String(argv[index + 1] ?? "").trim();
      index += 1;
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
  console.log("  node tools/perf/verify-coordinator-record-arbitration-fixtures.mjs");
  console.log("  node tools/perf/verify-coordinator-record-arbitration-fixtures.mjs --json");
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

function buildDispatchEvent(ts) {
  return {
    ts,
    event: "coordinator_dispatch",
    selected_agent: "codex",
    recommended_role: "executor",
    recommended_action: "implement",
    goal: "implement alpha feature validation",
    dispatch_status: "ready",
    execution_status: "executed",
    entrypoint_kind: "skill",
    entrypoint_name: "branch-cycle-audit",
    stop_required: false,
    executed: true,
    executed_steps: [],
  };
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const handoffFixturesRoot = path.resolve(repoRoot, args.handoffFixturesRoot);
    const integrationFixturesRoot = path.resolve(repoRoot, args.integrationFixturesRoot);
    const handoffProjectScript = path.resolve(repoRoot, "tools", "runtime", "project-handoff-packet.mjs");
    const summaryScript = path.resolve(repoRoot, "tools", "runtime", "project-coordination-summary.mjs");
    const loopScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-loop.mjs");
    const dispatchPlanScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-dispatch-plan.mjs");
    const recordArbitrationScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-record-arbitration.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-coordinator-arbitration-"));
    const escalatedTarget = path.join(tempRoot, "escalated");
    const integrationTarget = path.join(tempRoot, "integration-cycle");
    const dbOnlyTarget = path.join(tempRoot, "db-only-escalated");
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), escalatedTarget, { recursive: true });
    fs.cpSync(path.join(integrationFixturesRoot, "integration-cycle"), integrationTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), dbOnlyTarget, { recursive: true });
    runJson(handoffProjectScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", dbOnlyTarget, "--json"], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });

    appendHistoryEvent(escalatedTarget, buildDispatchEvent("2026-03-09T02:00:00Z"));
    appendHistoryEvent(escalatedTarget, buildDispatchEvent("2026-03-09T02:05:00Z"));
    appendHistoryEvent(escalatedTarget, buildDispatchEvent("2026-03-09T02:10:00Z"));
    appendHistoryEvent(escalatedTarget, buildDispatchEvent("2026-03-09T02:15:00Z"));
    appendHistoryEvent(escalatedTarget, buildDispatchEvent("2026-03-09T02:20:00Z"));
    runJson(summaryScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    appendHistoryEvent(dbOnlyTarget, buildDispatchEvent("2026-03-09T02:00:00Z"));
    appendHistoryEvent(dbOnlyTarget, buildDispatchEvent("2026-03-09T02:05:00Z"));
    appendHistoryEvent(dbOnlyTarget, buildDispatchEvent("2026-03-09T02:10:00Z"));
    appendHistoryEvent(dbOnlyTarget, buildDispatchEvent("2026-03-09T02:15:00Z"));
    appendHistoryEvent(dbOnlyTarget, buildDispatchEvent("2026-03-09T02:20:00Z"));
    runJson(summaryScript, ["--target", dbOnlyTarget, "--json"], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });

    const beforeLoop = runJson(loopScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    const beforeDispatch = runJson(dispatchPlanScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    const arbitration = runJson(recordArbitrationScript, ["--target", escalatedTarget, "--decision", "continue", "--note", "validated by user", "--json"], repoRoot, 0);
    const afterLoop = runJson(loopScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    const afterDispatch = runJson(dispatchPlanScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    const integrationArbitration = runJson(recordArbitrationScript, ["--target", integrationTarget, "--decision", "integration_cycle", "--note", "use a dedicated integration vehicle", "--json"], repoRoot, 0);
    const integrationLoop = runJson(loopScript, ["--target", integrationTarget, "--json"], repoRoot, 0);
    const integrationDispatch = runJson(dispatchPlanScript, ["--target", integrationTarget, "--json"], repoRoot, 0);
    const dbOnlyArbitration = runJson(recordArbitrationScript, ["--target", dbOnlyTarget, "--decision", "continue", "--note", "validated by user", "--json"], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    const dbOnlyLoop = runJson(loopScript, ["--target", dbOnlyTarget, "--json"], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    const dbOnlyDispatch = runJson(dispatchPlanScript, ["--target", dbOnlyTarget, "--json"], repoRoot, 0, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });

    const arbitrationFile = path.join(escalatedTarget, "docs", "audit", "USER-ARBITRATION.md");
    const summaryFile = path.join(escalatedTarget, "docs", "audit", "COORDINATION-SUMMARY.md");
    const historyFile = path.join(escalatedTarget, ".aidn", "runtime", "context", "coordination-history.ndjson");
    const dbOnlyArbitrationFile = path.join(dbOnlyTarget, "docs", "audit", "USER-ARBITRATION.md");

    assert(beforeLoop.loop.escalation.level === "user_arbitration_required", "loop should escalate before user arbitration");
    assert(beforeDispatch.dispatch_status === "escalated", "dispatch should be escalated before user arbitration");
    assert(arbitration.arbitration_log_appended === true, "arbitration command should append user arbitration log");
    assert(arbitration.coordination_history_appended === true, "arbitration command should append history");
    assert(fs.existsSync(arbitrationFile), "user arbitration file should exist");
    assert(fs.readFileSync(arbitrationFile, "utf8").includes("decision: continue"), "user arbitration file should record the decision");
    assert(fs.readFileSync(historyFile, "utf8").includes("\"event\":\"user_arbitration\""), "history should record user arbitration event");
    assert(fs.readFileSync(summaryFile, "utf8").includes("last_arbitration_decision: continue"), "summary should record last arbitration decision");
    assert(afterLoop.loop.status === "arbitrated", "loop should become arbitrated after user arbitration");
    assert(afterLoop.loop.escalation.level === "none", "loop escalation should be cleared after user arbitration");
    assert(afterLoop.recommendation.role === "executor", "user arbitration continue should restore executor relay");
    assert(afterDispatch.dispatch_status === "ready", "dispatch should return to ready after user arbitration");
    assert(afterDispatch.entrypoint_name === "branch-cycle-audit", "dispatch should restore the implementation entrypoint");
    assert(integrationArbitration.arbitration_event.decision === "integration_cycle", "integration fixture should record integration_cycle arbitration");
    assert(integrationLoop.loop.status === "arbitrated", "integration-cycle arbitration should be reflected in the loop state");
    assert(integrationLoop.recommendation.role === "coordinator", "integration-cycle arbitration should keep routing on the coordinator");
    assert(integrationLoop.recommendation.action === "coordinate", "integration-cycle arbitration should request coordination");
    assert(/integration cycle/i.test(String(integrationLoop.recommendation.goal ?? "")), "integration-cycle arbitration should explain the dedicated vehicle goal");
    assert(integrationDispatch.dispatch_status === "ready", "matching integration-cycle arbitration should clear the integration gate");
    assert(integrationDispatch.integration_risk_gate.active === false, "integration-cycle arbitration should deactivate the integration gate");
    assert(integrationDispatch.integration_risk_gate.applied_decision === "integration_cycle", "dispatch should record the applied integration decision");
    assert(integrationDispatch.entrypoint_name === "start-session", "integration-cycle arbitration should keep the coordination entrypoint");
    assert(dbOnlyArbitration.state_mode === "db-only", "db-only arbitration should resolve state mode");
    assert(dbOnlyArbitration.arbitration_db_first_applied === true, "db-only arbitration should upsert USER-ARBITRATION to SQLite");
    assert(dbOnlyArbitration.arbitration_db_first_materialized === false, "db-only arbitration should not materialize USER-ARBITRATION on disk");
    assert(fs.existsSync(dbOnlyArbitrationFile) === false, "db-only arbitration should stay fileless on disk");
    assert(dbOnlyLoop.loop.status === "arbitrated", "db-only arbitration should still affect loop state");
    assert(dbOnlyDispatch.dispatch_status === "ready", "db-only arbitration should still clear escalated dispatch state");

    const output = {
      ts: new Date().toISOString(),
      before_loop: beforeLoop,
      before_dispatch: beforeDispatch,
      arbitration,
      after_loop: afterLoop,
      after_dispatch: afterDispatch,
      integration_arbitration: integrationArbitration,
      integration_loop: integrationLoop,
      integration_dispatch: integrationDispatch,
      db_only_arbitration: dbOnlyArbitration,
      db_only_loop: dbOnlyLoop,
      db_only_dispatch: dbOnlyDispatch,
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
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
