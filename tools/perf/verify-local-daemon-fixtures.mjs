#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForReadyFile(filePath, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(filePath)) {
      return readJson(filePath);
    }
    await sleep(100);
  }
  throw new Error(`daemon ready file not written: ${filePath}`);
}

function requestHealth({ host, port }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host,
      port,
      method: "GET",
      path: "/health",
      timeout: 2500,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body || "{}"));
        } catch (error) {
          reject(new Error(`invalid health JSON: ${error.message}`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("health request timed out")));
    request.on("error", reject);
    request.end();
  });
}

function runAidnJson(args, cwd = REPO_ROOT) {
  const result = spawnSync(process.execPath, [AIDN_BIN, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error([
      `aidn ${args.join(" ")} failed`,
      `status=${result.status}`,
      String(result.stderr ?? "").trim(),
      String(result.stdout ?? "").trim(),
    ].filter(Boolean).join("\n"));
  }
  return JSON.parse(String(result.stdout ?? "{}"));
}

async function stopProcess(child) {
  if (!child || child.killed) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(5000).then(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

async function main() {
  let tempRoot = "";
  let daemon = null;
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-local-daemon-"));
    const targetRoot = copyFixture(path.join(REPO_ROOT, "tests", "fixtures", "repo-installed-core"), tempRoot);
    const readyFile = path.join(tempRoot, "daemon-ready.json");
    daemon = spawn(process.execPath, [
      path.join(REPO_ROOT, "tools", "runtime", "local-daemon.mjs"),
      "--serve",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--ready-file",
      readyFile,
    ], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    daemon.on("error", (error) => {
      throw error;
    });

    const ready = await waitForReadyFile(readyFile);
    const host = ready.daemon.host;
    const port = ready.daemon.port;
    const health = await requestHealth({ host, port });
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
      "--daemon-host",
      host,
      "--daemon-port",
      String(port),
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
      "--daemon-host",
      "127.0.0.1",
      "--daemon-port",
      "9",
      "--daemon-timeout-ms",
      "200",
    ]);

    const checks = {
      ready_file_reports_daemon_contract: ready.contract_version === "runtime-local-daemon.v1",
      health_reports_capability: Array.isArray(health.daemon?.capabilities)
        && health.daemon.capabilities.includes("codex.workflow-step"),
      delegated_preserves_workflow_contract: delegated.contract_version === "codex-workflow-step.v1",
      delegated_uses_daemon: delegated.daemon?.used === true && delegated.daemon?.fallback === false,
      delegated_preserves_steps: delegated.steps?.some((step) => step.id === "coordinator-next-action") === true,
      fallback_preserves_workflow_contract: fallback.contract_version === "codex-workflow-step.v1",
      fallback_reports_batch_fallback: fallback.daemon?.used === false && fallback.daemon?.fallback === true,
      fallback_reason_present: String(fallback.daemon?.reason ?? "").length > 0,
    };
    for (const [name, passed] of Object.entries(checks)) {
      assert(passed, `failed check: ${name}`);
    }

    console.log("PASS local daemon fixture checks");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await stopProcess(daemon);
    if (tempRoot && fs.existsSync(tempRoot)) {
      removePathWithRetry(tempRoot);
    }
  }
}

await main();
