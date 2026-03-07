#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readIndexFromSqlite } from "../../src/lib/sqlite/index-sqlite-lib.mjs";
import { readAidnProjectConfig } from "../../src/lib/config/aidn-config-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODE_MIGRATE = path.resolve(REPO_ROOT, "tools", "runtime", "mode-migrate.mjs");

function normalizePathForNode(absolutePath) {
  return process.platform === "win32" && absolutePath.startsWith("/") && absolutePath[2] === ":"
    ? absolutePath.slice(1)
    : absolutePath;
}

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
  console.log("  node tools/perf/verify-mode-migrate-repair-layer-fixtures.mjs");
}

function runJson(command, args, cwd) {
  const stdout = execFileSync(command, args, {
    cwd,
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
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-mode-migrate-"));
    const workingCopy = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, workingCopy, { recursive: true });
    fs.rmSync(path.join(workingCopy, ".aidn"), { recursive: true, force: true });

    const migrated = runJson(process.execPath, [
      normalizePathForNode(MODE_MIGRATE),
      "--target",
      workingCopy,
      "--to",
      "db-only",
      "--json",
    ], REPO_ROOT);

    const sqliteFile = path.resolve(workingCopy, ".aidn/runtime/index/workflow-index.sqlite");
    const reportFile = path.resolve(workingCopy, ".aidn/runtime/index/repair-layer-report.json");
    const triageFile = path.resolve(workingCopy, ".aidn/runtime/index/repair-layer-triage.json");
    const triageSummaryFile = path.resolve(workingCopy, ".aidn/runtime/index/repair-layer-triage-summary.md");
    const payload = readIndexFromSqlite(sqliteFile).payload;
    const config = readAidnProjectConfig(workingCopy).data ?? {};
    const runtime = config.runtime && typeof config.runtime === "object" ? config.runtime : {};

    const checks = {
      migrate_ok: migrated.ok === true,
      moved_to_db_only: String(migrated?.to_mode ?? "") === "db-only",
      repair_layer_step_present: Array.isArray(migrated?.steps) && migrated.steps.some((step) => String(step?.step ?? "") === "repair_layer"),
      repair_layer_completed: ["applied", "skipped"].includes(String(migrated?.repair_layer_result?.action ?? "")),
      report_exists: fs.existsSync(reportFile),
      triage_exists: fs.existsSync(triageFile),
      triage_summary_exists: fs.existsSync(triageSummaryFile),
      repair_layer_triage_step_present: Array.isArray(migrated?.steps) && migrated.steps.some((step) => String(step?.step ?? "") === "repair_layer_triage"),
      sqlite_exists: fs.existsSync(sqliteFile),
      sqlite_sessions_present: Array.isArray(payload.sessions) && payload.sessions.length >= 2,
      sqlite_ambiguous_relation_present: Array.isArray(payload.migration_findings)
        && payload.migration_findings.some((row) => String(row?.finding_type ?? "") === "AMBIGUOUS_RELATION" && String(row?.entity_id ?? "") === "S102"),
      config_state_mode_updated: String(runtime.stateMode ?? "") === "db-only",
      config_index_store_updated: String(runtime.indexStoreMode ?? "") === "sqlite",
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      working_copy: workingCopy,
      checks,
      migrated,
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
