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
import { isJsonEquivalent, writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";
import { resolveSharedCoordinationBackupSchemaInfo } from "../../src/application/runtime/shared-coordination-admin-service.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    out: ".aidn/runtime/shared-coordination-backup.json",
    limit: 50,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--out") {
      args.out = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--limit") {
      args.limit = Number(argv[i + 1] ?? 50);
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
  console.log("  npx aidn runtime shared-coordination-backup --target . --json");
  console.log("  npx aidn runtime shared-coordination-backup --target . --out .aidn/runtime/shared-coordination-backup.json --limit 100 --json");
}

function resolveActiveContext(targetRoot) {
  const { dbBackedMode } = resolveDbBackedMode(targetRoot);
  const sqliteIndex = dbBackedMode
    ? loadSqliteIndexPayloadSafe(targetRoot)
    : {
      payload: null,
      runtimeHeads: {},
    };
  const currentState = resolveAuditArtifactText({
    targetRoot,
    candidatePath: "docs/audit/CURRENT-STATE.md",
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteIndex.payload,
    sqliteRuntimeHeads: sqliteIndex.runtimeHeads,
  });
  const currentMap = parseSimpleMap(currentState.text);
  return {
    current_state_source: currentState.source,
    active_session: normalizeScalar(currentMap.get("active_session") ?? "none") || "none",
    active_cycle: normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none",
  };
}

export async function backupSharedCoordination({
  targetRoot = ".",
  out = ".aidn/runtime/shared-coordination-backup.json",
  limit = 50,
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
  const activeContext = resolveActiveContext(absoluteTargetRoot);

  if (!resolution.store) {
    return {
      target_root: absoluteTargetRoot,
      output_file: "",
      written: false,
      ok: false,
      status: resolution.status || "disabled",
      reason: resolution.reason || "shared coordination backend is not available",
      workspace,
      shared_coordination_backend: backend,
      health,
      backup: null,
    };
  }

  const planning = activeContext.active_session !== "none"
    ? await readSharedPlanningState(resolution, {
      workspace,
      sessionId: activeContext.active_session,
      planningKey: `session:${activeContext.active_session}`,
    })
    : null;
  const handoff = await readLatestSharedHandoffRelay(resolution, {
    workspace,
    sessionId: activeContext.active_session !== "none" ? activeContext.active_session : "",
    scopeType: activeContext.active_cycle !== "none" ? "cycle" : "",
    scopeId: activeContext.active_cycle !== "none" ? activeContext.active_cycle : "",
  });
  const coordination = await readSharedCoordinationRecords(resolution, {
    workspace,
    sessionId: activeContext.active_session !== "none" ? activeContext.active_session : "",
    limit: Math.max(1, Number(limit || 50)),
  });

  const backup = {
    ts: new Date().toISOString(),
    workspace,
    shared_coordination_backend: backend,
    health,
    schema_snapshot: {
      schema_name: resolution.contract?.schema_name ?? health?.schema_name ?? "unknown",
      expected_schema_version: Number(resolution.contract?.schema_version ?? health?.expected_schema_version ?? 0) || 0,
      latest_applied_schema_version: Number(health?.latest_applied_schema_version ?? 0) || 0,
      schema_status: normalizeScalar(health?.schema_status || "unknown") || "unknown",
    },
    active_context: activeContext,
    contract: resolution.contract
      ? {
        scope: resolution.contract.scope,
        schema_name: resolution.contract.schema_name,
        schema_version: resolution.contract.schema_version,
        expected_schema_version: resolution.contract.schema_version,
        source_schema_version: Number(health?.latest_applied_schema_version ?? 0) || 0,
        schema_file: resolution.contract.schema_file,
        driver: resolution.contract.driver,
      }
      : null,
    snapshot: {
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
        record_count: Array.isArray(coordination.records) ? coordination.records.length : 0,
        records: coordination.records,
      },
    },
  };

  const output = writeJsonIfChanged(path.resolve(absoluteTargetRoot, out), backup, {
    isEquivalent(previousContent) {
      return isJsonEquivalent(previousContent, backup, ["ts"]);
    },
  });
  return {
    target_root: absoluteTargetRoot,
    output_file: output.path,
    written: output.written,
    ok: true,
    status: "backed-up",
    reason: "shared coordination backup exported",
    workspace,
    shared_coordination_backend: backend,
    health,
    schema_compatibility: resolveSharedCoordinationBackupSchemaInfo(backup),
    backup,
  };
}

function printHuman(result) {
  console.log("Shared coordination backup:");
  console.log(`- ok=${result.ok ? "yes" : "no"}`);
  console.log(`- status=${result.status}`);
  console.log(`- reason=${result.reason}`);
  if (result.output_file) {
    console.log(`- output_file=${result.output_file}`);
    console.log(`- written=${result.written ? "yes" : "no"}`);
  }
  if (result.health) {
    console.log(`- schema_status=${result.health.schema_status || "unknown"}`);
    console.log(`- latest_schema_version=${result.health.latest_applied_schema_version ?? 0}`);
  }
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await backupSharedCoordination({
      targetRoot: args.target,
      out: args.out,
      limit: args.limit,
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
