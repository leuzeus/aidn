#!/usr/bin/env node
import path from "node:path";
import { runRepairLayerAutofixUseCase } from "../../src/application/runtime/repair-layer-autofix-use-case.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    indexBackend: "auto",
    sessionId: "",
    decidedBy: "",
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
    } else if (token === "--decided-by") {
      args.decidedBy = String(argv[i + 1] ?? "").trim();
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
  if (!["auto", "json", "sqlite", "postgres"].includes(args.indexBackend)) {
    throw new Error("Invalid --index-backend. Expected auto|json|sqlite|postgres");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/repair-layer-autofix.mjs --target . --apply --json");
  console.log("  node tools/runtime/repair-layer-autofix.mjs --target . --session-id S102 --apply --json");
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const output = await runRepairLayerAutofixUseCase({ args, targetRoot });
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Repair autofix ${output.action}: suggestions=${output.summary.suggestions_count} decisions=${output.summary.decisions_count}`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

await main();
