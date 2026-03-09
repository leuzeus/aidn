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
  console.log("  node tools/perf/verify-codex-context-repair-layer-fixtures.mjs");
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

function runNoJson(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveDbSyncOpenCount(hookOutput) {
  const triageCount = hookOutput?.db_sync?.payload?.repair_layer_triage_result?.triage?.summary?.open_findings_count;
  if (triageCount !== undefined && triageCount !== null) {
    return Number(triageCount);
  }
  const severityCounts = hookOutput?.db_sync?.payload?.repair_layer_result?.summary?.severity_counts;
  if (severityCounts && typeof severityCounts === "object") {
    return Number(severityCounts.warning ?? 0) + Number(severityCounts.error ?? 0);
  }
  return null;
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceTarget = path.resolve(process.cwd(), args.target);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-codex-context-repair-"));
    const target = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, target, { recursive: true });
    fs.rmSync(path.join(target, ".aidn"), { recursive: true, force: true });
    runNoJson("tools/install.mjs", [
      "--target",
      target,
      "--pack",
      "core",
      "--force-agents-merge",
    ]);

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

    const hookOutput = runJson("tools/codex/run-json-hook.mjs", [
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
    ], env);

    const contextFile = String(hookOutput?.context_file ?? path.resolve(target, ".aidn/runtime/context/codex-context.json"));
    const stored = readJson(contextFile);
    const latestEntry = stored?.latest?.["close-session"] ?? {};

    const hydrated = runJson("tools/codex/hydrate-context.mjs", [
      "--target",
      target,
      "--index-file",
      ".aidn/runtime/index/workflow-index.sqlite",
      "--backend",
      "sqlite",
      "--skill",
      "close-session",
      "--json",
    ], env);
    const runtimeStateFile = path.join(target, "docs", "audit", "RUNTIME-STATE.md");
    const runtimeStateText = fs.existsSync(runtimeStateFile)
      ? fs.readFileSync(runtimeStateFile, "utf8")
      : "";

    const decision = hydrated?.decisions?.["close-session"] ?? {};
    const recentHistory = Array.isArray(hydrated?.recent_history) ? hydrated.recent_history : [];
    const closeHistory = recentHistory.filter((entry) => String(entry?.skill ?? "") === "close-session");
    const latestHistory = closeHistory[closeHistory.length - 1] ?? {};

    const checks = {
      hook_output_db_sync_enabled: hookOutput?.db_sync?.enabled === true,
      hook_output_open_count_present: Number(hookOutput?.repair_layer_open_count ?? 0) >= 1,
      hook_output_matches_db_sync_summary: Number(hookOutput?.repair_layer_open_count ?? -1)
        === Number(resolveDbSyncOpenCount(hookOutput) ?? -2),
      context_latest_open_count_present: Number(latestEntry?.repair_layer_open_count ?? 0) >= 1,
      context_latest_status_present: ["warn", "block"].includes(String(latestEntry?.repair_layer_status ?? "")),
      context_latest_advice_present: String(latestEntry?.repair_layer_advice ?? "").length >= 1,
      context_latest_top_findings_present: Array.isArray(latestEntry?.repair_layer_top_findings)
        && latestEntry.repair_layer_top_findings.length >= 1,
      hydrate_decision_open_count_present: Number(decision?.repair_layer_open_count ?? 0) >= 1,
      hydrate_decision_status_present: ["warn", "block"].includes(String(decision?.repair_layer_status ?? "")),
      hydrate_decision_advice_present: String(decision?.repair_layer_advice ?? "").length >= 1,
      hydrate_decision_top_findings_present: Array.isArray(decision?.repair_layer_top_findings)
        && decision.repair_layer_top_findings.length >= 1,
      hydrate_history_open_count_present: Number(latestHistory?.repair_layer_open_count ?? 0) >= 1,
      parity_context_hydrate_count: Number(latestEntry?.repair_layer_open_count ?? -1) === Number(decision?.repair_layer_open_count ?? -2),
      hydrate_runtime_state_present: hydrated?.runtime_state && typeof hydrated.runtime_state === "object",
      hydrate_runtime_state_status_present: ["warn", "block"].includes(String(hydrated?.runtime_state?.digest?.repair_layer_status ?? "")),
      hydrate_runtime_state_matches_decision: String(hydrated?.runtime_state?.digest?.repair_layer_status ?? "")
        === String(decision?.repair_layer_status ?? ""),
      hydrate_runtime_state_file_written: fs.existsSync(runtimeStateFile),
      hydrate_runtime_state_markdown_mentions_status: runtimeStateText.includes(`repair_layer_status: ${String(decision?.repair_layer_status ?? "")}`),
      hydrate_runtime_state_markdown_mentions_advice: runtimeStateText.includes(`repair_layer_advice: ${String(decision?.repair_layer_advice ?? "")}`),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: target,
      checks,
      samples: {
        hook_output: {
          repair_layer_open_count: hookOutput?.repair_layer_open_count ?? null,
          top_finding: hookOutput?.repair_layer_top_findings?.[0] ?? null,
        },
        context_latest: {
          repair_layer_open_count: latestEntry?.repair_layer_open_count ?? null,
          repair_layer_status: latestEntry?.repair_layer_status ?? null,
          top_finding: latestEntry?.repair_layer_top_findings?.[0] ?? null,
        },
        hydrated_decision: {
          repair_layer_open_count: decision?.repair_layer_open_count ?? null,
          repair_layer_status: decision?.repair_layer_status ?? null,
          top_finding: decision?.repair_layer_top_findings?.[0] ?? null,
        },
        hydrated_runtime_state: {
          output_file: hydrated?.runtime_state?.output_file ?? null,
          repair_layer_status: hydrated?.runtime_state?.digest?.repair_layer_status ?? null,
          top_finding: hydrated?.runtime_state?.digest?.blocking_findings?.[0] ?? null,
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
