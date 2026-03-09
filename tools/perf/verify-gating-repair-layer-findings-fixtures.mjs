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
  console.log("  node tools/perf/verify-gating-repair-layer-findings-fixtures.mjs");
}

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceTarget = path.resolve(process.cwd(), args.target);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-gate-repair-findings-"));
    const target = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, target, { recursive: true });
    fs.rmSync(path.join(target, ".aidn"), { recursive: true, force: true });

    const indexSync = runJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "dual-sqlite",
      "--json",
    ]);
    const sqliteFile = String(indexSync?.outputs?.find?.((row) => String(row?.backend ?? "").toLowerCase() === "sqlite")?.path ?? path.resolve(target, ".aidn/runtime/index/workflow-index.sqlite"));

    const dual = runJson("tools/perf/gating-evaluate.mjs", [
      "--target",
      target,
      "--state-mode",
      "dual",
      "--index-file",
      sqliteFile,
      "--index-backend",
      "sqlite",
      "--reload-decision",
      "incremental",
      "--reload-fallback",
      "false",
      "--reload-reason-codes",
      "",
      "--json",
    ]);

    const dbOnly = runJson("tools/perf/gating-evaluate.mjs", [
      "--target",
      target,
      "--state-mode",
      "db-only",
      "--index-file",
      sqliteFile,
      "--index-backend",
      "sqlite",
      "--reload-decision",
      "incremental",
      "--reload-fallback",
      "false",
      "--reload-reason-codes",
      "",
      "--json",
    ]);

    const checks = {
      dual_warns_on_repair_findings: String(dual?.result ?? "") === "warn",
      dual_signal_present: Array.isArray(dual?.levels?.level2?.active_signals)
        && dual.levels.level2.active_signals.includes("repair_findings_open"),
      dual_open_count_present: Number(dual?.levels?.level2?.repair_layer_open_count ?? 0) >= 1,
      db_only_warns_on_repair_findings: String(dbOnly?.result ?? "") === "warn",
      db_only_signal_present: Array.isArray(dbOnly?.levels?.level2?.active_signals)
        && dbOnly.levels.level2.active_signals.includes("repair_findings_open"),
      db_only_open_count_present: Number(dbOnly?.levels?.level2?.repair_layer_open_count ?? 0) >= 1,
      parity_dual_db_only_action: String(dual?.action ?? "") === String(dbOnly?.action ?? ""),
      parity_dual_db_only_reason: String(dual?.reason_code ?? "") === String(dbOnly?.reason_code ?? ""),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: target,
      checks,
      samples: {
        dual: {
          action: dual?.action ?? null,
          result: dual?.result ?? null,
          reason_code: dual?.reason_code ?? null,
          active_signals: dual?.levels?.level2?.active_signals ?? [],
          repair_layer_open_count: dual?.levels?.level2?.repair_layer_open_count ?? null,
        },
        db_only: {
          action: dbOnly?.action ?? null,
          result: dbOnly?.result ?? null,
          reason_code: dbOnly?.reason_code ?? null,
          active_signals: dbOnly?.levels?.level2?.active_signals ?? [],
          repair_layer_open_count: dbOnly?.levels?.level2?.repair_layer_open_count ?? null,
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
