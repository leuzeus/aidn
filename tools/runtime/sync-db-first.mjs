#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalProcessAdapter } from "../../src/adapters/runtime/local-process-adapter.mjs";
import { runSyncDbFirstUseCase } from "../../src/application/runtime/sync-db-first-use-case.mjs";
import { normalizeStateMode } from "../aidn-config-lib.mjs";

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const PERF_INDEX_SYNC = path.resolve(RUNTIME_DIR, "..", "perf", "index-sync.mjs");

function parseArgs(argv) {
  const args = {
    target: ".",
    stateMode: "",
    store: "",
    forceInFiles: false,
    strict: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--state-mode") {
      args.stateMode = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--store") {
      args.store = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--force-in-files") {
      args.forceInFiles = true;
    } else if (token === "--strict") {
      args.strict = true;
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime sync-db-first --target . --json");
  console.log("  npx aidn runtime sync-db-first --target . --state-mode dual --strict --json");
  console.log("  npx aidn runtime sync-db-first --target . --force-in-files --json");
}

function main() {
  let outputJson = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    outputJson = args.json;
    const targetRoot = path.resolve(process.cwd(), args.target);
    const processAdapter = createLocalProcessAdapter();
    const out = runSyncDbFirstUseCase({
      args,
      targetRoot,
      processAdapter,
      perfIndexSyncScript: PERF_INDEX_SYNC,
    });
    if (args.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`DB sync ${out.ok ? "OK" : "WARN"} (state_mode=${out.state_mode}, store=${out.store ?? "n/a"}).`);
    }
  } catch (error) {
    const out = {
      ts: new Date().toISOString(),
      ok: false,
      message: String(error.message ?? error),
    };
    if (outputJson) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.error(`ERROR: ${out.message}`);
    }
    process.exit(1);
  }
}

main();

