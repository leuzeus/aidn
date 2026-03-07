#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readIndexFromSqlite } from "../../src/lib/sqlite/index-sqlite-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/session-rich",
    sqliteFile: ".aidn/runtime/index/fixtures/repair-layer-command/workflow-index.sqlite",
    reportFile: ".aidn/runtime/index/fixtures/repair-layer-command/repair-layer-report.json",
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
    } else if (token === "--report-file") {
      args.reportFile = String(argv[i + 1] ?? "").trim();
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
  console.log("  node tools/perf/verify-repair-layer-command-fixtures.mjs");
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
    const reportFile = resolveTargetPath(target, args.reportFile);
    const sqliteFileArg = path.relative(process.cwd(), sqliteFile);
    const reportFileArg = path.relative(process.cwd(), reportFile);

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--sqlite-output",
      sqliteFile,
      "--json",
    ]);

    const command = runJson("tools/runtime/repair-layer.mjs", [
      "--target",
      target,
      "--index-file",
      sqliteFileArg,
      "--index-backend",
      "sqlite",
      "--report-file",
      reportFileArg,
      "--apply",
      "--json",
    ]);

    const payload = readIndexFromSqlite(sqliteFile).payload;
    const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));

    const checks = {
      action_completed: ["applied", "skipped"].includes(String(command?.action ?? "")),
      report_written: path.resolve(reportFile) === String(command?.report_file ?? ""),
      sqlite_sessions_present: Array.isArray(payload.sessions) && payload.sessions.length >= 2,
      sqlite_findings_present: Array.isArray(payload.migration_findings) && payload.migration_findings.length >= 1,
      sqlite_ambiguous_relation_present: Array.isArray(payload.migration_findings)
        && payload.migration_findings.some((row) => String(row?.finding_type ?? "") === "AMBIGUOUS_RELATION" && String(row?.entity_id ?? "") === "S102"),
      report_summary_matches_findings: Number(report?.summary?.migration_findings_count ?? -1) === Number(payload?.migration_findings?.length ?? 0),
      report_summary_matches_sessions: Number(report?.summary?.sessions_count ?? -1) === Number(payload?.sessions?.length ?? 0),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      target_root: target,
      sqlite_file: sqliteFile,
      report_file: reportFile,
      checks,
      command,
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
