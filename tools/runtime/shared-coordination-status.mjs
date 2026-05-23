#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readLatestSharedHandoffRelay,
  readSharedCoordinationRecords,
  readSharedPlanningState,
  resolveSharedCoordinationStore,
  summarizeSharedCoordinationResolution,
} from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { deriveSharedCoordinationGovernance } from "../../src/application/runtime/shared-coordination-governance-lib.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import {
  loadSqliteIndexPayloadSafe,
  normalizeScalar,
  parseSimpleMap,
  resolveAuditArtifactText,
  resolveDbBackedMode,
} from "./db-first-runtime-view-lib.mjs";

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
  console.log("  npx aidn runtime shared-coordination-status --target . --json");
}

function deriveSharedCoordinationOperations({
  backend,
  health,
  snapshot,
  sourceOfTruth,
  metadata,
}) {
  const status = backend?.status ?? "disabled";
  const schemaStatus = health?.schema_status ?? (status === "disabled" ? "disabled" : status);
  const compatibilityStatus = health?.compatibility_status ?? "unknown";
  const planningStatus = snapshot?.planning_read?.status ?? "not_applicable";
  const handoffStatus = snapshot?.handoff_read?.status ?? "unknown";
  const coordinationStatus = snapshot?.coordination_read?.status ?? "unknown";
  const recommendedActions = [];
  if (status === "missing-env") {
    recommendedActions.push("set the environment variable referenced by shared_coordination_backend.connection_ref");
  } else if (status === "disabled") {
    recommendedActions.push("keep local-only mode or configure shared-runtime explicitly before using shared coordination");
  } else if (schemaStatus !== "ready") {
    recommendedActions.push("run aidn runtime shared-coordination-bootstrap --target . --json or inspect migration diagnostics");
  } else {
    recommendedActions.push("shared coordination is inspectable; back it up before mutating shared records");
  }
  return {
    local_first: true,
    scope: "shared-coordination-only",
    backend_kind: backend?.backend_kind ?? "none",
    backend_status: status,
    schema_status: schemaStatus,
    source_of_truth_status: sourceOfTruth?.source_of_truth_status ?? "missing",
    metadata_status: metadata?.metadata_status ?? "not_governed",
    compatibility_status: compatibilityStatus,
    latest_schema_version: health?.latest_applied_schema_version ?? 0,
    connection_ref: backend?.connection_ref || "none",
    connection_secret_exposed: false,
    freshness_status: [planningStatus, handoffStatus, coordinationStatus].some((item) => item === "found") ? "inspectable" : "no-shared-records",
    planning_read_status: planningStatus,
    handoff_read_status: handoffStatus,
    coordination_read_status: coordinationStatus,
    backup_command: "aidn runtime shared-coordination-backup --target . --json",
    restore_preview_command: "aidn runtime shared-coordination-restore --target . --json",
    recommended_actions: recommendedActions,
  };
}

export async function projectSharedCoordinationStatus({
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
  const backend = summarizeSharedCoordinationResolution(resolution);
  const health = resolution.store ? await resolution.store.healthcheck() : null;
  const { dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
  const sqliteFallback = dbBackedMode ? loadSqliteIndexPayloadSafe(absoluteTargetRoot) : {
    exists: false,
    sqliteFile: "",
    payload: null,
    runtimeHeads: {},
    warning: "",
  };
  const currentStateResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: "docs/audit/CURRENT-STATE.md",
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
  });
  const currentMap = parseSimpleMap(currentStateResolution.text);
  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
  const planning = activeSession !== "none"
    ? await readSharedPlanningState(resolution, {
      workspace,
      sessionId: activeSession,
      planningKey: `session:${activeSession}`,
    })
    : null;
  const handoff = await readLatestSharedHandoffRelay(resolution, {
    workspace,
    sessionId: activeSession !== "none" ? activeSession : "",
    scopeType: activeCycle !== "none" ? "cycle" : "",
    scopeId: activeCycle !== "none" ? activeCycle : "",
  });
  const coordination = await readSharedCoordinationRecords(resolution, {
    workspace,
    sessionId: activeSession !== "none" ? activeSession : "",
    limit: 5,
  });
  const latestObservedAt = planning?.planning_state?.updated_at
    || handoff?.handoff_relay?.created_at
    || coordination?.records?.[0]?.created_at
    || "";
  const hasSharedRecords = Boolean(planning?.planning_state || handoff?.handoff_relay || (coordination?.records?.length ?? 0) > 0);
  const governance = deriveSharedCoordinationGovernance({
    workspace,
    backend,
    updatedAt: latestObservedAt,
    hasSharedRecords,
  });
  const result = {
    target_root: absoluteTargetRoot,
    ok: resolution.store ? health?.ok === true : resolution.status === "disabled",
    workspace,
    source_of_truth: governance.source_of_truth,
    metadata: governance.metadata,
    shared_coordination_backend: backend,
    health,
    snapshot: {
      active_session: activeSession,
      active_cycle: activeCycle,
      planning_read: planning
        ? {
          status: planning.status,
          planning_state: planning.planning_state,
          governance: planning.governance,
        }
        : null,
      handoff_read: {
        status: handoff.status,
        handoff_relay: handoff.handoff_relay,
        governance: handoff.governance,
      },
      coordination_read: {
        status: coordination.status,
        records: coordination.records,
        governance: coordination.governance,
      },
    },
    contract: resolution.contract
      ? {
        scope: resolution.contract.scope,
        schema_name: resolution.contract.schema_name,
        schema_version: resolution.contract.schema_version,
        driver: resolution.contract.driver,
      }
      : null,
  };
  return {
    ...result,
    operations: deriveSharedCoordinationOperations({
      backend,
      health,
      snapshot: result.snapshot,
      sourceOfTruth: governance.source_of_truth,
      metadata: governance.metadata,
    }),
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await projectSharedCoordinationStatus({
      targetRoot: args.target,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Shared coordination status:");
      console.log(`- project_id=${result.workspace?.project_id || "none"}`);
      console.log(`- workspace_id=${result.workspace?.workspace_id || "none"}`);
      console.log(`- worktree_id=${result.workspace?.worktree_id || "none"}`);
      console.log(`- backend_kind=${result.shared_coordination_backend.backend_kind}`);
      console.log(`- status=${result.shared_coordination_backend.status}`);
      console.log(`- reason=${result.shared_coordination_backend.reason}`);
      console.log(`- connection_status=${result.shared_coordination_backend.connection_status || "none"}`);
      if (result.health) {
        console.log(`- health=${result.health.ok ? "ok" : "fail"}`);
        console.log(`- schema_status=${result.health.schema_status || "unknown"}`);
        console.log(`- compatibility_status=${result.health.compatibility_status || "unknown"}`);
        console.log(`- latest_schema_version=${result.health.latest_applied_schema_version ?? 0}`);
        console.log(`- registered_project_count=${result.health.registered_project_count ?? 0}`);
        console.log(`- legacy_workspace_rows=${result.health.legacy_workspace_rows ?? 0}`);
      }
      console.log(`- operational_schema_status=${result.operations?.schema_status ?? "unknown"}`);
      console.log(`- operational_freshness=${result.operations?.freshness_status ?? "unknown"}`);
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
