import fs from "node:fs";
import path from "node:path";
import {
  readAidnProjectConfig,
  resolveConfigSourceBranch,
} from "../config/aidn-config-lib.mjs";
import {
  loadSqliteIndexPayloadSafe,
  resolveAuditArtifactText,
  resolveDbBackedMode,
} from "../../../tools/runtime/db-first-runtime-view-lib.mjs";
import {
  analyzeStructuredArtifact,
  parseStructuredMarkdownMap,
} from "./structured-artifact-parser-lib.mjs";

const OPEN_CYCLE_STATES = new Set(["OPEN", "IMPLEMENTING", "VERIFYING"]);
const CLOSE_SESSION_DECISIONS = new Set(["integrate-to-session", "report", "close-non-retained", "cancel-close"]);
const SESSION_PR_STATUSES = new Set(["none", "open", "merged", "closed_not_merged", "unknown"]);
const SESSION_PR_REVIEW_STATUSES = new Set(["unknown", "pending", "approved", "changes_requested", "resolved"]);
const POST_MERGE_SYNC_STATUSES = new Set(["not_needed", "required", "done", "unknown"]);

export function normalizeScalar(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("`") && normalized.endsWith("`") && normalized.length >= 2) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

export function canonicalNone(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return normalized === "none" || normalized === "(none)";
}

export function canonicalUnknown(value) {
  return normalizeScalar(value).toLowerCase() === "unknown";
}

export function normalizeSessionPrStatus(value) {
  const normalized = normalizeScalar(value).toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_")
    .replace(/[()]/g, "");
  if (!normalized || canonicalNone(normalized)) {
    return "none";
  }
  if (normalized === "closednotmerged" || normalized === "closed_not_merged") {
    return "closed_not_merged";
  }
  if (SESSION_PR_STATUSES.has(normalized)) {
    return normalized;
  }
  return "unknown";
}

export function normalizeSessionPrReviewStatus(value) {
  const normalized = normalizeScalar(value).toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
  if (!normalized) {
    return "unknown";
  }
  if (SESSION_PR_REVIEW_STATUSES.has(normalized)) {
    return normalized;
  }
  return "unknown";
}

export function normalizePostMergeSyncStatus(value) {
  const normalized = normalizeScalar(value).toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
  if (!normalized || canonicalNone(normalized)) {
    return "not_needed";
  }
  if (POST_MERGE_SYNC_STATUSES.has(normalized)) {
    return normalized;
  }
  return "unknown";
}

export function parseSimpleMap(text) {
  return new Map(Object.entries(parseStructuredMarkdownMap(text)).map(([key, value]) => [key, normalizeScalar(value)]));
}

function decodeArtifactContent(artifact) {
  if (typeof artifact?.content !== "string" || artifact.content.length === 0) {
    return "";
  }
  const format = String(artifact?.content_format ?? "utf8").trim().toLowerCase();
  if (format === "base64") {
    return Buffer.from(artifact.content, "base64").toString("utf8");
  }
  return artifact.content;
}

function deriveTargetRootFromAuditRoot(auditRoot) {
  return path.resolve(auditRoot, "..", "..");
}

function deriveTargetRootFromAuditPath(filePath) {
  const resolved = path.resolve(filePath).replace(/\\/g, "/");
  const marker = "/docs/audit/";
  const index = resolved.toLowerCase().indexOf(marker);
  if (index === -1) {
    return null;
  }
  return path.resolve(resolved.slice(0, index));
}

function toRelativeAuditPath(targetRoot, filePath) {
  if (!targetRoot || !filePath) {
    return "";
  }
  const rel = path.relative(targetRoot, filePath).replace(/\\/g, "/");
  return rel.startsWith("docs/audit/") ? rel : "";
}

function loadDbAuditContext(targetRoot) {
  if (!targetRoot) {
    return {
      targetRoot: null,
      dbBackedMode: false,
      sqlitePayload: null,
      sqliteRuntimeHeads: {},
    };
  }
  const { dbBackedMode } = resolveDbBackedMode(targetRoot);
  const sqliteFallback = dbBackedMode ? loadSqliteIndexPayloadSafe(targetRoot) : null;
  return {
    targetRoot,
    dbBackedMode,
    sqlitePayload: sqliteFallback?.payload ?? null,
    sqliteRuntimeHeads: sqliteFallback?.runtimeHeads ?? {},
  };
}

function loadDbAuditContextFromAuditRoot(auditRoot) {
  return loadDbAuditContext(deriveTargetRootFromAuditRoot(auditRoot));
}

function listSessionArtifactsFromSqlite(auditRoot, sqlitePayload) {
  if (!sqlitePayload || !Array.isArray(sqlitePayload.artifacts)) {
    return [];
  }
  return sqlitePayload.artifacts
    .filter((artifact) => /^sessions\/S\d+.*\.md$/i.test(String(artifact?.path ?? "").replace(/\\/g, "/")))
    .map((artifact) => {
      const relativePath = String(artifact.path).replace(/\\/g, "/");
      const text = decodeArtifactContent(artifact);
      const metadata = parseSessionMetadata(text);
      const sessionIdMatch = path.basename(relativePath).match(/^(S\d+)/i);
      return {
        session_id: sessionIdMatch ? String(sessionIdMatch[1]).toUpperCase() : path.basename(relativePath, ".md").toUpperCase(),
        file_path: path.resolve(auditRoot, relativePath),
        metadata,
      };
    })
    .sort((left, right) => left.session_id.localeCompare(right.session_id, undefined, { numeric: true, sensitivity: "base" }));
}

function listCycleStatusesFromSqlite(auditRoot, sqlitePayload) {
  if (!sqlitePayload || !Array.isArray(sqlitePayload.artifacts)) {
    return [];
  }
  return sqlitePayload.artifacts
    .filter((artifact) => /^cycles\/[^/]+\/status\.md$/i.test(String(artifact?.path ?? "").replace(/\\/g, "/")))
    .map((artifact) => {
      const relativePath = String(artifact.path).replace(/\\/g, "/");
      const text = decodeArtifactContent(artifact);
      const map = parseSimpleMap(text);
      const cycleDir = relativePath.split("/")[1] ?? "";
      const cycleIdMatch = cycleDir.match(/(C\d+)/i);
      return {
        cycle_id: cycleIdMatch ? String(cycleIdMatch[1]).toUpperCase() : cycleDir.toUpperCase(),
        cycle_dir: cycleDir,
        file_path: path.resolve(auditRoot, relativePath),
        text,
        state: normalizeScalar(map.get("state") ?? "unknown").toUpperCase() || "UNKNOWN",
        branch_name: normalizeScalar(map.get("branch_name") ?? "none") || "none",
        session_owner: normalizeScalar(map.get("session_owner") ?? "none") || "none",
        outcome: normalizeScalar(map.get("outcome") ?? "unknown") || "unknown",
        dor_state: normalizeScalar(map.get("dor_state") ?? "unknown") || "unknown",
        usage_matrix_scope: normalizeScalar(map.get("usage_matrix_scope") ?? "local") || "local",
        usage_matrix_state: normalizeScalar(map.get("usage_matrix_state") ?? "NOT_DEFINED") || "NOT_DEFINED",
        usage_matrix_summary: normalizeScalar(map.get("usage_matrix_summary") ?? "none") || "none",
        usage_matrix_rationale: normalizeScalar(map.get("usage_matrix_rationale") ?? "none") || "none",
        continuity_rule: normalizeScalar(map.get("continuity_rule") ?? "none") || "none",
        continuity_base_branch: normalizeScalar(map.get("continuity_base_branch") ?? "none") || "none",
        continuity_latest_cycle_branch: normalizeScalar(map.get("continuity_latest_cycle_branch") ?? "none") || "none",
      };
    })
    .sort((left, right) => left.cycle_id.localeCompare(right.cycle_id, undefined, { numeric: true, sensitivity: "base" }));
}

export function readTextIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    const targetRoot = deriveTargetRootFromAuditPath(filePath);
    const relativeAuditPath = toRelativeAuditPath(targetRoot, filePath);
    if (!targetRoot || !relativeAuditPath) {
      return "";
    }
    const dbContext = loadDbAuditContext(targetRoot);
    if (!dbContext.dbBackedMode || !dbContext.sqlitePayload) {
      return "";
    }
    return resolveAuditArtifactText({
      targetRoot,
      candidatePath: relativeAuditPath,
      dbBacked: dbContext.dbBackedMode,
      sqlitePayload: dbContext.sqlitePayload,
      sqliteRuntimeHeads: dbContext.sqliteRuntimeHeads,
    }).text;
  }
  return fs.readFileSync(filePath, "utf8");
}

function splitEntityList(value) {
  const normalized = normalizeScalar(value).replace(/[|]/g, " ").trim();
  if (!normalized || /^none$/i.test(normalized)) {
    return [];
  }
  return normalized
    .split(/[,\s]+/)
    .map((item) => normalizeScalar(item))
    .filter((item) => item.length > 0 && !canonicalNone(item));
}

function extractIds(values, prefix) {
  const joined = Array.isArray(values) ? values.join(" ") : String(values ?? "");
  const pattern = new RegExp(`\\b(${prefix}[0-9]+)\\b`, "gi");
  const matches = joined.match(pattern) ?? [];
  return Array.from(new Set(matches.map((item) => String(item).toUpperCase()))).sort((a, b) => a.localeCompare(b));
}

export function parseSessionMetadata(text) {
  const derived = analyzeStructuredArtifact(text, {
    classification: { kind: "session", subtype: "session" },
  }).derived_session_context ?? {};
  const effectiveIntegrationTargets = Array.isArray(derived.integration_target_cycles)
    ? derived.integration_target_cycles
    : [];
  return {
    mode: derived.mode ?? null,
    session_branch: derived.session_branch ?? null,
    parent_session: derived.parent_session ?? null,
    branch_kind: derived.branch_kind ?? null,
    cycle_branch: derived.cycle_branch ?? null,
    intermediate_branch: derived.intermediate_branch ?? null,
    integration_target_cycle: derived.primary_focus_cycle ?? (effectiveIntegrationTargets.length === 1 ? effectiveIntegrationTargets[0] : null),
    integration_target_cycles: effectiveIntegrationTargets,
    primary_focus_cycle: derived.primary_focus_cycle ?? null,
    attached_cycles: Array.isArray(derived.attached_cycles) ? derived.attached_cycles : [],
    reported_from_previous_session: Array.isArray(derived.reported_from_previous_session) ? derived.reported_from_previous_session : [],
    carry_over_pending: derived.carry_over_pending ?? null,
    pr_status: normalizeSessionPrStatus(derived.pr_status),
    pr_url: derived.pr_url ?? null,
    pr_number: derived.pr_number ?? null,
    pr_base_branch: derived.pr_base_branch ?? null,
    pr_head_branch: derived.pr_head_branch ?? null,
    pr_review_status: normalizeSessionPrReviewStatus(derived.pr_review_status),
    post_merge_sync_status: normalizePostMergeSyncStatus(derived.post_merge_sync_status),
    post_merge_sync_basis: derived.post_merge_sync_basis ?? null,
    close_gate_satisfied: derived.close_gate_satisfied ?? null,
    snapshot_updated: derived.snapshot_updated ?? null,
  };
}

export function parseSessionCloseCycleDecisions(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }
  const lines = String(text).split(/\r?\n/);
  const items = [];
  let active = false;
  for (const line of lines) {
    if (/^###\s+Cycle Resolution At Session Close/i.test(line.trim())) {
      active = true;
      continue;
    }
    if (active && /^###\s+/.test(line.trim())) {
      break;
    }
    if (!active) {
      continue;
    }
    const bulletMatch = line.match(/^\s*-\s+(.+)$/);
    if (!bulletMatch) {
      continue;
    }
    const raw = String(bulletMatch[1] ?? "").trim();
    const cycleId = extractIds(raw, "C").at(0) ?? null;
    const stateMatch = raw.match(/state:\s*`?([A-Z_]+)`?/i);
    const decisionMatch = raw.match(/decision:\s*`?([a-z-]+)`?/i);
    const targetSessionMatch = raw.match(/target session:\s*`?([^|`]+)`?/i);
    const rationaleMatch = raw.match(/rationale:\s*(.+)$/i);
    const decision = normalizeScalar(decisionMatch?.[1] ?? "").toLowerCase();
    if (!cycleId || !CLOSE_SESSION_DECISIONS.has(decision)) {
      continue;
    }
    items.push({
      cycle_id: cycleId,
      state: normalizeScalar(stateMatch?.[1] ?? "").toUpperCase() || null,
      decision,
      target_session: normalizeScalar(targetSessionMatch?.[1] ?? "") || "none",
      rationale: normalizeScalar(rationaleMatch?.[1] ?? "") || "",
    });
  }
  return items;
}

export function findSessionFile(auditRoot, sessionId) {
  if (!sessionId || canonicalNone(sessionId) || canonicalUnknown(sessionId)) {
    return null;
  }
  const sessionsDir = path.join(auditRoot, "sessions");
  const entries = fs.existsSync(sessionsDir)
    ? fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^S\d+.*\.md$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const direct = entries.find((entry) => entry.name.toUpperCase().startsWith(String(sessionId).toUpperCase()));
  if (direct) {
    return path.join(sessionsDir, direct.name);
  }
  const dbContext = loadDbAuditContextFromAuditRoot(auditRoot);
  const fallback = listSessionArtifactsFromSqlite(auditRoot, dbContext.sqlitePayload)
    .find((session) => session.session_id === String(sessionId).toUpperCase());
  return fallback?.file_path ?? null;
}

export function findLatestSessionFile(auditRoot) {
  const sessionsDir = path.join(auditRoot, "sessions");
  if (fs.existsSync(sessionsDir)) {
    const entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^S\d+.*\.md$/i.test(entry.name))
      .map((entry) => path.join(sessionsDir, entry.name))
      .sort((left, right) => path.basename(right).localeCompare(path.basename(left), undefined, { numeric: true, sensitivity: "base" }));
    if (entries.length > 0) {
      return entries[0] ?? null;
    }
  }
  const dbContext = loadDbAuditContextFromAuditRoot(auditRoot);
  return listSessionArtifactsFromSqlite(auditRoot, dbContext.sqlitePayload)
    .map((session) => session.file_path)
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left), undefined, { numeric: true, sensitivity: "base" }))[0] ?? null;
}

export function findCycleStatus(auditRoot, cycleId) {
  if (!cycleId || canonicalNone(cycleId) || canonicalUnknown(cycleId)) {
    return null;
  }
  const cyclesDir = path.join(auditRoot, "cycles");
  const entries = fs.existsSync(cyclesDir)
    ? fs.readdirSync(cyclesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.toUpperCase().startsWith(`${String(cycleId).toUpperCase()}-`))
      .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  for (const entry of entries) {
    const statusPath = path.join(cyclesDir, entry.name, "status.md");
    if (fs.existsSync(statusPath)) {
      return statusPath;
    }
  }
  const dbContext = loadDbAuditContextFromAuditRoot(auditRoot);
  const fallback = listCycleStatusesFromSqlite(auditRoot, dbContext.sqlitePayload)
    .find((cycle) => cycle.cycle_id === String(cycleId).toUpperCase());
  return fallback?.file_path ?? null;
}

export function findCycleDirectory(auditRoot, cycleId) {
  const statusPath = findCycleStatus(auditRoot, cycleId);
  return statusPath ? path.dirname(statusPath) : null;
}

export function readCurrentState(targetRoot) {
  const auditRoot = path.join(targetRoot, "docs", "audit");
  const filePath = path.join(auditRoot, "CURRENT-STATE.md");
  const dbContext = loadDbAuditContext(targetRoot);
  const resolution = resolveAuditArtifactText({
    targetRoot,
    candidatePath: "docs/audit/CURRENT-STATE.md",
    dbBacked: dbContext.dbBackedMode,
    sqlitePayload: dbContext.sqlitePayload,
    sqliteRuntimeHeads: dbContext.sqliteRuntimeHeads,
  });
  const text = resolution.text;
  const map = parseSimpleMap(text);
  return {
    audit_root: auditRoot,
    file_path: filePath,
    text,
    map,
    active_session: normalizeScalar(map.get("active_session") ?? "none") || "none",
    session_branch: normalizeScalar(map.get("session_branch") ?? "none") || "none",
    branch_kind: normalizeScalar(map.get("branch_kind") ?? "unknown") || "unknown",
    mode: normalizeScalar(map.get("mode") ?? "unknown") || "unknown",
    active_cycle: normalizeScalar(map.get("active_cycle") ?? "none") || "none",
    cycle_branch: normalizeScalar(map.get("cycle_branch") ?? "none") || "none",
    session_pr_status: normalizeSessionPrStatus(map.get("session_pr_status") ?? "none"),
    session_pr_review_status: normalizeSessionPrReviewStatus(map.get("session_pr_review_status") ?? "unknown"),
    post_merge_sync_status: normalizePostMergeSyncStatus(map.get("post_merge_sync_status") ?? "not_needed"),
    dor_state: normalizeScalar(map.get("dor_state") ?? "unknown") || "unknown",
    first_plan_step: normalizeScalar(map.get("first_plan_step") ?? "unknown") || "unknown",
    active_backlog: normalizeScalar(map.get("active_backlog") ?? "none") || "none",
    backlog_status: normalizeScalar(map.get("backlog_status") ?? "unknown") || "unknown",
    backlog_next_step: normalizeScalar(map.get("backlog_next_step") ?? "unknown") || "unknown",
    backlog_selected_execution_scope: normalizeScalar(map.get("backlog_selected_execution_scope") ?? "none") || "none",
    planning_arbitration_status: normalizeScalar(map.get("planning_arbitration_status") ?? "none") || "none",
  };
}

export function readSourceBranch(targetRoot) {
  const config = readAidnProjectConfig(targetRoot);
  const configSourceBranch = resolveConfigSourceBranch(config.data);
  if (configSourceBranch) {
    return configSourceBranch;
  }
  const dbContext = loadDbAuditContext(targetRoot);
  const workflowText = resolveAuditArtifactText({
    targetRoot,
    candidatePath: "docs/audit/WORKFLOW.md",
    dbBacked: dbContext.dbBackedMode,
    sqlitePayload: dbContext.sqlitePayload,
    sqliteRuntimeHeads: dbContext.sqliteRuntimeHeads,
  }).text;
  const workflowMap = parseSimpleMap(workflowText);
  const workflowSourceBranch = normalizeScalar(workflowMap.get("source_branch") ?? "");
  if (workflowSourceBranch) {
    return workflowSourceBranch;
  }
  const text = resolveAuditArtifactText({
    targetRoot,
    candidatePath: "docs/audit/baseline/current.md",
    dbBacked: dbContext.dbBackedMode,
    sqlitePayload: dbContext.sqlitePayload,
    sqliteRuntimeHeads: dbContext.sqliteRuntimeHeads,
  }).text;
  const map = parseSimpleMap(text);
  const sourceBranch = normalizeScalar(map.get("source_branch") ?? "");
  return sourceBranch || null;
}

export function listSessionArtifacts(auditRoot) {
  const sessionsDir = path.join(auditRoot, "sessions");
  if (fs.existsSync(sessionsDir)) {
    const entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^S\d+.*\.md$/i.test(entry.name))
      .map((entry) => {
        const filePath = path.join(sessionsDir, entry.name);
        const text = readTextIfExists(filePath);
        const metadata = parseSessionMetadata(text);
        const sessionIdMatch = entry.name.match(/^(S\d+)/i);
        return {
          session_id: sessionIdMatch ? String(sessionIdMatch[1]).toUpperCase() : path.basename(entry.name, ".md").toUpperCase(),
          file_path: filePath,
          metadata,
        };
      })
      .sort((left, right) => left.session_id.localeCompare(right.session_id, undefined, { numeric: true, sensitivity: "base" }));
    if (entries.length > 0) {
      return entries;
    }
  }
  const dbContext = loadDbAuditContextFromAuditRoot(auditRoot);
  return listSessionArtifactsFromSqlite(auditRoot, dbContext.sqlitePayload);
}

export function listCycleStatuses(auditRoot) {
  const cyclesDir = path.join(auditRoot, "cycles");
  if (fs.existsSync(cyclesDir)) {
    const entries = fs.readdirSync(cyclesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const filePath = path.join(cyclesDir, entry.name, "status.md");
        if (!fs.existsSync(filePath)) {
          return null;
        }
        const text = readTextIfExists(filePath);
        const map = parseSimpleMap(text);
        const cycleIdMatch = entry.name.match(/(C\d+)/i);
        return {
          cycle_id: cycleIdMatch ? String(cycleIdMatch[1]).toUpperCase() : entry.name.toUpperCase(),
          cycle_dir: entry.name,
          file_path: filePath,
          text,
          state: normalizeScalar(map.get("state") ?? "unknown").toUpperCase() || "UNKNOWN",
          branch_name: normalizeScalar(map.get("branch_name") ?? "none") || "none",
          session_owner: normalizeScalar(map.get("session_owner") ?? "none") || "none",
          outcome: normalizeScalar(map.get("outcome") ?? "unknown") || "unknown",
          dor_state: normalizeScalar(map.get("dor_state") ?? "unknown") || "unknown",
          usage_matrix_scope: normalizeScalar(map.get("usage_matrix_scope") ?? "local") || "local",
          usage_matrix_state: normalizeScalar(map.get("usage_matrix_state") ?? "NOT_DEFINED") || "NOT_DEFINED",
          usage_matrix_summary: normalizeScalar(map.get("usage_matrix_summary") ?? "none") || "none",
          usage_matrix_rationale: normalizeScalar(map.get("usage_matrix_rationale") ?? "none") || "none",
          continuity_rule: normalizeScalar(map.get("continuity_rule") ?? "none") || "none",
          continuity_base_branch: normalizeScalar(map.get("continuity_base_branch") ?? "none") || "none",
          continuity_latest_cycle_branch: normalizeScalar(map.get("continuity_latest_cycle_branch") ?? "none") || "none",
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.cycle_id.localeCompare(right.cycle_id, undefined, { numeric: true, sensitivity: "base" }));
    if (entries.length > 0) {
      return entries;
    }
  }
  const dbContext = loadDbAuditContextFromAuditRoot(auditRoot);
  return listCycleStatusesFromSqlite(auditRoot, dbContext.sqlitePayload);
}

export function isOpenCycleState(state) {
  return OPEN_CYCLE_STATES.has(String(state ?? "").toUpperCase());
}

export function collectOpenCycles(cycles) {
  return (Array.isArray(cycles) ? cycles : []).filter((cycle) => isOpenCycleState(cycle?.state));
}

export function readCycleChangeRequestImpacts(cycleDir) {
  if (!cycleDir) {
    return [];
  }
  const filePath = path.join(cycleDir, "change-requests.md");
  const text = readTextIfExists(filePath);
  const impacts = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*Impact:\s*(low|medium|high)\s*$/i);
    if (!match) {
      continue;
    }
    impacts.push(String(match[1]).trim().toLowerCase());
  }
  return impacts;
}
