#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  defaultIndexStoreFromStateMode,
  normalizeStateMode,
  readAidnProjectConfig,
  resolveConfigStateMode,
} from "../aidn-config-lib.mjs";

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

function resolveStateMode(targetRoot, requested) {
  const normalizedRequested = normalizeStateMode(requested);
  if (normalizedRequested) {
    return normalizedRequested;
  }
  const envMode = normalizeStateMode(process.env.AIDN_STATE_MODE);
  if (envMode) {
    return envMode;
  }
  const config = readAidnProjectConfig(targetRoot);
  return resolveConfigStateMode(config.data) ?? "files";
}

function parseJsonOutput(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    throw new Error("Empty stdout");
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("Invalid JSON output");
  }
}

function runIndexSync(targetRoot, store) {
  const args = [
    PERF_INDEX_SYNC,
    "--target",
    targetRoot,
    "--store",
    store,
    "--with-content",
    "--json",
  ];
  const stdout = execFileSync(process.execPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseJsonOutput(stdout);
}

function main() {
  let outputJson = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    outputJson = args.json;
    const targetRoot = path.resolve(process.cwd(), args.target);
    const stateMode = resolveStateMode(targetRoot, args.stateMode);
    const strictByState = stateMode === "dual" || stateMode === "db-only";
    const strict = args.strict || strictByState;

    if (stateMode === "files" && !args.forceInFiles) {
      const out = {
        ts: new Date().toISOString(),
        ok: true,
        skipped: true,
        reason: "state_mode_files",
        target_root: targetRoot,
        state_mode: stateMode,
        strict,
      };
      if (args.json) {
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.log("DB sync skipped (state_mode=files).");
      }
      return;
    }

    const store = args.store || defaultIndexStoreFromStateMode(stateMode);
    const payload = runIndexSync(targetRoot, store);
    const out = {
      ts: new Date().toISOString(),
      ok: true,
      skipped: false,
      target_root: targetRoot,
      state_mode: stateMode,
      strict,
      store,
      payload,
    };
    if (args.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`DB sync OK (state_mode=${stateMode}, store=${store}).`);
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

