#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(BIN_DIR, "..");
const VERSION_FILE = path.join(REPO_ROOT, "VERSION");

const PERF_ALIASES = {
  collect: { file: "collect-event.mjs" },
  report: { file: "report-kpi.mjs" },
  "sync-history": { file: "sync-kpi-history.mjs" },
  "fallback-report": { file: "report-fallbacks.mjs" },
  index: { file: "index-sync.mjs" },
  "index-check": { file: "index-sync-check.mjs" },
  "index-select-paths": { file: "index-sync-select-paths.mjs" },
  "index-reconcile": { file: "index-sync-reconcile.mjs" },
  "index-sync-history": { file: "sync-index-sync-history.mjs" },
  "index-sync-report": { file: "report-index-sync.mjs" },
  "index-from-sqlite": { file: "index-from-sqlite.mjs" },
  "index-export-files": { file: "index-export-files.mjs" },
  "index-verify-sqlite": { file: "index-verify-sqlite.mjs" },
  "index-canonical-check": { file: "check-index-canonical-coverage.mjs" },
  "index-canonical-summary": { file: "render-index-canonical-check-summary.mjs" },
  "index-regression-kpi": { file: "report-index-regression-kpi.mjs" },
  "index-regression-history": { file: "sync-kpi-history.mjs" },
  "index-regression": { file: "check-regression.mjs" },
  "index-sql": { file: "index-to-sql.mjs" },
  "index-query": { file: "index-query.mjs" },
  structure: { file: "structure-profile.mjs" },
  "index-verify": { file: "index-verify-dual.mjs" },
  "verify-index-sync": { file: "verify-index-sync-fixtures.mjs" },
  "verify-index-sync-select-paths": { file: "verify-index-sync-select-paths-fixtures.mjs" },
  "verify-index-reconcile": { file: "verify-index-reconcile-fixtures.mjs" },
  "verify-index-sqlite": { file: "verify-index-sqlite-fixtures.mjs" },
  "verify-index-canonical-check": { file: "verify-index-canonical-check-fixtures.mjs" },
  "verify-index-regression": { file: "verify-index-regression-fixtures.mjs" },
  "verify-cli-aliases": { file: "verify-perf-cli-aliases-fixtures.mjs" },
  "verify-structure": { file: "verify-structure-profile-fixtures.mjs" },
  "verify-skill-hooks": { file: "verify-skill-hook-coverage.mjs" },
  "verify-install-import": { file: "verify-install-import-fixtures.mjs" },
  "verify-state-mode-parity": { file: "verify-state-mode-parity-fixtures.mjs" },
  "index-report": { file: "report-index.mjs" },
  "index-thresholds": { file: "check-thresholds-defaults.mjs", fixedArgs: ["--preset", "index"] },
  "index-sync-thresholds": { file: "check-thresholds-defaults.mjs", fixedArgs: ["--preset", "index-sync"] },
  checkpoint: { file: "checkpoint.mjs" },
  "reload-check": { file: "reload-check.mjs" },
  gate: { file: "gating-evaluate.mjs" },
  "check-thresholds": { file: "check-thresholds.mjs" },
  "check-regression": { file: "check-regression.mjs" },
  "check-fallbacks": { file: "check-thresholds-defaults.mjs", fixedArgs: ["--preset", "fallback"] },
  campaign: { file: "run-kpi-campaign.mjs" },
  "render-summary": { file: "render-summary.mjs" },
  reset: { file: "reset-runtime.mjs" },
  hook: { file: "workflow-hook.mjs" },
  "session-start": { file: "workflow-hook.mjs", fixedArgs: ["--phase", "session-start"] },
  "session-close": { file: "workflow-hook.mjs", fixedArgs: ["--phase", "session-close"] },
  "delivery-start": { file: "delivery-window.mjs", fixedArgs: ["--action", "start"] },
  "delivery-end": { file: "delivery-window.mjs", fixedArgs: ["--action", "end"] },
};

function printUsage() {
  console.log("Usage:");
  console.log("  aidn install --target ../repo --pack core");
  console.log("  aidn install --target ../repo --pack core --verify");
  console.log("  aidn build-release");
  console.log("  aidn perf checkpoint --target ../repo --mode COMMITTING --index-store all --index-sync-check --json");
  console.log("  aidn perf session-start --target ../repo --mode COMMITTING --json");
  console.log("");
  console.log("Perf subcommands:");
  console.log(`  ${Object.keys(PERF_ALIASES).sort().join(", ")}`);
}

function printVersion() {
  try {
    const version = fs.readFileSync(VERSION_FILE, "utf8").trim();
    console.log(version || "unknown");
  } catch {
    console.log("unknown");
  }
}

function runNodeScript(relativePath, args) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`ERROR: script not found: ${absolutePath}`);
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [absolutePath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`ERROR: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

function resolvePerfCommand(subcommand, args) {
  const alias = PERF_ALIASES[subcommand];
  if (alias) {
    return {
      relativePath: path.join("tools", "perf", alias.file),
      argv: [...(alias.fixedArgs ?? []), ...args],
    };
  }

  if (!/^[a-z0-9-]+$/.test(subcommand)) {
    throw new Error(`Invalid perf subcommand: ${subcommand}`);
  }
  const fallbackFile = `${subcommand}.mjs`;
  return {
    relativePath: path.join("tools", "perf", fallbackFile),
    argv: args,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? "";

  if (!command || command === "--help" || command === "-h" || command === "help") {
    printUsage();
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    printVersion();
    return;
  }

  if (command === "install") {
    runNodeScript(path.join("tools", "install.mjs"), argv.slice(1));
    return;
  }

  if (command === "build-release") {
    runNodeScript(path.join("tools", "build-release.mjs"), argv.slice(1));
    return;
  }

  if (command === "perf") {
    const subcommand = argv[1] ?? "";
    if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
      printUsage();
      process.exit(1);
    }
    try {
      const perf = resolvePerfCommand(subcommand, argv.slice(2));
      runNodeScript(perf.relativePath, perf.argv);
      return;
    } catch (error) {
      console.error(`ERROR: ${error.message}`);
      process.exit(1);
    }
  }

  console.error(`ERROR: unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

main();
