#!/usr/bin/env node
import path from "node:path";
import { createCodexAgentAdapter } from "../../src/adapters/codex/codex-agent-adapter.mjs";
import { createHookContextStoreAdapter } from "../../src/adapters/codex/hook-context-store-adapter.mjs";
import { runJsonHookUseCase } from "../../src/application/codex/run-json-hook-use-case.mjs";

function splitArgs(argv) {
  const idx = argv.indexOf("--");
  if (idx < 0) {
    return { options: argv, command: [] };
  }
  return {
    options: argv.slice(0, idx),
    command: argv.slice(idx + 1),
  };
}

function parseArgs(argv) {
  const { options, command } = splitArgs(argv);
  const args = {
    skill: "",
    mode: "",
    target: ".",
    stateMode: "",
    strict: false,
    noAutoSkipGate: false,
    failOnRepairBlock: false,
    failOnError: false,
    forceJson: true,
    contextFile: ".aidn/runtime/context/codex-context.json",
    rawDir: ".aidn/runtime/context/raw",
    maxEntries: 50,
    json: false,
    dbSync: null,
    dbSyncExplicit: false,
    command,
  };

  for (let i = 0; i < options.length; i += 1) {
    const token = options[i];
    if (token === "--skill") {
      args.skill = String(options[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(options[i + 1] ?? "").trim().toUpperCase();
      i += 1;
    } else if (token === "--target") {
      args.target = String(options[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--state-mode") {
      args.stateMode = String(options[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--no-auto-skip-gate") {
      args.noAutoSkipGate = true;
    } else if (token === "--fail-on-repair-block") {
      args.failOnRepairBlock = true;
    } else if (token === "--fail-on-error") {
      args.failOnError = true;
    } else if (token === "--no-force-json") {
      args.forceJson = false;
    } else if (token === "--context-file") {
      args.contextFile = String(options[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--raw-dir") {
      args.rawDir = String(options[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--max-entries") {
      args.maxEntries = Number(options[i + 1] ?? 50);
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--db-sync") {
      args.dbSync = true;
      args.dbSyncExplicit = true;
    } else if (token === "--no-db-sync") {
      args.dbSync = false;
      args.dbSyncExplicit = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.skill) {
    throw new Error("Missing value for --skill");
  }
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!Number.isFinite(args.maxEntries) || args.maxEntries < 1) {
    throw new Error("Invalid --max-entries. Expected a positive integer.");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn codex run-json-hook --skill context-reload --mode THINKING --target . --json");
  console.log("  npx aidn codex run-json-hook --skill context-reload --mode THINKING --target . -- npx aidn perf skill-hook --skill context-reload --target . --mode THINKING --json");
  console.log("  npx aidn codex run-json-hook --skill branch-cycle-audit --mode COMMITTING --target . --strict --fail-on-error");
  console.log("  npx aidn codex run-json-hook --skill cycle-create --mode COMMITTING --target . --db-sync --json");
  console.log("  npx aidn codex run-json-hook --skill close-session --mode COMMITTING --target . --no-auto-skip-gate --json");
  console.log("  npx aidn codex run-json-hook --skill close-session --mode COMMITTING --target . --fail-on-repair-block");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const agentAdapter = createCodexAgentAdapter();
    const hookContextStore = createHookContextStoreAdapter();
    const targetRoot = path.resolve(process.cwd(), args.target);
    const output = runJsonHookUseCase({
      args,
      targetRoot,
      agentAdapter,
      hookContextStore,
    });

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      const status = output.ok ? "OK" : "WARN";
      const decision = output.decision ?? output.action ?? output.result ?? "n/a";
      console.log(`Hook context ${status}: skill=${output.skill} mode=${output.mode} state=${output.state_mode} decision=${decision}`);
      if (Number(output.repair_layer_open_count ?? 0) > 0) {
        console.log(`Repair findings: ${output.repair_layer_open_count} open${output.repair_layer_blocking ? " (blocking)" : ""}`);
        if (output.repair_layer_status) {
          console.log(`Repair status: ${output.repair_layer_status}`);
        }
        if (output.repair_layer_advice) {
          console.log(`Repair advice: ${output.repair_layer_advice}`);
        }
      }
      console.log(`Context file: ${output.context_file}`);
    }

    const dbSyncFailed = output.db_sync?.enabled === true && output.db_sync?.error != null;
    const shouldFail = (!output.ok && (args.failOnError || output.strict === true))
      || (dbSyncFailed && output.strict === true)
      || (args.failOnRepairBlock && String(output.repair_layer_status ?? "") === "block");
    if (shouldFail) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
