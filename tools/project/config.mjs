#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runProjectConfigUseCase } from "../../src/application/project/project-config-use-case.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    list: false,
    json: false,
    adapterFile: "",
    preferredStateMode: "",
    defaultIndexStore: "",
    migrateAdapter: false,
    dryRun: false,
    version: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--list") {
      args.list = true;
    } else if (token === "--adapter-file") {
      args.adapterFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--preferred-state-mode") {
      args.preferredStateMode = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--default-index-store") {
      args.defaultIndexStore = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--migrate-adapter") {
      args.migrateAdapter = true;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--version") {
      args.version = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--wizard") {
      // Wizard is the default action when --list is not requested.
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/project/config.mjs --target . --list --json");
  console.log("  node tools/project/config.mjs --target . --wizard");
  console.log("  node tools/project/config.mjs --target . --adapter-file ./workflow.adapter.json");
  console.log("  node tools/project/config.mjs --target . --migrate-adapter --json");
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(scriptDir, "..", "..");
    const targetRoot = path.resolve(process.cwd(), args.target);
    const result = await runProjectConfigUseCase({ args, targetRoot, repoRoot });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Target: ${result.target_root}`);
    console.log(`Action: ${result.action}`);
    console.log(`Path: ${result.path ?? result.adapter_path ?? "n/a"}`);
    if (result.exists) {
      console.log(`Exists: yes`);
    } else {
      console.log(`Exists: no`);
    }
    if (result.config) {
      console.log(JSON.stringify(result.config, null, 2));
    }
    if (result.extracted_config) {
      console.log(JSON.stringify(result.extracted_config, null, 2));
    }
    if (!result.ok) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
