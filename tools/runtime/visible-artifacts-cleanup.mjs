#!/usr/bin/env node
import path from "node:path";
import { runVisibleArtifactsCleanup } from "../../src/application/runtime/visible-artifacts-cleanup-service.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    backupRoot: "",
    write: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--backup-root") {
      args.backupRoot = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--write") {
      args.write = true;
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
  console.log("  npx aidn runtime visible-artifacts-cleanup --target . --json");
  console.log("  npx aidn runtime visible-artifacts-cleanup --target . --write --json");
  console.log("  npx aidn runtime visible-artifacts-cleanup --target . --backup-root ../.aidn-backups/project/timestamp --write --json");
}

function printText(result) {
  console.log(`Visible artifacts cleanup: ${result.status}`);
  console.log(`Target: ${result.target_root}`);
  console.log(`Backup: ${result.backup_root}`);
  console.log(`Candidates: ${result.candidates.length}`);
  console.log(`Protected: ${result.protected_files.length}`);
  console.log(`Quarantined: ${result.quarantined_count}`);
  if (result.errors.length > 0) {
    console.log(`Errors: ${result.errors.join("; ")}`);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = runVisibleArtifactsCleanup({
      targetRoot: path.resolve(process.cwd(), args.target),
      backupRoot: args.backupRoot,
      write: args.write,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printText(result);
    }
    if (result.status === "blocked") {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
