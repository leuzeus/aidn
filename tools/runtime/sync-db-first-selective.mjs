#!/usr/bin/env node
import path from "node:path";
import { normalizeStateMode } from "../aidn-config-lib.mjs";
import { createLocalGitAdapter } from "../../src/adapters/runtime/local-git-adapter.mjs";
import { createLocalProcessAdapter } from "../../src/adapters/runtime/local-process-adapter.mjs";
import { runSyncDbFirstSelectiveUseCase } from "../../src/application/runtime/sync-db-first-selective-use-case.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    auditRoot: "docs/audit",
    sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    stateMode: "",
    forceInFiles: false,
    fallbackFull: true,
    strict: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--audit-root") {
      args.auditRoot = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--state-mode") {
      args.stateMode = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--force-in-files") {
      args.forceInFiles = true;
    } else if (token === "--no-fallback-full") {
      args.fallbackFull = false;
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
  if (args.stateMode && !normalizeStateMode(args.stateMode)) {
    throw new Error("Invalid --state-mode. Expected files|dual|db-only");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime sync-db-first-selective --target . --json");
  console.log("  npx aidn runtime sync-db-first-selective --target . --state-mode dual --json");
}

function main() {
  let outputJson = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    outputJson = args.json;
    const targetRoot = path.resolve(process.cwd(), args.target);
    const gitAdapter = createLocalGitAdapter();
    const processAdapter = createLocalProcessAdapter();
    const out = runSyncDbFirstSelectiveUseCase({
      args,
      targetRoot,
      gitAdapter,
      processAdapter,
    });

    if (args.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`Selective DB sync ${out.ok ? "OK" : "WARN"}: synced=${out.summary.synced_count}, failed=${out.summary.failed_count}, fallback=${out.fallback ? "yes" : "no"}`);
    }
    if (!out.ok && out.strict) {
      process.exit(1);
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

