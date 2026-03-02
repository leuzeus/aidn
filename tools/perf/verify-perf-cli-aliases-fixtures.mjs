#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    sqliteFile: ".aidn/runtime/index/fixtures/cli-aliases/workflow-index.sqlite",
    canonicalCheckFile: ".aidn/runtime/index/fixtures/cli-aliases/index-canonical-check.json",
    canonicalSummaryFile: ".aidn/runtime/index/fixtures/cli-aliases/index-canonical-check-summary.md",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--canonical-check-file") {
      args.canonicalCheckFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--canonical-summary-file") {
      args.canonicalSummaryFile = argv[i + 1] ?? "";
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
  console.log("  node tools/perf/verify-perf-cli-aliases-fixtures.mjs");
  console.log("  node tools/perf/verify-perf-cli-aliases-fixtures.mjs --target tests/fixtures/repo-installed-core");
}

function runNodeWithJson(scriptPath, args) {
  const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function runNodeNoJson(scriptPath, args) {
  execFileSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const root = process.cwd();
    const aidnCli = path.resolve(root, "bin", "aidn.mjs");
    const targetRoot = path.resolve(root, args.target);
    const sqliteFile = path.resolve(targetRoot, args.sqliteFile);
    const canonicalCheckFile = path.resolve(targetRoot, args.canonicalCheckFile);
    const canonicalSummaryFile = path.resolve(targetRoot, args.canonicalSummaryFile);

    runNodeNoJson(aidnCli, [
      "perf",
      "index",
      "--target",
      targetRoot,
      "--store",
      "sqlite",
      "--no-content",
      "--sqlite-output",
      sqliteFile,
    ]);

    const canonicalCheck = runNodeWithJson(aidnCli, [
      "perf",
      "index-canonical-check",
      "--index-file",
      sqliteFile,
      "--backend",
      "sqlite",
      "--targets",
      "docs/performance/INDEX_TARGETS.json",
      "--out",
      canonicalCheckFile,
      "--json",
    ]);

    runNodeNoJson(aidnCli, [
      "perf",
      "index-canonical-summary",
      "--check-file",
      canonicalCheckFile,
      "--out",
      canonicalSummaryFile,
    ]);

    const pass = canonicalCheck?.summary?.overall_status === "pass"
      && fs.existsSync(sqliteFile)
      && fs.existsSync(canonicalCheckFile)
      && fs.existsSync(canonicalSummaryFile);

    const payload = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      files: {
        sqlite_file: sqliteFile,
        canonical_check_file: canonicalCheckFile,
        canonical_summary_file: canonicalSummaryFile,
      },
      checks: {
        canonical_status: canonicalCheck?.summary?.overall_status ?? null,
        canonical_markdown_coverage: canonicalCheck?.coverage?.canonical_coverage_ratio_markdown ?? null,
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`Target: ${payload.target_root}`);
      console.log(`Canonical status: ${payload.checks.canonical_status}`);
      console.log(`Canonical markdown coverage: ${payload.checks.canonical_markdown_coverage}`);
      console.log(`Result: ${payload.pass ? "PASS" : "FAIL"}`);
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
