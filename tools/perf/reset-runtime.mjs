#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    root: ".aidn/runtime",
    keepCache: false,
    keepHistory: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--root") {
      args.root = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--keep-cache") {
      args.keepCache = true;
    } else if (token === "--keep-history") {
      args.keepHistory = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.root) {
    throw new Error("Missing value for --root");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/reset-runtime.mjs");
  console.log("  node tools/perf/reset-runtime.mjs --root .aidn/runtime");
  console.log("  node tools/perf/reset-runtime.mjs --keep-cache");
  console.log("  node tools/perf/reset-runtime.mjs --keep-history");
}

function removeIfExists(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  }
  return false;
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function cleanPerfDir(perfDir, keepHistory) {
  if (!fs.existsSync(perfDir)) {
    return false;
  }
  if (!keepHistory) {
    fs.rmSync(perfDir, { recursive: true, force: true });
    return true;
  }
  const entries = fs.readdirSync(perfDir, { withFileTypes: true });
  let removedAny = false;
  for (const entry of entries) {
    if (entry.isFile() && entry.name === "kpi-history.ndjson") {
      continue;
    }
    const absolute = path.join(perfDir, entry.name);
    fs.rmSync(absolute, { recursive: true, force: true });
    removedAny = true;
  }
  return removedAny;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const runtimeRoot = path.resolve(process.cwd(), args.root);
    const perfDir = path.join(runtimeRoot, "perf");
    const indexDir = path.join(runtimeRoot, "index");
    const cacheDir = path.join(runtimeRoot, "cache");

    const removed = {
      perf: cleanPerfDir(perfDir, args.keepHistory),
      index: removeIfExists(indexDir),
      cache: args.keepCache ? false : removeIfExists(cacheDir),
    };

    ensureDir(perfDir);
    ensureDir(indexDir);
    if (args.keepCache) {
      ensureDir(cacheDir);
    }

    console.log(`Runtime reset complete: ${runtimeRoot}`);
    console.log(`Removed perf: ${removed.perf}`);
    console.log(`Removed index: ${removed.index}`);
    console.log(`Removed cache: ${removed.cache}`);
    console.log(`keep_cache: ${args.keepCache}`);
    console.log(`keep_history: ${args.keepHistory}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
