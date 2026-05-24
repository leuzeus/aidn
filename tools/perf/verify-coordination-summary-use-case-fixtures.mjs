#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { projectCoordinationSummary } from "../../src/application/runtime/coordination-summary-projector-use-case.mjs";

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

async function main() {
  let tempRoot = "";
  try {
    const repoRoot = process.cwd();
    const handoffProjectScript = path.resolve(repoRoot, "tools", "runtime", "project-handoff-packet.mjs");
    const dispatchExecuteScript = path.resolve(repoRoot, "tools", "runtime", "coordinator-dispatch-execute.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-coordination-summary-use-case-"));
    const readyTarget = path.join(tempRoot, "ready");
    const blockedTarget = path.join(tempRoot, "blocked");
    const dbOnlyTarget = path.join(tempRoot, "db-only");

    fs.cpSync(path.join(repoRoot, "tests", "fixtures", "perf-handoff", "ready"), readyTarget, { recursive: true });
    fs.cpSync(path.join(repoRoot, "tests", "fixtures", "perf-handoff", "blocked"), blockedTarget, { recursive: true });
    fs.cpSync(path.join(repoRoot, "tests", "fixtures", "perf-handoff", "ready"), dbOnlyTarget, { recursive: true });
    initGitRepo(readyTarget, { workingBranch: "feature/C101-alpha" });
    initGitRepo(blockedTarget, { workingBranch: "feature/C101-alpha" });
    initGitRepo(dbOnlyTarget, { workingBranch: "feature/C101-alpha" });

    runJson(handoffProjectScript, ["--target", readyTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", blockedTarget, "--json"], repoRoot, 0);
    runJson(handoffProjectScript, ["--target", dbOnlyTarget, "--json"], repoRoot, 0);

    const readyExecute = runJson(dispatchExecuteScript, ["--target", readyTarget, "--execute", "--json"], repoRoot, 1);
    const blockedExecute = runJson(dispatchExecuteScript, ["--target", blockedTarget, "--execute", "--json"], repoRoot, 0);
    appendHistoryEvent(dbOnlyTarget, {
      ts: "2026-03-09T02:00:00Z",
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
    });

    const readySummary = await projectCoordinationSummary({ targetRoot: readyTarget, historyFile: ".aidn/runtime/context/coordination-history.ndjson" });
    const blockedSummary = await projectCoordinationSummary({ targetRoot: blockedTarget, historyFile: ".aidn/runtime/context/coordination-history.ndjson" });
    const dbOnlySummary = await projectCoordinationSummary({
      targetRoot: dbOnlyTarget,
      historyFile: ".aidn/runtime/context/coordination-history.ndjson",
    });

    assert(readyExecute.execution_status === "escalated", "ready execution should surface escalation");
    assert(blockedExecute.execution_status === "executed", "blocked execution should surface executed dispatch execution");
    assert(readySummary.summary.history_status === "available", "use case should surface available history for ready");
    assert(blockedSummary.summary.history_status === "available", "use case should surface available history for blocked");
    assert(dbOnlySummary.state_mode === "files", "use case should surface files mode by default");
    assert(typeof readySummary.coordination_summary_diagnostic?.summary === "string", "use case should expose diagnostic summary");
    assert(typeof blockedSummary.coordination_summary_diagnostic?.summary === "string", "use case should expose diagnostic summary");
    assert(fs.existsSync(path.join(readyTarget, "docs", "audit", "COORDINATION-SUMMARY.md")), "ready projection should be materialized by use case");

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
