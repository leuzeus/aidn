#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

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

function createOwnedTempRoot() {
  const requested = String(process.env.AIDN_TEST_RUNTIME_STATE_PROJECTOR_TEMP_ROOT ?? "").trim();
  if (!requested) {
    return fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-state-"));
  }

  const tempBase = path.resolve(os.tmpdir());
  const absolute = path.resolve(requested);
  const relative = path.relative(tempBase, absolute);
  assert(
    relative !== ""
      && !relative.startsWith(`..${path.sep}`)
      && relative !== ".."
      && !path.isAbsolute(relative),
    "injected runtime-state projector temp root must be below the operating-system temp directory",
  );
  assert(
    path.basename(absolute).startsWith("aidn-runtime-state-injected-"),
    "injected runtime-state projector temp root must use the governed test prefix",
  );
  assert(!fs.existsSync(absolute), `injected runtime-state projector temp root already exists: ${absolute}`);
  fs.mkdirSync(absolute);
  return absolute;
}

function verifyInjectedFailureCleanup() {
  const injectedTempRoot = path.join(
    os.tmpdir(),
    `aidn-runtime-state-injected-${process.pid}-${randomUUID()}`,
  );
  assert(!fs.existsSync(injectedTempRoot), "injected projector temp root must start absent");
  const script = fileURLToPath(import.meta.url);
  const child = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AIDN_TEST_RUNTIME_STATE_PROJECTOR_INJECT_FAILURE: "after-temp-create",
      AIDN_TEST_RUNTIME_STATE_PROJECTOR_FAILURE_CHILD: "1",
      AIDN_TEST_RUNTIME_STATE_PROJECTOR_TEMP_ROOT: injectedTempRoot,
    },
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
  assert(child.status === 1, "injected projector failure should exit non-zero");
  assert(
    String(child.stderr).includes("injected runtime-state projector fixture failure"),
    "injected projector failure did not reach the expected point",
  );
  assert(
    !fs.existsSync(injectedTempRoot),
    `injected projector failure leaked its owned temp directory: ${injectedTempRoot}`,
  );
  return true;
}

function main() {
  let tempRoot = "";
  let resultPayload = null;
  let primaryError = null;
  let cleanupError = null;
  try {
    const fixture = "tests/fixtures/repo-installed-core";
    tempRoot = createOwnedTempRoot();
    if (process.env.AIDN_TEST_RUNTIME_STATE_PROJECTOR_INJECT_FAILURE === "after-temp-create") {
      throw new Error("injected runtime-state projector fixture failure");
    }
    const outFile = path.join(tempRoot, "RUNTIME-STATE.md");

    const result = runJson("tools/runtime/project-runtime-state.mjs", [
      "--target", fixture,
      "--out", outFile,
      "--json",
      "--write",
    ]);

    const markdown = fs.readFileSync(outFile, "utf8");
    assert(typeof result?.digest?.project_id === "string" && result.digest.project_id.length > 0, "digest.project_id missing");
    assert(typeof result?.digest?.workspace_id === "string" && result.digest.workspace_id.length > 0, "digest.workspace_id missing");
    assert(typeof result?.digest?.worktree_id === "string" && result.digest.worktree_id.length > 0, "digest.worktree_id missing");
    assert(result?.digest?.contract_version === "critical-markdown-v1", "digest.contract_version missing");
    assert(result?.digest?.runtime_state_mode, "digest.runtime_state_mode missing");
    assert(result?.digest?.repair_layer_status, "digest.repair_layer_status missing");
    assert(result?.digest?.repair_primary_reason, "digest.repair_primary_reason missing");
    assert(typeof result?.digest?.source_of_truth === "string" && result.digest.source_of_truth.length > 0, "digest.source_of_truth missing");
    assert(result?.digest?.source_mode === "explicit", "digest.source_mode missing");
    assert(typeof result?.digest?.lifecycle_status === "string" && result.digest.lifecycle_status.length > 0, "digest.lifecycle_status missing");
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
    assert(markdown.includes("contract_version: critical-markdown-v1"), "expected explicit contract_version in runtime-state markdown");
    assert(markdown.includes("source_of_truth:"), "expected source_of_truth in runtime-state markdown");
    assert(markdown.includes("source_mode: explicit"), "expected explicit source_mode in runtime-state markdown");
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
      "--write",
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
    assert(fileless.digest.contract_version === "critical-markdown-v1", "db-only fileless digest should expose explicit contract version");
    assert(typeof fileless.digest.source_of_truth === "string" && fileless.digest.source_of_truth.length > 0, "db-only fileless digest should expose source_of_truth");
    assert(fileless.digest.source_mode === "explicit", "db-only fileless digest should expose source_mode");
    assert(fileless.digest.current_state_source === "sqlite", "db-only fileless digest should load CURRENT-STATE from SQLite");
    assert(fileless.digest.cycle_status_source === "sqlite", "db-only fileless digest should load cycle status from SQLite");
    assert(typeof fileless.digest.shared_planning_source === "string", "db-only fileless digest should expose shared planning provenance");
    assert(filelessMarkdown.includes("project_id:"), "db-only fileless markdown should record project identity");
    assert(filelessMarkdown.includes("contract_version: critical-markdown-v1"), "db-only fileless markdown should record explicit contract version");
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
    const injectedFailureCleanup = process.env.AIDN_TEST_RUNTIME_STATE_PROJECTOR_FAILURE_CHILD === "1"
      ? null
      : verifyInjectedFailureCleanup();
    resultPayload = {
      ok: true,
      status: "PASS",
      success_cleanup: true,
      injected_failure_cleanup: injectedFailureCleanup,
      cleanup_scope: "process-owned",
      owned_test_directories_remaining: 0,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    if (tempRoot) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        cleanupError = cleanup.error;
      } else if (fs.existsSync(tempRoot)) {
        cleanupError = new Error(`runtime-state fixture temp directory remains: ${tempRoot}`);
      }
    }
  }

  if (primaryError || cleanupError) {
    if (primaryError) {
      console.error(`ERROR: ${primaryError.message}`);
    }
    if (cleanupError) {
      console.error(`ERROR: ${cleanupError.message}`);
    }
    printUsage();
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(resultPayload, null, 2));
}

main();
