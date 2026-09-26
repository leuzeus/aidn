import path from "node:path";
import {
  createRuntimeCanonicalSnapshotReader,
  resolveEffectiveRuntimePersistence,
} from "./runtime-persistence-service.mjs";
import {
  canonicalNone,
  canonicalUnknown,
  normalizeScalar,
  parseSimpleMap,
  parseSessionMetadata,
} from "../../lib/workflow/session-context-lib.mjs";
import { findUniqueAuditArtifact, resolveRuntimeHeadArtifact } from "./runtime-head-resolution-service.mjs";

const CLOSED_CYCLE_STATES = new Set(["DONE", "CLOSED", "CANCELLED", "CANCELED", "ABANDONED", "ARCHIVED"]);
const CLOSED_SESSION_STATES = new Set(["DONE", "CLOSED", "ENDED", "ABANDONED", "ARCHIVED"]);
const WORK_MODES = new Set(["THINKING", "EXPLORING", "COMMITTING"]);

function isUsableRef(value) {
  const normalized = normalizeScalar(value);
  return Boolean(normalized) && !canonicalNone(normalized) && !canonicalUnknown(normalized);
}

function isOpenCycle(cycle) {
  const state = normalizeScalar(cycle?.state || "UNKNOWN").toUpperCase();
  return Boolean(cycle) && !CLOSED_CYCLE_STATES.has(state);
}

function isOpenSession(session) {
  const state = normalizeScalar(session?.state || "UNKNOWN").toUpperCase();
  return Boolean(session) && !CLOSED_SESSION_STATES.has(state) && !normalizeScalar(session?.ended_at);
}

function decodeArtifactContent(artifact) {
  if (typeof artifact?.content !== "string") {
    return "";
  }
  const format = normalizeScalar(artifact?.content_format || "utf8").toLowerCase();
  return format === "base64"
    ? Buffer.from(artifact.content, "base64").toString("utf8")
    : artifact.content;
}

function normalizeArtifactPath(value) {
  return normalizeScalar(value)
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^docs\/audit\//i, "");
}

function findCurrentStateArtifact(payload, runtimeHeads) {
  return resolveRuntimeHeadArtifact(runtimeHeads, "current_state", payload)
    ?? findUniqueAuditArtifact(payload, "CURRENT-STATE.md");
}

// Relational session.state historically stores the work mode. Lifecycle, PR
// closure and multi-cycle ownership must come from the canonical artifact when
// it exists, never from an old visible projection or invented row defaults.
function withCanonicalArtifactMetadata(payload) {
  const result = { ...payload };
  for (const [table, idField, pattern] of [
    ["sessions", "session_id", /^sessions\/(S\d+)(?:[-_.][^/]*)?\.md$/i],
    ["cycles", "cycle_id", /^cycles\/(C\d+)[^/]*\/status\.md$/i],
  ]) {
    const artifacts = new Map();
    for (const artifact of payload.artifacts ?? []) {
      const match = normalizeArtifactPath(artifact.path).match(pattern);
      if (!match) continue;
      const id = match[1].toUpperCase();
      if (artifacts.has(id)) throw new Error("RUNTIME_CONTINUITY_ARTIFACT_AMBIGUOUS");
      artifacts.set(id, artifact);
    }
    const rows = new Map();
    for (const row of payload[table] ?? []) {
      const id = normalizeScalar(row[idField]).toUpperCase();
      if (rows.has(id)) throw new Error("RUNTIME_CONTINUITY_ENTITY_AMBIGUOUS");
      rows.set(id, row);
    }
    for (const [id, artifact] of artifacts) {
      const text = decodeArtifactContent(artifact);
      if (!text.trim()) throw new Error("RUNTIME_CONTINUITY_ARTIFACT_EMPTY");
      const map = parseSimpleMap(text);
      const row = rows.get(id) ?? { [idField]: id };
      const declaredId = normalizeScalar(map.get(idField)).toUpperCase();
      const artifactId = normalizeScalar(artifact[idField]).toUpperCase();
      const metadata = table === "sessions" ? parseSessionMetadata(text) : null;
      const branch = metadata?.session_branch ?? map.get("branch_name");
      if ((declaredId && declaredId !== id) || (artifactId && artifactId !== id)
          || (row.source_artifact_path && normalizeArtifactPath(row.source_artifact_path) !== normalizeArtifactPath(artifact.path))
          || (row.branch_name && branch && row.branch_name !== branch)) {
        throw new Error("RUNTIME_CONTINUITY_ARTIFACT_IDENTITY_MISMATCH");
      }
      rows.set(id, { ...row, state: map.get("state") || row.state,
        branch_name: branch || row.branch_name,
        ...(table === "cycles" ? { session_id: map.get("session_owner") || row.session_id } : {}),
        source_artifact_path: artifact.path, artifact_text: text, artifact_map: map,
        ...(metadata ? { artifact_metadata: metadata } : {}),
      });
    }
    result[table] = [...rows.values()];
  }
  return result;
}

function findById(items, idField, value) {
  const normalized = normalizeScalar(value).toUpperCase();
  if (!normalized) {
    return null;
  }
  return items.find((item) => normalizeScalar(item?.[idField]).toUpperCase() === normalized) ?? null;
}

function summarizeIds(items, idField) {
  const ids = items
    .map((item) => normalizeScalar(item?.[idField]).toUpperCase())
    .filter(Boolean);
  const preview = ids.slice(0, 5).join(", ");
  return ids.length > 5 ? `${preview}, ... (${ids.length} total)` : preview;
}

function inferActiveRows(payload, currentMap) {
  const cycles = Array.isArray(payload?.cycles) ? payload.cycles : [];
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const openCycles = cycles.filter(isOpenCycle);
  const openSessions = sessions.filter(isOpenSession);
  const ambiguities = [];
  const declaredCycleRef = isUsableRef(currentMap.get("active_cycle"))
    ? normalizeScalar(currentMap.get("active_cycle")).toUpperCase()
    : "";
  const declaredCycle = declaredCycleRef
    ? findById(cycles, "cycle_id", declaredCycleRef)
    : null;
  let activeCycle = null;
  if (declaredCycleRef) {
    if (!declaredCycle) {
      ambiguities.push(`declared active cycle ${declaredCycleRef} is missing from canonical runtime rows`);
    } else if (!isOpenCycle(declaredCycle)) {
      ambiguities.push(`declared active cycle ${declaredCycleRef} is closed in canonical runtime rows`);
    } else {
      activeCycle = declaredCycle;
    }
  } else if (openCycles.length === 1) {
    activeCycle = openCycles[0];
  } else if (openCycles.length > 1) {
    const integrationTargetIds = new Set(
      sessions
        .map((session) => normalizeScalar(session?.integration_target_cycle).toUpperCase())
        .filter(Boolean),
    );
    const targetedOpenCycles = openCycles.filter((cycle) => integrationTargetIds.has(normalizeScalar(cycle?.cycle_id).toUpperCase()));
    if (targetedOpenCycles.length === 1) {
      activeCycle = targetedOpenCycles[0];
    } else {
      ambiguities.push(`multiple open canonical cycles require arbitration: ${summarizeIds(openCycles, "cycle_id")}`);
    }
  }

  const declaredSessionRef = isUsableRef(currentMap.get("active_session"))
    ? normalizeScalar(currentMap.get("active_session")).toUpperCase()
    : "";
  const declaredSession = declaredSessionRef
    ? findById(sessions, "session_id", declaredSessionRef)
    : null;
  const cycleSession = activeCycle?.session_id
    ? findById(sessions, "session_id", activeCycle.session_id)
    : null;
  let activeSession = null;
  if (declaredSessionRef) {
    if (!declaredSession) {
      ambiguities.push(`declared active session ${declaredSessionRef} is missing from canonical runtime rows`);
    } else if (!isOpenSession(declaredSession)) {
      ambiguities.push(`declared active session ${declaredSessionRef} is closed in canonical runtime rows`);
    } else {
      activeSession = declaredSession;
    }
  }
  if (!activeSession && activeCycle?.session_id) {
    if (!cycleSession) {
      ambiguities.push(`active cycle ${normalizeScalar(activeCycle.cycle_id).toUpperCase()} references missing session ${normalizeScalar(activeCycle.session_id).toUpperCase()}`);
    } else if (!isOpenSession(cycleSession)) {
      ambiguities.push(`active cycle ${normalizeScalar(activeCycle.cycle_id).toUpperCase()} references closed session ${normalizeScalar(activeCycle.session_id).toUpperCase()}`);
    } else {
      activeSession = cycleSession;
    }
  }
  if (!activeSession && !declaredSessionRef && !activeCycle?.session_id) {
    if (openSessions.length === 1) {
      activeSession = openSessions[0];
    } else if (openSessions.length > 1) {
      ambiguities.push(`multiple open canonical sessions require arbitration: ${summarizeIds(openSessions, "session_id")}`);
    }
  }
  return {
    activeCycle,
    activeSession,
    ambiguities,
  };
}

function preserveMapValue(currentMap, key, fallback) {
  const value = normalizeScalar(currentMap.get(key));
  return value || fallback;
}

function resolveMode(currentMap, activeCycle, activeSession) {
  const declared = preserveMapValue(currentMap, "mode", "").toUpperCase();
  if (WORK_MODES.has(declared)) {
    return declared;
  }
  const sessionState = normalizeScalar(activeSession?.artifact_metadata?.mode || activeSession?.state).toUpperCase();
  if (WORK_MODES.has(sessionState)) {
    return sessionState;
  }
  return activeCycle ? "COMMITTING" : "unknown";
}

function buildCanonicalCurrentState({
  visibleCurrentState,
  payload,
  runtimeHeads,
} = {}) {
  const currentArtifact = findCurrentStateArtifact(payload, runtimeHeads);
  const text = decodeArtifactContent(currentArtifact);
  const map = parseSimpleMap(text);
  const { activeCycle, activeSession, ambiguities } = inferActiveRows(payload, map);
  const activeCycleId = normalizeScalar(activeCycle?.cycle_id) || "none";
  const activeSessionId = normalizeScalar(activeSession?.session_id) || "none";
  return {
    current_state: {
      audit_root: visibleCurrentState.audit_root,
      file_path: visibleCurrentState.file_path,
      text,
      map,
      active_session: activeSessionId,
      session_branch: normalizeScalar(activeSession?.branch_name)
        || preserveMapValue(map, "session_branch", "none"),
      branch_kind: activeCycle
        ? "cycle"
        : normalizeScalar(activeSession?.branch_kind)
          || preserveMapValue(map, "branch_kind", "unknown"),
      mode: resolveMode(map, activeCycle, activeSession),
      active_cycle: activeCycleId,
      cycle_branch: normalizeScalar(activeCycle?.branch_name)
        || normalizeScalar(activeSession?.cycle_branch)
        || preserveMapValue(map, "cycle_branch", "none"),
      session_pr_status: preserveMapValue(map, "session_pr_status", "none"),
      session_pr_review_status: preserveMapValue(map, "session_pr_review_status", "unknown"),
      post_merge_sync_status: preserveMapValue(map, "post_merge_sync_status", "not_needed"),
      dor_state: normalizeScalar(activeCycle?.dor_state)
        || preserveMapValue(map, "dor_state", "unknown"),
      first_plan_step: preserveMapValue(map, "first_plan_step", "unknown"),
      active_backlog: preserveMapValue(map, "active_backlog", "none"),
      backlog_status: preserveMapValue(map, "backlog_status", "unknown"),
      backlog_next_step: preserveMapValue(map, "backlog_next_step", "unknown"),
      backlog_selected_execution_scope: preserveMapValue(map, "backlog_selected_execution_scope", "none"),
      planning_arbitration_status: preserveMapValue(map, "planning_arbitration_status", "none"),
    },
    ambiguities,
  };
}

function buildCanonicalSessions(payload, auditRoot) {
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const cycles = Array.isArray(payload?.cycles) ? payload.cycles : [];
  return sessions.map((session) => {
    const sessionId = normalizeScalar(session?.session_id).toUpperCase();
    const attachedCycles = cycles
      .filter((cycle) => normalizeScalar(cycle?.session_id).toUpperCase() === sessionId)
      .map((cycle) => normalizeScalar(cycle?.cycle_id).toUpperCase())
      .filter(Boolean);
    const integrationTarget = normalizeScalar(session?.integration_target_cycle).toUpperCase();
    return {
      session_id: sessionId,
      file_path: path.resolve(auditRoot, normalizeArtifactPath(session?.source_artifact_path || `sessions/${sessionId}.md`)),
      metadata: {
        mode: normalizeScalar(session?.state).toUpperCase() || null,
        session_branch: normalizeScalar(session?.branch_name) || null,
        parent_session: normalizeScalar(session?.parent_session) || null,
        branch_kind: normalizeScalar(session?.branch_kind) || "session",
        cycle_branch: normalizeScalar(session?.cycle_branch) || null,
        intermediate_branch: normalizeScalar(session?.intermediate_branch) || null,
        integration_target_cycle: integrationTarget || null,
        integration_target_cycles: integrationTarget ? [integrationTarget] : [],
        primary_focus_cycle: integrationTarget || null,
        attached_cycles: attachedCycles,
        reported_from_previous_session: [],
        carry_over_pending: normalizeScalar(session?.carry_over_pending) || null,
        pr_status: "none",
        pr_review_status: "unknown",
        post_merge_sync_status: "not_needed",
        ...session.artifact_metadata,
      },
    };
  }).sort((left, right) => left.session_id.localeCompare(right.session_id, undefined, {
    numeric: true,
    sensitivity: "base",
  }));
}

function buildCanonicalCycles(payload, auditRoot) {
  const cycles = Array.isArray(payload?.cycles) ? payload.cycles : [];
  return cycles.map((cycle) => {
    const cycleId = normalizeScalar(cycle?.cycle_id).toUpperCase();
    const artifactPath = normalizeArtifactPath(cycle.source_artifact_path || `cycles/${cycleId}-runtime/status.md`);
    const map = cycle.artifact_map ?? new Map();
    return {
      cycle_id: cycleId,
      cycle_dir: artifactPath.split("/")[1],
      file_path: path.resolve(auditRoot, artifactPath),
      text: cycle.artifact_text ?? "",
      state: normalizeScalar(cycle?.state).toUpperCase() || "UNKNOWN",
      branch_name: normalizeScalar(cycle?.branch_name) || "none",
      session_owner: normalizeScalar(cycle?.session_id).toUpperCase() || "none",
      outcome: normalizeScalar(cycle?.outcome) || "unknown",
      dor_state: normalizeScalar(cycle?.dor_state) || "unknown",
      usage_matrix_scope: "local",
      usage_matrix_state: "NOT_DEFINED",
      usage_matrix_summary: "none",
      usage_matrix_rationale: "none",
      continuity_rule: normalizeScalar(cycle?.continuity_rule) || "none",
      continuity_base_branch: normalizeScalar(cycle?.continuity_base_branch) || "none",
      continuity_latest_cycle_branch: normalizeScalar(cycle?.continuity_latest_cycle_branch) || "none",
      ...Object.fromEntries(["branch_name", "outcome", "dor_state", "usage_matrix_scope", "usage_matrix_state",
        "usage_matrix_summary", "usage_matrix_rationale", "continuity_rule", "continuity_base_branch",
        "continuity_latest_cycle_branch", "session_owner"].filter(key => map.has(key)).map(key => [key, map.get(key)])),
    };
  }).sort((left, right) => left.cycle_id.localeCompare(right.cycle_id, undefined, {
    numeric: true,
    sensitivity: "base",
  }));
}

export async function resolveWorkflowContinuityContext({
  targetRoot,
  effectiveStateMode = "files",
  visibleCurrentState,
  visibleSessions = [],
  visibleCycles = [],
  runtimeSnapshotReaderFactory = createRuntimeCanonicalSnapshotReader,
} = {}) {
  const runtimePersistence = resolveEffectiveRuntimePersistence({
    targetRoot,
  });
  const dbBackedMode = effectiveStateMode === "dual" || effectiveStateMode === "db-only";
  const canonicalRequired = effectiveStateMode === "db-only" || runtimePersistence.backend === "postgres";
  const visible = {
    current_state: visibleCurrentState,
    sessions: visibleSessions,
    cycles: visibleCycles,
    source: "visible-files",
    backend_kind: "files",
    canonical_available: false,
    canonical_required: canonicalRequired,
    canonical_continuity_status: "visible-files",
    canonical_continuity_ambiguities: [],
    warning: "",
  };
  if (!dbBackedMode && runtimePersistence.backend !== "postgres") {
    return visible;
  }

  const reader = runtimeSnapshotReaderFactory({
    targetRoot,
    backend: runtimePersistence.backend,
    connectionRef: runtimePersistence.connectionRef ?? "",
  });
  const backend = reader.describeBackend();
  const backendKind = normalizeScalar(backend?.backend_kind || runtimePersistence.backend || "unknown").toLowerCase();
  const snapshot = await reader.readCanonicalSnapshot({
    includePayload: true,
    includeRuntimeHeads: true,
  });
  if (!snapshot?.exists || !snapshot?.payload) {
    return {
      ...visible,
      source: "visible-files-fallback",
      backend_kind: backendKind,
      canonical_continuity_status: "unavailable",
      warning: normalizeScalar(snapshot?.warning) || `canonical ${backendKind} runtime snapshot is unavailable`,
    };
  }

  const payload = withCanonicalArtifactMetadata(snapshot.payload);
  const canonicalState = buildCanonicalCurrentState({
    visibleCurrentState,
    payload,
    runtimeHeads: snapshot.runtimeHeads,
  });
  const hasActiveContext = isUsableRef(canonicalState.current_state.active_session)
    || isUsableRef(canonicalState.current_state.active_cycle);
  return {
    current_state: canonicalState.current_state,
    sessions: buildCanonicalSessions(payload, visibleCurrentState.audit_root),
    cycles: buildCanonicalCycles(payload, visibleCurrentState.audit_root),
    source: `runtime-canonical-${backendKind}`,
    backend_kind: backendKind,
    canonical_available: true,
    canonical_required: canonicalRequired,
    canonical_continuity_status: canonicalState.ambiguities.length > 0
      ? "ambiguous"
      : (hasActiveContext ? "resolved" : "empty"),
    canonical_continuity_ambiguities: canonicalState.ambiguities,
    warning: normalizeScalar(snapshot.warning),
    snapshot,
  };
}
