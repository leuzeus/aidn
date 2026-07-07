#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const TOOL_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(TOOL_FILE), "..", "..");
const DEFAULT_FIXTURE = path.join(REPO_ROOT, "tests", "fixtures", "repo-installed-core");
const RUNTIME_SYNC_FULL = path.join(REPO_ROOT, "tools", "runtime", "sync-db-first.mjs");
const RUNTIME_SYNC_SELECTIVE = path.join(REPO_ROOT, "tools", "runtime", "sync-db-first-selective.mjs");
const RUNTIME_PRE_WRITE_ADMIT = path.join(REPO_ROOT, "tools", "runtime", "pre-write-admit.mjs");
const RUNTIME_LOCAL_DAEMON = path.join(REPO_ROOT, "tools", "runtime", "local-daemon.mjs");
const CODEX_RUN_JSON_HOOK = path.join(REPO_ROOT, "tools", "codex", "run-json-hook.mjs");
const CODEX_WORKFLOW_STEP = path.join(REPO_ROOT, "tools", "codex", "workflow-step.mjs");

function parseArgs(argv) {
  const args = {
    target: DEFAULT_FIXTURE,
    iterations: 3,
    warmup: 1,
    skill: "requirements-delta",
    mode: "COMMITTING",
    includeDaemon: true,
    keepTemp: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--iterations") {
      args.iterations = Number(argv[i + 1] ?? args.iterations);
      i += 1;
    } else if (token === "--warmup") {
      args.warmup = Number(argv[i + 1] ?? args.warmup);
      i += 1;
    } else if (token === "--skill") {
      args.skill = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").trim().toUpperCase();
      i += 1;
    } else if (token === "--no-daemon") {
      args.includeDaemon = false;
    } else if (token === "--keep-temp") {
      args.keepTemp = true;
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
  if (!Number.isInteger(args.iterations) || args.iterations < 1) {
    throw new Error("Invalid --iterations. Expected a positive integer.");
  }
  if (!Number.isInteger(args.warmup) || args.warmup < 0) {
    throw new Error("Invalid --warmup. Expected 0 or a positive integer.");
  }
  if (!args.skill) {
    throw new Error("Missing value for --skill");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/measure-issue-43-latency.mjs --json");
  console.log("  node tools/perf/measure-issue-43-latency.mjs --target ../client-repo --iterations 5 --warmup 1 --json");
  console.log("  node tools/perf/measure-issue-43-latency.mjs --no-daemon");
}

function normalizePathForNode(absolutePath) {
  return process.platform === "win32" && absolutePath.startsWith("/") && absolutePath[2] === ":"
    ? absolutePath.slice(1)
    : absolutePath;
}

function run(command, args, cwd = REPO_ROOT) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runJson(command, args, cwd = REPO_ROOT) {
  const text = run(command, args, cwd).trim();
  if (!text) {
    throw new Error(`Empty JSON output from ${command}`);
  }
  return JSON.parse(text);
}

function setupMeasuredTarget(sourceTarget) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-issue-43-latency-"));
  const targetRoot = path.join(tempRoot, "repo");
  fs.cpSync(path.resolve(sourceTarget), targetRoot, {
    recursive: true,
    filter(source) {
      const normalized = source.replace(/\\/g, "/");
      return !normalized.includes("/.git/");
    },
  });
  removePathWithRetry(path.join(targetRoot, ".git"));
  removePathWithRetry(path.join(targetRoot, ".aidn", "runtime"));
  run("git", ["init"], targetRoot);
  run("git", ["config", "user.email", "aidn@example.com"], targetRoot);
  run("git", ["config", "user.name", "aidn-ci"], targetRoot);
  run("git", ["add", "."], targetRoot);
  run("git", ["commit", "-m", "issue 43 latency fixture"], targetRoot);
  return {
    tempRoot,
    targetRoot,
  };
}

function percentile(values, pct) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
}

function roundMs(value) {
  return Math.round(Number(value) * 100) / 100;
}

function summarizePayload(payload) {
  const dbSyncPayload = payload?.db_sync?.payload ?? null;
  return {
    ok: payload?.ok === true,
    output_mode: payload?.output_mode ?? null,
    fast_path_used: payload?.fast_path?.used ?? dbSyncPayload?.fast_path?.used ?? null,
    fast_path_reason: payload?.fast_path?.reason ?? dbSyncPayload?.fast_path?.reason ?? null,
    daemon_used: payload?.daemon?.used ?? null,
    daemon_fallback: payload?.daemon?.fallback ?? null,
    db_sync_enabled: payload?.db_sync?.enabled ?? null,
    db_sync_fast_path_used: dbSyncPayload?.fast_path?.used ?? null,
    workflow_contract: payload?.contract_version ?? null,
    step_count: payload?.summary?.step_count ?? null,
    admission_status: payload?.admission_status ?? null,
  };
}

function measureScenario({ id, command, args, cwd, iterations, warmup }) {
  for (let i = 0; i < warmup; i += 1) {
    run(command, args, cwd);
  }
  const durations = [];
  let lastText = "";
  let lastPayload = null;
  for (let i = 0; i < iterations; i += 1) {
    const started = process.hrtime.bigint();
    lastText = run(command, args, cwd);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    durations.push(elapsedMs);
    try {
      lastPayload = JSON.parse(lastText);
    } catch {
      lastPayload = null;
    }
  }
  return {
    id,
    command: [path.relative(REPO_ROOT, command).replace(/\\/g, "/"), ...args].join(" "),
    iterations,
    warmup,
    duration_ms: {
      min: roundMs(Math.min(...durations)),
      median: roundMs(percentile(durations, 50)),
      p90: roundMs(percentile(durations, 90)),
      max: roundMs(Math.max(...durations)),
      avg: roundMs(durations.reduce((sum, value) => sum + value, 0) / durations.length),
      samples: durations.map(roundMs),
    },
    output_bytes: Buffer.byteLength(lastText, "utf8"),
    payload: summarizePayload(lastPayload),
  };
}

function ratio(faster, slower) {
  const left = Number(faster?.duration_ms?.median ?? 0);
  const right = Number(slower?.duration_ms?.median ?? 0);
  if (left <= 0 || right <= 0) {
    return null;
  }
  return roundMs(right / left);
}

function printText(output) {
  console.log("Issue 43 latency measurement:");
  console.log(`- target=${output.target_root}`);
  console.log(`- iterations=${output.iterations} warmup=${output.warmup}`);
  for (const item of output.scenarios) {
    console.log(`- ${item.id}: median=${item.duration_ms.median}ms avg=${item.duration_ms.avg}ms p90=${item.duration_ms.p90}ms bytes=${item.output_bytes}`);
    if (item.payload.fast_path_used !== null || item.payload.daemon_used !== null) {
      console.log(`  fast_path=${item.payload.fast_path_used ?? "n/a"} daemon=${item.payload.daemon_used ?? "n/a"} fallback=${item.payload.daemon_fallback ?? "n/a"}`);
    }
  }
  if (output.comparisons.length > 0) {
    console.log("Comparisons:");
    for (const item of output.comparisons) {
      console.log(`- ${item.id}: ${item.median_speedup_ratio ?? "n/a"}x`);
    }
  }
  console.log("No timing threshold is enforced by this measurement.");
}

async function main() {
  let tempRoot = "";
  let targetRoot = "";
  let keepTemp = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    keepTemp = args.keepTemp;
    const measured = setupMeasuredTarget(args.target);
    tempRoot = measured.tempRoot;
    targetRoot = measured.targetRoot;

    const node = process.execPath;
    runJson(node, [
      normalizePathForNode(RUNTIME_SYNC_FULL),
      "--target",
      targetRoot,
      "--state-mode",
      "dual",
      "--store",
      "sqlite",
      "--json",
    ]);

    const scenarios = [];
    const commonHookArgs = [
      "--skill",
      args.skill,
      "--mode",
      args.mode,
      "--target",
      targetRoot,
      "--json",
    ];
    scenarios.push(measureScenario({
      id: "sync_db_first_selective_no_change",
      command: node,
      args: [
        normalizePathForNode(RUNTIME_SYNC_SELECTIVE),
        "--target",
        targetRoot,
        "--state-mode",
        "dual",
        "--json",
      ],
      iterations: args.iterations,
      warmup: args.warmup,
    }));
    scenarios.push(measureScenario({
      id: "pre_write_admit_no_change",
      command: node,
      args: [
        normalizePathForNode(RUNTIME_PRE_WRITE_ADMIT),
        "--target",
        targetRoot,
        "--skill",
        args.skill,
        "--json",
      ],
      iterations: args.iterations,
      warmup: args.warmup,
    }));
    scenarios.push(measureScenario({
      id: "run_json_hook_batch_no_change",
      command: node,
      args: [
        normalizePathForNode(CODEX_RUN_JSON_HOOK),
        ...commonHookArgs,
      ],
      iterations: args.iterations,
      warmup: args.warmup,
    }));
    scenarios.push(measureScenario({
      id: "workflow_step_batch_no_change",
      command: node,
      args: [
        normalizePathForNode(CODEX_WORKFLOW_STEP),
        "--skill",
        args.skill,
        "--mode",
        args.mode,
        "--target",
        targetRoot,
        "--json",
      ],
      iterations: args.iterations,
      warmup: args.warmup,
    }));

    let daemonStarted = false;
    try {
      if (args.includeDaemon) {
        runJson(node, [
          normalizePathForNode(RUNTIME_LOCAL_DAEMON),
          "--start",
          "--target",
          targetRoot,
          "--port",
          "0",
          "--json",
        ]);
        daemonStarted = true;
        scenarios.push(measureScenario({
          id: "run_json_hook_daemon_no_change",
          command: node,
          args: [
            normalizePathForNode(CODEX_RUN_JSON_HOOK),
            ...commonHookArgs,
            "--use-daemon",
          ],
          iterations: args.iterations,
          warmup: args.warmup,
        }));
        scenarios.push(measureScenario({
          id: "workflow_step_daemon_no_change",
          command: node,
          args: [
            normalizePathForNode(CODEX_WORKFLOW_STEP),
            "--skill",
            args.skill,
            "--mode",
            args.mode,
            "--target",
            targetRoot,
            "--json",
            "--use-daemon",
          ],
          iterations: args.iterations,
          warmup: args.warmup,
        }));
      }
    } finally {
      if (daemonStarted) {
        try {
          runJson(node, [
            normalizePathForNode(RUNTIME_LOCAL_DAEMON),
            "--stop",
            "--target",
            targetRoot,
            "--json",
          ]);
        } catch {
          // Best effort cleanup; the temp directory is still removed below.
        }
      }
    }

    const byId = new Map(scenarios.map((item) => [item.id, item]));
    const comparisons = [
      {
        id: "run_json_hook_batch_vs_daemon_median",
        baseline: "run_json_hook_batch_no_change",
        candidate: "run_json_hook_daemon_no_change",
        median_speedup_ratio: ratio(byId.get("run_json_hook_daemon_no_change"), byId.get("run_json_hook_batch_no_change")),
      },
      {
        id: "workflow_step_batch_vs_daemon_median",
        baseline: "workflow_step_batch_no_change",
        candidate: "workflow_step_daemon_no_change",
        median_speedup_ratio: ratio(byId.get("workflow_step_daemon_no_change"), byId.get("workflow_step_batch_no_change")),
      },
    ].filter((item) => byId.has(item.baseline) && byId.has(item.candidate));

    const output = {
      ts: new Date().toISOString(),
      ok: true,
      measurement: "issue-43-latency",
      target_root: targetRoot,
      source_target: path.resolve(args.target),
      iterations: args.iterations,
      warmup: args.warmup,
      skill: args.skill,
      mode: args.mode,
      scenarios,
      comparisons,
      threshold_enforced: false,
      note: "Local timing evidence only; use functional perf:verify-* gates for CI decisions.",
    };
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      printText(output);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot) && !keepTemp) {
      removePathWithRetry(tempRoot);
    }
  }
}

await main();
