#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeRuntimeCycleIdentitySource } from "../../src/application/runtime/runtime-cycle-identity-normalization-service.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    rename: [],
    dryRun: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--rename") {
      args.rename.push(String(argv[i + 1] ?? "").trim());
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (args.rename.length === 0) {
    throw new Error("At least one --rename mapping is required");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime persistence-source-normalize --target . --rename C004-spike-root-structure-investigation=C020-spike-root-structure-investigation --json");
  console.log("  npx aidn runtime persistence-source-normalize --target . --rename C005-structural-root-simplification-lot1=C021-structural-root-simplification-lot1 --rename C032-corrective-component-review-hardening=C034-corrective-component-review-hardening --dry-run --json");
}

export function normalizeRuntimePersistenceSource({
  targetRoot = ".",
  rename = [],
  write = true,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  return normalizeRuntimeCycleIdentitySource({
    targetRoot: absoluteTargetRoot,
    renameSpecs: rename,
    write,
  });
}

function printHuman(result) {
  console.log("Runtime persistence source normalization:");
  console.log(`- write_requested=${result.write_requested ? "yes" : "no"}`);
  console.log(`- target_root=${result.target_root}`);
  console.log(`- mappings=${result.mappings.length}`);
  for (const mapping of result.mappings) {
    console.log(`- rename ${mapping.old_slug} => ${mapping.new_slug}`);
  }
  console.log(`- files_scanned=${result.files_scanned}`);
  console.log(`- files_updated=${result.files_updated}`);
  console.log(`- directories_renamed=${result.directories_renamed}`);
  if (Array.isArray(result.skipped_binary_files) && result.skipped_binary_files.length > 0) {
    console.log(`- skipped_binary_files=${result.skipped_binary_files.length}`);
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = normalizeRuntimePersistenceSource({
      targetRoot: args.target,
      rename: args.rename,
      write: !args.dryRun,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
