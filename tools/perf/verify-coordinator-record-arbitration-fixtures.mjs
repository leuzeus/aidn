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
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--handoff-fixtures-root") {
      args.handoffFixturesRoot = String(argv[index + 1] ?? "").trim();
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

function runJson(script, args, repoRoot, expectStatus = 0) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
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
    const handoffProjectScript = path.resolve(repoRoot, "tools", "runtime", "project-handoff-packet.mjs");
    const summaryScript = path.resolve(repoRoot, "tools", "runtime", "project-coordination-summary.mjs");
    const loopScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-loop.mjs");
    const dispatchPlanScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-dispatch-plan.mjs");
    const recordArbitrationScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-record-arbitration.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-coordinator-arbitration-"));
    const escalatedTarget = path.join(tempRoot, "escalated");
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), escalatedTarget, { recursive: true });
    runJson(handoffProjectScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);

    appendHistoryEvent(escalatedTarget, buildDispatchEvent("2026-03-09T02:00:00Z"));
    appendHistoryEvent(escalatedTarget, buildDispatchEvent("2026-03-09T02:05:00Z"));
    appendHistoryEvent(escalatedTarget, buildDispatchEvent("2026-03-09T02:10:00Z"));
    appendHistoryEvent(escalatedTarget, buildDispatchEvent("2026-03-09T02:15:00Z"));
    appendHistoryEvent(escalatedTarget, buildDispatchEvent("2026-03-09T02:20:00Z"));
    runJson(summaryScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);

    const beforeLoop = runJson(loopScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    const beforeDispatch = runJson(dispatchPlanScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    const arbitration = runJson(recordArbitrationScript, ["--target", escalatedTarget, "--decision", "continue", "--note", "validated by user", "--json"], repoRoot, 0);
    const afterLoop = runJson(loopScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);
    const afterDispatch = runJson(dispatchPlanScript, ["--target", escalatedTarget, "--json"], repoRoot, 0);

    const arbitrationFile = path.join(escalatedTarget, "docs", "audit", "USER-ARBITRATION.md");
    const summaryFile = path.join(escalatedTarget, "docs", "audit", "COORDINATION-SUMMARY.md");
    const historyFile = path.join(escalatedTarget, ".aidn", "runtime", "context", "coordination-history.ndjson");

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

    const output = {
      ts: new Date().toISOString(),
      before_loop: beforeLoop,
      before_dispatch: beforeDispatch,
      arbitration,
      after_loop: afterLoop,
      after_dispatch: afterDispatch,
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
