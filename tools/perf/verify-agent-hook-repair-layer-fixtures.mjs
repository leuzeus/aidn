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
  console.log("  node tools/perf/verify-agent-hook-repair-layer-fixtures.mjs");
}

function runJson(script, scriptArgs, env = {}, expectStatus = 0) {
  const file = path.resolve(process.cwd(), script);
  try {
    const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...env,
      },
    });
    if (expectStatus !== 0) {
      throw new Error(`Command unexpectedly succeeded: ${script}`);
    }
    return JSON.parse(stdout);
  } catch (error) {
    if (Number(error?.status ?? 0) !== expectStatus) {
      throw error;
    }
    const stdout = String(error?.stdout ?? "").trim();
    return JSON.parse(stdout);
  }
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
      "--json",
    ], env, 1);

    const checks = {
      skill_hook_structured_output_present: skillHook && typeof skillHook === "object",
      skill_hook_result_present: ["ok", "stop"].includes(String(skillHook?.result ?? "")),
      skill_hook_status_present: ["clean", "warn", "block"].includes(String(skillHook?.repair_layer_status ?? "")),
      skill_hook_advice_present: String(skillHook?.repair_layer_advice ?? "").length >= 1,
      skill_hook_primary_reason_present: String(skillHook?.repair_primary_reason ?? "").length >= 1,
      skill_hook_top_findings_shape_present: Array.isArray(skillHook?.repair_layer_top_findings),
      run_json_hook_structured_output_present: runJsonHook && typeof runJsonHook === "object",
      run_json_hook_open_count_present: Number(runJsonHook?.repair_layer_open_count ?? 0) >= 0,
      run_json_hook_status_present: ["clean", "warn", "block"].includes(String(runJsonHook?.repair_layer_status ?? "")),
      run_json_hook_advice_present: String(runJsonHook?.repair_layer_advice ?? "").length >= 1,
      run_json_hook_primary_reason_present: String(runJsonHook?.repair_primary_reason ?? "").length >= 1,
      run_json_hook_top_findings_shape_present: Array.isArray(runJsonHook?.repair_layer_top_findings),
      run_json_hook_summary_present: Number(runJsonHook?.summary?.repair_layer_open_count ?? 0) >= 0
        && ["clean", "warn", "block"].includes(String(runJsonHook?.summary?.repair_layer_status ?? "")),
      run_json_hook_enrichment_preserves_or_increases_open_count: Number(runJsonHook?.repair_layer_open_count ?? -1)
        >= Number(skillHook?.repair_layer_open_count ?? -2),
      run_json_hook_enrichment_preserves_or_increases_findings: Number(runJsonHook?.repair_layer_top_findings?.length ?? 0)
        >= Number(skillHook?.repair_layer_top_findings?.length ?? 0),
      run_json_hook_primary_reason_differs_when_db_sync_finds_more_context:
        Number(runJsonHook?.repair_layer_top_findings?.length ?? 0) === 0
        || String(runJsonHook?.repair_primary_reason ?? "") !== String(skillHook?.repair_primary_reason ?? ""),
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
          repair_layer_status: skillHook?.repair_layer_status ?? null,
          repair_primary_reason: skillHook?.repair_primary_reason ?? null,
          top_finding: skillHook?.repair_layer_top_findings?.[0] ?? null,
        },
        run_json_hook: {
          result: runJsonHook?.summary?.result ?? null,
          repair_layer_open_count: runJsonHook?.repair_layer_open_count ?? null,
          repair_layer_status: runJsonHook?.repair_layer_status ?? null,
          repair_primary_reason: runJsonHook?.repair_primary_reason ?? null,
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
      removePathWithRetry(tempRoot);
    }
  }
}

main();
