#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeIndexStoreMode,
} from "./aidn-config-lib.mjs";
import { runInstallUseCase } from "../src/application/install/install-use-case.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    pack: "",
    dryRun: false,
    verifyOnly: false,
    skipArtifactImport: false,
    artifactImportStore: "",
    assist: false,
    strict: false,
    skipAgents: false,
    forceAgentsMerge: false,
    codexMigrateCustom: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--pack") {
      args.pack = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--verify") {
      args.verifyOnly = true;
    } else if (token === "--skip-artifact-import") {
      args.skipArtifactImport = true;
    } else if (token === "--artifact-import-store") {
      args.artifactImportStore = String(argv[i + 1] ?? "").toLowerCase();
      i += 1;
    } else if (token === "--assist") {
      args.assist = true;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--skip-agents") {
      args.skipAgents = true;
    } else if (token === "--force-agents-merge") {
      args.forceAgentsMerge = true;
    } else if (token === "--no-codex-migrate-custom") {
      args.codexMigrateCustom = false;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.target) {
    throw new Error("Missing required argument value: --target");
  }
  if (args.artifactImportStore && !normalizeIndexStoreMode(args.artifactImportStore)) {
    throw new Error("Invalid --artifact-import-store. Expected file|sql|dual|sqlite|dual-sqlite|all");
  }

  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/install.mjs --target ../repo");
  console.log("  node tools/install.mjs --target ../repo --pack core");
  console.log("  node tools/install.mjs --target . --pack core --dry-run");
  console.log("  node tools/install.mjs --target . --pack core --verify");
  console.log("  node tools/install.mjs --target . --pack core --skip-artifact-import");
  console.log("  node tools/install.mjs --target . --pack core --artifact-import-store dual-sqlite");
  console.log("  node tools/install.mjs --target ../repo --pack core --assist");
  console.log("  node tools/install.mjs --target ../repo --pack core --strict");
  console.log("  node tools/install.mjs --target ../repo --pack core --skip-agents");
  console.log("  node tools/install.mjs --target ../repo --pack core --force-agents-merge");
  console.log("  node tools/install.mjs --target ../repo --pack core --no-codex-migrate-custom");
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(scriptDir, "..");
    const targetRoot = path.resolve(process.cwd(), args.target);
    await runInstallUseCase({
      args,
      repoRoot,
      targetRoot,
    });
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
