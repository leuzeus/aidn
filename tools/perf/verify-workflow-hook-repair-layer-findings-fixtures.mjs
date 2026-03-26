#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  console.log("  node tools/perf/verify-workflow-hook-repair-layer-findings-fixtures.mjs");
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

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceTarget = path.resolve(process.cwd(), args.target);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-hook-repair-findings-"));
    const target = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, target, { recursive: true });
    fs.rmSync(path.join(target, ".aidn"), { recursive: true, force: true });

    const env = {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    };

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--json",
    ]);

    const start = runJson("tools/perf/workflow-hook.mjs", [
      "--phase",
      "session-start",
      "--target",
      target,
      "--mode",
      "COMMITTING",
      "--index-store",
      "sqlite",
      "--json",
    ], env);

    fs.appendFileSync(
      path.join(target, "docs", "audit", "baseline", "current.md"),
      "\n<!-- checkpoint-repair-layer-signal -->\n",
      "utf8",
    );

    const close = runJson("tools/perf/workflow-hook.mjs", [
      "--phase",
      "session-close",
      "--target",
      target,
      "--mode",
      "COMMITTING",
      "--index-store",
      "sqlite",
      "--no-auto-skip-gate",
      "--json",
    ], env);

    const checks = {
      start_ok: String(start?.result ?? "") === "ok",
      close_ok: String(close?.result ?? "") === "ok",
      close_checkpoint_gate_signal_present: Array.isArray(close?.checkpoint?.gate?.levels?.level2?.active_signals)
        && close.checkpoint.gate.levels.level2.active_signals.includes("repair_findings_open"),
      close_summary_open_count_present: Number(close?.summary?.repair_layer_open_count ?? 0) >= 1,
      close_summary_top_findings_present: Array.isArray(close?.summary?.repair_layer_top_findings)
        && close.summary.repair_layer_top_findings.length >= 1,
      close_summary_blocking_flag_present: typeof close?.summary?.repair_layer_blocking === "boolean",
      close_summary_matches_checkpoint: Number(close?.summary?.repair_layer_open_count ?? -1)
        === Number(close?.checkpoint?.summary?.repair_layer_open_count ?? -2),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: target,
      checks,
      samples: {
        start: {
          result: start?.summary?.result ?? null,
          repair_layer_open_count: start?.summary?.repair_layer_open_count ?? null,
        },
        close: {
          result: close?.summary?.result ?? null,
          checkpoint_result: close?.summary?.checkpoint_result ?? null,
          checkpoint_reason_code: close?.summary?.checkpoint_reason_code ?? null,
          repair_layer_open_count: close?.summary?.repair_layer_open_count ?? null,
          repair_layer_blocking: close?.summary?.repair_layer_blocking ?? null,
          top_finding: close?.summary?.repair_layer_top_findings?.[0] ?? null,
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
