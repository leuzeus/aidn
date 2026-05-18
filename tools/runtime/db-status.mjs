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
  console.log("  npx aidn runtime persistence-status --target . --backend postgres --json");
  console.log("  npx aidn runtime db-status --target . --sqlite-file .aidn/runtime/index/workflow-index.sqlite --json");
}

function redactConnectionRef(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "none";
  }
  if (normalized.startsWith("env:")) {
    return normalized;
  }
  return "<redacted>";
}

function deriveRuntimeOperations(payload) {
  const pendingIds = Array.isArray(payload.pending_ids) ? payload.pending_ids : [];
  const missingTables = Array.isArray(payload.tables_missing) ? payload.tables_missing : [];
  const backend = payload.runtime_persistence?.backend ?? "unknown";
  const compatibility = payload.compatibility_status ?? "unknown";
  const targetUnavailable = compatibility === "target-unavailable" || payload.runtime_backend_adoption_plan?.reason_code === "target-unavailable";
  const schemaStatus = targetUnavailable
    ? "target-unavailable"
    : payload.exists === false
      ? "missing"
      : missingTables.length > 0
        ? "schema-incomplete"
        : pendingIds.length > 0
          ? "migration-required"
          : "ready";
  const recommendedActions = [];
  if (schemaStatus === "missing" || schemaStatus === "migration-required" || schemaStatus === "schema-incomplete") {
    recommendedActions.push("run aidn runtime db-migrate --target . --json after backing up the selected runtime surface");
  }
  if (targetUnavailable) {
    recommendedActions.push("resolve the configured backend connection before migration or adoption");
  }
  if (payload.runtime_backend_adoption_plan?.action && payload.runtime_backend_adoption_plan.action !== "noop") {
    recommendedActions.push("review runtime_backend_adoption_plan before changing runtime.persistence.backend");
  }
  if (recommendedActions.length === 0) {
    recommendedActions.push("no immediate runtime persistence action required");
  }
  const connectionRef = redactConnectionRef(payload.runtime_persistence?.connectionRef ?? payload.runtime_persistence?.connection_ref);
  return {
    local_first: true,
    backend,
    backend_source: payload.runtime_persistence?.source ?? "unknown",
    schema_status: schemaStatus,
    compatibility_status: compatibility,
    schema_version: payload.schema_version ?? null,
    pending_migration_count: pendingIds.length,
    applied_migration_count: Array.isArray(payload.applied_ids) ? payload.applied_ids.length : 0,
    sqlite_scope: payload.sqlite_scope,
    sqlite_scope_reason: payload.sqlite_scope_reason,
    resolved_projection_scope: payload.resolved_projection_backend?.projection_scope ?? "unknown",
    connection_ref: connectionRef,
    connection_secret_exposed: false,
    freshness_status: payload.exists === false ? "missing" : "inspectable",
    backup_command: "aidn runtime db-backup --target . --json",
    migration_command: "aidn runtime db-migrate --target . --json",
    recommended_actions: recommendedActions,
  };
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
  const payload = {
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
  return {
    ...payload,
    operations: deriveRuntimeOperations(payload),
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
    const resolvedProjectionBackendKind = String(payload.resolved_projection_backend?.projection_backend_kind ?? "").trim() || "unknown";
    const resolvedProjectionScope = String(payload.resolved_projection_backend?.projection_scope ?? "").trim() || "unknown";
    console.log(`Resolved projection backend: ${resolvedProjectionBackendKind}`);
    console.log(`Resolved projection scope: ${resolvedProjectionScope}`);
    if (resolvedProjectionBackendKind === "sqlite" && payload.sqlite_file) {
      console.log(`SQLite projection DB: ${payload.sqlite_file}`);
    }
    console.log(`CLI sqlite inspection scope: ${payload.sqlite_scope}`);
    console.log(`Exists: ${payload.exists ? "yes" : "no"}`);
    if (payload.storage_policy) {
      console.log(`Canonical storage: ${payload.storage_policy}`);
    }
    if (payload.compatibility_status) {
      console.log(`Compatibility status: ${payload.compatibility_status}`);
    }
    console.log(`Operational schema status: ${payload.operations?.schema_status ?? "unknown"}`);
    console.log(`Operational freshness: ${payload.operations?.freshness_status ?? "unknown"}`);
    console.log(`Schema version: ${payload.schema_version ?? "n/a"}`);
    console.log(`Applied migrations: ${payload.applied_ids.join(", ") || "none"}`);
    console.log(`Pending migrations: ${payload.pending_ids.join(", ") || "none"}`);
    if (typeof payload.canonical_payload_rows === "number") {
      console.log(`Canonical payload rows: ${payload.canonical_payload_rows}`);
    }
    if (typeof payload.legacy_snapshot_rows === "number") {
      console.log(`Legacy snapshot rows: ${payload.legacy_snapshot_rows}`);
    }
    if (Array.isArray(payload.tables_missing)) {
      console.log(`Canonical tables missing: ${payload.tables_missing.join(", ") || "none"}`);
    }
    if (Array.isArray(payload.legacy_tables_missing)) {
      console.log(`Legacy tables missing: ${payload.legacy_tables_missing.join(", ") || "none"}`);
    }
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
