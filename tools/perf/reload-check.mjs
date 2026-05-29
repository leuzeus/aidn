#!/usr/bin/env node
import path from "node:path";
import {
  printHumanReloadResult,
  runReloadCheckUseCase,
} from "../../src/application/runtime/reload-check-use-case.mjs";

function parseArgs(argv) {
  const envStateMode = String(process.env.AIDN_STATE_MODE ?? "").trim().toLowerCase();
  const args = {
    target: ".",
    cache: ".aidn/runtime/cache/reload-state.json",
    stateMode: envStateMode || "files",
    stateModeExplicit: false,
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    indexBackend: "auto",
    json: false,
    writeCache: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--cache") {
      args.cache = argv[i + 1] ?? "";
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
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--write-cache") {
      args.writeCache = true;
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
  if (!args.cache) {
    throw new Error("Missing value for --cache");
  }
  if (!["files", "dual", "db-only"].includes(args.stateMode)) {
    throw new Error("Invalid --state-mode. Expected files|dual|db-only");
  }
  if (!args.indexFile) {
    throw new Error("Missing value for --index-file");
  }
  if (!["auto", "json", "sqlite", "postgres"].includes(args.indexBackend)) {
    throw new Error("Invalid --index-backend. Expected auto|json|sqlite|postgres");
  }

  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/reload-check.mjs --target ../client");
  console.log("  AIDN_STATE_MODE=db-only node tools/perf/reload-check.mjs --target ../client");
  console.log("  node tools/perf/reload-check.mjs --target . --write-cache");
  console.log("  node tools/perf/reload-check.mjs --target . --state-mode db-only --index-file .aidn/runtime/index/workflow-index.sqlite");
  console.log("  node tools/perf/reload-check.mjs --json");
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const result = await runReloadCheckUseCase({
      args,
      targetRoot,
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    printHumanReloadResult(result, result.cache_file);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

await main();
