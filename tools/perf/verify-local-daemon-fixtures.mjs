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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function copyFixture(sourceRoot, tempRoot) {
  const targetRoot = path.join(tempRoot, "repo");
  fs.cpSync(sourceRoot, targetRoot, {
    recursive: true,
    filter(source) {
      return !source.replace(/\\/g, "/").includes("/.git/");
    },
  });
  return targetRoot;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runAidn(args, cwd = REPO_ROOT) {
  const result = spawnSync(process.execPath, [AIDN_BIN, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = String(result.stdout ?? "").trim();
  return {
    status: result.status ?? 1,
    stdout,
    stderr: String(result.stderr ?? "").trim(),
    json: stdout ? JSON.parse(stdout) : null,
  };
}

function runAidnJson(args, cwd = REPO_ROOT) {
  const result = runAidn(args, cwd);
  if ((result.status ?? 1) !== 0) {
    throw new Error([
      `aidn ${args.join(" ")} failed`,
      `status=${result.status}`,
      result.stderr,
      result.stdout,
    ].filter(Boolean).join("\n"));
  }
  return result.json;
}

async function main() {
  let tempRoot = "";
  let targetRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-local-daemon-"));
    targetRoot = copyFixture(path.join(REPO_ROOT, "tests", "fixtures", "repo-installed-core"), tempRoot);
    const endpointFile = path.join(targetRoot, ".aidn", "runtime", "daemon", "endpoint.json");
    const started = runAidnJson([
      "runtime",
      "local-daemon",
      "--start",
      "--target",
      targetRoot,
      "--port",
      "0",
      "--json",
    ]);
    const endpoint = readJson(endpointFile);
    const endpointExistsBeforeStop = fs.existsSync(endpointFile);
    const endpointPortBeforeStop = Number(endpoint.daemon?.port ?? 0);
    const status = runAidnJson([
      "runtime",
      "local-daemon",
      "--status",
      "--target",
      targetRoot,
      "--json",
    ]);
    const delegated = runAidnJson([
      "codex",
      "workflow-step",
      "--target",
      targetRoot,
      "--skills",
      "context-reload,requirements-delta",
      "--mode",
      "COMMITTING",
      "--json",
      "--use-daemon",
      "--daemon-timeout-ms",
      "60000",
    ]);
    const delegatedHook = runAidnJson([
      "codex",
      "run-json-hook",
      "--target",
      targetRoot,
      "--skill",
      "context-reload",
      "--mode",
      "THINKING",
      "--json",
      "--use-daemon",
      "--daemon-timeout-ms",
      "60000",
    ]);
    const fallback = runAidnJson([
      "codex",
      "workflow-step",
      "--target",
      targetRoot,
      "--skills",
      "context-reload",
      "--mode",
      "THINKING",
      "--json",
      "--use-daemon",
      "--daemon-endpoint-file",
      ".aidn/runtime/daemon/missing-endpoint.json",
      "--daemon-timeout-ms",
      "200",
    ]);
    const fallbackHook = runAidnJson([
      "codex",
      "run-json-hook",
      "--target",
      targetRoot,
      "--skill",
      "context-reload",
      "--mode",
      "THINKING",
      "--json",
      "--use-daemon",
      "--daemon-endpoint-file",
      ".aidn/runtime/daemon/missing-endpoint.json",
      "--daemon-timeout-ms",
      "200",
    ]);
    const stopped = runAidnJson([
      "runtime",
      "local-daemon",
      "--stop",
      "--target",
      targetRoot,
      "--json",
    ]);
    const statusAfterStop = runAidn([
      "runtime",
      "local-daemon",
      "--status",
      "--target",
      targetRoot,
      "--json",
    ]);

    const checks = {
      start_reports_daemon_contract: started.contract_version === "runtime-local-daemon.v1",
      start_writes_endpoint: endpointExistsBeforeStop
        && endpointPortBeforeStop === Number(started.daemon?.port ?? -1),
      status_uses_endpoint: status.ok === true
        && Number(status.daemon?.port ?? 0) === Number(started.daemon?.port ?? -1),
      status_reports_capability: Array.isArray(status.daemon?.capabilities)
        && status.daemon.capabilities.includes("codex.workflow-step"),
      status_reports_run_json_hook_capability: Array.isArray(status.daemon?.capabilities)
        && status.daemon.capabilities.includes("codex.run-json-hook"),
      delegated_preserves_workflow_contract: delegated.contract_version === "codex-workflow-step.v1",
      delegated_uses_daemon: delegated.daemon?.used === true && delegated.daemon?.fallback === false,
      delegated_uses_endpoint_file: String(delegated.daemon?.endpoint_file ?? "").replace(/\\/g, "/").endsWith(".aidn/runtime/daemon/endpoint.json"),
      delegated_preserves_steps: delegated.steps?.some((step) => step.id === "coordinator-next-action") === true,
      delegated_hook_uses_daemon: delegatedHook.daemon?.used === true && delegatedHook.daemon?.fallback === false,
      delegated_hook_uses_endpoint_file: String(delegatedHook.daemon?.endpoint_file ?? "").replace(/\\/g, "/").endsWith(".aidn/runtime/daemon/endpoint.json"),
      delegated_hook_preserves_compact_output: delegatedHook.output_mode === "compact"
        && delegatedHook.skill === "context-reload"
        && delegatedHook.normalized?.raw == null,
      fallback_preserves_workflow_contract: fallback.contract_version === "codex-workflow-step.v1",
      fallback_reports_batch_fallback: fallback.daemon?.used === false && fallback.daemon?.fallback === true,
      fallback_reason_present: String(fallback.daemon?.reason ?? "").length > 0,
      fallback_hook_reports_batch_fallback: fallbackHook.daemon?.used === false && fallbackHook.daemon?.fallback === true,
      fallback_hook_reason_present: String(fallbackHook.daemon?.reason ?? "").length > 0,
      stop_reports_stopped: stopped.ok === true && stopped.stopped === true,
      stop_removes_endpoint: !fs.existsSync(endpointFile),
      status_after_stop_unavailable: statusAfterStop.status === 1
        && statusAfterStop.json?.ok === false
        && statusAfterStop.json?.daemon?.status === "unavailable",
    };
    for (const [name, passed] of Object.entries(checks)) {
      assert(passed, `failed check: ${name}; sample=${JSON.stringify({
        endpoint_exists_before_stop: endpointExistsBeforeStop,
        endpoint_exists_after_stop: fs.existsSync(endpointFile),
        endpoint_port: endpointPortBeforeStop,
        started_port: started?.daemon?.port ?? null,
        status_port: status?.daemon?.port ?? null,
        delegated_daemon: delegated?.daemon ?? null,
        delegated_hook_daemon: delegatedHook?.daemon ?? null,
        fallback_hook_daemon: fallbackHook?.daemon ?? null,
        stopped: stopped ?? null,
        status_after_stop: statusAfterStop?.json ?? null,
      })}`);
    }

    console.log("PASS local daemon fixture checks");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (targetRoot) {
      runAidn([
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
