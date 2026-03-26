#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  persistWorkflowRunId,
  writeRunIdFile,
} from "../../src/application/runtime/workflow-session-service.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-runtime-path-cleanup-fixtures.mjs");
}

function run(repoRoot, relativeScript, argv) {
  const result = spawnSync(process.execPath, [
    path.resolve(repoRoot, relativeScript),
    ...argv,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function main() {
  let tempRoot = "";
  try {
    const repoRoot = process.cwd();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-cleanup-"));
    const target = path.join(tempRoot, "repo");
    fs.mkdirSync(path.join(target, ".git"), { recursive: true });

    const deliveryStart = run(repoRoot, "tools/perf/delivery-window.mjs", [
      "--target",
      target,
      "--action",
      "start",
      "--mode",
      "COMMITTING",
    ]);
    const statePath = path.join(target, ".aidn", "runtime", "perf", "delivery-window.json");
    const eventPath = path.join(target, ".aidn", "runtime", "perf", "workflow-events.ndjson");
    const stateExistsAfterStart = fs.existsSync(statePath);

    const deliveryEnd = run(repoRoot, "tools/perf/delivery-window.mjs", [
      "--target",
      target,
      "--action",
      "end",
      "--mode",
      "COMMITTING",
    ]);

    const runIdFile = path.join(target, ".aidn", "runtime", "perf", "current-run-id.txt");
    writeRunIdFile(runIdFile, "session-123");
    const removedRunIdPath = persistWorkflowRunId({
      phase: "session-close",
      runIdFilePath: runIdFile,
      runId: "session-123",
    });

    const checks = {
      delivery_start_ok: deliveryStart.status === 0,
      delivery_start_wrote_state: stateExistsAfterStart,
      delivery_end_ok: deliveryEnd.status === 0,
      delivery_end_removed_state: fs.existsSync(statePath) === false,
      delivery_events_exist: fs.existsSync(eventPath),
      delivery_end_mentions_end: deliveryEnd.stdout.includes("Delivery window ended."),
      session_close_removed_run_id: fs.existsSync(runIdFile) === false,
      session_close_returned_path: removedRunIdPath === runIdFile,
    };

    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      target_root: target,
      checks,
      samples: {
        delivery_start_stdout: deliveryStart.stdout.trim().split(/\r?\n/),
        delivery_end_stdout: deliveryEnd.stdout.trim().split(/\r?\n/),
      },
      pass,
    };

    console.log(JSON.stringify(output, null, 2));
    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
