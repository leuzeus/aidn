#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  repairSharedRuntimeReanchor,
  summarizeSharedRuntimeReanchorResult,
} from "../../src/application/runtime/shared-runtime-reanchor-service.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    json: false,
    write: false,
    localOnly: false,
    workspaceId: "",
    backendKind: "",
    sharedRoot: "",
    connectionRef: "",
    projectionPolicy: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--workspace-id") {
      args.workspaceId = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--backend") {
      args.backendKind = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--shared-root") {
      args.sharedRoot = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--connection-ref") {
      args.connectionRef = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--projection-policy") {
      args.projectionPolicy = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--local-only" || token === "--disable") {
      args.localOnly = true;
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
  console.log("  npx aidn runtime shared-runtime-reanchor --target . --json");
  console.log("  npx aidn runtime shared-runtime-reanchor --target . --local-only --write --json");
  console.log("  npx aidn runtime shared-runtime-reanchor --target . --backend postgres --connection-ref env:AIDN_PG_URL --workspace-id workspace-main --write --json");
  console.log("  npx aidn runtime shared-runtime-reanchor --target . --backend sqlite-file --shared-root ../aidn-shared --workspace-id workspace-main --write --json");
}

export function runSharedRuntimeReanchor(options = {}) {
  return repairSharedRuntimeReanchor({
    targetRoot: options.target,
    env: process.env,
    workspaceId: options.workspaceId,
    backendKind: options.backendKind,
    sharedRoot: options.sharedRoot,
    connectionRef: options.connectionRef,
    projectionPolicy: options.projectionPolicy,
    localOnly: options.localOnly === true,
    write: options.write === true,
  });
}

function main() {
  Promise.resolve().then(() => {
    const args = parseArgs(process.argv.slice(2));
    const result = runSharedRuntimeReanchor(args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const summary = summarizeSharedRuntimeReanchorResult(result);
      console.log("Shared runtime re-anchor:");
      console.log(`- ok=${summary.ok ? "yes" : "no"}`);
      console.log(`- action=${summary.action}`);
      console.log(`- applied=${summary.applied ? "yes" : "no"}`);
      console.log(`- current_status=${summary.current_status || "none"}`);
      if (summary.proposed_status) {
        console.log(`- proposed_status=${summary.proposed_status}`);
      }
      if (summary.applied_status) {
        console.log(`- applied_status=${summary.applied_status}`);
      }
      console.log(`- locator_valid=${summary.current_locator_valid ? "yes" : "no"}`);
      console.log(`- next=${summary.recommended_next_action || "none"}`);
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
