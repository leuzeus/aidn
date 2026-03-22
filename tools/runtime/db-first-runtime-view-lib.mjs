import fs from "node:fs";
import path from "node:path";
import { resolveEffectiveStateMode } from "../../src/core/state-mode/state-mode-policy.mjs";
import { readIndexFromSqlite } from "../../src/lib/sqlite/index-sqlite-lib.mjs";

export function normalizeScalar(value) {
  const normalized = String(value ?? "").trim();
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

export function parseTimestamp(value) {
  const normalized = normalizeScalar(value);
  if (!normalized) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const parsed = Date.parse(`${normalized}T00:00:00Z`);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

export function parseSimpleMap(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_]+):\s*(.+)$/);
    if (!match) {
      continue;
    }
    map.set(match[1], normalizeScalar(match[2]));
  }
  return map;
}

function parseFlexibleMap(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_ ]*):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
    map.set(key, normalizeScalar(match[2]));
  }
  return map;
}

function exists(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath);
}

function readTextIfExists(filePath) {
  return exists(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function resolveTargetPath(targetRoot, candidate) {
  if (!candidate) {
    return "";
  }
  if (path.isAbsolute(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(targetRoot, candidate);
}

function relativePath(root, filePath) {
  if (!filePath) {
    return "none";
  }
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function decodeArtifactContent(artifact) {
  if (typeof artifact?.content !== "string") {
    return "";
  }
  const format = String(artifact?.content_format ?? "utf8").trim().toLowerCase();
  if (format === "base64") {
    return Buffer.from(artifact.content, "base64").toString("utf8");
  }
  return artifact.content;
}

function normalizeRelativeArtifactPath(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^docs\/audit\//i, "");
}

function toAuditArtifactPath(value) {
  const normalized = normalizeRelativeArtifactPath(value);
  return normalized ? `docs/audit/${normalized}` : "none";
}

export function loadSqliteIndexPayloadSafe(targetRoot) {
  const sqliteFile = path.join(targetRoot, ".aidn", "runtime", "index", "workflow-index.sqlite");
  if (!exists(sqliteFile)) {
    return {
      exists: false,
      sqliteFile,
      payload: null,
      warning: "",
    };
  }
  try {
    return {
      exists: true,
      sqliteFile,
      payload: readIndexFromSqlite(sqliteFile).payload,
      warning: "",
    };
  } catch (error) {
    return {
      exists: true,
      sqliteFile,
      payload: null,
      warning: `SQLite artifact fallback unavailable: ${error.message}`,
    };
  }
}

function findArtifactByPath(sqlitePayload, artifactPath) {
  if (!sqlitePayload || !Array.isArray(sqlitePayload.artifacts)) {
    return null;
  }
  const normalized = normalizeRelativeArtifactPath(artifactPath);
  if (!normalized) {
    return null;
  }
  return sqlitePayload.artifacts.find((artifact) => normalizeRelativeArtifactPath(artifact?.path) === normalized) ?? null;
}

export function resolveDbBackedMode(targetRoot, requestedStateMode = "files") {
  const effectiveStateMode = resolveEffectiveStateMode({
    targetRoot,
    stateMode: requestedStateMode,
  });
  return {
    effectiveStateMode,
    dbBackedMode: effectiveStateMode === "dual" || effectiveStateMode === "db-only",
  };
}

export function resolveAuditArtifactText({
  targetRoot,
  candidatePath,
  dbBacked = false,
  sqlitePayload = null,
} = {}) {
  const absolutePath = resolveTargetPath(targetRoot, candidatePath);
  if (exists(absolutePath)) {
    return {
      exists: true,
      source: "file",
      absolutePath,
      logicalPath: relativePath(targetRoot, absolutePath),
      artifactPath: normalizeRelativeArtifactPath(candidatePath),
      text: readTextIfExists(absolutePath),
    };
  }
  if (!dbBacked || !sqlitePayload) {
    return {
      exists: false,
      source: "missing",
      absolutePath,
      logicalPath: relativePath(targetRoot, absolutePath),
      artifactPath: normalizeRelativeArtifactPath(candidatePath),
      text: "",
    };
  }
  const artifact = findArtifactByPath(sqlitePayload, candidatePath);
  const text = decodeArtifactContent(artifact);
  if (!artifact || !text) {
    return {
      exists: false,
      source: "missing",
      absolutePath,
      logicalPath: relativePath(targetRoot, absolutePath),
      artifactPath: normalizeRelativeArtifactPath(candidatePath),
      text: "",
    };
  }
  return {
    exists: true,
    source: "sqlite",
    absolutePath,
    logicalPath: toAuditArtifactPath(artifact.path),
    artifactPath: normalizeRelativeArtifactPath(artifact.path),
    text,
  };
}

function findSessionFile(auditRoot, sessionId) {
  if (!sessionId || canonicalNone(sessionId) || canonicalUnknown(sessionId)) {
    return null;
  }
  const sessionsDir = path.join(auditRoot, "sessions");
  if (!exists(sessionsDir)) {
    return null;
  }
  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^S\d+.*\.md$/i.test(entry.name));
  const direct = entries.find((entry) => entry.name.startsWith(sessionId));
  return direct ? path.join(sessionsDir, direct.name) : null;
}

function findSessionArtifact(sqlitePayload, sessionId) {
  if (!sqlitePayload || !Array.isArray(sqlitePayload.artifacts) || !sessionId || canonicalNone(sessionId) || canonicalUnknown(sessionId)) {
    return null;
  }
  return sqlitePayload.artifacts.find((artifact) => {
    const rel = normalizeRelativeArtifactPath(artifact?.path);
    return rel.startsWith(`sessions/${sessionId}`) && rel.endsWith(".md");
  }) ?? null;
}

export function resolveSessionArtifact({ targetRoot, auditRoot, sessionId, dbBacked = false, sqlitePayload = null } = {}) {
  const filePath = findSessionFile(auditRoot, sessionId);
  if (filePath) {
    return {
      exists: true,
      source: "file",
      filePath,
      logicalPath: relativePath(targetRoot, filePath),
      text: readTextIfExists(filePath),
    };
  }
  if (!dbBacked || !sqlitePayload) {
    return {
      exists: false,
      source: "missing",
      filePath: null,
      logicalPath: "none",
      text: "",
    };
  }
  const artifact = findSessionArtifact(sqlitePayload, sessionId);
  const text = decodeArtifactContent(artifact);
  if (!artifact || !text) {
    return {
      exists: false,
      source: "missing",
      filePath: null,
      logicalPath: "none",
      text: "",
    };
  }
  return {
    exists: true,
    source: "sqlite",
    filePath: null,
    logicalPath: toAuditArtifactPath(artifact.path),
    text,
  };
}

function findCycleStatusFile(auditRoot, cycleId) {
  if (!cycleId || canonicalNone(cycleId) || canonicalUnknown(cycleId)) {
    return null;
  }
  const cyclesDir = path.join(auditRoot, "cycles");
  if (!exists(cyclesDir)) {
    return null;
  }
  const entries = fs.readdirSync(cyclesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${cycleId}-`));
  for (const entry of entries) {
    const statusPath = path.join(cyclesDir, entry.name, "status.md");
    if (exists(statusPath)) {
      return statusPath;
    }
  }
  return null;
}

function findCycleStatusArtifact(sqlitePayload, cycleId) {
  if (!sqlitePayload || !Array.isArray(sqlitePayload.artifacts) || !cycleId || canonicalNone(cycleId) || canonicalUnknown(cycleId)) {
    return null;
  }
  return sqlitePayload.artifacts.find((artifact) => {
    const rel = normalizeRelativeArtifactPath(artifact?.path);
    return String(artifact?.cycle_id ?? "") === cycleId
      ? rel.endsWith("/status.md")
      : new RegExp(`^cycles/${cycleId}[^/]*/status\\.md$`, "i").test(rel);
  }) ?? null;
}

export function resolveCycleStatusArtifact({ targetRoot, auditRoot, cycleId, dbBacked = false, sqlitePayload = null } = {}) {
  const filePath = findCycleStatusFile(auditRoot, cycleId);
  if (filePath) {
    return {
      exists: true,
      source: "file",
      filePath,
      logicalPath: relativePath(targetRoot, filePath),
      artifactPath: normalizeRelativeArtifactPath(relativePath(auditRoot, filePath)),
      text: readTextIfExists(filePath),
    };
  }
  if (!dbBacked || !sqlitePayload) {
    return {
      exists: false,
      source: "missing",
      filePath: null,
      logicalPath: "none",
      artifactPath: "",
      text: "",
    };
  }
  const artifact = findCycleStatusArtifact(sqlitePayload, cycleId);
  const text = decodeArtifactContent(artifact);
  if (!artifact || !text) {
    return {
      exists: false,
      source: "missing",
      filePath: null,
      logicalPath: "none",
      artifactPath: "",
      text: "",
    };
  }
  return {
    exists: true,
    source: "sqlite",
    filePath: null,
    logicalPath: toAuditArtifactPath(artifact.path),
    artifactPath: normalizeRelativeArtifactPath(artifact.path),
    text,
  };
}

export function resolveCyclePlanArtifact({
  targetRoot,
  cycleStatusResolution,
  cycleId,
  dbBacked = false,
  sqlitePayload = null,
} = {}) {
  if (cycleStatusResolution?.filePath) {
    const filePath = path.join(path.dirname(cycleStatusResolution.filePath), "plan.md");
    if (exists(filePath)) {
      return {
        exists: true,
        source: "file",
        filePath,
        logicalPath: relativePath(targetRoot, filePath),
        text: readTextIfExists(filePath),
      };
    }
  }
  if (!dbBacked || !sqlitePayload) {
    return {
      exists: false,
      source: "missing",
      filePath: null,
      logicalPath: "none",
      text: "",
    };
  }
  const preferredPath = normalizeRelativeArtifactPath(cycleStatusResolution?.artifactPath);
  const preferredPlanPath = preferredPath ? preferredPath.replace(/\/status\.md$/i, "/plan.md") : "";
  const artifact = findArtifactByPath(sqlitePayload, preferredPlanPath)
    ?? (Array.isArray(sqlitePayload.artifacts)
      ? sqlitePayload.artifacts.find((item) => {
        const rel = normalizeRelativeArtifactPath(item?.path);
        return String(item?.cycle_id ?? "") === cycleId && rel.endsWith("/plan.md");
      }) ?? null
      : null);
  const text = decodeArtifactContent(artifact);
  if (!artifact || !text) {
    return {
      exists: false,
      source: "missing",
      filePath: null,
      logicalPath: "none",
      text: "",
    };
  }
  return {
    exists: true,
    source: "sqlite",
    filePath: null,
    logicalPath: toAuditArtifactPath(artifact.path),
    text,
  };
}

export function buildVirtualCurrentStateConsistency({
  currentStateResolution,
  activeCycle,
  activeSession = "none",
  cycleStatusResolution = null,
} = {}) {
  const checks = {};
  const currentMap = parseSimpleMap(currentStateResolution?.text ?? "");
  const currentUpdatedAt = parseTimestamp(currentMap.get("updated_at") ?? "");
  const cycleStatusMap = parseFlexibleMap(cycleStatusResolution?.text ?? "");
  const statusUpdatedAt = parseTimestamp(cycleStatusMap.get("last_updated") ?? cycleStatusMap.get("updated_at") ?? "");
  const dorLastCheck = parseTimestamp(cycleStatusMap.get("dor_last_check") ?? "");
  const normalizedActiveCycle = normalizeScalar(activeCycle || currentMap.get("active_cycle") || "none") || "none";
  const normalizedActiveSession = normalizeScalar(activeSession || currentMap.get("active_session") || "none") || "none";

  checks.updated_at_parseable = {
    pass: currentUpdatedAt !== null,
    details: currentUpdatedAt !== null
      ? "CURRENT-STATE updated_at parsed from SQLite artifact"
      : "CURRENT-STATE updated_at is missing or unparseable in SQLite artifact",
  };
  checks.active_cycle_status_exists = {
    pass: !normalizedActiveCycle || canonicalNone(normalizedActiveCycle) || canonicalUnknown(normalizedActiveCycle)
      ? true
      : cycleStatusResolution?.exists === true,
    details: !normalizedActiveCycle || canonicalNone(normalizedActiveCycle) || canonicalUnknown(normalizedActiveCycle)
      ? "no active cycle declared in CURRENT-STATE artifact"
      : (cycleStatusResolution?.exists === true
        ? `cycle status resolved via ${cycleStatusResolution.source}`
        : "active cycle status artifact is missing"),
  };
  checks.updated_at_not_older_than_status = {
    pass: statusUpdatedAt == null || currentUpdatedAt == null ? false : currentUpdatedAt >= statusUpdatedAt,
    details: statusUpdatedAt == null
      ? "cycle status last updated timestamp is missing"
      : currentUpdatedAt == null
        ? "CURRENT-STATE updated_at is missing"
        : currentUpdatedAt >= statusUpdatedAt
          ? "CURRENT-STATE updated_at is aligned with active cycle status timestamps"
          : "CURRENT-STATE updated_at is older than active cycle status timestamps",
  };
  checks.updated_at_not_older_than_dor_check = {
    pass: dorLastCheck == null || currentUpdatedAt == null ? false : currentUpdatedAt >= dorLastCheck,
    details: dorLastCheck == null
      ? "DoR last check timestamp is missing"
      : currentUpdatedAt == null
        ? "CURRENT-STATE updated_at is missing"
        : currentUpdatedAt >= dorLastCheck
          ? "CURRENT-STATE updated_at is aligned with DoR check timestamps"
          : "CURRENT-STATE updated_at is older than the latest DoR check timestamp",
  };

  if (canonicalNone(normalizedActiveCycle) || canonicalUnknown(normalizedActiveCycle)) {
    checks.updated_at_not_older_than_status.pass = true;
    checks.updated_at_not_older_than_status.details = "no active cycle declared in CURRENT-STATE artifact";
    checks.updated_at_not_older_than_dor_check.pass = true;
    checks.updated_at_not_older_than_dor_check.details = "no active cycle declared in CURRENT-STATE artifact";
  }
  if (statusUpdatedAt == null) {
    checks.updated_at_not_older_than_status.pass = true;
  }
  if (dorLastCheck == null) {
    checks.updated_at_not_older_than_dor_check.pass = true;
  }

  const pass = Object.values(checks).every((check) => check?.pass === true);
  return {
    pass,
    source: currentStateResolution?.source === "sqlite" ? "sqlite" : "file",
    current_state: {
      active_cycle: normalizedActiveCycle,
      active_session: normalizedActiveSession,
    },
    checks,
  };
}
