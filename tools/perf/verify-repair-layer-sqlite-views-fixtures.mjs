#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);

function getDatabaseSync() {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch (error) {
    throw new Error(`SQLite backend unavailable: ${error.message}`);
  }
}

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/session-rich",
    sqliteFile: ".aidn/runtime/index/fixtures/repair-layer-views/workflow-index.sqlite",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = String(argv[i + 1] ?? "").trim();
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
  console.log("  node tools/perf/verify-repair-layer-sqlite-views-fixtures.mjs");
}

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function resolveTargetPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const target = path.resolve(process.cwd(), args.target);
    const sqliteFile = resolveTargetPath(target, args.sqliteFile);

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--sqlite-output",
      sqliteFile,
      "--json",
    ]);

    const DatabaseSync = getDatabaseSync();
    const db = new DatabaseSync(sqliteFile);
    const viewNames = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'view'
      ORDER BY name ASC
    `).all().map((row) => String(row?.name ?? ""));
    const sessionContextRows = db.prepare("SELECT * FROM v_session_cycle_context ORDER BY session_id ASC, cycle_id ASC").all();
    const sessionLinkRows = db.prepare("SELECT * FROM v_session_link_context ORDER BY source_session_id ASC, target_session_id ASC").all();
    const artifactContextRows = db.prepare("SELECT * FROM v_artifact_link_context ORDER BY source_path ASC, target_path ASC").all();
    const openFindingRows = db.prepare("SELECT * FROM v_repair_findings_open ORDER BY created_at DESC").all();
    db.close();

    const checks = {
      session_context_view_exists: viewNames.includes("v_session_cycle_context"),
      session_link_view_exists: viewNames.includes("v_session_link_context"),
      artifact_context_view_exists: viewNames.includes("v_artifact_link_context"),
      repair_findings_view_exists: viewNames.includes("v_repair_findings_open"),
      session_context_has_rows: sessionContextRows.length >= 3,
      session_link_has_rows: sessionLinkRows.length >= 1,
      artifact_context_has_rows: artifactContextRows.length >= 2,
      repair_findings_open_has_rows: openFindingRows.length >= 1,
      accepted_columns_present: sessionContextRows.some((row) => Object.prototype.hasOwnProperty.call(row, "session_branch_name")),
      continuity_columns_present: sessionLinkRows.some((row) => Object.prototype.hasOwnProperty.call(row, "source_parent_session")),
      target_columns_present: artifactContextRows.some((row) => Object.prototype.hasOwnProperty.call(row, "target_cycle_id")),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      target_root: target,
      sqlite_file: sqliteFile,
      checks,
      samples: {
        views: viewNames,
        session_context_first: sessionContextRows[0] ?? null,
        session_link_first: sessionLinkRows[0] ?? null,
        artifact_context_first: artifactContextRows[0] ?? null,
        repair_finding_first: openFindingRows[0] ?? null,
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${target}`);
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
  }
}

main();
