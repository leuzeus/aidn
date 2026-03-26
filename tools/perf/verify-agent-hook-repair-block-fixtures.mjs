#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/session-rich",
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-agent-hook-repair-block-fixtures.mjs");
}

function runJson(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  return JSON.parse(stdout);
}

function runWithStatus(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  const result = spawnSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  return {
    status: Number(result.status ?? 1),
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function parseJsonOutput(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return null;
  }
  return JSON.parse(trimmed);
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceTarget = path.resolve(process.cwd(), args.target);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-agent-repair-block-"));
    const target = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, target, { recursive: true });
    fs.rmSync(path.join(target, ".aidn"), { recursive: true, force: true });

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--json",
    ]);

    const env = {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    };

    const skillHook = runWithStatus("tools/perf/skill-hook.mjs", [
      "--skill",
      "close-session",
      "--target",
      target,
      "--mode",
      "COMMITTING",
      "--no-auto-skip-gate",
      "--fail-on-repair-block",
      "--json",
    ], env);

    const runJsonHook = runWithStatus("tools/codex/run-json-hook.mjs", [
      "--skill",
      "close-session",
      "--mode",
      "COMMITTING",
      "--target",
      target,
      "--state-mode",
      "db-only",
      "--no-auto-skip-gate",
      "--fail-on-repair-block",
      "--json",
    ], env);
    const runJsonPayload = parseJsonOutput(runJsonHook.stdout);

    const checks = {
      skill_hook_does_not_fail_on_warn: skillHook.status === 0,
      run_json_hook_still_fails_under_strict_stop: runJsonHook.status === 1,
      run_json_hook_repair_status_is_warn_not_block: String(runJsonPayload?.repair_layer_status ?? "") === "warn",
      run_json_hook_repair_blocking_flag_is_false: runJsonPayload?.repair_layer_blocking === false,
      run_json_hook_failure_is_not_caused_by_repair_block: String(runJsonPayload?.summary?.repair_layer_status ?? "") === "warn"
        && String(runJsonPayload?.summary?.result ?? "") === "stop",
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: target,
      checks,
      samples: {
        skill_hook_status: skillHook.status,
        run_json_hook_status: runJsonHook.status,
        run_json_hook_payload: {
          result: runJsonPayload?.summary?.result ?? null,
          repair_layer_status: runJsonPayload?.repair_layer_status ?? null,
          repair_layer_blocking: runJsonPayload?.repair_layer_blocking ?? null,
        },
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${sourceTarget}`);
      for (const [name, value] of Object.entries(checks)) {
        console.log(`${value ? "PASS" : "FAIL"} ${name}`);
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      removePathWithRetry(tempRoot);
    }
  }
}

main();
