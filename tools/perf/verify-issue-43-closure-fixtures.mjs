#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const TOOL_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(TOOL_FILE), "..", "..");
const AIDN_BIN = path.join(REPO_ROOT, "bin", "aidn.mjs");
const DEFAULT_TARGET = path.join(REPO_ROOT, "tests", "fixtures", "repo-installed-core");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseArgs(argv) {
  const args = {
    target: DEFAULT_TARGET,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
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
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-issue-43-closure-fixtures.mjs --json");
}

function copyFixture(sourceRoot, tempRoot) {
  const targetRoot = path.join(tempRoot, "repo");
  fs.cpSync(sourceRoot, targetRoot, {
    recursive: true,
    filter(source) {
      return !source.replace(/\\/g, "/").includes("/.git/");
    },
  });
  removePathWithRetry(path.join(targetRoot, ".aidn", "runtime"));
  return targetRoot;
}

function runRaw(args, options = {}) {
  const result = spawnSync(process.execPath, [AIDN_BIN, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  const stdout = String(result.stdout ?? "").trim();
  return {
    status: result.status ?? 1,
    stdout,
    stderr: String(result.stderr ?? "").trim(),
    json: stdout ? JSON.parse(stdout) : null,
  };
}

function runJson(args, options = {}) {
  const result = runRaw(args, options);
  if (result.status !== 0) {
    throw new Error([
      `aidn ${args.join(" ")} failed`,
      `status=${result.status}`,
      result.stderr,
      result.stdout,
    ].filter(Boolean).join("\n"));
  }
  return result.json;
}

function runGit(targetRoot, args) {
  const result = spawnSync("git", ["-C", targetRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
}

async function main() {
  let tempRoot = "";
  let targetRoot = "";
  let daemonStarted = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceRoot = path.resolve(args.target);
    if (!fs.existsSync(sourceRoot)) {
      throw new Error(`Target fixture not found: ${sourceRoot}`);
    }
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-issue-43-closure-"));
    targetRoot = copyFixture(sourceRoot, tempRoot);
    runGit(targetRoot, ["init"]);
    runGit(targetRoot, ["config", "user.email", "aidn@example.com"]);
    runGit(targetRoot, ["config", "user.name", "aidn-ci"]);
    runGit(targetRoot, ["add", "."]);
    runGit(targetRoot, ["commit", "-m", "issue 43 closure fixture"]);

    const fullSync = runJson([
      "runtime",
      "sync-db-first",
      "--target",
      targetRoot,
      "--state-mode",
      "dual",
      "--store",
      "sqlite",
      "--json",
    ]);
    const selective = runJson([
      "runtime",
      "sync-db-first-selective",
      "--target",
      targetRoot,
      "--state-mode",
      "dual",
      "--json",
    ]);
    const hook = runJson([
      "codex",
      "run-json-hook",
      "--target",
      targetRoot,
      "--skill",
      "requirements-delta",
      "--mode",
      "COMMITTING",
      "--json",
    ]);
    const workflowStep = runRaw([
      "codex",
      "workflow-step",
      "--target",
      targetRoot,
      "--skills",
      "context-reload,requirements-delta",
      "--mode",
      "COMMITTING",
      "--json",
    ]);
    const started = runJson([
      "runtime",
      "local-daemon",
      "--start",
      "--target",
      targetRoot,
      "--port",
      "0",
      "--json",
    ]);
    daemonStarted = true;
    const daemonHook = runRaw([
      "codex",
      "run-json-hook",
      "--target",
      targetRoot,
      "--skill",
      "pr-orchestrate",
      "--mode",
      "COMMITTING",
      "--json",
      "--use-daemon",
      "--no-db-sync",
      "--daemon-timeout-ms",
      "60000",
    ]);
    const daemonWorkflow = runRaw([
      "codex",
      "workflow-step",
      "--target",
      targetRoot,
      "--skill",
      "requirements-delta",
      "--mode",
      "COMMITTING",
      "--json",
      "--use-daemon",
      "--daemon-timeout-ms",
      "60000",
    ]);
    const status = runJson([
      "runtime",
      "local-daemon",
      "--status",
      "--target",
      targetRoot,
      "--json",
    ]);

    const checks = {
      full_sync_created_runtime_index: fullSync.ok === true,
      no_change_fast_path_used: selective.fast_path?.used === true
        && selective.fast_path?.reason === "unchanged_clean_runtime_index",
      compact_hook_preserves_fast_path_decision: hook.output_mode === "compact"
        && hook.db_sync?.payload?.fast_path
        && typeof hook.db_sync.payload.fast_path.used === "boolean"
        && typeof hook.db_sync.payload.fast_path.reason === "string",
      compact_hook_keeps_raw_reference: String(hook.raw_payload_ref ?? hook.raw_file ?? "").length > 0
        && hook.normalized?.raw == null,
      workflow_step_contract_present: workflowStep.json?.contract_version === "codex-workflow-step.v1",
      workflow_step_runs_multiple_steps: Number(workflowStep.json?.summary?.step_count ?? 0) >= 3,
      daemon_start_reports_capabilities: started.daemon?.capabilities?.includes("codex.run-json-hook") === true
        && started.daemon?.capabilities?.includes("codex.workflow-step") === true,
      daemon_run_json_hook_delegates: daemonHook.json?.daemon?.used === true
        && daemonHook.json?.daemon?.fallback === false
        && daemonHook.json?.db_sync?.enabled === false,
      daemon_workflow_step_delegates: daemonWorkflow.json?.daemon?.used === true
        && daemonWorkflow.json?.daemon?.fallback === false
        && daemonWorkflow.json?.contract_version === "codex-workflow-step.v1",
      daemon_cache_diagnostics_present: typeof status.caches?.runtime_snapshot?.entries === "number"
        && typeof status.caches?.workspace_resolution?.hits === "number"
        && typeof status.caches?.postgres_pool?.entries === "number",
    };
    const pass = Object.values(checks).every(Boolean);
    const output = {
      ts: new Date().toISOString(),
      ok: pass,
      issue: 43,
      target_root: targetRoot,
      checks,
      evidence: {
        fast_path_reason: selective.fast_path?.reason ?? null,
        hook_output_mode: hook.output_mode ?? null,
        run_json_hook_daemon_status: daemonHook.status,
        workflow_step_daemon_status: daemonWorkflow.status,
        daemon_cache_stats: status.caches ?? null,
      },
      note: "Functional closure verifier; latency evidence remains in perf:measure-issue-43-latency.",
    };
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`verify-issue-43-closure: ${pass ? "PASS" : "FAIL"}`);
    }
    if (!pass) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exitCode = 1;
  } finally {
    if (daemonStarted && targetRoot) {
      runRaw([
        "runtime",
        "local-daemon",
        "--stop",
        "--target",
        targetRoot,
        "--json",
      ]);
    }
    if (tempRoot && fs.existsSync(tempRoot)) {
      removePathWithRetry(tempRoot);
    }
  }
}

await main();
