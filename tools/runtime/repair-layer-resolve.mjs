#!/usr/bin/env node
import path from "node:path";
import { runRepairLayerResolveUseCase } from "../../src/application/runtime/repair-layer-resolve-use-case.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    indexBackend: "auto",
    sessionId: "",
    cycleId: "",
    relationType: "attached_cycle",
    decision: "",
    decidedBy: "",
    notes: "",
    apply: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--index-backend") {
      args.indexBackend = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--session-id") {
      args.sessionId = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--cycle-id") {
      args.cycleId = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--relation-type") {
      args.relationType = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--decision") {
      args.decision = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--decided-by") {
      args.decidedBy = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--notes") {
      args.notes = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--apply") {
      args.apply = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.sessionId || !args.cycleId || !args.decision) {
    throw new Error("Missing required values. Expected --session-id --cycle-id --decision.");
  }
  if (!["auto", "json", "sqlite"].includes(args.indexBackend)) {
    throw new Error("Invalid --index-backend. Expected auto|json|sqlite");
  }
  if (!["accepted", "rejected"].includes(args.decision)) {
    throw new Error("Invalid --decision. Expected accepted|rejected");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/repair-layer-resolve.mjs --target . --session-id S102 --cycle-id C101 --decision accepted --apply --json");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const output = runRepairLayerResolveUseCase({ args, targetRoot });
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Resolved ambiguity: ${args.sessionId} -> ${args.cycleId} (${args.decision})`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
