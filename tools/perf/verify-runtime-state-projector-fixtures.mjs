#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-runtime-state-projector-fixtures.mjs");
}

function runJson(script, args, env = {}) {
  const stdout = execFileSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  return JSON.parse(stdout);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  try {
    const fixture = "tests/fixtures/repo-installed-core";
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-state-"));
    const outFile = path.join(tempRoot, "RUNTIME-STATE.md");

    const result = runJson("tools/runtime/project-runtime-state.mjs", [
      "--target", fixture,
      "--out", outFile,
      "--json",
    ]);

    const markdown = fs.readFileSync(outFile, "utf8");
    assert(typeof result?.digest?.project_id === "string" && result.digest.project_id.length > 0, "digest.project_id missing");
    assert(typeof result?.digest?.workspace_id === "string" && result.digest.workspace_id.length > 0, "digest.workspace_id missing");
    assert(typeof result?.digest?.worktree_id === "string" && result.digest.worktree_id.length > 0, "digest.worktree_id missing");
    assert(result?.digest?.runtime_state_mode, "digest.runtime_state_mode missing");
    assert(result?.digest?.repair_layer_status, "digest.repair_layer_status missing");
    assert(result?.digest?.repair_primary_reason, "digest.repair_primary_reason missing");
    assert(result?.digest?.shared_runtime_validation_status === "clear", "digest should expose clear shared runtime validation by default");
    assert(typeof result?.digest?.shared_planning_source === "string", "digest.shared_planning_source missing");
    assert(typeof result?.digest?.shared_planning_read_status === "string", "digest.shared_planning_read_status missing");
    assert(typeof result?.digest?.active_backlog === "string", "digest.active_backlog missing");
    assert(typeof result?.digest?.backlog_status === "string", "digest.backlog_status missing");
    assert(typeof result?.digest?.backlog_next_step === "string", "digest.backlog_next_step missing");
    assert(typeof result?.digest?.planning_arbitration_status === "string", "digest.planning_arbitration_status missing");
    assert(result?.digest?.current_state_freshness, "digest.current_state_freshness missing");
    assert(Array.isArray(result?.digest?.prioritized_artifacts), "digest.prioritized_artifacts missing");
    assert(result.digest.prioritized_artifacts.includes("docs/audit/CURRENT-STATE.md"), "digest missing CURRENT-STATE.md");
    assert(!markdown.includes("docs/audit/cycles/none-*/status.md"), "digest leaked none cycle path");
    assert(!markdown.includes("docs/audit/sessions/none*.md"), "digest leaked none session path");
    assert(markdown.includes("current_state_freshness: unknown"), "expected unknown freshness for empty installed fixture");

    const filelessRepo = path.join(tempRoot, "db-only-fileless");
    fs.cpSync(path.resolve(process.cwd(), "tests/fixtures/perf-handoff/ready"), filelessRepo, { recursive: true });
    runJson("tools/perf/index-sync.mjs", [
      "--target", filelessRepo,
      "--store", "sqlite",
      "--with-content",
      "--json",
    ], {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    fs.rmSync(path.join(filelessRepo, "docs", "audit", "CURRENT-STATE.md"), { force: true });
    fs.rmSync(path.join(filelessRepo, "docs", "audit", "cycles", "C101-feature-alpha", "status.md"), { force: true });
    const filelessOut = path.join(tempRoot, "RUNTIME-STATE-fileless.md");
    const fileless = runJson("tools/runtime/project-runtime-state.mjs", [
      "--target", filelessRepo,
      "--out", filelessOut,
      "--json",
    ], {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    const filelessMarkdown = fs.readFileSync(filelessOut, "utf8");
    assert(fileless.digest.runtime_state_mode === "db-only", "db-only fileless digest should preserve runtime_state_mode");
    assert(typeof fileless.digest.project_id === "string" && fileless.digest.project_id.length > 0, "db-only fileless digest should expose project_id");
    assert(fileless.digest.shared_runtime_validation_status === "clear", "db-only fileless digest should expose clear shared runtime validation");
    assert(fileless.digest.current_state_freshness === "ok", "db-only fileless digest should recover freshness from SQLite");
    assert(fileless.digest.consistency_status === "pass", "db-only fileless digest should keep consistency pass");
    assert(fileless.digest.current_state_source === "sqlite", "db-only fileless digest should load CURRENT-STATE from SQLite");
    assert(fileless.digest.cycle_status_source === "sqlite", "db-only fileless digest should load cycle status from SQLite");
    assert(typeof fileless.digest.shared_planning_source === "string", "db-only fileless digest should expose shared planning provenance");
    assert(filelessMarkdown.includes("project_id:"), "db-only fileless markdown should record project identity");
    assert(filelessMarkdown.includes("current_state_freshness: ok"), "db-only fileless markdown should record recovered freshness");

    const textOut = execFileSync(process.execPath, [
      "tools/runtime/project-runtime-state.mjs",
      "--target", fixture,
      "--out", outFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert(textOut.includes("Runtime state digest:"), "text mode missing digest line");
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
