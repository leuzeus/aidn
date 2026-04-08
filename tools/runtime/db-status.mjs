#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { resolveSharedStateBackend } from "../../src/application/runtime/shared-state-backend-service.mjs";
import {
  createRuntimePersistenceAdmin,
  resolveEffectiveRuntimePersistence,
} from "../../src/application/runtime/runtime-persistence-service.mjs";
import { planRuntimeBackendAdoption } from "../../src/application/runtime/runtime-backend-adoption-service.mjs";
import { normalizeRuntimePersistenceBackend } from "../../src/lib/config/aidn-config-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    backend: "",
    sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    sqliteFileExplicit: false,
    schemaFile: "",
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
    } else if (token === "--sqlite-file") {
      args.sqliteFile = String(argv[i + 1] ?? "").trim();
      args.sqliteFileExplicit = true;
      i += 1;
    } else if (token === "--schema-file") {
      args.schemaFile = String(argv[i + 1] ?? "").trim();
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
  if (args.backend && !normalizeRuntimePersistenceBackend(args.backend)) {
    throw new Error("Invalid --backend. Expected sqlite|postgres");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime db-status --target . --json");
  console.log("  npx aidn runtime persistence-status --target . --backend sqlite --json");
  console.log("  npx aidn runtime db-status --target . --sqlite-file .aidn/runtime/index/workflow-index.sqlite --json");
}

export async function projectRuntimePersistenceStatus({
  targetRoot = ".",
  backend = "",
  sqliteFile = ".aidn/runtime/index/workflow-index.sqlite",
  sqliteFileExplicit = false,
  schemaFile = "",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot);
  const absoluteSqliteFile = path.isAbsolute(sqliteFile)
    ? sqliteFile
    : path.resolve(absoluteTargetRoot, sqliteFile);
  const workspace = resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const resolvedProjection = resolveSharedStateBackend({
    targetRoot: absoluteTargetRoot,
    workspace,
  }).describeBackend();
  const absoluteSchemaFile = schemaFile
    ? (path.isAbsolute(schemaFile) ? schemaFile : path.resolve(process.cwd(), schemaFile))
    : "";
  const runtimePersistence = resolveEffectiveRuntimePersistence({
    targetRoot: absoluteTargetRoot,
    backend,
  });
  const admin = createRuntimePersistenceAdmin({
    targetRoot: absoluteTargetRoot,
    backend: runtimePersistence.backend,
    connectionRef: runtimePersistence.connectionRef ?? "",
    sqliteFile: absoluteSqliteFile,
    ...(absoluteSchemaFile ? { schemaFile: absoluteSchemaFile } : {}),
  });
  const describedBackend = admin.describeBackend();
  const status = await admin.inspectSchema();
  const adoptionPlan = await planRuntimeBackendAdoption({
    targetRoot: absoluteTargetRoot,
    backend: runtimePersistence.backend,
    connectionRef: runtimePersistence.connectionRef ?? "",
    sqliteFile: absoluteSqliteFile,
  });
  return {
    ts: new Date().toISOString(),
    target_root: absoluteTargetRoot,
    runtime_persistence: runtimePersistence,
    runtime_backend: describedBackend,
    sqlite_scope: sqliteFileExplicit ? "explicit-path" : "local-target-default",
    sqlite_scope_reason: sqliteFileExplicit
      ? "db-status is inspecting the explicit sqlite file requested by the caller"
      : "db-status defaults to the local SQLite projection/cache unless an explicit sqlite file is requested",
    workspace,
    resolved_projection_backend: resolvedProjection,
    runtime_backend_adoption_plan: adoptionPlan,
    ...status,
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const payload = await projectRuntimePersistenceStatus({
      targetRoot: args.target,
      backend: args.backend,
      sqliteFile: args.sqliteFile,
      sqliteFileExplicit: args.sqliteFileExplicit,
      schemaFile: args.schemaFile,
    });
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`Runtime backend: ${payload.runtime_persistence?.backend ?? "unknown"} (${payload.runtime_persistence?.source ?? "unknown"})`);
    if (payload.runtime_backend?.supported === false) {
      console.log(`Status: ${payload.reason ?? payload.runtime_backend.reason}`);
      return;
    }
    console.log(`SQLite DB: ${payload.sqlite_file ?? "missing"}`);
    console.log(`SQLite scope: ${payload.sqlite_scope}`);
    console.log(`Exists: ${payload.exists ? "yes" : "no"}`);
    console.log(`Schema version: ${payload.schema_version ?? "n/a"}`);
    console.log(`Applied migrations: ${payload.applied_ids.join(", ") || "none"}`);
    console.log(`Pending migrations: ${payload.pending_ids.join(", ") || "none"}`);
    console.log(`Adoption action: ${payload.runtime_backend_adoption_plan?.action ?? "unknown"}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
