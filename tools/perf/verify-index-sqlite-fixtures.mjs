#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    indexFile: ".aidn/runtime/index/fixtures/sqlite/workflow-index.json",
    sqlFile: ".aidn/runtime/index/fixtures/sqlite/workflow-index.sql",
    sqliteFile: ".aidn/runtime/index/fixtures/sqlite/workflow-index.sqlite",
    exportedFile: ".aidn/runtime/index/fixtures/sqlite/workflow-index.from-sqlite.json",
    rebuildAuditRoot: ".aidn/runtime/index/fixtures/sqlite/rebuild/docs/audit",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sql-file") {
      args.sqlFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--exported-file") {
      args.exportedFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--rebuild-audit-root") {
      args.rebuildAuditRoot = argv[i + 1] ?? "";
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
  if (!args.target || !args.indexFile || !args.sqlFile || !args.sqliteFile || !args.exportedFile || !args.rebuildAuditRoot) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-index-sqlite-fixtures.mjs");
  console.log("  node tools/perf/verify-index-sqlite-fixtures.mjs --target tests/fixtures/repo-installed-core");
  console.log("  node tools/perf/verify-index-sqlite-fixtures.mjs --sqlite-file .aidn/runtime/index/fixtures/sqlite/workflow-index.sqlite");
  console.log("  node tools/perf/verify-index-sqlite-fixtures.mjs --rebuild-audit-root .aidn/runtime/index/fixtures/sqlite/rebuild/docs/audit");
}

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function runNoJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveTargetPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const target = path.resolve(process.cwd(), args.target);
    const indexFilePath = resolveTargetPath(target, args.indexFile);
    const sqlFilePath = resolveTargetPath(target, args.sqlFile);
    const sqliteFilePath = resolveTargetPath(target, args.sqliteFile);
    const exportedFilePath = resolveTargetPath(target, args.exportedFile);
    const rebuildAuditRootPath = resolveTargetPath(target, args.rebuildAuditRoot);

    runNoJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "all",
      "--no-content",
      "--output",
      indexFilePath,
      "--sql-output",
      sqlFilePath,
      "--sqlite-output",
      sqliteFilePath,
    ]);

    const dualParity = runJson("tools/perf/index-verify-dual.mjs", [
      "--index-file",
      indexFilePath,
      "--sql-file",
      sqlFilePath,
      "--json",
    ]);

    const sqliteParity = runJson("tools/perf/index-verify-sqlite.mjs", [
      "--index-file",
      indexFilePath,
      "--sqlite-file",
      sqliteFilePath,
      "--json",
    ]);

    const exported = runJson("tools/perf/index-from-sqlite.mjs", [
      "--sqlite-file",
      sqliteFilePath,
      "--out",
      exportedFilePath,
      "--json",
    ]);

    const rebuilt = runJson("tools/perf/index-export-files.mjs", [
      "--index-file",
      sqliteFilePath,
      "--backend",
      "sqlite",
      "--target",
      target,
      "--audit-root",
      rebuildAuditRootPath,
      "--json",
    ]);
    const rebuiltSecond = runJson("tools/perf/index-export-files.mjs", [
      "--index-file",
      sqliteFilePath,
      "--backend",
      "sqlite",
      "--target",
      target,
      "--audit-root",
      rebuildAuditRootPath,
      "--json",
    ]);
    const rebuiltWorkflowPath = path.resolve(rebuildAuditRootPath, "WORKFLOW.md");

    const incrementalObserved = Number(rebuiltSecond?.summary?.rendered_incremental_from_canonical ?? 0) >= 1;
    const idempotentObserved = Number(rebuiltSecond?.summary?.exported ?? -1) === 0
      && Number(rebuiltSecond?.summary?.unchanged ?? 0) >= 1;
    const pass = dualParity.ok === true
      && sqliteParity.in_sync === true
      && exists(indexFilePath)
      && exists(sqlFilePath)
      && exists(sqliteFilePath)
      && exists(exportedFilePath)
      && exists(rebuiltWorkflowPath)
      && Number(rebuilt?.summary?.missing_content ?? 0) === 0
      && Number(rebuilt?.summary?.rendered_from_canonical ?? 0) >= 1
      && Number(rebuiltSecond?.summary?.missing_content ?? 0) === 0
      && idempotentObserved
      && (incrementalObserved || idempotentObserved);

    const output = {
      ts: new Date().toISOString(),
      target_root: target,
      files: {
        index_file: indexFilePath,
        sql_file: sqlFilePath,
        sqlite_file: sqliteFilePath,
        exported_file: exportedFilePath,
        rebuilt_audit_root: rebuildAuditRootPath,
      },
      checks: {
        dual_parity_ok: dualParity.ok === true,
        sqlite_parity_in_sync: sqliteParity.in_sync === true,
        export_written: exported?.write?.written === true || exported?.write?.written === false,
        rebuild_missing_content: Number(rebuilt?.summary?.missing_content ?? -1),
        rebuild_rendered_from_canonical: Number(rebuilt?.summary?.rendered_from_canonical ?? 0),
        rebuild_second_missing_content: Number(rebuiltSecond?.summary?.missing_content ?? -1),
        rebuild_second_rendered_incremental: Number(rebuiltSecond?.summary?.rendered_incremental_from_canonical ?? 0),
        rebuild_second_unchanged: Number(rebuiltSecond?.summary?.unchanged ?? 0),
        rebuild_second_exported: Number(rebuiltSecond?.summary?.exported ?? 0),
        incremental_observed: incrementalObserved,
        idempotent_observed: idempotentObserved,
        rebuild_workflow_exists: exists(rebuiltWorkflowPath),
        dual_parity_digest: dualParity.actual_sha256 ?? null,
        sqlite_parity_digest: sqliteParity?.digests?.index_sqlite ?? null,
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${output.target_root}`);
      console.log(`Dual parity: ${output.checks.dual_parity_ok ? "PASS" : "FAIL"}`);
      console.log(`SQLite parity: ${output.checks.sqlite_parity_in_sync ? "PASS" : "FAIL"}`);
      console.log(`Export exists: ${exists(exportedFilePath) ? "yes" : "no"}`);
      console.log(`Rebuild workflow exists: ${output.checks.rebuild_workflow_exists ? "yes" : "no"}`);
      console.log(`Rebuild missing content: ${output.checks.rebuild_missing_content}`);
      console.log(`Rebuild second missing content: ${output.checks.rebuild_second_missing_content}`);
      console.log(`Rebuild second exported: ${output.checks.rebuild_second_exported}`);
      console.log(`Rebuild second unchanged: ${output.checks.rebuild_second_unchanged}`);
      console.log(`Rebuild second incremental rendered: ${output.checks.rebuild_second_rendered_incremental}`);
      console.log(`Idempotent observed: ${output.checks.idempotent_observed ? "yes" : "no"}`);
      console.log(`Incremental observed: ${output.checks.incremental_observed ? "yes" : "no"}`);
      console.log(`Result: ${output.pass ? "PASS" : "FAIL"}`);
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
