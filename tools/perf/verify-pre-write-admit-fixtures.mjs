#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    fixturesRoot: "tests/fixtures/perf-handoff",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--fixtures-root") {
      args.fixturesRoot = String(argv[i + 1] ?? "").trim();
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
  console.log("  node tools/perf/verify-pre-write-admit-fixtures.mjs");
  console.log("  node tools/perf/verify-pre-write-admit-fixtures.mjs --fixtures-root tests/fixtures/perf-handoff --json");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runAidn(repoRoot, args, expectStatus = 0) {
  const cli = path.resolve(repoRoot, "bin", "aidn.mjs");
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== expectStatus) {
    throw new Error(`Command failed (aidn ${args.join(" ")}): ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "{}"));
}

function installSharedPlanningFixture(targetRoot, { selectedExecutionScope = "none" } = {}) {
  const currentStateFile = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
  const currentStateText = fs.readFileSync(currentStateFile, "utf8");
  fs.writeFileSync(currentStateFile, currentStateText.replace(
    "first_plan_step: implement alpha feature validation",
    [
      "first_plan_step: implement alpha feature validation",
      "active_backlog: backlog/BL-S101-session-planning.md",
      "backlog_status: promoted",
      "backlog_next_step: select the first cycle scope",
      `backlog_selected_execution_scope: ${selectedExecutionScope}`,
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
    "backlog_next_step: select the first cycle scope",
    `selected_execution_scope: ${selectedExecutionScope}`,
    "",
  ].join("\n"), "utf8");
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const fixturesRoot = path.resolve(repoRoot, args.fixturesRoot);
    const readyTarget = path.join(fixturesRoot, "ready");
    const blockedTarget = path.join(fixturesRoot, "blocked");
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-pre-write-admit-"));
    const cycleCreateTarget = path.join(tempRoot, "cycle-create");
    fs.cpSync(readyTarget, cycleCreateTarget, { recursive: true });
    installSharedPlanningFixture(cycleCreateTarget, { selectedExecutionScope: "none" });

    const ready = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      readyTarget,
      "--skill",
      "requirements-delta",
      "--json",
    ], 0);
    const blocked = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      blockedTarget,
      "--skill",
      "requirements-delta",
      "--strict",
      "--json",
    ], 1);
    const cycleCreateBlocked = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      cycleCreateTarget,
      "--skill",
      "cycle-create",
      "--strict",
      "--json",
    ], 1);

    assert(ready.ok === true, "ready pre-write admission should pass");
    assert(ready.admission_status === "admitted", "ready pre-write admission should be admitted");
    assert(ready.context.active_cycle === "C101", "ready pre-write admission should expose active cycle");
    assert(ready.context.first_plan_step === "implement alpha feature validation", "ready pre-write admission should keep first plan step");
    assert(Array.isArray(ready.prioritized_artifacts) && ready.prioritized_artifacts.includes("docs/audit/CURRENT-STATE.md"), "ready pre-write admission should prioritize CURRENT-STATE.md");

    assert(blocked.ok === false, "blocked pre-write admission should fail");
    assert(blocked.admission_status === "blocked", "blocked pre-write admission should report blocked");
    assert(blocked.context.repair_layer_status === "block", "blocked pre-write admission should expose repair block");
    assert(blocked.blocking_reasons.some((item) => String(item).includes("repair layer is blocking")), "blocked pre-write admission should expose repair blocking reason");
    assert(blocked.blocking_findings.includes("branch_cycle_mismatch"), "blocked pre-write admission should expose blocking findings");
    assert(cycleCreateBlocked.ok === false, "cycle-create pre-write admission should fail when shared planning scope is missing");
    assert(cycleCreateBlocked.context.active_backlog === "backlog/BL-S101-session-planning.md", "cycle-create pre-write admission should expose the active backlog");
    assert(cycleCreateBlocked.context.backlog_selected_execution_scope === "none", "cycle-create pre-write admission should expose the missing execution scope");
    assert(cycleCreateBlocked.blocking_reasons.some((item) => String(item).includes("selected execution scope")), "cycle-create pre-write admission should explain the missing shared planning scope");

    const output = {
      ts: new Date().toISOString(),
      fixtures_root: fixturesRoot,
      ready,
      blocked,
      cycle_create_blocked: cycleCreateBlocked,
      pass: true,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Fixtures root: ${fixturesRoot}`);
      console.log("Result: PASS");
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
