#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  resolveSharedCoordinationStore,
  summarizeSharedCoordinationResolution,
  syncSharedWorkspaceRegistration,
} from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { resolveSharedCoordinationRestoreCompatibility } from "../../src/application/runtime/shared-coordination-admin-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function parseArgs(argv) {
  const args = {
    target: ".",
    input: ".aidn/runtime/shared-coordination-backup.json",
    write: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--in") {
      args.input = String(argv[i + 1] ?? "").trim();
      i += 1;
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
  if (!args.input) {
    throw new Error("Missing value for --in");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime shared-coordination-restore --target . --json");
  console.log("  npx aidn runtime shared-coordination-restore --target . --in .aidn/runtime/shared-coordination-backup.json --write --json");
}

function loadBackupSnapshot(inputFile) {
  if (!fs.existsSync(inputFile)) {
    throw new Error(`Backup file not found: ${inputFile}`);
  }
  const payload = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  return {
    payload,
    planningState: payload?.snapshot?.planning_read?.planning_state ?? null,
    handoffRelay: payload?.snapshot?.handoff_read?.handoff_relay ?? null,
    coordinationRecords: Array.isArray(payload?.snapshot?.coordination_read?.records)
      ? payload.snapshot.coordination_read.records
      : [],
  };
}

function buildPreview({ planningState, handoffRelay, coordinationRecords }) {
  return {
    planning_present: Boolean(planningState),
    handoff_present: Boolean(handoffRelay),
    coordination_record_count: coordinationRecords.length,
  };
}

function sortRecordsForReplay(records) {
  return records
    .slice()
    .sort((left, right) => String(left?.created_at ?? "").localeCompare(String(right?.created_at ?? "")) || String(left?.record_id ?? "").localeCompare(String(right?.record_id ?? "")));
}

function checkWorkspaceMatch(workspace, payload) {
  const backupWorkspaceId = normalizeScalar(payload?.workspace?.workspace_id);
  if (!backupWorkspaceId) {
    return {
      ok: true,
      backup_workspace_id: "",
    };
  }
  return {
    ok: backupWorkspaceId === normalizeScalar(workspace?.workspace_id),
    backup_workspace_id: backupWorkspaceId,
  };
}

export async function restoreSharedCoordination({
  targetRoot = ".",
  input = ".aidn/runtime/shared-coordination-backup.json",
  write = false,
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const absoluteInput = path.resolve(absoluteTargetRoot, input);
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

  if (!resolution.store) {
    return {
      target_root: absoluteTargetRoot,
      input_file: absoluteInput,
      ok: false,
      status: resolution.status || "disabled",
      reason: resolution.reason || "shared coordination backend is not available",
      write_requested: Boolean(write),
      workspace,
      shared_coordination_backend: backend,
      health,
      preview: null,
      restore: null,
    };
  }

  const snapshot = loadBackupSnapshot(absoluteInput);
  const schemaCompatibility = resolveSharedCoordinationRestoreCompatibility({
    backupPayload: snapshot.payload,
    resolution,
    health,
  });
  const workspaceMatch = checkWorkspaceMatch(workspace, snapshot.payload);
  if (!workspaceMatch.ok) {
    return {
      target_root: absoluteTargetRoot,
      input_file: absoluteInput,
      ok: false,
      status: "workspace-mismatch",
      reason: `backup workspace_id ${workspaceMatch.backup_workspace_id} does not match current workspace_id ${workspace.workspace_id}`,
      write_requested: Boolean(write),
      workspace,
      shared_coordination_backend: backend,
      health,
      preview: buildPreview(snapshot),
      schema_compatibility: schemaCompatibility,
      restore: null,
    };
  }

  const preview = buildPreview(snapshot);
  if (!schemaCompatibility.ok) {
    return {
      target_root: absoluteTargetRoot,
      input_file: absoluteInput,
      ok: false,
      status: schemaCompatibility.status,
      reason: schemaCompatibility.reason,
      write_requested: Boolean(write),
      workspace,
      shared_coordination_backend: backend,
      health,
      preview,
      schema_compatibility: schemaCompatibility,
      restore: null,
    };
  }
  if (!write) {
    return {
      target_root: absoluteTargetRoot,
      input_file: absoluteInput,
      ok: true,
      status: "dry-run",
      reason: "shared coordination restore preview generated",
      write_requested: false,
      workspace,
      shared_coordination_backend: backend,
      health,
      preview,
      schema_compatibility: schemaCompatibility,
      restore: null,
    };
  }

  const registration = await syncSharedWorkspaceRegistration(resolution, {
    workspace,
  });
  if (!registration.ok) {
    return {
      target_root: absoluteTargetRoot,
      input_file: absoluteInput,
      ok: false,
      status: registration.status,
      reason: registration.reason,
      write_requested: true,
      workspace,
      shared_coordination_backend: backend,
      health,
      preview,
      schema_compatibility: schemaCompatibility,
      restore: {
        registration,
        planning: null,
        handoff: null,
        coordination: [],
      },
    };
  }

  const planning = snapshot.planningState
    ? await resolution.store.upsertPlanningState({
      workspaceId: workspace.workspace_id,
      planningKey: snapshot.planningState.planning_key,
      sessionId: snapshot.planningState.session_id,
      backlogArtifactRef: snapshot.planningState.backlog_artifact_ref,
      backlogArtifactSha256: snapshot.planningState.backlog_artifact_sha256,
      planningStatus: snapshot.planningState.planning_status,
      planningArbitrationStatus: snapshot.planningState.planning_arbitration_status,
      nextDispatchScope: snapshot.planningState.next_dispatch_scope,
      nextDispatchAction: snapshot.planningState.next_dispatch_action,
      backlogNextStep: snapshot.planningState.backlog_next_step,
      selectedExecutionScope: snapshot.planningState.selected_execution_scope,
      dispatchReady: snapshot.planningState.dispatch_ready === true,
      sourceWorktreeId: snapshot.planningState.source_worktree_id || workspace.worktree_id,
      payload: snapshot.planningState.payload ?? {},
    })
    : null;

  const handoff = snapshot.handoffRelay
    ? await resolution.store.appendHandoffRelay({
      workspaceId: workspace.workspace_id,
      relayId: snapshot.handoffRelay.relay_id,
      sessionId: snapshot.handoffRelay.session_id,
      cycleId: snapshot.handoffRelay.cycle_id,
      scopeType: snapshot.handoffRelay.scope_type,
      scopeId: snapshot.handoffRelay.scope_id,
      sourceWorktreeId: snapshot.handoffRelay.source_worktree_id || workspace.worktree_id,
      handoffStatus: snapshot.handoffRelay.handoff_status,
      fromAgentRole: snapshot.handoffRelay.from_agent_role,
      fromAgentAction: snapshot.handoffRelay.from_agent_action,
      recommendedNextAgentRole: snapshot.handoffRelay.recommended_next_agent_role,
      recommendedNextAgentAction: snapshot.handoffRelay.recommended_next_agent_action,
      handoffPacketRef: snapshot.handoffRelay.handoff_packet_ref,
      handoffPacketSha256: snapshot.handoffRelay.handoff_packet_sha256,
      prioritizedArtifacts: Array.isArray(snapshot.handoffRelay.prioritized_artifacts) ? snapshot.handoffRelay.prioritized_artifacts : [],
      metadata: snapshot.handoffRelay.metadata_json ?? {},
    })
    : null;

  const coordination = [];
  for (const record of sortRecordsForReplay(snapshot.coordinationRecords)) {
    coordination.push(await resolution.store.appendCoordinationRecord({
      workspaceId: workspace.workspace_id,
      recordId: record.record_id,
      recordType: record.record_type,
      sessionId: record.session_id,
      cycleId: record.cycle_id,
      scopeType: record.scope_type,
      scopeId: record.scope_id,
      sourceWorktreeId: record.source_worktree_id || workspace.worktree_id,
      actorRole: record.actor_role,
      actorAction: record.actor_action,
      status: record.status,
      coordinationLogRef: record.coordination_log_ref,
      coordinationSummaryRef: record.coordination_summary_ref,
      payload: record.payload_json ?? {},
    }));
  }

  const ok = (planning ? planning.ok === true : true)
    && (handoff ? handoff.ok === true : true)
    && coordination.every((item) => item.ok === true);

  return {
    target_root: absoluteTargetRoot,
    input_file: absoluteInput,
    ok,
    status: ok ? "restored" : "restore-failed",
    reason: ok ? "shared coordination snapshot replayed" : "shared coordination snapshot replay failed",
    write_requested: true,
    workspace,
    shared_coordination_backend: backend,
    health,
    preview,
    schema_compatibility: schemaCompatibility,
    restore: {
      registration,
      planning,
      handoff,
      coordination,
    },
  };
}

function printHuman(result) {
  console.log("Shared coordination restore:");
  console.log(`- ok=${result.ok ? "yes" : "no"}`);
  console.log(`- status=${result.status}`);
  console.log(`- reason=${result.reason}`);
  console.log(`- input_file=${result.input_file}`);
  console.log(`- write_requested=${result.write_requested ? "yes" : "no"}`);
  if (result.preview) {
    console.log(`- planning_present=${result.preview.planning_present ? "yes" : "no"}`);
    console.log(`- handoff_present=${result.preview.handoff_present ? "yes" : "no"}`);
    console.log(`- coordination_record_count=${result.preview.coordination_record_count}`);
  }
  if (result.schema_compatibility) {
    console.log(`- schema_compatibility=${result.schema_compatibility.status}`);
  }
  if (result.health) {
    console.log(`- schema_status=${result.health.schema_status || "unknown"}`);
    console.log(`- latest_schema_version=${result.health.latest_applied_schema_version ?? 0}`);
  }
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await restoreSharedCoordination({
      targetRoot: args.target,
      input: args.input,
      write: args.write,
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
