#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { normalizeHookPayload } from "../../src/application/codex/normalize-hook-payload.mjs";
import { buildRunJsonHookSummary } from "../../src/core/workflow/workflow-output-factory.mjs";

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
  console.log("  node tools/perf/verify-hook-normalization-repair-layer-fixtures.mjs");
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
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-hook-normalize-repair-"));
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
    fs.appendFileSync(
      path.join(target, "docs", "audit", "baseline", "current.md"),
      "\n<!-- normalize-repair-layer-signal -->\n",
      "utf8",
    );

    const checkpoint = runJson("tools/perf/checkpoint.mjs", [
      "--target",
      target,
      "--mode",
      "COMMITTING",
      "--index-store",
      "sqlite",
      "--no-auto-skip-gate",
      "--json",
    ], env);
    const workflowHook = runJson("tools/perf/workflow-hook.mjs", [
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

    const normalizedCheckpoint = normalizeHookPayload(checkpoint, {
      skill: "checkpoint",
      mode: "COMMITTING",
      stateMode: "db-only",
      strictRequested: true,
      targetRoot: target,
    });
    const normalizedWorkflowHook = normalizeHookPayload(workflowHook, {
      skill: "close-session",
      mode: "COMMITTING",
      stateMode: "db-only",
      strictRequested: true,
      targetRoot: target,
    });

    const hookSummary = buildRunJsonHookSummary({
      result: normalizedWorkflowHook.result,
      error: normalizedWorkflowHook.error,
      state_mode: normalizedWorkflowHook.state_mode,
      command_status: 0,
      db_sync: { enabled: false, error: null },
      normalized: normalizedWorkflowHook,
    });

    const checks = {
      checkpoint_open_count_present: Number(normalizedCheckpoint.repair_layer_open_count ?? 0) >= 1,
      checkpoint_top_findings_present: Array.isArray(normalizedCheckpoint.repair_layer_top_findings)
        && normalizedCheckpoint.repair_layer_top_findings.length >= 1,
      workflow_hook_open_count_present: Number(normalizedWorkflowHook.repair_layer_open_count ?? 0) >= 1,
      workflow_hook_top_findings_present: Array.isArray(normalizedWorkflowHook.repair_layer_top_findings)
        && normalizedWorkflowHook.repair_layer_top_findings.length >= 1,
      hook_summary_open_count_present: Number(hookSummary.repair_layer_open_count ?? 0) >= 1,
      hook_summary_top_findings_present: Array.isArray(hookSummary.repair_layer_top_findings)
        && hookSummary.repair_layer_top_findings.length >= 1,
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: target,
      checks,
      samples: {
        checkpoint_open_count: normalizedCheckpoint.repair_layer_open_count ?? null,
        workflow_hook_open_count: normalizedWorkflowHook.repair_layer_open_count ?? null,
        hook_summary_open_count: hookSummary.repair_layer_open_count ?? null,
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
