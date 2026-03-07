#!/usr/bin/env node
import path from "node:path";
import { runDeliveryWindowUseCase } from "../../src/application/runtime/delivery-window-use-case.mjs";

function parseArgs(argv) {
  const args = {
    action: "",
    file: ".aidn/runtime/perf/workflow-events.ndjson",
    stateFile: ".aidn/runtime/perf/delivery-window.json",
    runIdFile: ".aidn/runtime/perf/current-run-id.txt",
    target: ".",
    mode: "COMMITTING",
    runId: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--action") {
      args.action = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--file") {
      args.file = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--state-file") {
      args.stateFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--run-id-file") {
      args.runIdFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").toUpperCase();
      i += 1;
    } else if (token === "--run-id") {
      args.runId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!["start", "end"].includes(args.action)) {
    throw new Error("Missing or invalid --action. Expected start|end");
  }
  if (!["THINKING", "EXPLORING", "COMMITTING", "UNKNOWN"].includes(args.mode)) {
    throw new Error("Invalid --mode. Expected THINKING|EXPLORING|COMMITTING|UNKNOWN");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/delivery-window.mjs --action start --mode COMMITTING");
  console.log("  node tools/perf/delivery-window.mjs --action end --mode COMMITTING");
  console.log("  node tools/perf/delivery-window.mjs --action start --run-id-file .aidn/runtime/perf/current-run-id.txt");
  console.log("  node tools/perf/delivery-window.mjs --action start --run-id S072-20260301T1012Z");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const result = runDeliveryWindowUseCase({ args, targetRoot });
    if (result.action === "start") {
      console.log("Delivery window started.");
      console.log(`run_id: ${result.run_id}`);
      console.log(`state: ${result.state_file}`);
      console.log(`event: ${result.event_file}`);
      return;
    }
    console.log("Delivery window ended.");
    console.log(`run_id: ${result.run_id}`);
    console.log(`duration_ms: ${result.duration_ms}`);
    console.log(`event: ${result.event_file}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
