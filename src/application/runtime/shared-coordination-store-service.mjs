import path from "node:path";
import { createPostgresSharedCoordinationStore } from "../../adapters/runtime/postgres-shared-coordination-store.mjs";
import {
  getPostgresSharedCoordinationContract,
  resolvePostgresSharedCoordinationConnection,
} from "./postgres-shared-coordination-contract-service.mjs";
import { resolveWorkspaceContext } from "./workspace-resolution-service.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function makeResolution({
  enabled,
  configured,
  backendKind,
  status,
  reason,
  workspace,
  connection,
  contract,
  store,
} = {}) {
  return {
    enabled: Boolean(enabled),
    configured: Boolean(configured),
    backend_kind: normalizeScalar(backendKind) || "none",
    status: normalizeScalar(status) || "disabled",
    reason: normalizeScalar(reason) || "none",
    workspace,
    connection: connection ?? null,
    contract: contract ?? null,
    store: store ?? null,
  };
}

function buildSyntheticId(prefix, workspace, suffix = "") {
  const worktreeId = normalizeScalar(workspace?.worktree_id) || "worktree";
  const tail = normalizeScalar(suffix) || new Date().toISOString();
  return `${prefix}:${worktreeId}:${tail}`;
}

export function summarizeSharedCoordinationResolution(resolution) {
  return {
    enabled: Boolean(resolution?.enabled),
    configured: Boolean(resolution?.configured),
    backend_kind: normalizeScalar(resolution?.backend_kind) || "none",
    status: normalizeScalar(resolution?.status) || "disabled",
    reason: normalizeScalar(resolution?.reason) || "none",
    connection_ref: normalizeScalar(resolution?.connection?.connection_ref),
    connection_status: normalizeScalar(resolution?.connection?.status),
    driver_package: normalizeScalar(resolution?.connection?.driver?.package_name || resolution?.contract?.driver?.package_name),
  };
}

export async function resolveSharedCoordinationStore({
  targetRoot = ".",
  workspace = null,
  env = process.env,
  connectionString = "",
  clientFactory = null,
  moduleLoader = null,
  store = null,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const resolvedWorkspace = workspace ?? resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const backendKind = normalizeScalar(resolvedWorkspace?.shared_backend_kind).toLowerCase() || "none";
  const sharedRuntimeMode = normalizeScalar(resolvedWorkspace?.shared_runtime_mode) || "local-only";

  if (sharedRuntimeMode !== "shared-runtime") {
    return makeResolution({
      enabled: false,
      configured: false,
      backendKind,
      status: "disabled",
      reason: "shared runtime is not enabled",
      workspace: resolvedWorkspace,
    });
  }
  if (backendKind !== "postgres") {
    return makeResolution({
      enabled: false,
      configured: false,
      backendKind,
      status: "disabled",
      reason: `shared coordination store is not used for backend kind ${backendKind || "none"}`,
      workspace: resolvedWorkspace,
    });
  }

  const contract = getPostgresSharedCoordinationContract({
    workspace: resolvedWorkspace,
    env,
    connectionString,
    connectionRef: resolvedWorkspace?.shared_runtime_connection_ref,
  });
  const connection = resolvePostgresSharedCoordinationConnection({
    workspace: resolvedWorkspace,
    env,
    connectionString,
  });
  if (!connection.ok) {
    return makeResolution({
      enabled: true,
      configured: false,
      backendKind,
      status: connection.status,
      reason: connection.message,
      workspace: resolvedWorkspace,
      connection,
      contract,
    });
  }

  return makeResolution({
    enabled: true,
    configured: true,
    backendKind,
    status: "ready",
    reason: "shared coordination backend resolved",
    workspace: resolvedWorkspace,
    connection,
    contract,
    store: store ?? createPostgresSharedCoordinationStore({
      connectionString: connection.connection_string,
      connectionRef: connection.connection_ref,
      workspace: resolvedWorkspace,
      env,
      clientFactory,
      moduleLoader,
    }),
  });
}

export async function ensureSharedCoordinationReady(resolution) {
  if (!resolution?.store) {
    return {
      attempted: false,
      ok: false,
      status: normalizeScalar(resolution?.status) || "disabled",
      reason: normalizeScalar(resolution?.reason) || "shared coordination backend is not available",
      bootstrap: null,
      health: null,
    };
  }

  const bootstrap = await resolution.store.bootstrap();
  if (bootstrap.ok !== true) {
    return {
      attempted: true,
      ok: false,
      status: "bootstrap-failed",
      reason: normalizeScalar(bootstrap.error?.message) || "bootstrap failed",
      bootstrap,
      health: null,
    };
  }

  const health = await resolution.store.healthcheck();
  if (health.ok !== true) {
    return {
      attempted: true,
      ok: false,
      status: "unhealthy",
      reason: normalizeScalar(health.error?.message) || "healthcheck failed",
      bootstrap,
      health,
    };
  }

  return {
    attempted: true,
    ok: true,
    status: "ready",
    reason: "shared coordination backend bootstrapped and healthy",
    bootstrap,
    health,
  };
}

export async function syncSharedWorkspaceRegistration(resolution, {
  workspace = null,
} = {}) {
  const effectiveWorkspace = workspace ?? resolution?.workspace ?? null;
  if (!resolution?.store) {
    return {
      attempted: false,
      ok: false,
      status: normalizeScalar(resolution?.status) || "disabled",
      reason: normalizeScalar(resolution?.reason) || "shared coordination backend is not available",
      registration: null,
      backend: summarizeSharedCoordinationResolution(resolution),
    };
  }

  const readiness = await ensureSharedCoordinationReady(resolution);
  if (!readiness.ok) {
    return {
      attempted: true,
      ok: false,
      status: readiness.status,
      reason: readiness.reason,
      readiness,
      registration: null,
      backend: summarizeSharedCoordinationResolution(resolution),
    };
  }

  const workspaceRegistration = await resolution.store.registerWorkspace({
    workspaceId: effectiveWorkspace?.workspace_id,
    workspaceIdSource: effectiveWorkspace?.workspace_id_source,
    locatorRef: effectiveWorkspace?.shared_runtime_locator_ref,
    gitCommonDir: effectiveWorkspace?.git_common_dir,
    repoRoot: effectiveWorkspace?.repo_root,
    sharedBackendKind: "postgres",
  });
  if (workspaceRegistration.ok !== true) {
    return {
      attempted: true,
      ok: false,
      status: "workspace-registration-failed",
      reason: normalizeScalar(workspaceRegistration.error?.message) || "workspace registration failed",
      readiness,
      registration: {
        workspace: workspaceRegistration,
        worktree: null,
      },
      backend: summarizeSharedCoordinationResolution(resolution),
    };
  }

  const worktreeRegistration = await resolution.store.registerWorktreeHeartbeat({
    workspaceId: effectiveWorkspace?.workspace_id,
    worktreeId: effectiveWorkspace?.worktree_id,
    worktreeRoot: effectiveWorkspace?.worktree_root,
    gitDir: effectiveWorkspace?.git_dir,
    isLinkedWorktree: effectiveWorkspace?.is_linked_worktree === true,
  });
  if (worktreeRegistration.ok !== true) {
    return {
      attempted: true,
      ok: false,
      status: "worktree-registration-failed",
      reason: normalizeScalar(worktreeRegistration.error?.message) || "worktree registration failed",
      readiness,
      registration: {
        workspace: workspaceRegistration,
        worktree: worktreeRegistration,
      },
      backend: summarizeSharedCoordinationResolution(resolution),
    };
  }

  return {
    attempted: true,
    ok: true,
    status: "registered",
    reason: "workspace and worktree registration refreshed",
    readiness,
    registration: {
      workspace: workspaceRegistration,
      worktree: worktreeRegistration,
    },
    backend: summarizeSharedCoordinationResolution(resolution),
  };
}

export async function syncSharedPlanningState(resolution, {
  workspace = null,
  payload = {},
  backlogFile = "",
  backlogSha256 = "",
  planningKey = "",
} = {}) {
  const effectiveWorkspace = workspace ?? resolution?.workspace ?? null;
  const registration = await syncSharedWorkspaceRegistration(resolution, {
    workspace: effectiveWorkspace,
  });
  if (!registration.ok) {
    return {
      attempted: registration.attempted,
      ok: false,
      status: registration.status,
      reason: registration.reason,
      operation: "upsertPlanningState",
      backend: registration.backend,
    };
  }

  const result = await resolution.store.upsertPlanningState({
    workspaceId: effectiveWorkspace?.workspace_id,
    planningKey: normalizeScalar(planningKey) || `session:${normalizeScalar(payload?.session_id) || "none"}`,
    sessionId: payload?.session_id,
    backlogArtifactRef: backlogFile,
    backlogArtifactSha256: backlogSha256,
    planningStatus: payload?.planning_status,
    planningArbitrationStatus: payload?.planning_arbitration_status,
    nextDispatchScope: payload?.next_dispatch_scope,
    nextDispatchAction: payload?.next_dispatch_action,
    backlogNextStep: payload?.backlog_next_step,
    selectedExecutionScope: payload?.selected_execution_scope,
    dispatchReady: String(payload?.dispatch_ready ?? "").trim().toLowerCase() === "yes" || payload?.dispatch_ready === true,
    sourceWorktreeId: effectiveWorkspace?.worktree_id,
    payload,
  });
  return {
    attempted: true,
    ok: result.ok === true,
    status: result.ok === true ? "synced" : "write-failed",
    reason: result.ok === true ? "shared planning state synchronized" : normalizeScalar(result.error?.message) || "shared planning sync failed",
    operation: "upsertPlanningState",
    registration,
    backend: registration.backend,
    result,
  };
}

export async function appendSharedHandoffRelay(resolution, {
  workspace = null,
  packet = {},
  outputFile = "",
  packetSha256 = "",
} = {}) {
  const effectiveWorkspace = workspace ?? resolution?.workspace ?? null;
  const registration = await syncSharedWorkspaceRegistration(resolution, {
    workspace: effectiveWorkspace,
  });
  if (!registration.ok) {
    return {
      attempted: registration.attempted,
      ok: false,
      status: registration.status,
      reason: registration.reason,
      operation: "appendHandoffRelay",
      backend: registration.backend,
    };
  }

  const relayId = buildSyntheticId("handoff", effectiveWorkspace, packet?.updated_at);
  const result = await resolution.store.appendHandoffRelay({
    workspaceId: effectiveWorkspace?.workspace_id,
    relayId,
    sessionId: packet?.active_session,
    cycleId: packet?.active_cycle,
    scopeType: packet?.scope_type,
    scopeId: packet?.scope_id,
    sourceWorktreeId: effectiveWorkspace?.worktree_id,
    handoffStatus: packet?.handoff_status,
    fromAgentRole: packet?.handoff_from_agent_role,
    fromAgentAction: packet?.handoff_from_agent_action,
    recommendedNextAgentRole: packet?.recommended_next_agent_role,
    recommendedNextAgentAction: packet?.recommended_next_agent_action,
    handoffPacketRef: outputFile,
    handoffPacketSha256: packetSha256,
    prioritizedArtifacts: Array.isArray(packet?.prioritized_artifacts) ? packet.prioritized_artifacts : [],
    metadata: packet,
  });
  return {
    attempted: true,
    ok: result.ok === true,
    status: result.ok === true ? "synced" : "write-failed",
    reason: result.ok === true ? "shared handoff relay synchronized" : normalizeScalar(result.error?.message) || "shared handoff sync failed",
    operation: "appendHandoffRelay",
    registration,
    backend: registration.backend,
    result,
  };
}

export async function appendSharedCoordinationRecord(resolution, {
  workspace = null,
  recordType = "",
  status = "",
  payload = {},
  sessionId = "",
  cycleId = "",
  scopeType = "none",
  scopeId = "none",
  actorRole = "",
  actorAction = "",
  coordinationLogRef = "",
  coordinationSummaryRef = "",
  recordId = "",
} = {}) {
  const effectiveWorkspace = workspace ?? resolution?.workspace ?? null;
  const registration = await syncSharedWorkspaceRegistration(resolution, {
    workspace: effectiveWorkspace,
  });
  if (!registration.ok) {
    return {
      attempted: registration.attempted,
      ok: false,
      status: registration.status,
      reason: registration.reason,
      operation: "appendCoordinationRecord",
      backend: registration.backend,
    };
  }

  const resolvedRecordId = normalizeScalar(recordId) || buildSyntheticId(
    normalizeScalar(recordType) || "coordination",
    effectiveWorkspace,
    normalizeScalar(payload?.ts) || new Date().toISOString(),
  );
  const result = await resolution.store.appendCoordinationRecord({
    workspaceId: effectiveWorkspace?.workspace_id,
    recordId: resolvedRecordId,
    recordType,
    sessionId,
    cycleId,
    scopeType,
    scopeId,
    sourceWorktreeId: effectiveWorkspace?.worktree_id,
    actorRole,
    actorAction,
    status,
    coordinationLogRef,
    coordinationSummaryRef,
    payload,
  });
  return {
    attempted: true,
    ok: result.ok === true,
    status: result.ok === true ? "synced" : "write-failed",
    reason: result.ok === true ? "shared coordination record synchronized" : normalizeScalar(result.error?.message) || "shared coordination sync failed",
    operation: "appendCoordinationRecord",
    registration,
    backend: registration.backend,
    result,
  };
}

export async function readSharedPlanningState(resolution, {
  workspace = null,
  planningKey = "",
  sessionId = "",
} = {}) {
  const effectiveWorkspace = workspace ?? resolution?.workspace ?? null;
  if (!resolution?.store) {
    return {
      attempted: false,
      ok: false,
      status: normalizeScalar(resolution?.status) || "disabled",
      reason: normalizeScalar(resolution?.reason) || "shared coordination backend is not available",
      operation: "getPlanningState",
      backend: summarizeSharedCoordinationResolution(resolution),
      result: null,
      planning_state: null,
    };
  }

  const registration = await syncSharedWorkspaceRegistration(resolution, {
    workspace: effectiveWorkspace,
  });
  if (!registration.ok) {
    return {
      attempted: registration.attempted,
      ok: false,
      status: registration.status,
      reason: registration.reason,
      operation: "getPlanningState",
      backend: registration.backend,
      registration,
      result: null,
      planning_state: null,
    };
  }

  const resolvedPlanningKey = normalizeScalar(planningKey) || `session:${normalizeScalar(sessionId) || "none"}`;
  const result = await resolution.store.getPlanningState({
    workspaceId: effectiveWorkspace?.workspace_id,
    planningKey: resolvedPlanningKey,
  });
  return {
    attempted: true,
    ok: result.ok === true,
    status: result.ok === true ? (result.planning_state ? "found" : "empty") : "read-failed",
    reason: result.ok === true
      ? (result.planning_state ? "shared planning state loaded" : "no shared planning state found")
      : (normalizeScalar(result.error?.message) || "shared planning read failed"),
    operation: "getPlanningState",
    backend: registration.backend,
    registration,
    result,
    planning_state: result.planning_state ?? null,
  };
}

export async function readLatestSharedHandoffRelay(resolution, {
  workspace = null,
  sessionId = "",
  scopeType = "",
  scopeId = "",
} = {}) {
  const effectiveWorkspace = workspace ?? resolution?.workspace ?? null;
  if (!resolution?.store) {
    return {
      attempted: false,
      ok: false,
      status: normalizeScalar(resolution?.status) || "disabled",
      reason: normalizeScalar(resolution?.reason) || "shared coordination backend is not available",
      operation: "getLatestHandoffRelay",
      backend: summarizeSharedCoordinationResolution(resolution),
      result: null,
      handoff_relay: null,
    };
  }

  const registration = await syncSharedWorkspaceRegistration(resolution, {
    workspace: effectiveWorkspace,
  });
  if (!registration.ok) {
    return {
      attempted: registration.attempted,
      ok: false,
      status: registration.status,
      reason: registration.reason,
      operation: "getLatestHandoffRelay",
      backend: registration.backend,
      registration,
      result: null,
      handoff_relay: null,
    };
  }

  const result = await resolution.store.getLatestHandoffRelay({
    workspaceId: effectiveWorkspace?.workspace_id,
    sessionId,
    scopeType,
    scopeId,
  });
  return {
    attempted: true,
    ok: result.ok === true,
    status: result.ok === true ? (result.handoff_relay ? "found" : "empty") : "read-failed",
    reason: result.ok === true
      ? (result.handoff_relay ? "shared handoff relay loaded" : "no shared handoff relay found")
      : (normalizeScalar(result.error?.message) || "shared handoff read failed"),
    operation: "getLatestHandoffRelay",
    backend: registration.backend,
    registration,
    result,
    handoff_relay: result.handoff_relay ?? null,
  };
}

export async function readSharedCoordinationRecords(resolution, {
  workspace = null,
  recordType = "",
  sessionId = "",
  scopeType = "",
  scopeId = "",
  limit = 20,
} = {}) {
  const effectiveWorkspace = workspace ?? resolution?.workspace ?? null;
  if (!resolution?.store) {
    return {
      attempted: false,
      ok: false,
      status: normalizeScalar(resolution?.status) || "disabled",
      reason: normalizeScalar(resolution?.reason) || "shared coordination backend is not available",
      operation: "listCoordinationRecords",
      backend: summarizeSharedCoordinationResolution(resolution),
      result: null,
      records: [],
    };
  }

  const registration = await syncSharedWorkspaceRegistration(resolution, {
    workspace: effectiveWorkspace,
  });
  if (!registration.ok) {
    return {
      attempted: registration.attempted,
      ok: false,
      status: registration.status,
      reason: registration.reason,
      operation: "listCoordinationRecords",
      backend: registration.backend,
      registration,
      result: null,
      records: [],
    };
  }

  const result = await resolution.store.listCoordinationRecords({
    workspaceId: effectiveWorkspace?.workspace_id,
    recordType,
    sessionId,
    scopeType,
    scopeId,
    limit,
  });
  return {
    attempted: true,
    ok: result.ok === true,
    status: result.ok === true ? (Array.isArray(result.records) && result.records.length > 0 ? "found" : "empty") : "read-failed",
    reason: result.ok === true
      ? (Array.isArray(result.records) && result.records.length > 0 ? "shared coordination records loaded" : "no shared coordination records found")
      : (normalizeScalar(result.error?.message) || "shared coordination records read failed"),
    operation: "listCoordinationRecords",
    backend: registration.backend,
    registration,
    result,
    records: Array.isArray(result.records) ? result.records : [],
  };
}
