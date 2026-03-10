#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { initGitRepo } from "./test-git-fixture-lib.mjs";

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
  console.log("  node tools/perf/verify-coordination-summary-fixtures.mjs");
  console.log("  node tools/perf/verify-coordination-summary-fixtures.mjs --json");
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

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const handoffFixturesRoot = path.resolve(repoRoot, args.handoffFixturesRoot);
    const handoffProjectScript = path.resolve(repoRoot, "tools", "runtime", "project-handoff-packet.mjs");
    const dispatchExecuteScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-dispatch-execute.mjs");
    const summaryScript = path.resolve(repoRoot, "tools", "runtime", "project-coordination-summary.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-coordination-summary-"));
    const readyTarget = path.join(tempRoot, "ready");
    const blockedTarget = path.join(tempRoot, "blocked");

    fs.cpSync(path.join(handoffFixturesRoot, "ready"), readyTarget, { recursive: true });
    fs.cpSync(path.join(handoffFixturesRoot, "blocked"), blockedTarget, { recursive: true });
    initGitRepo(readyTarget, { workingBranch: "feature/C101-alpha" });
    initGitRepo(blockedTarget, { workingBranch: "feature/C101-alpha" });

    runJson(handoffProjectScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", blockedTarget, "--json"], repoRoot, 0);
    const readyExecute = runJson(dispatchExecuteScript, ["--target", readyTarget, "--execute", "--json"], repoRoot, 0);
    const blockedExecute = runJson(dispatchExecuteScript, ["--target", blockedTarget, "--execute", "--json"], repoRoot, 0);

    const readySummary = runJson(summaryScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    const blockedSummary = runJson(summaryScript, ["--target", blockedTarget, "--json"], repoRoot, 0);

    const readySummaryFile = path.join(readyTarget, "docs", "audit", "COORDINATION-SUMMARY.md");
    const blockedSummaryFile = path.join(blockedTarget, "docs", "audit", "COORDINATION-SUMMARY.md");
    const readySummaryText = fs.readFileSync(readySummaryFile, "utf8");
    const blockedSummaryText = fs.readFileSync(blockedSummaryFile, "utf8");

    assert(readyExecute.coordination_summary_written === true, "ready execution should refresh coordination summary");
    assert(blockedExecute.coordination_summary_written === true, "blocked execution should refresh coordination summary");
    assert(fs.existsSync(readySummaryFile), "ready summary file should exist");
    assert(fs.existsSync(blockedSummaryFile), "blocked summary file should exist");

    assert(readySummary.summary.history_status === "available", "ready summary should report available history");
    assert(readySummary.summary.total_dispatches >= 1, "ready summary should report dispatches");
    assert(readySummary.summary.last_recommended_role === "executor", "ready summary should track executor role");
    assert(readySummary.summary.last_execution_status === "executed", "ready summary should track execution status");
    assert(readySummaryText.includes("recommended_role_counts:"), "ready summary markdown should include aggregate role counts");
    assert(readySummaryText.includes("executor"), "ready summary markdown should mention executor");

    assert(blockedSummary.summary.history_status === "available", "blocked summary should report available history");
    assert(blockedSummary.summary.total_dispatches >= 1, "blocked summary should report dispatches");
    assert(blockedSummary.summary.last_recommended_role === "repair", "blocked summary should track repair role");
    assert(blockedSummary.summary.last_execution_status === "executed", "blocked summary should track execution status");
    assert(blockedSummaryText.includes("repair"), "blocked summary markdown should mention repair");

    const output = {
      ts: new Date().toISOString(),
      ready_execute: readyExecute,
      blocked_execute: blockedExecute,
      ready_summary: readySummary,
      blocked_summary: blockedSummary,
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
