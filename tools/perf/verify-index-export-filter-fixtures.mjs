#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const FILTER_PATHS = [
  "reports/R001-latency-review.md",
  "backlog/BL001-perf-followups.md",
];

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/modern",
    indexFile: ".aidn/runtime/index/fixtures/filter/workflow-index.json",
    sqliteFile: ".aidn/runtime/index/fixtures/filter/workflow-index.sqlite",
    rebuildAuditRoot: ".aidn/runtime/index/fixtures/filter/rebuild/docs/audit",
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
    } else if (token === "--sqlite-file") {
      args.sqliteFile = argv[i + 1] ?? "";
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
  if (!args.target || !args.indexFile || !args.sqliteFile || !args.rebuildAuditRoot) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-index-export-filter-fixtures.mjs");
  console.log("  node tools/perf/verify-index-export-filter-fixtures.mjs --target tests/fixtures/perf-structure/modern");
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

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const indexFilePath = resolveTargetPath(targetRoot, args.indexFile);
    const sqliteFilePath = resolveTargetPath(targetRoot, args.sqliteFile);
    const rebuildAuditRootPath = resolveTargetPath(targetRoot, args.rebuildAuditRoot);

    runNoJson("tools/perf/index-sync.mjs", [
      "--target",
      targetRoot,
      "--store",
      "sqlite",
      "--no-content",
      "--output",
      indexFilePath,
      "--sqlite-output",
      sqliteFilePath,
    ]);

    const first = runJson("tools/perf/index-export-files.mjs", [
      "--index-file",
      sqliteFilePath,
      "--backend",
      "sqlite",
      "--target",
      targetRoot,
      "--audit-root",
      rebuildAuditRootPath,
      "--only-path",
      FILTER_PATHS[0],
      "--only-path",
      FILTER_PATHS[1],
      "--json",
    ]);

    const second = runJson("tools/perf/index-export-files.mjs", [
      "--index-file",
      sqliteFilePath,
      "--backend",
      "sqlite",
      "--target",
      targetRoot,
      "--audit-root",
      rebuildAuditRootPath,
      "--only-path",
      FILTER_PATHS[0],
      "--only-path",
      FILTER_PATHS[1],
      "--json",
    ]);
    const third = runJson("tools/perf/index-export-files.mjs", [
      "--index-file",
      sqliteFilePath,
      "--backend",
      "sqlite",
      "--target",
      targetRoot,
      "--audit-root",
      rebuildAuditRootPath,
      "--only-path",
      FILTER_PATHS[0],
      "--only-path",
      FILTER_PATHS[1],
      "--json",
    ]);

    const expectedPaths = FILTER_PATHS.map((rel) => path.resolve(rebuildAuditRootPath, rel.replace(/\//g, path.sep)));
    const expectedExist = expectedPaths.every((filePath) => fs.existsSync(filePath));
    const unexpectedPath = path.resolve(rebuildAuditRootPath, "migration", "M001-state-mode-transition.md");
    const unexpectedMissing = !fs.existsSync(unexpectedPath);

    const checks = {
      filter_count_first: Number(first?.summary?.selected_paths_filter_count ?? -1),
      filter_missing_first: Number(first?.summary?.selected_paths_filter_missing_count ?? -1),
      selected_artifacts_first: Number(first?.summary?.artifacts_selected ?? -1),
      missing_content_first: Number(first?.summary?.missing_content ?? -1),
      exported_first: Number(first?.summary?.exported ?? -1),
      unchanged_first: Number(first?.summary?.unchanged ?? -1),
      unchanged_second: Number(second?.summary?.unchanged ?? -1),
      exported_second: Number(second?.summary?.exported ?? -1),
      incremental_second: Number(second?.summary?.rendered_incremental_from_canonical ?? -1),
      unchanged_third: Number(third?.summary?.unchanged ?? -1),
      exported_third: Number(third?.summary?.exported ?? -1),
      incremental_third: Number(third?.summary?.rendered_incremental_from_canonical ?? -1),
      expected_paths_exist: expectedExist,
      unexpected_path_missing: unexpectedMissing,
    };
    const idempotentObservedSecond = checks.exported_second === 0 && checks.unchanged_second >= 1;
    const idempotentObservedThird = checks.exported_third === 0 && checks.unchanged_third >= 1;
    checks.idempotent_observed = idempotentObservedSecond || idempotentObservedThird;

    const pass = checks.filter_count_first === FILTER_PATHS.length
      && checks.filter_missing_first === 0
      && checks.selected_artifacts_first === FILTER_PATHS.length
      && checks.missing_content_first === 0
      && (checks.exported_first + checks.unchanged_first) === FILTER_PATHS.length
      && checks.incremental_second >= 1
      && checks.incremental_third >= 1
      && checks.idempotent_observed
      && checks.expected_paths_exist
      && checks.unexpected_path_missing;

    const output = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      files: {
        index_file: indexFilePath,
        sqlite_file: sqliteFilePath,
        rebuild_audit_root: rebuildAuditRootPath,
      },
      checks,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${output.target_root}`);
      console.log(`Filter count: ${checks.filter_count_first}`);
      console.log(`Filter missing: ${checks.filter_missing_first}`);
      console.log(`Selected artifacts: ${checks.selected_artifacts_first}`);
      console.log(`Missing content (first): ${checks.missing_content_first}`);
      console.log(`Exported (first): ${checks.exported_first}`);
      console.log(`Unchanged (first): ${checks.unchanged_first}`);
      console.log(`Unchanged (second): ${checks.unchanged_second}`);
      console.log(`Exported (second): ${checks.exported_second}`);
      console.log(`Incremental rendered (second): ${checks.incremental_second}`);
      console.log(`Unchanged (third): ${checks.unchanged_third}`);
      console.log(`Exported (third): ${checks.exported_third}`);
      console.log(`Incremental rendered (third): ${checks.incremental_third}`);
      console.log(`Idempotent observed: ${checks.idempotent_observed ? "yes" : "no"}`);
      console.log(`Expected paths exist: ${checks.expected_paths_exist ? "yes" : "no"}`);
      console.log(`Unexpected path missing: ${checks.unexpected_path_missing ? "yes" : "no"}`);
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
