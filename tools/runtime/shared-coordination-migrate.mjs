#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ensureSharedCoordinationReady,
  resolveSharedCoordinationStore,
  summarizeSharedCoordinationResolution,
} from "../../src/application/runtime/shared-coordination-store-service.mjs";
import {
  buildSharedCoordinationMigrationPlan,
  buildSharedCoordinationRollbackHint,
  defaultSharedCoordinationRollbackSnapshotPath,
} from "../../src/application/runtime/shared-coordination-admin-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { backupSharedCoordination } from "./shared-coordination-backup.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    dryRun: false,
    rollbackOut: "",
    rollbackLimit: 50,
    rollbackSnapshot: true,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--rollback-out") {
      args.rollbackOut = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--rollback-limit") {
      args.rollbackLimit = Number(argv[i + 1] ?? 50);
      i += 1;
    } else if (token === "--no-rollback-snapshot") {
      args.rollbackSnapshot = false;
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
  console.log("  npx aidn runtime shared-coordination-migrate --target . --json");
  console.log("  npx aidn runtime shared-coordination-migrate --target . --dry-run --json");
  console.log("  npx aidn runtime shared-coordination-migrate --target . --rollback-out .aidn/runtime/shared-coordination-rollback.json --json");
}

export async function migrateSharedCoordination({
  targetRoot = ".",
  write = true,
  rollbackOut = "",
  rollbackLimit = 50,
  rollbackSnapshot = true,
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
  const healthBefore = resolution.store ? await resolution.store.healthcheck() : null;
  const migrationPlan = buildSharedCoordinationMigrationPlan({
    health: healthBefore,
    contract: resolution.contract,
  });
  const shouldPlanRollbackSnapshot = Boolean(rollbackSnapshot)
    && Boolean(resolution.store)
    && migrationPlan.mutating
    && !migrationPlan.blocked;
  const shouldCreateRollbackSnapshot = shouldPlanRollbackSnapshot && Boolean(write);
  const rollbackOutputFile = shouldPlanRollbackSnapshot
    ? (rollbackOut
      ? path.resolve(absoluteTargetRoot, rollbackOut)
      : defaultSharedCoordinationRollbackSnapshotPath(absoluteTargetRoot))
    : "";

  if (!resolution.store) {
    return {
      target_root: absoluteTargetRoot,
      ok: false,
      workspace,
      shared_coordination_backend: summarizeSharedCoordinationResolution(resolution),
      shared_coordination_migration: {
        attempted: false,
        ok: false,
        status: resolution.status || "disabled",
        reason: resolution.reason || "shared coordination backend is not available",
        bootstrap: null,
        health: healthBefore,
      },
      pre_migration_health: healthBefore,
      migration_plan: migrationPlan,
      rollback_snapshot: null,
      rollback_hint: null,
      write_requested: Boolean(write),
      contract: resolution.contract
        ? {
          scope: resolution.contract.scope,
          schema_name: resolution.contract.schema_name,
          schema_version: resolution.contract.schema_version,
          schema_file: resolution.contract.schema_file,
          driver: resolution.contract.driver,
        }
        : null,
    };
  }

  if (!write || migrationPlan.blocked) {
    return {
      target_root: absoluteTargetRoot,
      ok: !migrationPlan.blocked,
      workspace,
      shared_coordination_backend: summarizeSharedCoordinationResolution(resolution),
      shared_coordination_migration: {
        attempted: false,
        ok: !migrationPlan.blocked,
        status: migrationPlan.blocked ? migrationPlan.status : "dry-run",
        reason: migrationPlan.reason,
        bootstrap: null,
        health: healthBefore,
      },
      pre_migration_health: healthBefore,
      migration_plan: migrationPlan,
      rollback_snapshot: shouldPlanRollbackSnapshot
        ? {
          planned_output_file: rollbackOutputFile,
          limit: Math.max(1, Number(rollbackLimit || 50)),
          enabled: true,
        }
        : null,
      rollback_hint: shouldPlanRollbackSnapshot
        ? buildSharedCoordinationRollbackHint({
          targetRoot: absoluteTargetRoot,
          inputFile: rollbackOutputFile,
        })
        : null,
      write_requested: Boolean(write),
      contract: resolution.contract
        ? {
          scope: resolution.contract.scope,
          schema_name: resolution.contract.schema_name,
          schema_version: resolution.contract.schema_version,
          schema_file: resolution.contract.schema_file,
          driver: resolution.contract.driver,
        }
        : null,
    };
  }

  const rollbackSnapshotResult = shouldCreateRollbackSnapshot
    ? await backupSharedCoordination({
      targetRoot: absoluteTargetRoot,
      out: rollbackOutputFile,
      limit: Math.max(1, Number(rollbackLimit || 50)),
      sharedCoordination: resolution,
    })
    : null;
  const migration = await ensureSharedCoordinationReady(resolution);
  return {
    target_root: absoluteTargetRoot,
    ok: migration.ok === true,
    workspace,
    shared_coordination_backend: summarizeSharedCoordinationResolution(resolution),
    shared_coordination_migration: migration,
    pre_migration_health: healthBefore,
    migration_plan: migrationPlan,
    rollback_snapshot: rollbackSnapshotResult
      ? {
        ok: rollbackSnapshotResult.ok === true,
        output_file: rollbackSnapshotResult.output_file,
        written: rollbackSnapshotResult.written,
        health: rollbackSnapshotResult.health,
      }
      : null,
    rollback_hint: rollbackSnapshotResult?.ok === true
      ? buildSharedCoordinationRollbackHint({
        targetRoot: absoluteTargetRoot,
        inputFile: rollbackSnapshotResult.output_file,
      })
      : null,
    write_requested: true,
    contract: resolution.contract
      ? {
        scope: resolution.contract.scope,
        schema_name: resolution.contract.schema_name,
        schema_version: resolution.contract.schema_version,
        schema_file: resolution.contract.schema_file,
        driver: resolution.contract.driver,
      }
      : null,
  };
}

function printHuman(result) {
  console.log("Shared coordination migrate:");
  console.log(`- ok=${result.ok ? "yes" : "no"}`);
  console.log(`- backend_kind=${result.shared_coordination_backend.backend_kind}`);
  console.log(`- status=${result.shared_coordination_migration.status}`);
  console.log(`- reason=${result.shared_coordination_migration.reason}`);
  console.log(`- write_requested=${result.write_requested ? "yes" : "no"}`);
  if (result.migration_plan) {
    console.log(`- planned_action=${result.migration_plan.action}`);
    console.log(`- planned_mutation=${result.migration_plan.mutating ? "yes" : "no"}`);
  }
  if (result.contract) {
    console.log(`- schema_name=${result.contract.schema_name}`);
    console.log(`- schema_version=${result.contract.schema_version}`);
  }
  if (result.pre_migration_health) {
    console.log(`- pre_schema_status=${result.pre_migration_health.schema_status || "unknown"}`);
    console.log(`- pre_latest_schema_version=${result.pre_migration_health.latest_applied_schema_version ?? 0}`);
  }
  if (result.shared_coordination_migration?.health) {
    console.log(`- schema_status=${result.shared_coordination_migration.health.schema_status || "unknown"}`);
    console.log(`- latest_schema_version=${result.shared_coordination_migration.health.latest_applied_schema_version ?? 0}`);
  }
  if (result.rollback_snapshot?.output_file) {
    console.log(`- rollback_snapshot=${result.rollback_snapshot.output_file}`);
  }
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await migrateSharedCoordination({
      targetRoot: args.target,
      write: !args.dryRun,
      rollbackOut: args.rollbackOut,
      rollbackLimit: args.rollbackLimit,
      rollbackSnapshot: args.rollbackSnapshot,
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
