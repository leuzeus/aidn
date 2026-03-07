#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

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
  console.log("  node tools/perf/verify-agent-hook-repair-layer-fixtures.mjs");
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
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-agent-hook-repair-"));
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

    const skillHook = runJson("tools/perf/skill-hook.mjs", [
      "--skill",
      "close-session",
      "--target",
      target,
      "--mode",
      "COMMITTING",
      "--no-auto-skip-gate",
      "--json",
    ], env);

    const runJsonHook = runJson("tools/codex/run-json-hook.mjs", [
      "--skill",
      "close-session",
      "--mode",
      "COMMITTING",
      "--target",
      target,
      "--state-mode",
      "db-only",
      "--no-auto-skip-gate",
      "--no-db-sync",
      "--json",
    ], env);

    const checks = {
      skill_hook_ok: skillHook?.ok === true,
      skill_hook_open_count_present: Number(skillHook?.repair_layer_open_count ?? 0) >= 1,
      skill_hook_top_findings_present: Array.isArray(skillHook?.repair_layer_top_findings)
        && skillHook.repair_layer_top_findings.length >= 1,
      run_json_hook_ok: runJsonHook?.ok === true,
      run_json_hook_open_count_present: Number(runJsonHook?.repair_layer_open_count ?? 0) >= 1,
      run_json_hook_top_findings_present: Array.isArray(runJsonHook?.repair_layer_top_findings)
        && runJsonHook.repair_layer_top_findings.length >= 1,
      run_json_hook_summary_present: Number(runJsonHook?.summary?.repair_layer_open_count ?? 0) >= 1,
      parity_skill_hook_run_json_count: Number(skillHook?.repair_layer_open_count ?? -1)
        === Number(runJsonHook?.repair_layer_open_count ?? -2),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: target,
      checks,
      samples: {
        skill_hook: {
          result: skillHook?.payload?.summary?.result ?? null,
          repair_layer_open_count: skillHook?.repair_layer_open_count ?? null,
          top_finding: skillHook?.repair_layer_top_findings?.[0] ?? null,
        },
        run_json_hook: {
          result: runJsonHook?.summary?.result ?? null,
          repair_layer_open_count: runJsonHook?.repair_layer_open_count ?? null,
          summary_repair_layer_open_count: runJsonHook?.summary?.repair_layer_open_count ?? null,
          top_finding: runJsonHook?.repair_layer_top_findings?.[0] ?? null,
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
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
