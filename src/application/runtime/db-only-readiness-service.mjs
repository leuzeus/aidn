import path from "node:path";
import { resolvePromotedSharedPlanningContext } from "./shared-planning-resolution-service.mjs";
import { resolveWorkspaceContext } from "./workspace-resolution-service.mjs";
import {
  canonicalNone,
  canonicalUnknown,
  loadDbIndexPayloadSafe,
  normalizeScalar,
  parseSimpleMap,
  resolveDbArtifactSourceName,
  resolveAuditArtifactText,
  resolveCycleStatusArtifact,
  resolveDbBackedMode,
  resolveSessionArtifact,
} from "../../../tools/runtime/db-first-runtime-view-lib.mjs";

function createCheck(id, pass, details) {
  return { id, pass, details };
}

function countArtifactsWithContent(sqlitePayload) {
  if (!sqlitePayload || !Array.isArray(sqlitePayload.artifacts)) {
    return 0;
  }
  return sqlitePayload.artifacts.filter((artifact) => typeof artifact?.content === "string" && artifact.content.length > 0).length;
}

function createMissingResolution(logicalPath = "none", source = "not_applicable") {
  return {
    exists: false,
    source,
    logicalPath,
    text: "",
  };
}

function normalizeBacklogPath(activeBacklog) {
  const normalized = String(activeBacklog ?? "").trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!normalized || canonicalNone(normalized) || canonicalUnknown(normalized)) {
    return "";
  }
  if (normalized.startsWith("docs/audit/")) {
    return normalized;
  }
  return `docs/audit/${normalized.replace(/^\/+/, "")}`;
}

export function assessDbOnlyReadiness({
  targetRoot,
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  packetFile = "docs/audit/HANDOFF-PACKET.md",
  sharedCoordination = null,
  sharedCoordinationOptions = {},
  sharedStateOptions = {},
} = {}) {
  return Promise.resolve().then(async () => {
    const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
    const auditRoot = path.join(absoluteTargetRoot, "docs", "audit");
    const workspace = resolveWorkspaceContext({
      targetRoot: absoluteTargetRoot,
    });
    const { effectiveStateMode, dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
    const sqliteIndex = await loadDbIndexPayloadSafe(absoluteTargetRoot, sharedStateOptions);
    const dbSource = resolveDbArtifactSourceName(sqliteIndex.backend);
    const sqliteContentArtifactsCount = countArtifactsWithContent(sqliteIndex.payload);

    const currentState = resolveAuditArtifactText({
      targetRoot: absoluteTargetRoot,
      candidatePath: currentStateFile,
      dbBacked: dbBackedMode,
      sqlitePayload: sqliteIndex.payload,
      sqliteRuntimeHeads: sqliteIndex.runtimeHeads,
      dbSource,
    });
    const runtimeState = resolveAuditArtifactText({
      targetRoot: absoluteTargetRoot,
      candidatePath: runtimeStateFile,
      dbBacked: dbBackedMode,
      sqlitePayload: sqliteIndex.payload,
      sqliteRuntimeHeads: sqliteIndex.runtimeHeads,
      dbSource,
    });
    const handoffPacket = resolveAuditArtifactText({
      targetRoot: absoluteTargetRoot,
      candidatePath: packetFile,
      dbBacked: dbBackedMode,
      sqlitePayload: sqliteIndex.payload,
      sqliteRuntimeHeads: sqliteIndex.runtimeHeads,
      dbSource,
    });

    const currentMap = parseSimpleMap(currentState.text);
    const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
    const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
    const localActiveBacklog = normalizeScalar(currentMap.get("active_backlog") ?? "none") || "none";
    const sharedPlanning = await resolvePromotedSharedPlanningContext({
      targetRoot: absoluteTargetRoot,
      workspace,
      currentState: {
        active_session: activeSession,
        active_backlog: localActiveBacklog,
        backlog_status: currentMap.get("backlog_status") ?? "unknown",
        backlog_next_step: currentMap.get("backlog_next_step") ?? "unknown",
        backlog_selected_execution_scope: currentMap.get("backlog_selected_execution_scope") ?? "none",
        planning_arbitration_status: currentMap.get("planning_arbitration_status") ?? "none",
      },
      sharedCoordination,
      sharedCoordinationOptions,
    });
    const effectiveActiveBacklog = normalizeScalar(sharedPlanning.active_backlog) || localActiveBacklog;

    const sessionArtifact = resolveSessionArtifact({
      targetRoot: absoluteTargetRoot,
      auditRoot,
      sessionId: activeSession,
      dbBacked: dbBackedMode,
      sqlitePayload: sqliteIndex.payload,
      dbSource,
    });
    const cycleStatus = resolveCycleStatusArtifact({
      targetRoot: absoluteTargetRoot,
      auditRoot,
      cycleId: activeCycle,
      dbBacked: dbBackedMode,
      sqlitePayload: sqliteIndex.payload,
      dbSource,
    });
    const backlogPath = normalizeBacklogPath(effectiveActiveBacklog);
    const backlogArtifact = backlogPath
      ? resolveAuditArtifactText({
        targetRoot: absoluteTargetRoot,
        candidatePath: backlogPath,
        dbBacked: dbBackedMode,
        sqlitePayload: sqliteIndex.payload,
        sqliteRuntimeHeads: sqliteIndex.runtimeHeads,
        dbSource,
      })
      : createMissingResolution("none", "not_applicable");
    const backlogResolvableFromSharedPlanning = Boolean(backlogPath)
      && !backlogArtifact.exists
      && sharedPlanning.shared_planning_source === "shared-coordination"
      && !canonicalNone(sharedPlanning.active_backlog)
      && !canonicalUnknown(sharedPlanning.active_backlog);

    const checks = [
      createCheck(
        "effective_mode_db_backed",
        dbBackedMode,
        dbBackedMode
          ? `effective state mode is ${effectiveStateMode}`
          : `effective state mode is ${effectiveStateMode}; db-only readiness requires dual or db-only`,
      ),
      createCheck(
        "sqlite_index_present",
        sqliteIndex.exists,
        sqliteIndex.exists
          ? `SQLite index found at ${sqliteIndex.sqliteFile}`
          : `SQLite index missing at ${sqliteIndex.sqliteFile}`,
      ),
      createCheck(
        "sqlite_index_readable",
        sqliteIndex.payload != null,
        sqliteIndex.payload != null
          ? `SQLite payload loaded (${Array.isArray(sqliteIndex.payload?.artifacts) ? sqliteIndex.payload.artifacts.length : 0} artifacts)`
          : (sqliteIndex.warning || "SQLite payload is unavailable"),
      ),
      createCheck(
        "sqlite_index_has_content",
        sqliteContentArtifactsCount > 0,
        sqliteContentArtifactsCount > 0
          ? `${sqliteContentArtifactsCount} SQLite artifact(s) include embedded content`
          : "SQLite payload has no embedded artifact content",
      ),
      createCheck(
        "current_state_resolvable",
        currentState.exists,
        currentState.exists
          ? `CURRENT-STATE resolved via ${currentState.source}`
          : "CURRENT-STATE could not be resolved from file or SQLite",
      ),
      createCheck(
        "runtime_state_resolvable",
        runtimeState.exists,
        runtimeState.exists
          ? `RUNTIME-STATE resolved via ${runtimeState.source}`
          : "RUNTIME-STATE could not be resolved from file or SQLite",
      ),
      createCheck(
        "handoff_packet_resolvable",
        handoffPacket.exists,
        handoffPacket.exists
          ? `HANDOFF-PACKET resolved via ${handoffPacket.source}`
          : "HANDOFF-PACKET could not be resolved from file or SQLite",
      ),
      createCheck(
        "active_session_resolvable",
        canonicalNone(activeSession) || canonicalUnknown(activeSession) || sessionArtifact.exists,
        canonicalNone(activeSession) || canonicalUnknown(activeSession)
          ? "no active session declared"
          : (sessionArtifact.exists
            ? `active session ${activeSession} resolved via ${sessionArtifact.source}`
            : `active session ${activeSession} could not be resolved from file or SQLite`),
      ),
      createCheck(
        "active_cycle_status_resolvable",
        canonicalNone(activeCycle) || canonicalUnknown(activeCycle) || cycleStatus.exists,
        canonicalNone(activeCycle) || canonicalUnknown(activeCycle)
          ? "no active cycle declared"
          : (cycleStatus.exists
            ? `active cycle ${activeCycle} status resolved via ${cycleStatus.source}`
            : `active cycle ${activeCycle} status could not be resolved from file or SQLite`),
      ),
      createCheck(
        "active_backlog_resolvable",
        !backlogPath || backlogArtifact.exists || backlogResolvableFromSharedPlanning,
        !backlogPath
          ? "no active backlog declared"
          : (backlogArtifact.exists
            ? `active backlog resolved via ${backlogArtifact.source}`
            : (backlogResolvableFromSharedPlanning
              ? `active backlog ${backlogPath} is backed by shared coordination despite missing local projection`
              : `active backlog ${backlogPath} could not be resolved from file or SQLite`)),
      ),
    ];

    const failedChecks = checks.filter((check) => check.pass !== true);
    return {
      ts: new Date().toISOString(),
      target_root: absoluteTargetRoot,
      effective_state_mode: effectiveStateMode,
      db_backed_mode: dbBackedMode,
      status: failedChecks.length === 0 ? "pass" : "fail",
      checks,
      active_context: {
        active_session: activeSession,
        active_cycle: activeCycle,
        active_backlog: effectiveActiveBacklog,
        local_active_backlog: localActiveBacklog,
      },
      shared_planning: {
        source: sharedPlanning.shared_planning_source,
        read_status: sharedPlanning.shared_planning_read_status,
        read_reason: sharedPlanning.shared_planning_read_reason,
        active_backlog: sharedPlanning.active_backlog,
        backlog_status: sharedPlanning.backlog_status,
        backlog_next_step: sharedPlanning.backlog_next_step,
        planning_arbitration_status: sharedPlanning.planning_arbitration_status,
      },
      sqlite_index: {
        exists: sqliteIndex.exists,
        file: sqliteIndex.sqliteFile,
        projection_scope: sqliteIndex.backend?.projection_scope ?? "local-target",
        coordination_backend_kind: sqliteIndex.backend?.coordination_backend_kind ?? "none",
        readable: sqliteIndex.payload != null,
        artifact_count: Array.isArray(sqliteIndex.payload?.artifacts) ? sqliteIndex.payload.artifacts.length : 0,
        content_artifacts_count: sqliteContentArtifactsCount,
        warning: sqliteIndex.warning || "",
      },
      resolutions: {
        current_state: {
          exists: currentState.exists,
          source: currentState.source,
          logical_path: currentState.logicalPath,
        },
        runtime_state: {
          exists: runtimeState.exists,
          source: runtimeState.source,
          logical_path: runtimeState.logicalPath,
        },
        handoff_packet: {
          exists: handoffPacket.exists,
          source: handoffPacket.source,
          logical_path: handoffPacket.logicalPath,
        },
        session_artifact: {
          exists: sessionArtifact.exists,
          source: sessionArtifact.source,
          logical_path: sessionArtifact.logicalPath,
        },
        cycle_status: {
          exists: cycleStatus.exists,
          source: cycleStatus.source,
          logical_path: cycleStatus.logicalPath,
        },
        backlog_artifact: {
          exists: backlogArtifact.exists,
          source: backlogArtifact.source,
          logical_path: backlogArtifact.logicalPath,
          shared_planning_backed: backlogResolvableFromSharedPlanning,
        },
      },
    };
  });
}
