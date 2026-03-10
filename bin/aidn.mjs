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
  "constraint-report": { file: "report-constraints.mjs" },
  "constraint-actions": { file: "report-constraint-actions.mjs" },
  "constraint-history": { file: "sync-constraint-history.mjs" },
  "constraint-trend": { file: "report-constraint-trend.mjs" },
  "constraint-trend-summary": { file: "render-constraint-trend-summary.mjs" },
  "constraint-lot-plan": { file: "report-constraint-lot-plan.mjs" },
  "constraint-lot-update": { file: "update-constraint-lot-plan.mjs" },
  "constraint-lot-advance": { file: "advance-constraint-lot-plan.mjs" },
  "constraint-lot-summary": { file: "render-constraint-lot-plan-summary.mjs" },
  "constraint-summary": { file: "render-constraint-summary.mjs" },
  "constraint-loop": { file: "constraint-loop.mjs" },
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
  "verify-skill-hook-context": { file: "verify-skill-hook-context-injection.mjs" },
  "verify-db-first-sync": { file: "verify-db-first-sync-coverage.mjs" },
  "verify-sync-db-first-selective": { file: "verify-sync-db-first-selective-fixtures.mjs" },
  "verify-install-import": { file: "verify-install-import-fixtures.mjs" },
  "verify-state-mode-parity": { file: "verify-state-mode-parity-fixtures.mjs" },
  "verify-constraint-report": { file: "verify-constraint-report-fixtures.mjs" },
  "verify-constraint-actions": { file: "verify-constraint-actions-fixtures.mjs" },
  "verify-constraint-trend": { file: "verify-constraint-trend-fixtures.mjs" },
  "verify-constraint-lot-plan": { file: "verify-constraint-lot-plan-fixtures.mjs" },
  "index-report": { file: "report-index.mjs" },
  "index-thresholds": { file: "check-thresholds-defaults.mjs", fixedArgs: ["--preset", "index"] },
  "index-sync-thresholds": { file: "check-thresholds-defaults.mjs", fixedArgs: ["--preset", "index-sync"] },
  checkpoint: { file: "checkpoint.mjs" },
  "reload-check": { file: "reload-check.mjs" },
  gate: { file: "gating-evaluate.mjs" },
  "check-thresholds": { file: "check-thresholds.mjs" },
  "check-regression": { file: "check-regression.mjs" },
  "check-fallbacks": { file: "check-thresholds-defaults.mjs", fixedArgs: ["--preset", "fallback"] },
  "check-constraints": { file: "check-thresholds-defaults.mjs", fixedArgs: ["--preset", "constraint"] },
  "check-constraint-trend": { file: "check-thresholds-defaults.mjs", fixedArgs: ["--preset", "constraint-trend"] },
  campaign: { file: "run-kpi-campaign.mjs" },
  "render-summary": { file: "render-summary.mjs" },
  reset: { file: "reset-runtime.mjs" },
  hook: { file: "workflow-hook.mjs" },
  "session-start": { file: "workflow-hook.mjs", fixedArgs: ["--phase", "session-start"] },
  "session-close": { file: "workflow-hook.mjs", fixedArgs: ["--phase", "session-close"] },
  "delivery-start": { file: "delivery-window.mjs", fixedArgs: ["--action", "start"] },
  "delivery-end": { file: "delivery-window.mjs", fixedArgs: ["--action", "end"] },
  "audit-review": { file: "audit-review.mjs" },
};

const CODEX_ALIASES = {
  "run-json-hook": { file: "run-json-hook.mjs" },
  "normalize-hook-payload": { file: "normalize-hook-payload.mjs" },
  "hydrate-context": { file: "hydrate-context.mjs" },
  "context-store": { file: "context-store.mjs" },
};

const RUNTIME_ALIASES = {
  "artifact-store": { file: "artifact-store.mjs" },
  "coordinator-dispatch-execute": { file: "coordinator-dispatch-execute.mjs" },
  "coordinator-dispatch-plan": { file: "coordinator-dispatch-plan.mjs" },
  "coordinator-loop": { file: "coordinator-loop.mjs" },
  "coordinator-orchestrate": { file: "coordinator-orchestrate.mjs" },
  "coordinator-record-arbitration": { file: "coordinator-record-arbitration.mjs" },
  "coordinator-resume": { file: "coordinator-resume.mjs" },
  "coordinator-next-action": { file: "coordinator-next-action.mjs" },
  "coordinator-select-agent": { file: "coordinator-select-agent.mjs" },
  "coordinator-suggest-arbitration": { file: "coordinator-suggest-arbitration.mjs" },
  "list-agent-adapters": { file: "list-agent-adapters.mjs" },
  "verify-agent-roster": { file: "verify-agent-roster.mjs" },
  "project-agent-health-summary": { file: "project-agent-health-summary.mjs" },
  "project-agent-selection-summary": { file: "project-agent-selection-summary.mjs" },
  "project-integration-risk": { file: "project-integration-risk.mjs" },
  "project-multi-agent-status": { file: "project-multi-agent-status.mjs" },
  "db-first-artifact": { file: "db-first-artifact.mjs" },
  "handoff-admit": { file: "handoff-admit.mjs" },
  "pre-write-admit": { file: "pre-write-admit.mjs" },
  "project-coordination-summary": { file: "project-coordination-summary.mjs" },
  "project-handoff-packet": { file: "project-handoff-packet.mjs" },
  "project-runtime-state": { file: "project-runtime-state.mjs" },
  "sync-db-first": { file: "sync-db-first.mjs" },
  "sync-db-first-selective": { file: "sync-db-first-selective.mjs" },
  "mode-migrate": { file: "mode-migrate.mjs" },
};

function printUsage() {
  console.log("Usage:");
  console.log("  aidn install --target ../repo --pack core");
  console.log("  aidn install --target ../repo --pack core --verify");
  console.log("  aidn build-release");
  console.log("  aidn perf checkpoint --target ../repo --mode COMMITTING --index-store all --index-sync-check --json");
  console.log("  aidn perf session-start --target ../repo --mode COMMITTING --json");
  console.log("  aidn codex run-json-hook --skill context-reload --mode THINKING --target . --json");
  console.log("  aidn runtime sync-db-first-selective --target . --json");
  console.log("  aidn runtime coordinator-dispatch-execute --target . --execute --json");
  console.log("  aidn runtime coordinator-dispatch-plan --target . --json");
  console.log("  aidn runtime coordinator-loop --target . --json");
  console.log("  aidn runtime coordinator-orchestrate --target . --execute --max-iterations 2 --json");
  console.log("  aidn runtime coordinator-record-arbitration --target . --decision continue --note \"validated by user\" --json");
  console.log("  aidn runtime coordinator-resume --target . --json");
  console.log("  aidn runtime coordinator-next-action --target . --json");
  console.log("  aidn runtime coordinator-select-agent --target . --role auditor --action audit --json");
  console.log("  aidn runtime coordinator-suggest-arbitration --target . --json");
  console.log("  aidn runtime list-agent-adapters --target . --json");
  console.log("  aidn runtime verify-agent-roster --target . --json");
  console.log("  aidn runtime project-agent-health-summary --target . --json");
  console.log("  aidn runtime project-agent-selection-summary --target . --json");
  console.log("  aidn runtime project-integration-risk --target . --json");
  console.log("  aidn runtime project-multi-agent-status --target . --json");
  console.log("  aidn runtime handoff-admit --target . --json");
  console.log("  aidn runtime pre-write-admit --target . --skill cycle-create --json");
  console.log("  aidn runtime project-coordination-summary --target . --json");
  console.log("  aidn runtime project-handoff-packet --target . --json");
  console.log("  aidn runtime project-runtime-state --target . --json");
  console.log("");
  console.log("Perf subcommands:");
  console.log(`  ${Object.keys(PERF_ALIASES).sort().join(", ")}`);
  console.log("Codex subcommands:");
  console.log(`  ${Object.keys(CODEX_ALIASES).sort().join(", ")}`);
  console.log("Runtime subcommands:");
  console.log(`  ${Object.keys(RUNTIME_ALIASES).sort().join(", ")}`);
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
  return resolveToolCommand({
    aliases: PERF_ALIASES,
    group: "perf",
    rootDir: path.join("tools", "perf"),
    subcommand,
    args,
  });
}

function resolveCodexCommand(subcommand, args) {
  return resolveToolCommand({
    aliases: CODEX_ALIASES,
    group: "codex",
    rootDir: path.join("tools", "codex"),
    subcommand,
    args,
  });
}

function resolveRuntimeCommand(subcommand, args) {
  return resolveToolCommand({
    aliases: RUNTIME_ALIASES,
    group: "runtime",
    rootDir: path.join("tools", "runtime"),
    subcommand,
    args,
  });
}

function resolveToolCommand({ aliases, group, rootDir, subcommand, args }) {
  const alias = aliases[subcommand];
  if (alias) {
    return {
      relativePath: path.join(rootDir, alias.file),
      argv: [...(alias.fixedArgs ?? []), ...args],
    };
  }
  if (!/^[a-z0-9-]+$/.test(subcommand)) {
    throw new Error(`Invalid ${group} subcommand: ${subcommand}`);
  }
  const fallbackFile = `${subcommand}.mjs`;
  return {
    relativePath: path.join(rootDir, fallbackFile),
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

  if (command === "codex") {
    const subcommand = argv[1] ?? "";
    if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
      printUsage();
      process.exit(1);
    }
    try {
      const codex = resolveCodexCommand(subcommand, argv.slice(2));
      runNodeScript(codex.relativePath, codex.argv);
      return;
    } catch (error) {
      console.error(`ERROR: ${error.message}`);
      process.exit(1);
    }
  }

  if (command === "runtime") {
    const subcommand = argv[1] ?? "";
    if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
      printUsage();
      process.exit(1);
    }
    try {
      const runtime = resolveRuntimeCommand(subcommand, argv.slice(2));
      runNodeScript(runtime.relativePath, runtime.argv);
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
