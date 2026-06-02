#!/usr/bin/env node
import path from "node:path";
import { runVisibleArtifactsRestore } from "../../src/application/runtime/visible-artifacts-cleanup-service.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    from: "",
    write: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--from") {
      args.from = String(argv[i + 1] ?? "").trim();
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
  if (!args.from) {
    throw new Error("Missing value for --from");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime visible-artifacts-restore --target . --from ../.aidn-backups/project/timestamp --json");
  console.log("  npx aidn runtime visible-artifacts-restore --target . --from ../.aidn-backups/project/timestamp --write --json");
}

function printText(result) {
  console.log(`Visible artifacts restore: ${result.status}`);
  console.log(`Target: ${result.target_root}`);
  console.log(`Backup: ${result.backup_root}`);
  console.log(`Restore items: ${result.restore_items.length}`);
  console.log(`Restored: ${result.restored_count}`);
  if (result.errors.length > 0) {
    console.log(`Errors: ${result.errors.join("; ")}`);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = runVisibleArtifactsRestore({
      targetRoot: path.resolve(process.cwd(), args.target),
      from: args.from,
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
