#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  repairSharedRuntimeReanchor,
  summarizeSharedRuntimeReanchorResult,
} from "../../src/application/runtime/shared-runtime-reanchor-service.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function buildSharedRuntimeReanchorDiagnostic(result) {
  const summary = summarizeSharedRuntimeReanchorResult(result);
  const locatorStatus = result?.current_locator?.valid === false
    ? "invalid"
    : (result?.current_locator?.exists ? "present" : "missing");
  const workspace = result?.applied_workspace ?? result?.proposed_workspace ?? result?.workspace ?? {};
  const backendKind = normalizeScalar(workspace?.shared_backend_kind || result?.current_locator?.data?.backend?.kind) || "none";
  const alignment = result?.applied_shared_coordination_alignment ?? result?.shared_coordination_alignment ?? null;
  const alignmentStatus = normalizeScalar(alignment?.status) || "unknown";
  const alignmentSummary = alignmentStatus === "warn" || alignmentStatus === "block"
    ? (alignment?.findings?.[0]?.message || result?.recommended_next_action || "")
    : "";
  return {
    scope: "shared-runtime-only",
    action: summary.action || "inspect",
    applied: summary.applied === true,
    current_status: summary.current_status || "unknown",
    alignment_status: alignmentStatus,
    locator_status: locatorStatus,
    backend_kind: backendKind,
    summary: alignmentSummary || (summary.current_status === "clear"
      ? "shared runtime locator is aligned with the current workspace"
      : (summary.recommended_next_action || "shared runtime locator requires review")),
    recommended_action: summary.recommended_next_action || "inspect shared runtime locator settings",
  };
}

function parseArgs(argv) {
  const args = {
    target: ".",
    json: false,
    write: false,
    localOnly: false,
    projectId: "",
    projectRoot: "",
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
    } else if (token === "--project-id") {
      args.projectId = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--project-root") {
      args.projectRoot = String(argv[i + 1] ?? "").trim();
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
  console.log("  npx aidn runtime shared-runtime-reanchor --target . --backend postgres --connection-ref env:AIDN_PG_URL --project-id project-main --workspace-id workspace-main --write --json");
  console.log("  npx aidn runtime shared-runtime-reanchor --target . --backend sqlite-file --shared-root ../aidn-shared --project-id project-main --workspace-id workspace-main --write --json");
}

export function runSharedRuntimeReanchor(options = {}) {
  const result = repairSharedRuntimeReanchor({
    targetRoot: options.target,
    env: process.env,
    projectId: options.projectId,
    projectRoot: options.projectRoot,
    workspaceId: options.workspaceId,
    backendKind: options.backendKind,
    sharedRoot: options.sharedRoot,
    connectionRef: options.connectionRef,
    projectionPolicy: options.projectionPolicy,
    localOnly: options.localOnly === true,
    write: options.write === true,
  });
  return {
    ...result,
    shared_runtime_reanchor_diagnostic: buildSharedRuntimeReanchorDiagnostic(result),
  };
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
