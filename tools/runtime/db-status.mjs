#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateMetadataPolicy } from "../../src/core/metadata/metadata-policy.mjs";
import { evaluateSourceOfTruthPolicy } from "../../src/core/source-of-truth/source-of-truth-policy.mjs";
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

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function buildSelectedStructureSummary(payload) {
  const backend = payload?.runtime_persistence?.backend ?? "unknown";
  const schemaStatus = payload?.operations?.schema_status
    ?? payload?.runtime_backend_diagnostic?.schema_status
    ?? (payload?.exists === false ? "missing" : "unknown");
  return {
    backend,
    role: "selected-backend",
    available: payload?.runtime_backend?.supported === false ? false : payload?.exists !== false,
    schema_status: schemaStatus,
    compatibility_status: payload?.operations?.compatibility_status
      ?? payload?.runtime_backend_diagnostic?.compatibility_status
      ?? payload?.compatibility_status
      ?? null,
    backend_source: payload?.runtime_persistence?.source ?? "unknown",
    runtime_backend: payload?.runtime_backend ?? null,
    sqlite_scope: payload?.sqlite_scope ?? null,
    sqlite_scope_reason: payload?.sqlite_scope_reason ?? null,
    scope_key: payload?.runtime_backend?.scope_key ?? null,
    storage_policy: payload?.storage_policy ?? null,
    table_count: Number(payload?.table_count ?? 0) || 0,
    tables_present: normalizeList(payload?.tables_present),
    tables_missing: normalizeList(payload?.tables_missing),
    legacy_tables_present: normalizeList(payload?.legacy_tables_present),
    legacy_tables_missing: normalizeList(payload?.legacy_tables_missing),
    pending_ids: normalizeList(payload?.pending_ids),
    applied_ids: normalizeList(payload?.applied_ids),
    reason: payload?.reason ?? null,
  };
}

function buildSqliteStructureSummary(payload, adoptionPlan) {
  const source = adoptionPlan?.source ?? null;
  if (source) {
    return {
      backend: "sqlite",
      role: "migration-source",
      available: source.exists === true && !source.warning,
      schema_status: source.schema_exists ? "ready" : "missing",
      compatibility_status: source.exists === true
        ? (source.warning ? "warning" : "ready")
        : "missing",
      sqlite_file: source.sqlite_file ?? null,
      exists: Boolean(source.exists),
      has_payload: Boolean(source.has_payload),
      payload_digest: source.payload_digest ?? null,
      payload_summary: source.payload_summary ?? null,
      source_backend: source.backend ?? "sqlite",
      source_scope: source.source_scope ?? null,
      warning: source.warning ?? "",
      cycle_identity_collisions: normalizeList(source.cycle_identity_collisions),
      pending_ids: normalizeList(source.pending_ids),
      applied_ids: normalizeList(source.applied_ids),
    };
  }

  return {
    backend: "sqlite",
    role: "selected-backend",
    available: payload?.runtime_persistence?.backend === "sqlite" && payload?.exists !== false,
    schema_status: payload?.operations?.schema_status
      ?? payload?.runtime_backend_diagnostic?.schema_status
      ?? (payload?.exists === false ? "missing" : "unknown"),
    compatibility_status: payload?.compatibility_status ?? null,
    sqlite_file: payload?.runtime_backend?.sqlite_file ?? null,
    exists: payload?.exists === true,
    table_count: Number(payload?.table_count ?? 0) || 0,
    schema_version: payload?.schema_version ?? null,
    schema_migrations_present: payload?.schema_migrations_present === true,
    pending_ids: normalizeList(payload?.pending_ids),
    applied_ids: normalizeList(payload?.applied_ids),
    reason: payload?.reason ?? null,
  };
}

function buildPostgresStructureSummary(payload, adoptionPlan) {
  const target = adoptionPlan?.target ?? null;
  if (!target) {
    return {
      backend: "postgres",
      role: "migration-target",
      available: false,
      schema_status: payload?.runtime_persistence?.backend === "postgres" ? "target-unavailable" : "not-configured",
      compatibility_status: payload?.runtime_persistence?.backend === "postgres" ? "target-unavailable" : "not-configured",
      reason: payload?.runtime_persistence?.backend === "postgres"
        ? "postgres target is unavailable or has not been inspected"
        : "postgres backend is not configured",
    };
  }

  return {
    backend: "postgres",
    role: "migration-target",
    available: target.compatibility_status !== "target-unavailable",
    schema_status: target.compatibility_status === "target-unavailable"
      ? "target-unavailable"
      : (normalizeList(target.pending_ids).length > 0 || normalizeList(target.tables_missing).length > 0
        ? "migration-required"
        : "ready"),
    compatibility_status: target.compatibility_status ?? null,
    scope_key: target.scope_key ?? null,
    storage_policy: target.storage_policy ?? null,
    tables_present: normalizeList(target.tables_present),
    tables_missing: normalizeList(target.tables_missing),
    legacy_tables_present: normalizeList(target.legacy_tables_present),
    legacy_tables_missing: normalizeList(target.legacy_tables_missing),
    payload_rows: Number(target.payload_rows ?? 0) || 0,
    canonical_payload_rows: Number(target.canonical_payload_rows ?? 0) || 0,
    legacy_snapshot_rows: Number(target.legacy_snapshot_rows ?? 0) || 0,
    pending_ids: normalizeList(target.pending_ids),
    applied_ids: normalizeList(target.applied_ids),
    reason: target.reason ?? null,
    source_backend: target.source_backend ?? null,
    source_sqlite_file: target.source_sqlite_file ?? null,
  };
}

function buildRuntimeStructures(payload) {
  const adoptionPlan = payload?.runtime_backend_adoption_plan ?? null;
  const selectedBackend = payload?.runtime_persistence?.backend ?? "unknown";
  const selected = buildSelectedStructureSummary(payload);
  const sqlite = selectedBackend === "postgres"
    ? buildSqliteStructureSummary(payload, adoptionPlan)
    : selected;
  const postgres = selectedBackend === "postgres"
    ? buildPostgresStructureSummary(payload, adoptionPlan)
    : {
        backend: "postgres",
        role: "migration-target",
        available: false,
        schema_status: "not-configured",
        compatibility_status: "not-configured",
        reason: "postgres backend is not configured",
      };

  return {
    selected_backend: selectedBackend,
    active: selected,
    sqlite,
    postgres,
    migration: selectedBackend === "postgres"
      ? {
          available: true,
          action: adoptionPlan?.action ?? "noop",
          blocked: Boolean(adoptionPlan?.blocked),
          reason_code: adoptionPlan?.reason_code ?? "none",
          reason: adoptionPlan?.reason ?? null,
          source: adoptionPlan?.source ?? null,
          target: adoptionPlan?.target ?? null,
        }
      : {
          available: false,
          action: "noop",
          blocked: false,
          reason_code: "sqlite-active",
          reason: "postgres backend is not configured",
          source: null,
          target: null,
        },
  };
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
    source_of_truth_status: payload.source_of_truth?.source_of_truth_status ?? "missing",
    metadata_status: payload.metadata?.metadata_status ?? "not_governed",
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

function deriveRuntimeBackendDiagnostic(payload) {
  const backend = payload.runtime_persistence?.backend ?? "unknown";
  const backendSource = payload.runtime_persistence?.source ?? "unknown";
  const compatibilityStatus = payload.compatibility_status ?? "unknown";
  const schemaStatus = payload.operations?.schema_status ?? "unknown";
  const projectionScope = payload.resolved_projection_backend?.projection_scope ?? "unknown";
  const adoptionAction = payload.runtime_backend_adoption_plan?.action ?? "noop";
  const reasonCode = payload.runtime_backend_adoption_plan?.reason_code ?? "none";
  let recommendedAction = "no immediate runtime backend action required";
  if (schemaStatus === "missing" || schemaStatus === "migration-required" || schemaStatus === "schema-incomplete") {
    recommendedAction = "migrate or repair the selected runtime backend before relying on runtime projections";
  } else if (compatibilityStatus === "target-unavailable" || reasonCode === "target-unavailable") {
    recommendedAction = "resolve the configured target backend before attempting runtime backend adoption";
  } else if (adoptionAction && adoptionAction !== "noop") {
    recommendedAction = "review the adoption plan before changing runtime.persistence.backend";
  } else if (projectionScope === "shared-runtime-root" || projectionScope === "local-compat") {
    recommendedAction = "keep the current local-first projection policy unless a runtime backend switch is explicitly required";
  }
  return {
    scope: "runtime-persistence",
    backend,
    backend_source: backendSource,
    schema_status: schemaStatus,
    compatibility_status: compatibilityStatus,
    projection_scope: projectionScope,
    adoption_action: adoptionAction,
    reason_code: reasonCode,
    summary: payload.reason
      || payload.runtime_backend_adoption_plan?.reason
      || `runtime backend ${backend} is ${schemaStatus}`,
    recommended_action: recommendedAction,
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
  const sourceOfTruth = evaluateSourceOfTruthPolicy("runtime_defaults");
  const metadata = evaluateMetadataPolicy("workspace", {
    workspace_id: workspace.workspace_id,
    worktree_id: workspace.worktree_id,
    source_of_truth: sourceOfTruth.concept,
    updated_at: new Date().toISOString(),
    lifecycle_status: workspace.shared_runtime_mode === "shared-runtime" ? "active" : "discovered",
    owner: workspace.project_id,
    shared_runtime_mode: workspace.shared_runtime_mode,
  });
  const payload = {
    ts: new Date().toISOString(),
    target_root: absoluteTargetRoot,
    runtime_persistence: runtimePersistence,
    source_of_truth: sourceOfTruth,
    metadata,
    runtime_backend: describedBackend,
    sqlite_scope: sqliteFileExplicit ? "explicit-path" : "local-target-default",
    sqlite_scope_reason: sqliteFileExplicit
      ? "db-status is inspecting the explicit sqlite file requested by the caller"
      : (runtimePersistence.backend === "postgres"
        ? "db-status inspects the local SQLite compatibility projection while PostgreSQL remains the canonical backend"
        : "db-status defaults to the local SQLite projection/cache unless an explicit sqlite file is requested"),
    workspace,
    resolved_projection_backend: resolvedProjection,
    runtime_backend_adoption_plan: adoptionPlan,
    ...status,
  };
  const operations = deriveRuntimeOperations(payload);
  const runtimeStructures = buildRuntimeStructures({
    ...payload,
    operations,
  });
  return {
    ...payload,
    operations,
    runtime_structures: runtimeStructures,
    runtime_backend_diagnostic: deriveRuntimeBackendDiagnostic({
      ...payload,
      operations,
      runtime_structures: runtimeStructures,
    }),
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
    if (payload.runtime_structures?.active) {
      console.log(`Active structure status: ${payload.runtime_structures.active.schema_status ?? "unknown"}`);
    }
    if (payload.runtime_structures?.migration?.available) {
      console.log(`Migration action: ${payload.runtime_structures.migration.action ?? "unknown"}`);
    }
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
