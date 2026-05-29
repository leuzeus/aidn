#!/usr/bin/env node
import path from "node:path";
import { runRepairLayerTriageUseCase } from "../../src/application/runtime/repair-layer-triage-use-case.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    backend: "auto",
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
    } else if (token === "--backend") {
      args.backend = String(argv[i + 1] ?? "").trim().toLowerCase();
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
  if (!["auto", "json", "sqlite", "postgres"].includes(args.backend)) {
    throw new Error("Invalid --backend. Expected auto|json|sqlite|postgres");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/repair-layer-triage.mjs --target . --json");
}

function printHuman(output) {
  console.log(`Target: ${output.target_root}`);
  console.log(`Backend: ${output.backend}`);
  console.log(`Open findings: ${output.summary.open_findings_count}`);
  for (const item of output.items.slice(0, 5)) {
    console.log(`- [${item.severity}] ${item.finding_type} ${item.entity_id ?? ""}`.trim());
    if (item.message) {
      console.log(`  ${item.message}`);
    }
    if (Array.isArray(item.next_steps) && item.next_steps[0]?.command) {
      console.log(`  Next: ${item.next_steps[0].command}`);
    }
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const output = await runRepairLayerTriageUseCase({ args, targetRoot });
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      printHuman(output);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

await main();
