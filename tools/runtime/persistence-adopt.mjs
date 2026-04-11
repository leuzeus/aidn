#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  executeRuntimeBackendAdoption,
  planRuntimeBackendAdoption,
} from "../../src/application/runtime/runtime-backend-adoption-service.mjs";
import { normalizeRuntimePersistenceBackend } from "../../src/lib/config/aidn-config-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    backend: "",
    connectionRef: "",
    sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    dryRun: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--backend") {
      args.backend = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--connection-ref") {
      args.connectionRef = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = String(argv[i + 1] ?? "").trim();
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
  if (args.backend && !normalizeRuntimePersistenceBackend(args.backend)) {
    throw new Error("Invalid --backend. Expected sqlite|postgres");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime persistence-adopt --target . --json");
  console.log("  npx aidn runtime persistence-adopt --target . --backend postgres --dry-run --json");
  console.log("  npx aidn runtime persistence-adopt --target . --backend postgres --connection-ref env:AIDN_PG_URL --json");
}

export async function adoptRuntimePersistence({
  targetRoot = ".",
  backend = "",
  connectionRef = "",
  sqliteFile = ".aidn/runtime/index/workflow-index.sqlite",
  write = true,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const absoluteSqliteFile = path.isAbsolute(sqliteFile)
    ? sqliteFile
    : path.resolve(absoluteTargetRoot, sqliteFile);
  const plan = await planRuntimeBackendAdoption({
    targetRoot: absoluteTargetRoot,
    backend,
    connectionRef,
    sqliteFile: absoluteSqliteFile,
  });
  const execution = await executeRuntimeBackendAdoption({
    targetRoot: absoluteTargetRoot,
    backend,
    connectionRef,
    sqliteFile: absoluteSqliteFile,
    write,
    plan,
  });
  return {
    ts: new Date().toISOString(),
    target_root: absoluteTargetRoot,
    write_requested: Boolean(write),
    runtime_backend_adoption_plan: plan,
    runtime_backend_adoption: execution,
  };
}

function printHuman(result) {
  const plan = result.runtime_backend_adoption_plan;
  const execution = result.runtime_backend_adoption;
  console.log("Runtime persistence adopt:");
  console.log(`- action=${plan.action}`);
  console.log(`- blocked=${plan.blocked ? "yes" : "no"}`);
  console.log(`- reason=${plan.reason}`);
  console.log(`- write_requested=${result.write_requested ? "yes" : "no"}`);
  console.log(`- source_has_payload=${plan.source?.has_payload ? "yes" : "no"}`);
  console.log(`- target_visible_payload_rows=${plan.target?.payload_rows ?? 0}`);
  if (typeof plan.target?.canonical_payload_rows === "number") {
    console.log(`- target_canonical_payload_rows=${plan.target.canonical_payload_rows}`);
  }
  if (typeof plan.target?.legacy_snapshot_rows === "number") {
    console.log(`- target_legacy_snapshot_rows=${plan.target.legacy_snapshot_rows}`);
  }
  if (plan.target?.storage_policy) {
    console.log(`- target_canonical_storage=${plan.target.storage_policy}`);
  }
  if (plan.target?.compatibility_status) {
    console.log(`- target_compatibility_status=${plan.target.compatibility_status}`);
  }
  if (plan.prerequisites?.length) {
    console.log(`- prerequisites=${plan.prerequisites.join(", ")}`);
  }
  if (Array.isArray(plan.source?.cycle_identity_collisions) && plan.source.cycle_identity_collisions.length > 0) {
    console.log(`- source_cycle_identity_collision_count=${plan.source.cycle_identity_collisions.length}`);
    console.log(`- source_collision_cycle_ids=${plan.source.cycle_identity_collisions.map((item) => item.cycle_id).join(", ")}`);
    for (const collision of plan.source.cycle_identity_collisions) {
      console.log(`- source_cycle ${collision.cycle_id}: directories=${Array.isArray(collision.directories) ? collision.directories.join(", ") : ""}`);
    }
  }
  console.log(`- execution_status=${execution.execution_status}`);
  if (execution.event?.event_id) {
    console.log(`- event_id=${execution.event.event_id}`);
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await adoptRuntimePersistence({
      targetRoot: args.target,
      backend: args.backend,
      connectionRef: args.connectionRef,
      sqliteFile: args.sqliteFile,
      write: !args.dryRun,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result);
    }
    if (result.runtime_backend_adoption?.ok !== true && !args.dryRun) {
      process.exit(1);
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
