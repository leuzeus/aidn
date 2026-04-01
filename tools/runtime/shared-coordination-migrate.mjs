#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ensureSharedCoordinationReady,
  resolveSharedCoordinationStore,
  summarizeSharedCoordinationResolution,
} from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
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
  console.log("  npx aidn runtime shared-coordination-migrate --target . --json");
}

export async function migrateSharedCoordination({
  targetRoot = ".",
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const workspace = resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const resolution = sharedCoordination ?? await resolveSharedCoordinationStore({
    targetRoot: absoluteTargetRoot,
    workspace,
    ...sharedCoordinationOptions,
  });
  const migration = await ensureSharedCoordinationReady(resolution);
  return {
    target_root: absoluteTargetRoot,
    ok: migration.ok === true,
    workspace,
    shared_coordination_backend: summarizeSharedCoordinationResolution(resolution),
    shared_coordination_migration: migration,
    contract: resolution.contract
      ? {
        scope: resolution.contract.scope,
        schema_name: resolution.contract.schema_name,
        schema_version: resolution.contract.schema_version,
        schema_file: resolution.contract.schema_file,
        driver: resolution.contract.driver,
      }
      : null,
  };
}

function printHuman(result) {
  console.log("Shared coordination migrate:");
  console.log(`- ok=${result.ok ? "yes" : "no"}`);
  console.log(`- backend_kind=${result.shared_coordination_backend.backend_kind}`);
  console.log(`- status=${result.shared_coordination_migration.status}`);
  console.log(`- reason=${result.shared_coordination_migration.reason}`);
  if (result.contract) {
    console.log(`- schema_name=${result.contract.schema_name}`);
    console.log(`- schema_version=${result.contract.schema_version}`);
  }
  if (result.shared_coordination_migration?.health) {
    console.log(`- schema_status=${result.shared_coordination_migration.health.schema_status || "unknown"}`);
    console.log(`- latest_schema_version=${result.shared_coordination_migration.health.latest_applied_schema_version ?? 0}`);
  }
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await migrateSharedCoordination({
      targetRoot: args.target,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result);
    }
    if (!result.ok) {
      process.exit(1);
    }
  }).catch((error) => {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
