#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveSharedCoordinationStore, summarizeSharedCoordinationResolution, syncSharedWorkspaceRegistration } from "../../src/application/runtime/shared-coordination-store-service.mjs";
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
  console.log("  npx aidn runtime shared-coordination-bootstrap --target . --json");
}

export async function bootstrapSharedCoordination({
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
  const registration = await syncSharedWorkspaceRegistration(resolution, {
    workspace,
  });
  return {
    target_root: absoluteTargetRoot,
    ok: registration.ok === true,
    workspace,
    shared_coordination_backend: summarizeSharedCoordinationResolution(resolution),
    shared_coordination_bootstrap: registration,
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await bootstrapSharedCoordination({
      targetRoot: args.target,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Shared coordination bootstrap:");
      console.log(`- ok=${result.ok ? "yes" : "no"}`);
      console.log(`- backend_kind=${result.shared_coordination_backend.backend_kind}`);
      console.log(`- status=${result.shared_coordination_bootstrap.status}`);
      console.log(`- reason=${result.shared_coordination_bootstrap.reason}`);
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
