#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    modernTarget: "tests/fixtures/perf-structure/modern",
    mixedTarget: "tests/fixtures/perf-structure/mixed",
    indexFile: ".aidn/runtime/index/fixtures/reconcile/workflow-index.json",
    checkFile: ".aidn/runtime/index/fixtures/reconcile/index-sync-check.json",
    pathsFile: ".aidn/runtime/index/fixtures/reconcile/export-paths.txt",
    rebuildAuditRoot: ".aidn/runtime/index/fixtures/reconcile/rebuild/docs/audit",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--modern-target") {
      args.modernTarget = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--mixed-target") {
      args.mixedTarget = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--check-file") {
      args.checkFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--paths-file") {
      args.pathsFile = argv[i + 1] ?? "";
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
  if (!args.modernTarget || !args.mixedTarget || !args.indexFile || !args.checkFile || !args.pathsFile || !args.rebuildAuditRoot) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-index-reconcile-fixtures.mjs");
  console.log("  node tools/perf/verify-index-reconcile-fixtures.mjs --modern-target tests/fixtures/perf-structure/modern --mixed-target tests/fixtures/perf-structure/mixed");
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

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const modernTarget = path.resolve(process.cwd(), args.modernTarget);
    const mixedTarget = path.resolve(process.cwd(), args.mixedTarget);
    const indexFilePath = path.resolve(process.cwd(), args.indexFile);
    const checkFilePath = path.resolve(process.cwd(), args.checkFile);
    const pathsFilePath = path.resolve(process.cwd(), args.pathsFile);
    const rebuildAuditRootPath = path.resolve(process.cwd(), args.rebuildAuditRoot);

    runNoJson("tools/perf/index-sync.mjs", [
      "--target",
      mixedTarget,
      "--output",
      indexFilePath,
    ]);

    const first = runJson("tools/perf/index-sync-reconcile.mjs", [
      "--target",
      modernTarget,
      "--index-file",
      indexFilePath,
      "--check-file",
      checkFilePath,
      "--paths-file",
      pathsFilePath,
      "--audit-root",
      rebuildAuditRootPath,
      "--json",
    ]);

    const second = runJson("tools/perf/index-sync-reconcile.mjs", [
      "--target",
      modernTarget,
      "--index-file",
      indexFilePath,
      "--check-file",
      checkFilePath,
      "--paths-file",
      pathsFilePath,
      "--audit-root",
      rebuildAuditRootPath,
      "--json",
    ]);

    const checks = {
      first_pass: first.pass === true,
      first_initial_in_sync_false: first?.summary?.initial_in_sync === false,
      first_apply_executed: first?.summary?.apply_executed === true,
      first_selected_paths_count: Number(first?.summary?.selected_paths_count ?? 0),
      first_export_no_missing_content: Number(first?.summary?.export_missing_content ?? -1) === 0,
      second_pass: second.pass === true,
      second_initial_in_sync_true: second?.summary?.initial_in_sync === true,
      second_apply_executed_false: second?.summary?.apply_executed === false,
    };

    const pass = checks.first_pass
      && checks.first_initial_in_sync_false
      && checks.first_apply_executed
      && checks.first_selected_paths_count >= 1
      && checks.first_export_no_missing_content
      && checks.second_pass
      && checks.second_initial_in_sync_true
      && checks.second_apply_executed_false;

    const output = {
      ts: new Date().toISOString(),
      files: {
        index_file: indexFilePath,
        check_file: checkFilePath,
        paths_file: pathsFilePath,
        rebuild_audit_root: rebuildAuditRootPath,
      },
      checks,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Index file: ${output.files.index_file}`);
      console.log(`First run pass: ${checks.first_pass ? "yes" : "no"}`);
      console.log(`First run initial in sync: ${checks.first_initial_in_sync_false ? "no" : "yes"}`);
      console.log(`First run apply executed: ${checks.first_apply_executed ? "yes" : "no"}`);
      console.log(`First run selected paths: ${checks.first_selected_paths_count}`);
      console.log(`Second run pass: ${checks.second_pass ? "yes" : "no"}`);
      console.log(`Second run initial in sync: ${checks.second_initial_in_sync_true ? "yes" : "no"}`);
      console.log(`Second run apply executed: ${checks.second_apply_executed_false ? "no" : "yes"}`);
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
