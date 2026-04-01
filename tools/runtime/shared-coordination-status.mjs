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
  return {
    target_root: absoluteTargetRoot,
    ok: resolution.store ? health?.ok === true : resolution.status === "disabled",
    workspace,
    shared_coordination_backend: backend,
    health,
    snapshot: {
      active_session: activeSession,
      active_cycle: activeCycle,
      planning_read: planning
        ? {
          status: planning.status,
          planning_state: planning.planning_state,
        }
        : null,
      handoff_read: {
        status: handoff.status,
        handoff_relay: handoff.handoff_relay,
      },
      coordination_read: {
        status: coordination.status,
        records: coordination.records,
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
      console.log(`- backend_kind=${result.shared_coordination_backend.backend_kind}`);
      console.log(`- status=${result.shared_coordination_backend.status}`);
      console.log(`- reason=${result.shared_coordination_backend.reason}`);
      console.log(`- connection_status=${result.shared_coordination_backend.connection_status || "none"}`);
      if (result.health) {
        console.log(`- health=${result.health.ok ? "ok" : "fail"}`);
        console.log(`- schema_status=${result.health.schema_status || "unknown"}`);
        console.log(`- latest_schema_version=${result.health.latest_applied_schema_version ?? 0}`);
      }
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
