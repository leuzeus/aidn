import fs from "node:fs";
import path from "node:path";
import { buildNoChangeFastPath } from "../../core/gating/gating-signal-policy.mjs";
import { detectRuntimeSnapshotBackend, readRuntimeSnapshot } from "./runtime-snapshot-service.mjs";
import { countsAsRecentAnomalousFallback } from "../../core/gating/fallback-history-policy.mjs";
import { findUniqueAuditArtifact } from "./runtime-head-resolution-service.mjs";

function readTextSafe(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseKeyValues(content) {
  const out = {};
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_ ]*):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
    out[key] = match[2].trim();
  }
  return out;
}

function getLatestFileByPattern(dirPath, regex) {
  if (!fs.existsSync(dirPath)) {
    return null;
  }
  const files = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && regex.test(entry.name))
    .map((entry) => path.join(dirPath, entry.name));
  if (files.length === 0) {
    return null;
  }
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}

function extractSessionObjective(sessionPath) {
  if (!sessionPath || !fs.existsSync(sessionPath)) {
    return null;
  }
  return extractObjective(readTextSafe(sessionPath));
}

function objectiveVisibleLines(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const visible = [];
  let fence = null;
  let comment = false;
  for (const rawLine of lines) {
    if (fence) {
      const marker = rawLine.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length
          && marker[2].trim() === "") fence = null;
      continue;
    }
    if (!comment && /^(?: {4}|\t)/.test(rawLine)) {
      visible.push("");
      continue;
    }
    let line = "";
    let remainder = rawLine;
    while (remainder) {
      if (comment) {
        const end = remainder.indexOf("-->");
        if (end < 0) break;
        remainder = remainder.slice(end + 3);
        comment = false;
      } else {
        const start = remainder.indexOf("<!--");
        if (start < 0) { line += remainder; break; }
        line += `${remainder.slice(0, start)} `;
        remainder = remainder.slice(start + 4);
        comment = true;
      }
    }
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      fence = { char: marker[1][0], length: marker[1].length };
      visible.push("");
      continue;
    }
    visible.push(line);
  }
  return visible;
}

function normalizeObjective(value) {
  let objective = String(value ?? "").trim();
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(objective.replace(/[ \t]/g, ""))) return null;
  if (/^\[[ xX]\](?:\s|$)/.test(objective)) return null;
  const quoted = objective.match(/^`([^`]+)`$/);
  const placeholder = (quoted ? quoted[1] : objective).toLowerCase().replace(/^\((.*)\)$/, "$1").trim();
  if (!objective || ["none", "unknown", "to_define", "to define", "tbd", "todo", "1 clear sentence", "1 phrase"].includes(placeholder)) return null;
  return objective;
}

function extractObjective(text) {
  const lines = objectiveVisibleLines(text);
  const keyed = {};
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_ ]*):\s*(.*)$/);
    const key = match?.[1].trim().toLowerCase().replace(/\s+/g, "_");
    if (key !== "session_objective" && key !== "objective") continue;
    const objective = normalizeObjective(match[2]);
    if (objective) keyed[key] = objective;
  }
  const keyedObjective = keyed.session_objective ?? keyed.objective;
  if (keyedObjective) return keyedObjective;
  const heading = /^ {0,3}#{1,6}[ \t]+session[ \t]+objective(?:[ \t]+\([^)]*\))?[ \t]*#*[ \t]*$/i;
  const start = lines.findIndex(line => heading.test(line));
  if (start < 0) return null;
  const listOrKey = /^(?:[-*+]\s+|\d+[.)]\s+|(?:session[_ ]objective|objective):)/i;
  const boundary = index => /^ {0,3}#{1,6}(?:[ \t]|$)/.test(lines[index])
    || (Boolean(lines[index].trim()) && !listOrKey.test(lines[index].trim())
      && /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[index + 1] ?? ""));
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (boundary(i)) break;
    const objective = normalizeObjective(line.trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/^(?:session[_ ]objective|objective):\s*/i, ""));
    if (!objective) continue;
    if (listOrKey.test(line.trim())) return objective;
    const paragraph = [objective];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (!lines[j].trim() || boundary(j) || listOrKey.test(lines[j].trim())) break;
      const continuation = normalizeObjective(lines[j]);
      if (!continuation) break;
      paragraph.push(continuation);
    }
    return paragraph.join(" ").replace(/[ \t]+/g, " ");
  }
  return null;
}

function parseStatusMeta(statusPath) {
  const text = readTextSafe(statusPath);
  const kv = parseKeyValues(text);
  return {
    state: (kv.state ?? "UNKNOWN").toUpperCase(),
    currentGoal: kv.current_goal ?? null,
  };
}

function getActiveCycleGoal(targetRoot) {
  const cyclesRoot = path.join(targetRoot, "docs", "audit", "cycles");
  if (!fs.existsSync(cyclesRoot)) {
    return null;
  }
  const statusFiles = [];
  const cycleDirs = fs.readdirSync(cyclesRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const dirent of cycleDirs) {
    const statusPath = path.join(cyclesRoot, dirent.name, "status.md");
    if (fs.existsSync(statusPath)) {
      statusFiles.push(statusPath);
    }
  }
  if (statusFiles.length === 0) {
    return null;
  }

  const active = [];
  for (const filePath of statusFiles) {
    const meta = parseStatusMeta(filePath);
    if (meta.state === "OPEN" || meta.state === "IMPLEMENTING" || meta.state === "VERIFYING") {
      active.push({
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs,
        currentGoal: meta.currentGoal,
      });
    }
  }
  if (active.length === 0) {
    return null;
  }
  active.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return active[0].currentGoal ?? null;
}

function getChangedFiles(targetRoot, gitAdapter) {
  const changed = new Set();
  try {
    const statusOutput = gitAdapter.execStatusPorcelain(targetRoot);
    if (!statusOutput.trim()) {
      return [];
    }
    for (const line of statusOutput.split(/\r?\n/)) {
      if (line.length < 4) {
        continue;
      }
      const payload = line.slice(3).trim();
      if (!payload) {
        continue;
      }
      const renamed = payload.match(/^(.*)\s->\s(.*)$/);
      if (renamed) {
        changed.add(renamed[2].trim());
      } else {
        changed.add(payload);
      }
    }
  } catch {
    // ignore and keep best-effort result
  }
  return Array.from(changed).sort((a, b) => a.localeCompare(b));
}

function toTimestampMs(iso) {
  const ms = Date.parse(String(iso ?? ""));
  return Number.isNaN(ms) ? null : ms;
}

export function readEventSignalStats(filePath, options = {}) {
  const {
    includeDrift = true,
    includeFallback = true,
  } = options;
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return {
      latestDriftMs: null,
      fallbackRecentCount: 0,
    };
  }
  const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/);
  let latestDriftMs = null;
  let fallbackRecentCount = 0;
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      const skill = String(event.skill ?? "");
      if (includeDrift && skill === "drift-check" && event.event === "drift_check_completed"
          && event.result === "ok" && event.mode === "COMMITTING"
          && Boolean(options.branch) && event.branch === options.branch) {
        const eventMs = toTimestampMs(event.ts);
        if (eventMs != null && eventMs <= (options.nowMs ?? Date.now())
            && (latestDriftMs == null || eventMs > latestDriftMs)) {
          latestDriftMs = eventMs;
        }
      }
      if (includeFallback && countsAsRecentAnomalousFallback(event, options)) {
        fallbackRecentCount += 1;
      }
    } catch {
      // ignore malformed line
    }
  }
  return {
    latestDriftMs,
    fallbackRecentCount,
  };
}

function readJsonOptional(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return { exists: false, absolute, data: null };
  }
  try {
    return { exists: true, absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch {
    return { exists: true, absolute, data: null };
  }
}

function detectIndexBackend(indexFile, backend) {
  return detectRuntimeSnapshotBackend(indexFile, backend);
}

async function readRepairLayerSummary(targetRoot, indexFile, backend) {
  const absolute = path.resolve(process.cwd(), indexFile);
  if (detectIndexBackend(indexFile, backend) !== "postgres" && !fs.existsSync(absolute)) {
    return {
      exists: false,
      blocking: false,
      openCount: 0,
      severityCounts: {},
      topFindings: [],
    };
  }
  let payload = null;
  if (detectIndexBackend(indexFile, backend) !== "json") {
    payload = (await readRuntimeSnapshot({
      indexFile: absolute,
      backend: detectIndexBackend(indexFile, backend),
      targetRoot,
    })).payload;
  } else {
    try {
      payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
    } catch {
      payload = null;
    }
  }
  const findings = Array.isArray(payload?.migration_findings) ? payload.migration_findings : [];
  const openFindings = findings.filter((row) => {
    const severity = String(row?.severity ?? "").toLowerCase();
    return severity === "warning" || severity === "error";
  });
  const severityCounts = {};
  for (const row of openFindings) {
    const severity = String(row?.severity ?? "unknown").toLowerCase();
    severityCounts[severity] = Number(severityCounts[severity] ?? 0) + 1;
  }
  return {
    exists: true,
    blocking: openFindings.some((row) => String(row?.severity ?? "").toLowerCase() === "error"),
    openCount: openFindings.length,
    severityCounts,
    topFindings: openFindings.slice(0, 5).map((row) => ({
      severity: row?.severity ?? null,
      finding_type: row?.finding_type ?? null,
      entity_id: row?.entity_id ?? null,
      artifact_path: row?.artifact_path ?? null,
      message: row?.message ?? null,
    })),
  };
}

export async function collectGatingObservations({ targetRoot, eventFile, indexSyncCheckFile, indexFile, indexBackend, stateMode, mode, reloadResult, gitAdapter, completionContext = null }) {
  const sessionsRoot = path.join(targetRoot, "docs", "audit", "sessions");
  const latestSession = getLatestFileByPattern(sessionsRoot, /^S\d+.*\.md$/i);
  let sessionObjective = extractSessionObjective(latestSession);
  let cycleGoal = getActiveCycleGoal(targetRoot);
  if (completionContext) {
    const cyclePath = `cycles/${completionContext.cycle_dir}/status.md`;
    let statusText;
    let sessionText;
    if (stateMode !== "files" || indexBackend === "postgres") {
      const snapshot = await readRuntimeSnapshot({ targetRoot, indexFile, backend: indexBackend });
      if (!snapshot.payload) throw new Error("Canonical closure intent unavailable");
      const decode = artifact => artifact?.content_format === "base64"
        ? Buffer.from(artifact.content, "base64").toString("utf8") : artifact?.content ?? "";
      statusText = decode(findUniqueAuditArtifact(snapshot.payload, cyclePath));
      const sessions = (snapshot.payload.artifacts ?? []).filter(artifact =>
        String(artifact.path).replace(/\\/g, "/").replace(/^docs\/audit\//i, "")
          .match(/^sessions\/(S\d+)(?:[^\d/][^/]*)?\.md$/i)?.[1] === completionContext.session_id);
      sessionText = sessions.length === 1 ? decode(sessions[0]) : "";
    } else {
      statusText = readTextSafe(path.join(targetRoot, "docs/audit", cyclePath));
      const files = fs.existsSync(sessionsRoot) ? fs.readdirSync(sessionsRoot).filter(file =>
        file.match(/^(S\d+)(?:[^\d/][^/]*)?\.md$/i)?.[1] === completionContext.session_id) : [];
      sessionText = files.length === 1 ? readTextSafe(path.join(sessionsRoot, files[0])) : "";
    }
    cycleGoal = parseKeyValues(statusText).current_goal ?? null;
    sessionObjective = extractObjective(sessionText);
  }
  const changedFiles = getChangedFiles(targetRoot, gitAdapter);
  const noChangeFastPath = buildNoChangeFastPath(reloadResult, changedFiles);
  const eventStats = readEventSignalStats(eventFile, {
    branch: gitAdapter.getCurrentBranch(targetRoot),
    includeDrift: !noChangeFastPath && mode === "COMMITTING",
    includeFallback: true,
  });
  const indexSyncCheck = readJsonOptional(indexSyncCheckFile);
  const indexSyncPayload = indexSyncCheck.data;
  const indexSyncInSync = indexSyncPayload?.in_sync === true;
  const indexSyncTargetRoot = typeof indexSyncPayload?.target_root === "string"
    ? path.resolve(indexSyncPayload.target_root)
    : null;
  const indexSyncTargetMatch = indexSyncTargetRoot === targetRoot;
  const repairLayer = stateMode === "files" && indexBackend !== "postgres"
    ? {
      exists: false,
      blocking: false,
      openCount: 0,
      severityCounts: {},
      topFindings: [],
    }
    : await readRepairLayerSummary(targetRoot, indexFile, indexBackend);

  return {
    sessionObjective,
    cycleGoal,
    changedFiles,
    noChangeFastPath,
    latestDriftMs: eventStats.latestDriftMs,
    fallbackRecentCount: eventStats.fallbackRecentCount,
    indexSyncCheckAbsolute: indexSyncCheck.absolute,
    indexSyncCheckExists: indexSyncCheck.exists,
    indexSyncInSync,
    indexSyncTargetMatch,
    indexSyncDriftLevel: indexSyncPayload?.drift_level ?? null,
    repairLayerOpenCount: repairLayer.openCount,
    repairLayerBlocking: repairLayer.blocking,
    repairLayerSeverityCounts: repairLayer.severityCounts,
    repairLayerTopFindings: repairLayer.topFindings,
  };
}
