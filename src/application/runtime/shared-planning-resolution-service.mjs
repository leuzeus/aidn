import path from "node:path";
import {
  readSharedPlanningState,
  resolveSharedCoordinationStore,
} from "./shared-coordination-store-service.mjs";
import { resolveWorkspaceContext } from "./workspace-resolution-service.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function canonicalNone(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return normalized === "none" || normalized === "(none)";
}

function canonicalUnknown(value) {
  return normalizeScalar(value).toLowerCase() === "unknown";
}

function pickScalar(values, {
  allowNone = false,
  allowUnknown = false,
} = {}) {
  for (const value of values) {
    const normalized = normalizeScalar(value);
    if (!normalized) {
      continue;
    }
    if (!allowNone && canonicalNone(normalized)) {
      continue;
    }
    if (!allowUnknown && canonicalUnknown(normalized)) {
      continue;
    }
    return normalized;
  }
  return "";
}

function buildFallback(currentState) {
  return {
    active_backlog: normalizeScalar(currentState?.active_backlog) || "none",
    backlog_status: normalizeScalar(currentState?.backlog_status) || "unknown",
    backlog_next_step: normalizeScalar(currentState?.backlog_next_step) || "unknown",
    backlog_selected_execution_scope: normalizeScalar(currentState?.backlog_selected_execution_scope) || "none",
    planning_arbitration_status: normalizeScalar(currentState?.planning_arbitration_status) || "none",
    dispatch_ready: false,
    next_dispatch_scope: "none",
    next_dispatch_action: "none",
    shared_planning_source: "current-state",
    shared_planning_read_status: "not_attempted",
    shared_planning_read_reason: "shared planning resolution was not attempted",
  };
}

export async function resolvePromotedSharedPlanningContext({
  targetRoot = ".",
  workspace = null,
  currentState = {},
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const effectiveWorkspace = workspace ?? resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const fallback = buildFallback(currentState);
  const activeSession = normalizeScalar(currentState?.active_session) || "none";

  if (!activeSession || canonicalNone(activeSession) || canonicalUnknown(activeSession)) {
    return {
      ...fallback,
      shared_planning_read_status: "not_applicable",
      shared_planning_read_reason: "no active session is declared",
    };
  }

  const sharedCoordinationResolution = sharedCoordination ?? await resolveSharedCoordinationStore({
    targetRoot: absoluteTargetRoot,
    workspace: effectiveWorkspace,
    ...sharedCoordinationOptions,
  });
  const planningRead = await readSharedPlanningState(sharedCoordinationResolution, {
    workspace: effectiveWorkspace,
    sessionId: activeSession,
    planningKey: `session:${activeSession}`,
  });
  const planningState = planningRead?.planning_state ?? null;
  if (!(planningRead?.ok === true && planningState)) {
    return {
      ...fallback,
      shared_planning_read_status: normalizeScalar(planningRead?.status) || "empty",
      shared_planning_read_reason: normalizeScalar(planningRead?.reason) || "no shared planning state found",
    };
  }

  const payload = planningState.payload && typeof planningState.payload === "object"
    ? planningState.payload
    : {};
  return {
    active_backlog: pickScalar(
      [planningState.backlog_artifact_ref, payload.backlog_artifact_ref, fallback.active_backlog],
      { allowNone: false, allowUnknown: false },
    ) || fallback.active_backlog,
    backlog_status: pickScalar(
      [planningState.planning_status, payload.planning_status, fallback.backlog_status],
      { allowNone: false, allowUnknown: false },
    ) || fallback.backlog_status,
    backlog_next_step: pickScalar(
      [planningState.backlog_next_step, payload.backlog_next_step, fallback.backlog_next_step],
      { allowNone: false, allowUnknown: false },
    ) || fallback.backlog_next_step,
    backlog_selected_execution_scope: pickScalar(
      [planningState.selected_execution_scope, payload.selected_execution_scope, fallback.backlog_selected_execution_scope],
      { allowNone: false, allowUnknown: false },
    ) || fallback.backlog_selected_execution_scope,
    planning_arbitration_status: pickScalar(
      [planningState.planning_arbitration_status, payload.planning_arbitration_status, fallback.planning_arbitration_status],
      { allowNone: false, allowUnknown: false },
    ) || fallback.planning_arbitration_status,
    dispatch_ready: planningState.dispatch_ready === true,
    next_dispatch_scope: pickScalar(
      [planningState.next_dispatch_scope, payload.next_dispatch_scope],
      { allowNone: false, allowUnknown: false },
    ) || "none",
    next_dispatch_action: pickScalar(
      [planningState.next_dispatch_action, payload.next_dispatch_action],
      { allowNone: false, allowUnknown: false },
    ) || "none",
    shared_planning_source: "shared-coordination",
    shared_planning_read_status: normalizeScalar(planningRead.status) || "found",
    shared_planning_read_reason: normalizeScalar(planningRead.reason) || "shared planning state loaded",
    planning_state: planningState,
  };
}
