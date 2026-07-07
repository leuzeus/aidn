import crypto from "node:crypto";
import path from "node:path";
import { buildCanonicalFromMarkdown } from "../../lib/workflow/markdown-render-lib.mjs";
import { buildRuntimePayloadSummary } from "./runtime-relational-snapshot-rehydration-service.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function normalizeArtifactPath(value) {
  return normalizeScalar(value)
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^docs\/audit\//i, "");
}

function canonicalNone(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return !normalized || normalized === "none" || normalized === "(none)";
}

function canonicalUnknown(value) {
  return normalizeScalar(value).toLowerCase() === "unknown";
}

function isUsableRef(value) {
  return !canonicalNone(value) && !canonicalUnknown(value);
}

function parseSimpleMap(text) {
  const map = new Map();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    map.set(match[1], normalizeScalar(match[2]));
  }
  return map;
}

function parseTimestamp(value) {
  const normalized = normalizeScalar(value);
  if (!normalized) {
    return 0;
  }
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function decodeArtifactContent(artifact) {
  if (!artifact || typeof artifact.content !== "string") {
    return "";
  }
  const format = normalizeScalar(artifact.content_format || "utf8").toLowerCase();
  if (format === "base64") {
    return Buffer.from(artifact.content, "base64").toString("utf8");
  }
  return artifact.content;
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function findArtifact(payload, artifactPath) {
  const normalized = normalizeArtifactPath(artifactPath);
  if (!normalized || !Array.isArray(payload?.artifacts)) {
    return null;
  }
  return payload.artifacts.find((artifact) => normalizeArtifactPath(artifact?.path) === normalized) ?? null;
}

function findRuntimeHead(snapshot, headKey) {
  const runtimeHeads = snapshot?.runtimeHeads && typeof snapshot.runtimeHeads === "object"
    ? snapshot.runtimeHeads
    : {};
  return runtimeHeads[headKey] ?? null;
}

function findArtifactByRuntimeHead(snapshot, payload, headKey, fallbackPath) {
  const head = findRuntimeHead(snapshot, headKey);
  const headPath = normalizeArtifactPath(head?.artifact_path);
  return findArtifact(payload, headPath || fallbackPath);
}

function latestByUpdatedAt(items = [], idField = "") {
  return [...items]
    .filter(Boolean)
    .sort((left, right) => {
      const byTime = parseTimestamp(right?.updated_at) - parseTimestamp(left?.updated_at);
      if (byTime !== 0) {
        return byTime;
      }
      return normalizeScalar(right?.[idField]).localeCompare(normalizeScalar(left?.[idField]));
    })[0] ?? null;
}

const CLOSED_CYCLE_STATES = new Set(["DONE", "CLOSED", "CANCELLED", "CANCELED", "ABANDONED", "ARCHIVED"]);
const CLOSED_SESSION_STATES = new Set(["DONE", "CLOSED", "ENDED", "ABANDONED", "ARCHIVED"]);

function findCycle(payload, cycleId) {
  const normalized = normalizeScalar(cycleId).toUpperCase();
  if (!normalized || !Array.isArray(payload?.cycles)) {
    return null;
  }
  return payload.cycles.find((cycle) => normalizeScalar(cycle?.cycle_id).toUpperCase() === normalized) ?? null;
}

function findSession(payload, sessionId) {
  const normalized = normalizeScalar(sessionId).toUpperCase();
  if (!normalized || !Array.isArray(payload?.sessions)) {
    return null;
  }
  return payload.sessions.find((session) => normalizeScalar(session?.session_id).toUpperCase() === normalized) ?? null;
}

function isOpenCycle(cycle) {
  const state = normalizeScalar(cycle?.state || "UNKNOWN").toUpperCase();
  return Boolean(cycle) && !CLOSED_CYCLE_STATES.has(state);
}

function isOpenSession(session) {
  const state = normalizeScalar(session?.state || "UNKNOWN").toUpperCase();
  return Boolean(session) && !CLOSED_SESSION_STATES.has(state) && !normalizeScalar(session?.ended_at);
}

function inferActiveCycle(payload, currentMap) {
  const currentCycleId = normalizeScalar(currentMap.get("active_cycle"));
  const currentCycle = isUsableRef(currentCycleId) ? findCycle(payload, currentCycleId) : null;
  if (isOpenCycle(currentCycle)) {
    return {
      cycle: currentCycle,
      source: "current-state-valid-open-cycle",
      confidence: "high",
    };
  }
  const openCycle = latestByUpdatedAt(
    Array.isArray(payload?.cycles) ? payload.cycles.filter(isOpenCycle) : [],
    "cycle_id",
  );
  if (openCycle) {
    return {
      cycle: openCycle,
      source: "latest-open-cycle",
      confidence: "medium",
    };
  }
  const latestCycle = latestByUpdatedAt(Array.isArray(payload?.cycles) ? payload.cycles : [], "cycle_id");
  if (latestCycle) {
    return {
      cycle: latestCycle,
      source: "latest-cycle-closed-or-unknown",
      confidence: "low",
    };
  }
  return {
    cycle: null,
    source: "missing-cycle-evidence",
    confidence: "blocked",
  };
}

function findLinkedSessionForCycle(payload, cycleId) {
  const normalizedCycleId = normalizeScalar(cycleId).toUpperCase();
  if (!normalizedCycleId || !Array.isArray(payload?.session_cycle_links)) {
    return null;
  }
  const link = latestByUpdatedAt(
    payload.session_cycle_links.filter((candidate) =>
      normalizeScalar(candidate?.cycle_id).toUpperCase() === normalizedCycleId),
    "session_id",
  );
  return link?.session_id ? findSession(payload, link.session_id) : null;
}

function inferActiveSession(payload, currentMap, activeCycle) {
  const currentSessionId = normalizeScalar(currentMap.get("active_session"));
  const currentSession = isUsableRef(currentSessionId) ? findSession(payload, currentSessionId) : null;
  if (isOpenSession(currentSession)) {
    return {
      session: currentSession,
      source: "current-state-valid-open-session",
      confidence: "high",
    };
  }
  const cycleSessionId = normalizeScalar(activeCycle?.session_id);
  const cycleSession = isUsableRef(cycleSessionId) ? findSession(payload, cycleSessionId) : null;
  if (cycleSession) {
    return {
      session: cycleSession,
      source: "active-cycle-session-owner",
      confidence: isOpenSession(cycleSession) ? "high" : "medium",
    };
  }
  const linkedSession = findLinkedSessionForCycle(payload, activeCycle?.cycle_id);
  if (linkedSession) {
    return {
      session: linkedSession,
      source: "session-cycle-link",
      confidence: isOpenSession(linkedSession) ? "medium" : "low",
    };
  }
  const openSession = latestByUpdatedAt(
    Array.isArray(payload?.sessions) ? payload.sessions.filter(isOpenSession) : [],
    "session_id",
  );
  if (openSession) {
    return {
      session: openSession,
      source: "latest-open-session",
      confidence: "medium",
    };
  }
  const latestSession = latestByUpdatedAt(Array.isArray(payload?.sessions) ? payload.sessions : [], "session_id");
  if (latestSession) {
    return {
      session: latestSession,
      source: "latest-session-closed-or-unknown",
      confidence: "low",
    };
  }
  return {
    session: null,
    source: "missing-session-evidence",
    confidence: "blocked",
  };
}

function confidenceRank(value) {
  switch (normalizeScalar(value).toLowerCase()) {
    case "high": return 3;
    case "medium": return 2;
    case "low": return 1;
    default: return 0;
  }
}

function mergeConfidence(left, right) {
  return confidenceRank(left) <= confidenceRank(right) ? left : right;
}

function preserveCurrentValue(currentMap, key, fallback = "unknown") {
  const value = normalizeScalar(currentMap.get(key));
  return value || fallback;
}

function resolveMode(currentMap, cycle) {
  const current = preserveCurrentValue(currentMap, "mode", "");
  if (isUsableRef(current)) {
    return current;
  }
  return cycle ? "COMMITTING" : "THINKING";
}

function resolveRuntimeStateMode(effectiveStateMode, currentMap) {
  return normalizeScalar(effectiveStateMode)
    || preserveCurrentValue(currentMap, "runtime_state_mode", "unknown");
}

function buildReanchoredCurrentStateText({
  targetRoot,
  workspace,
  effectiveStateMode,
  currentMap,
  cycleEvidence,
  sessionEvidence,
  now,
  reason,
} = {}) {
  const cycle = cycleEvidence?.cycle ?? null;
  const session = sessionEvidence?.session ?? null;
  const activeCycle = normalizeScalar(cycle?.cycle_id) || "none";
  const activeSession = normalizeScalar(session?.session_id) || "none";
  const cycleBranch = normalizeScalar(cycle?.branch_name) || normalizeScalar(session?.cycle_branch) || "unknown";
  const sessionBranch = normalizeScalar(session?.branch_name) || "unknown";
  const confidence = mergeConfidence(cycleEvidence?.confidence, sessionEvidence?.confidence);
  const source = `${cycleEvidence?.source ?? "missing-cycle-evidence"}+${sessionEvidence?.source ?? "missing-session-evidence"}`;

  return [
    "# Current State",
    "",
    "Rule/State boundary:",
    "",
    "- This file is a state artifact.",
    "- It was regenerated by `aidn runtime state-reanchor --write` from canonical runtime evidence.",
    "- The runtime backend remains the source of truth; this visible file is a recovery anchor.",
    "",
    "## Summary",
    "",
    "contract_version: critical-markdown-v1",
    `updated_at: ${now}`,
    "source_of_truth: runtime-backend",
    "source_mode: reanchored",
    "lifecycle_status: refreshed",
    `owner: ${normalizeScalar(workspace?.project_id) || "project"}`,
    "steward: aidn",
    `project_id: ${normalizeScalar(workspace?.project_id) || "unknown"}`,
    `workspace_id: ${normalizeScalar(workspace?.workspace_id) || "unknown"}`,
    `worktree_id: ${normalizeScalar(workspace?.worktree_id) || "unknown"}`,
    `project_root: ${path.resolve(process.cwd(), targetRoot ?? ".").replace(/\\/g, "/")}`,
    `runtime_state_mode: ${resolveRuntimeStateMode(effectiveStateMode, currentMap)}`,
    `repair_layer_status: ${preserveCurrentValue(currentMap, "repair_layer_status", "unknown")}`,
    `repair_primary_reason: ${preserveCurrentValue(currentMap, "repair_primary_reason", "runtime state reanchored from canonical evidence")}`,
    "",
    "## Active Context",
    "",
    `mode: ${resolveMode(currentMap, cycle)}`,
    `branch_kind: ${preserveCurrentValue(currentMap, "branch_kind", normalizeScalar(session?.branch_kind) || "unknown")}`,
    `active_session: ${activeSession}`,
    `session_branch: ${sessionBranch}`,
    `active_cycle: ${activeCycle}`,
    `cycle_branch: ${cycleBranch}`,
    `cycle_state: ${normalizeScalar(cycle?.state) || "UNKNOWN"}`,
    `dor_state: ${normalizeScalar(cycle?.dor_state) || preserveCurrentValue(currentMap, "dor_state", "unknown")}`,
    `first_plan_step: ${preserveCurrentValue(currentMap, "first_plan_step", "unknown")}`,
    `active_backlog: ${preserveCurrentValue(currentMap, "active_backlog", "none")}`,
    `backlog_status: ${preserveCurrentValue(currentMap, "backlog_status", "unknown")}`,
    `backlog_next_step: ${preserveCurrentValue(currentMap, "backlog_next_step", "unknown")}`,
    `backlog_selected_execution_scope: ${preserveCurrentValue(currentMap, "backlog_selected_execution_scope", "none")}`,
    `planning_arbitration_status: ${preserveCurrentValue(currentMap, "planning_arbitration_status", "none")}`,
    "current_state_freshness: ok",
    "current_state_freshness_basis: CURRENT-STATE.md was reanchored from canonical runtime evidence",
    "consistency_status: reanchored",
    "",
    "## Blocking Findings",
    "",
    "blocking_findings:",
    "- none",
    "",
    "## Reanchor Metadata",
    "",
    `reanchor_status: reanchored`,
    `reanchor_reason: ${normalizeScalar(reason) || "manual runtime state repair"}`,
    `reanchor_source: ${source}`,
    `reanchor_confidence: ${confidence}`,
    "",
  ].join("\n");
}

export function buildRuntimeStateReanchorPlan({
  targetRoot = ".",
  workspace = null,
  effectiveStateMode = "unknown",
  snapshot = null,
  now = new Date().toISOString(),
  reason = "",
} = {}) {
  const payload = snapshot?.payload && typeof snapshot.payload === "object"
    ? snapshot.payload
    : null;
  const backend = snapshot?.backend ?? null;
  const backendKind = normalizeScalar(backend?.projection_backend_kind || backend?.backend_kind || snapshot?.source_backend || "unknown") || "unknown";
  const projectContext = snapshot?.project_context ?? payload?.project_context ?? null;
  const currentArtifact = payload ? findArtifactByRuntimeHead(snapshot, payload, "current_state", "CURRENT-STATE.md") : null;
  const currentText = decodeArtifactContent(currentArtifact);
  const currentMap = parseSimpleMap(currentText);

  if (!payload) {
    return {
      status: "blocked",
      reason: "canonical runtime payload is unavailable",
      confidence: "blocked",
      evidence: {
        backend: backendKind,
        current_state_source: currentArtifact ? "runtime-head" : "missing",
        active_cycle_source: "missing-payload",
        active_session_source: "missing-payload",
      },
      anchors: [],
      current_state_text: "",
      project_context: projectContext,
    };
  }

  const cycleEvidence = inferActiveCycle(payload, currentMap);
  const sessionEvidence = inferActiveSession(payload, currentMap, cycleEvidence.cycle);
  const confidence = mergeConfidence(cycleEvidence.confidence, sessionEvidence.confidence);
  const status = confidenceRank(confidence) >= 2 ? "ready" : "needs_review";
  const currentStateText = buildReanchoredCurrentStateText({
    targetRoot,
    workspace,
    effectiveStateMode,
    currentMap,
    cycleEvidence,
    sessionEvidence,
    now,
    reason,
  });
  const anchors = [
    {
      path: "docs/audit/CURRENT-STATE.md",
      artifact_path: "CURRENT-STATE.md",
      source: "runtime-reanchor",
      required: true,
      planned_action: "rewrite",
    },
    {
      path: "docs/audit/RUNTIME-STATE.md",
      artifact_path: "RUNTIME-STATE.md",
      source: "project-runtime-state",
      required: true,
      planned_action: "regenerate",
    },
    {
      path: "docs/audit/HANDOFF-PACKET.md",
      artifact_path: "HANDOFF-PACKET.md",
      source: "project-handoff-packet",
      required: true,
      planned_action: "regenerate",
    },
  ];
  return {
    status,
    reason: status === "ready"
      ? "runtime evidence is sufficient for deterministic reanchor"
      : "runtime evidence is incomplete or low confidence; review before writing",
    confidence,
    evidence: {
      backend: backendKind,
      current_state_source: currentArtifact ? "runtime-head-or-artifact" : "missing",
      current_active_cycle: normalizeScalar(currentMap.get("active_cycle")) || "none",
      current_active_session: normalizeScalar(currentMap.get("active_session")) || "none",
      active_cycle: normalizeScalar(cycleEvidence.cycle?.cycle_id) || "none",
      active_cycle_source: cycleEvidence.source,
      active_session: normalizeScalar(sessionEvidence.session?.session_id) || "none",
      active_session_source: sessionEvidence.source,
    },
    anchors,
    current_state_text: currentStateText,
    project_context: projectContext,
  };
}

function classifyAnchor(relPath) {
  const fileName = normalizeArtifactPath(relPath).split("/").pop() ?? "";
  if (fileName === "CURRENT-STATE.md") {
    return { kind: "other", family: "normative", subtype: "current_state" };
  }
  if (fileName === "RUNTIME-STATE.md") {
    return { kind: "other", family: "normative", subtype: "runtime_state" };
  }
  if (fileName === "HANDOFF-PACKET.md") {
    return { kind: "other", family: "normative", subtype: "handoff_packet" };
  }
  return { kind: "other", family: "support", subtype: "runtime_reanchor" };
}

function artifactOwnershipFromContent(text) {
  const map = parseSimpleMap(text);
  return {
    session_id: isUsableRef(map.get("active_session")) ? normalizeScalar(map.get("active_session")) : null,
    cycle_id: isUsableRef(map.get("active_cycle")) ? normalizeScalar(map.get("active_cycle")) : null,
  };
}

function buildRuntimeAnchorArtifact({ relPath, content, now, sourceMode = "reconstructed" }) {
  const normalizedPath = normalizeArtifactPath(relPath);
  const classification = classifyAnchor(normalizedPath);
  const canonical = buildCanonicalFromMarkdown(content, {
    relativePath: normalizedPath,
    classification,
  });
  const ownership = artifactOwnershipFromContent(content);
  const sizeBytes = Buffer.byteLength(content, "utf8");
  const parsedTime = Date.parse(now);
  const mtimeNs = Number.isFinite(parsedTime) ? String(BigInt(parsedTime) * 1_000_000n) : "0";
  return {
    path: normalizedPath,
    kind: classification.kind,
    family: classification.family,
    subtype: classification.subtype,
    gate_relevance: 0,
    classification_reason: "RUNTIME_REANCHOR_ANCHOR",
    content_format: "utf8",
    content,
    canonical_format: "markdown-canonical-v1",
    canonical,
    sha256: sha256Text(content),
    size_bytes: sizeBytes,
    mtime_ns: mtimeNs,
    session_id: ownership.session_id,
    cycle_id: ownership.cycle_id,
    source_mode: sourceMode,
    entity_confidence: 1,
    legacy_origin: "runtime_state_reanchor",
    updated_at: now,
  };
}

export function applyRuntimeStateReanchorPayload({
  payload,
  anchors,
  targetRoot = ".",
  now = new Date().toISOString(),
} = {}) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Cannot apply runtime state reanchor without a canonical payload");
  }
  const next = JSON.parse(JSON.stringify(payload));
  next.schema_version = Number(next.schema_version ?? 2) || 2;
  next.generated_at = now;
  next.target_root = next.target_root || path.resolve(process.cwd(), targetRoot ?? ".");
  next.audit_root = next.audit_root || path.resolve(process.cwd(), targetRoot ?? ".", "docs", "audit");
  const artifactInputs = Array.isArray(anchors) ? anchors : [];
  const replacementByPath = new Map();
  for (const anchor of artifactInputs) {
    const normalizedPath = normalizeArtifactPath(anchor?.artifact_path || anchor?.path);
    const content = String(anchor?.content ?? "");
    if (!normalizedPath || !content) {
      continue;
    }
    replacementByPath.set(normalizedPath, buildRuntimeAnchorArtifact({
      relPath: normalizedPath,
      content,
      now,
      sourceMode: normalizeScalar(anchor?.source_mode) || "reconstructed",
    }));
  }
  const keptArtifacts = Array.isArray(next.artifacts)
    ? next.artifacts.filter((artifact) => !replacementByPath.has(normalizeArtifactPath(artifact?.path)))
    : [];
  next.artifacts = [
    ...keptArtifacts,
    ...Array.from(replacementByPath.values()),
  ].sort((left, right) => normalizeArtifactPath(left.path).localeCompare(normalizeArtifactPath(right.path)));
  next.summary = buildRuntimePayloadSummary(
    next,
    next?.summary?.structure_kind ?? next?.structure_profile?.kind ?? "unknown",
  );
  return {
    payload: next,
    anchors: Array.from(replacementByPath.values()).map((artifact) => ({
      artifact_path: artifact.path,
      sha256: artifact.sha256,
      size_bytes: artifact.size_bytes,
      session_id: artifact.session_id,
      cycle_id: artifact.cycle_id,
      updated_at: artifact.updated_at,
    })),
  };
}
