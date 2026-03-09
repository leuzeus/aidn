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
  console.log("  node tools/perf/verify-checkpoint-repair-layer-findings-fixtures.mjs");
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

function readNdjson(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function runCheckpoint(target, stateMode) {
  return runJson("tools/perf/checkpoint.mjs", [
    "--target",
    target,
    "--mode",
    "COMMITTING",
    "--index-store",
    "sqlite",
    "--no-auto-skip-gate",
    "--json",
  ], {
    AIDN_STATE_MODE: stateMode,
    AIDN_INDEX_STORE_MODE: "sqlite",
  });
}

function findCheckpointEvent(events, runId) {
  return events.find((event) =>
    String(event?.event ?? "") === "checkpoint_summary"
    && String(event?.run_id ?? "") === String(runId ?? "")
  ) ?? null;
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceTarget = path.resolve(process.cwd(), args.target);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-checkpoint-repair-findings-"));
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

    const dual = runCheckpoint(target, "dual");
    const dbOnly = runCheckpoint(target, "db-only");
    const events = readNdjson(path.join(target, ".aidn/runtime/perf/workflow-events.ndjson"));
    const dualEvent = findCheckpointEvent(events, dual?.run_id);
    const dbOnlyEvent = findCheckpointEvent(events, dbOnly?.run_id);

    const checks = {
      dual_gate_signal_present: Array.isArray(dual?.gate?.levels?.level2?.active_signals)
        && dual.gate.levels.level2.active_signals.includes("repair_findings_open"),
      dual_summary_open_count_present: Number(dual?.summary?.repair_layer_open_count ?? 0) >= 1,
      dual_summary_top_findings_present: Array.isArray(dual?.summary?.repair_layer_top_findings)
        && dual.summary.repair_layer_top_findings.length >= 1,
      dual_event_open_count_present: Number(dualEvent?.repair_layer_open_count ?? 0) >= 1,
      db_only_gate_signal_present: Array.isArray(dbOnly?.gate?.levels?.level2?.active_signals)
        && dbOnly.gate.levels.level2.active_signals.includes("repair_findings_open"),
      db_only_summary_open_count_present: Number(dbOnly?.summary?.repair_layer_open_count ?? 0) >= 1,
      db_only_summary_top_findings_present: Array.isArray(dbOnly?.summary?.repair_layer_top_findings)
        && dbOnly.summary.repair_layer_top_findings.length >= 1,
      db_only_event_open_count_present: Number(dbOnlyEvent?.repair_layer_open_count ?? 0) >= 1,
      parity_dual_db_only_reason: String(dual?.summary?.reason_code ?? "") === String(dbOnly?.summary?.reason_code ?? ""),
      parity_dual_db_only_open_count: Number(dual?.summary?.repair_layer_open_count ?? -1) === Number(dbOnly?.summary?.repair_layer_open_count ?? -2),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: target,
      checks,
      samples: {
        dual: {
          result: dual?.summary?.result ?? null,
          reason_code: dual?.summary?.reason_code ?? null,
          repair_layer_open_count: dual?.summary?.repair_layer_open_count ?? null,
          repair_layer_blocking: dual?.summary?.repair_layer_blocking ?? null,
          top_finding: dual?.summary?.repair_layer_top_findings?.[0] ?? null,
        },
        db_only: {
          result: dbOnly?.summary?.result ?? null,
          reason_code: dbOnly?.summary?.reason_code ?? null,
          repair_layer_open_count: dbOnly?.summary?.repair_layer_open_count ?? null,
          repair_layer_blocking: dbOnly?.summary?.repair_layer_blocking ?? null,
          top_finding: dbOnly?.summary?.repair_layer_top_findings?.[0] ?? null,
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
