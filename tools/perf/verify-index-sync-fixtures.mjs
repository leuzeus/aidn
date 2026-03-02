#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    modernTarget: "tests/fixtures/perf-structure/modern",
    mixedTarget: "tests/fixtures/perf-structure/mixed",
    indexFile: ".aidn/runtime/index/fixtures/sync/workflow-index.json",
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
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.modernTarget || !args.mixedTarget || !args.indexFile) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-index-sync-fixtures.mjs");
  console.log("  node tools/perf/verify-index-sync-fixtures.mjs --modern-target tests/fixtures/perf-structure/modern --mixed-target tests/fixtures/perf-structure/mixed");
  console.log("  node tools/perf/verify-index-sync-fixtures.mjs --index-file .aidn/runtime/index/fixtures/sync/workflow-index.json");
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
    const mixedTarget = path.resolve(process.cwd(), args.mixedTarget);
    const modernTarget = path.resolve(process.cwd(), args.modernTarget);
    const indexFilePath = path.resolve(process.cwd(), args.indexFile);

    // Seed index with mixed target to force drift for modern target.
    runNoJson("tools/perf/index-sync.mjs", [
      "--target",
      mixedTarget,
      "--output",
      indexFilePath,
    ]);

    const checkDrift = runJson("tools/perf/index-sync-check.mjs", [
      "--target",
      modernTarget,
      "--index-file",
      indexFilePath,
      "--json",
    ]);

    const checkApply = runJson("tools/perf/index-sync-check.mjs", [
      "--target",
      modernTarget,
      "--index-file",
      indexFilePath,
      "--apply",
      "--json",
    ]);

    const checkFinal = runJson("tools/perf/index-sync-check.mjs", [
      "--target",
      modernTarget,
      "--index-file",
      indexFilePath,
      "--json",
    ]);

    const pass = checkDrift.in_sync === false
      && checkApply.action === "applied"
      && checkFinal.in_sync === true;

    const output = {
      ts: new Date().toISOString(),
      index_file: indexFilePath,
      checks: {
        drift: {
          in_sync: checkDrift.in_sync,
          reason_codes: checkDrift.reason_codes,
          mismatch_count: checkDrift.summary?.mismatch_count ?? null,
        },
        apply: {
          action: checkApply.action,
          applied_files_written: checkApply.apply_result?.writes?.files_written_count ?? 0,
        },
        final: {
          in_sync: checkFinal.in_sync,
          reason_codes: checkFinal.reason_codes,
          mismatch_count: checkFinal.summary?.mismatch_count ?? null,
        },
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Index file: ${output.index_file}`);
      console.log(`Drift check in_sync: ${output.checks.drift.in_sync}`);
      console.log(`Apply action: ${output.checks.apply.action}`);
      console.log(`Final check in_sync: ${output.checks.final.in_sync}`);
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
