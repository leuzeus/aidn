#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    modernTarget: "tests/fixtures/perf-structure/modern",
    mixedTarget: "tests/fixtures/perf-structure/mixed",
    indexFile: ".aidn/runtime/index/fixtures/select/workflow-index.json",
    checkFile: ".aidn/runtime/index/fixtures/select/index-sync-check.json",
    pathsFile: ".aidn/runtime/index/fixtures/select/export-paths.txt",
    rebuildAuditRoot: ".aidn/runtime/index/fixtures/select/rebuild/docs/audit",
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
  console.log("  node tools/perf/verify-index-sync-select-paths-fixtures.mjs");
  console.log("  node tools/perf/verify-index-sync-select-paths-fixtures.mjs --modern-target tests/fixtures/perf-structure/modern --mixed-target tests/fixtures/perf-structure/mixed");
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

function readPathsFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
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

    const drift = runJson("tools/perf/index-sync-check.mjs", [
      "--target",
      modernTarget,
      "--index-file",
      indexFilePath,
      "--json",
    ]);
    fs.mkdirSync(path.dirname(checkFilePath), { recursive: true });
    fs.writeFileSync(checkFilePath, `${JSON.stringify(drift, null, 2)}\n`, "utf8");

    const apply = runJson("tools/perf/index-sync-check.mjs", [
      "--target",
      modernTarget,
      "--index-file",
      indexFilePath,
      "--apply",
      "--json",
    ]);

    const select = runJson("tools/perf/index-sync-select-paths.mjs", [
      "--target",
      modernTarget,
      "--check-file",
      checkFilePath,
      "--out",
      pathsFilePath,
      "--json",
    ]);
    const selectedPathsFromFile = readPathsFile(pathsFilePath);

    const exportOne = runJson("tools/perf/index-export-files.mjs", [
      "--index-file",
      indexFilePath,
      "--backend",
      "json",
      "--target",
      modernTarget,
      "--audit-root",
      rebuildAuditRootPath,
      "--paths-file",
      pathsFilePath,
      "--json",
    ]);
    const exportTwo = runJson("tools/perf/index-export-files.mjs", [
      "--index-file",
      indexFilePath,
      "--backend",
      "json",
      "--target",
      modernTarget,
      "--audit-root",
      rebuildAuditRootPath,
      "--paths-file",
      pathsFilePath,
      "--json",
    ]);
    const exportThree = runJson("tools/perf/index-export-files.mjs", [
      "--index-file",
      indexFilePath,
      "--backend",
      "json",
      "--target",
      modernTarget,
      "--audit-root",
      rebuildAuditRootPath,
      "--paths-file",
      pathsFilePath,
      "--json",
    ]);

    const allSelectedExist = selectedPathsFromFile.every((rel) =>
      fs.existsSync(path.resolve(rebuildAuditRootPath, rel.replace(/\//g, path.sep))),
    );

    const checks = {
      drift_detected: drift.in_sync === false && (Array.isArray(drift.artifact_mismatches) && drift.artifact_mismatches.length >= 1),
      apply_executed: apply.action === "applied",
      selected_paths_count: Number(select.selected_paths_count ?? 0),
      selected_paths_file_count: selectedPathsFromFile.length,
      selected_paths_file_match: selectedPathsFromFile.length === Number(select.selected_paths_count ?? 0),
      export_missing_content: Number(exportOne?.summary?.missing_content ?? -1),
      export_selected_filter_count: Number(exportOne?.summary?.selected_paths_filter_count ?? -1),
      export_selected_filter_missing: Number(exportOne?.summary?.selected_paths_filter_missing_count ?? -1),
      export_written_or_unchanged: Number(exportOne?.summary?.exported ?? 0) + Number(exportOne?.summary?.unchanged ?? 0),
      export_second_exported: Number(exportTwo?.summary?.exported ?? -1),
      export_second_unchanged: Number(exportTwo?.summary?.unchanged ?? -1),
      export_third_exported: Number(exportThree?.summary?.exported ?? -1),
      export_third_unchanged: Number(exportThree?.summary?.unchanged ?? -1),
      selected_paths_exist_in_rebuild: allSelectedExist,
    };
    const idempotentObservedSecond = checks.export_second_exported === 0 && checks.export_second_unchanged >= 1;
    const idempotentObservedThird = checks.export_third_exported === 0 && checks.export_third_unchanged >= 1;
    checks.export_idempotent_observed = idempotentObservedSecond || idempotentObservedThird;

    const pass = checks.drift_detected
      && checks.apply_executed
      && checks.selected_paths_count >= 1
      && checks.selected_paths_file_match
      && checks.export_missing_content === 0
      && checks.export_selected_filter_count === checks.selected_paths_count
      && checks.export_selected_filter_missing === 0
      && checks.export_written_or_unchanged === checks.selected_paths_count
      && checks.export_idempotent_observed
      && checks.selected_paths_exist_in_rebuild;

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
      console.log(`Check file: ${output.files.check_file}`);
      console.log(`Paths file: ${output.files.paths_file}`);
      console.log(`Drift detected: ${checks.drift_detected ? "yes" : "no"}`);
      console.log(`Apply executed: ${checks.apply_executed ? "yes" : "no"}`);
      console.log(`Selected paths: ${checks.selected_paths_count}`);
      console.log(`Export missing content: ${checks.export_missing_content}`);
      console.log(`Export selected filter count: ${checks.export_selected_filter_count}`);
      console.log(`Export selected filter missing: ${checks.export_selected_filter_missing}`);
      console.log(`Export first written+unchanged: ${checks.export_written_or_unchanged}`);
      console.log(`Export second exported/unchanged: ${checks.export_second_exported}/${checks.export_second_unchanged}`);
      console.log(`Export third exported/unchanged: ${checks.export_third_exported}/${checks.export_third_unchanged}`);
      console.log(`Export idempotent observed: ${checks.export_idempotent_observed ? "yes" : "no"}`);
      console.log(`Selected paths exist in rebuild: ${checks.selected_paths_exist_in_rebuild ? "yes" : "no"}`);
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
