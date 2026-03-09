#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  printHumanGatingResult,
  runGatingEvaluateUseCase,
} from "../../src/application/runtime/gating-evaluate-use-case.mjs";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const envStateMode = String(process.env.AIDN_STATE_MODE ?? "").trim().toLowerCase();
  const args = {
    target: ".",
    cache: ".aidn/runtime/cache/reload-state.json",
    eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
    indexSyncCheckFile: ".aidn/runtime/index/index-sync-check.json",
    stateMode: envStateMode || "files",
    stateModeExplicit: false,
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    indexBackend: "auto",
    thresholdFiles: 3,
    thresholdMinutes: 45,
    mode: "COMMITTING",
    runId: "",
    reloadDecision: "",
    reloadFallback: "",
    reloadReasonCodes: "",
    emitEvent: true,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--cache") {
      args.cache = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--event-file") {
      args.eventFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-sync-check-file") {
      args.indexSyncCheckFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--state-mode") {
      args.stateMode = String(argv[i + 1] ?? "").toLowerCase();
      args.stateModeExplicit = true;
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-backend") {
      args.indexBackend = String(argv[i + 1] ?? "").toLowerCase();
      i += 1;
    } else if (token === "--threshold-files") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--threshold-files must be an integer");
      }
      args.thresholdFiles = Number(raw);
    } else if (token === "--threshold-minutes") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--threshold-minutes must be an integer");
      }
      args.thresholdMinutes = Number(raw);
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").toUpperCase();
      i += 1;
    } else if (token === "--run-id") {
      args.runId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--reload-decision") {
      args.reloadDecision = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--reload-fallback") {
      args.reloadFallback = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--reload-reason-codes") {
      args.reloadReasonCodes = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--no-emit-event") {
      args.emitEvent = false;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!args.eventFile) {
    throw new Error("Missing value for --event-file");
  }
  if (!["files", "dual", "db-only"].includes(args.stateMode)) {
    throw new Error("Invalid --state-mode. Expected files|dual|db-only");
  }
  if (!args.indexFile) {
    throw new Error("Missing value for --index-file");
  }
  if (!["auto", "json", "sqlite"].includes(args.indexBackend)) {
    throw new Error("Invalid --index-backend. Expected auto|json|sqlite");
  }
  if (!["THINKING", "EXPLORING", "COMMITTING", "UNKNOWN"].includes(args.mode)) {
    throw new Error("Invalid --mode. Expected THINKING|EXPLORING|COMMITTING|UNKNOWN");
  }
  if (args.reloadDecision && !["incremental", "full", "stop"].includes(args.reloadDecision)) {
    throw new Error("Invalid --reload-decision. Expected incremental|full|stop");
  }
  if (args.reloadFallback && !["true", "false"].includes(args.reloadFallback)) {
    throw new Error("Invalid --reload-fallback. Expected true|false");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/gating-evaluate.mjs --target ../client");
  console.log("  AIDN_STATE_MODE=db-only node tools/perf/gating-evaluate.mjs --target ../client");
  console.log("  node tools/perf/gating-evaluate.mjs --target ../client --mode COMMITTING");
  console.log("  node tools/perf/gating-evaluate.mjs --target ../client --index-sync-check-file .aidn/runtime/index/index-sync-check.json");
  console.log("  node tools/perf/gating-evaluate.mjs --target ../client --state-mode db-only --index-file .aidn/runtime/index/workflow-index.sqlite");
  console.log("  node tools/perf/gating-evaluate.mjs --target ../client --run-id S072-20260301T1012Z");
  console.log("  node tools/perf/gating-evaluate.mjs --target ../client --reload-decision incremental --reload-fallback false --reload-reason-codes \"\"");
  console.log("  node tools/perf/gating-evaluate.mjs --json");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const result = runGatingEvaluateUseCase({
      args,
      targetRoot,
      runtimeDir: PERF_DIR,
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printHumanGatingResult(result);
    if (result.event_file) {
      console.log(`Event file: ${result.event_file}`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
