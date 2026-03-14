#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    handoffFixturesRoot: "tests/fixtures/perf-handoff",
    currentStateFixturesRoot: "tests/fixtures/perf-current-state",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--handoff-fixtures-root") {
      args.handoffFixturesRoot = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--current-state-fixtures-root") {
      args.currentStateFixturesRoot = String(argv[i + 1] ?? "").trim();
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
  console.log("  node tools/perf/verify-coordinator-next-action-fixtures.mjs");
  console.log("  node tools/perf/verify-coordinator-next-action-fixtures.mjs --json");
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
    maxBuffer: 10 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== expectStatus) {
    throw new Error(`Command failed (${path.basename(script)}): ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "{}"));
}

function installSharedPlanningFixture(targetRoot) {
  const currentStateFile = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
  const currentStateText = fs.readFileSync(currentStateFile, "utf8");
  fs.writeFileSync(currentStateFile, currentStateText.replace(
    "first_plan_step: implement alpha feature validation",
    [
      "first_plan_step: implement alpha feature validation",
      "active_backlog: backlog/BL-S101-session-planning.md",
      "backlog_status: promoted",
      "backlog_next_step: implement alpha feature validation",
      "planning_arbitration_status: none",
    ].join("\n"),
  ), "utf8");
  const backlogDir = path.join(targetRoot, "docs", "audit", "backlog");
  fs.mkdirSync(backlogDir, { recursive: true });
  fs.writeFileSync(path.join(backlogDir, "BL-S101-session-planning.md"), [
    "# Session Backlog - S101",
    "",
    "## Summary",
    "",
    "updated_at: 2026-03-09T01:03:00Z",
    "session_id: S101",
    "session_branch: S101-alpha",
    "mode: COMMITTING",
    "planning_status: promoted",
    "linked_cycles: C101",
    "dispatch_ready: yes",
    "planning_arbitration_status: none",
    "next_dispatch_scope: cycle",
    "next_dispatch_action: implement",
    "backlog_next_step: implement alpha feature validation",
    "",
  ].join("\n"), "utf8");
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const handoffFixturesRoot = path.resolve(repoRoot, args.handoffFixturesRoot);
    const currentStateFixturesRoot = path.resolve(repoRoot, args.currentStateFixturesRoot);
    const coordinatorScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-next-action.mjs");
    const handoffProjectScript = path.resolve(repoRoot, "tools", "runtime", "project-handoff-packet.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-coordinator-next-"));
    const readyTarget = path.join(tempRoot, "ready");
    const warnTarget = path.join(tempRoot, "warn");
    const blockedTarget = path.join(tempRoot, "blocked");
    const tamperedTarget = path.join(tempRoot, "tampered");
    const transitionRejectedTarget = path.join(tempRoot, "transition-rejected");
    const fallbackTarget = path.join(tempRoot, "fallback");

    fs.cpSync(path.join(handoffFixturesRoot, "ready"), readyTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "warn"), warnTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "blocked"), blockedTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), tamperedTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "ready"), transitionRejectedTarget, { recursive: true });
    fs.cpSync(path.join(currentStateFixturesRoot, "active"), fallbackTarget, { recursive: true });
    installSharedPlanningFixture(readyTarget);

    runJson(handoffProjectScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", warnTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", blockedTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", tamperedTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", transitionRejectedTarget, "--json"], repoRoot, 0);

    const tamperedPacketPath = path.join(tamperedTarget, "docs", "audit", "HANDOFF-PACKET.md");
    const tamperedText = fs.readFileSync(tamperedPacketPath, "utf8").replace("active_cycle: C101", "active_cycle: C999");
    fs.writeFileSync(tamperedPacketPath, tamperedText, "utf8");
    const transitionRejectedPacketPath = path.join(transitionRejectedTarget, "docs", "audit", "HANDOFF-PACKET.md");
    const transitionRejectedText = fs.readFileSync(transitionRejectedPacketPath, "utf8")
      .replace("handoff_from_agent_role: coordinator", "handoff_from_agent_role: repair")
      .replace("handoff_from_agent_action: relay", "handoff_from_agent_action: repair")
      .replace("transition_policy_status: allowed", "transition_policy_status: transition_not_allowed")
      .replace("transition_policy_reason: COMMITTING allows coordinator -> executor", "transition_policy_reason: COMMITTING does not allow repair -> executor");
    fs.writeFileSync(transitionRejectedPacketPath, transitionRejectedText, "utf8");

    const fallbackRuntimeState = path.join(fallbackTarget, "docs", "audit", "RUNTIME-STATE.md");
    fs.writeFileSync(fallbackRuntimeState, [
      "# Runtime State Digest",
      "",
      "## Summary",
      "",
      "updated_at: 2026-03-09T01:05:00Z",
      "runtime_state_mode: dual",
      "repair_layer_status: ok",
      "repair_layer_advice: continue with the planned implementation flow",
      "repair_routing_hint: execution-or-audit",
      "repair_routing_reason: repair layer reports no blocking findings for the current relay",
      "",
      "## Current State Freshness",
      "",
      "current_state_freshness: ok",
      "current_state_freshness_basis: current-state timestamps are aligned with active cycle timestamps",
      "",
      "## Blocking Findings",
      "",
      "blocking_findings:",
      "- none",
      "",
      "## Prioritized Reads",
      "",
      "prioritized_artifacts:",
      "- `docs/audit/CURRENT-STATE.md`",
      "",
    ].join("\n"), "utf8");

    const ready = runJson(coordinatorScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    const warn = runJson(coordinatorScript, ["--target", warnTarget, "--json"], repoRoot, 0);
    const blocked = runJson(coordinatorScript, ["--target", blockedTarget, "--json"], repoRoot, 0);
    const tampered = runJson(coordinatorScript, ["--target", tamperedTarget, "--json"], repoRoot, 0);
    const transitionRejected = runJson(coordinatorScript, ["--target", transitionRejectedTarget, "--json"], repoRoot, 0);
    const fallback = runJson(coordinatorScript, ["--target", fallbackTarget, "--json"], repoRoot, 0);

    assert(ready.recommendation.role === "executor", "ready should route to executor");
    assert(ready.recommendation.action === "implement", "ready should route to implement");
    assert(ready.recommendation.source === "handoff-shared-planning", "ready should come from shared planning handoff");
    assert(ready.preferred_dispatch_source === "shared_planning", "ready should expose shared planning provenance");
    assert(ready.shared_planning_candidate?.shared_planning_candidate_ready === "yes", "ready should expose a ready shared planning candidate");
    assert(ready.shared_planning_candidate?.shared_planning_candidate_aligned === "yes", "ready should expose an aligned shared planning candidate");
    assert(ready.scope.scope_type === "cycle", "ready should preserve cycle scope");
    assert(ready.scope.scope_id === "C101", "ready should preserve active cycle id");

    assert(warn.recommendation.role === "auditor", "warn should route to auditor");
    assert(warn.recommendation.action === "audit", "warn should route to audit");
    assert(warn.scope.scope_type === "cycle", "warn should preserve cycle scope");

    assert(blocked.recommendation.role === "repair", "blocked should route to repair");
    assert(blocked.recommendation.action === "repair", "blocked should route to repair action");
    assert(blocked.recommendation.stop_required === true, "blocked should require stop");
    assert(blocked.scope.scope_type === "cycle", "blocked should preserve cycle scope");

    assert(tampered.recommendation.role === "coordinator", "tampered should fall back to coordinator");
    assert(tampered.recommendation.action === "reanchor", "tampered should fall back to reanchor");
    assert(tampered.recommendation.source === "handoff-admit", "tampered should come from handoff-admit");

    assert(transitionRejected.recommendation.role === "coordinator", "transition-rejected should fall back to coordinator");
    assert(transitionRejected.recommendation.action === "reanchor", "transition-rejected should fall back to reanchor");
    assert(transitionRejected.recommendation.source === "handoff-admit", "transition-rejected should come from handoff-admit");

    assert(fallback.recommendation.role === "executor", "fallback should route to executor");
    assert(fallback.recommendation.action === "implement", "fallback should route to implement");
    assert(fallback.recommendation.source === "current-state", "fallback should come from current-state");
    assert(fallback.scope.scope_type === "cycle", "fallback should derive cycle scope from current state");

    const output = {
      ts: new Date().toISOString(),
      ready,
      warn,
      blocked,
      tampered,
      transition_rejected: transitionRejected,
      fallback,
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
