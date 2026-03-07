import fs from "node:fs";
import path from "node:path";
import { buildNoChangeFastPath } from "../../core/gating/gating-signal-policy.mjs";

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
  const text = readTextSafe(sessionPath);
  const kv = parseKeyValues(text);
  if (kv.session_objective) {
    return kv.session_objective;
  }
  if (kv.objective) {
    return kv.objective;
  }
  const headingMatch = text.match(/##\s*Session Objective[\s\S]*?(?:\n-|\n\*|\n\d+\.)\s*(.+)/i);
  if (headingMatch) {
    return headingMatch[1].trim();
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

function readEventSignalStats(filePath, options = {}) {
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
    const mightBeDrift = includeDrift && line.includes("\"skill\":\"drift-check\"");
    const mightBeFallback = includeFallback
      && line.includes("\"skill\":\"reload-check\"")
      && line.includes("\"result\":\"fallback\"");
    if (!mightBeDrift && !mightBeFallback) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      const skill = String(event.skill ?? "");
      if (includeDrift && skill === "drift-check") {
        const eventMs = toTimestampMs(event.ts);
        if (eventMs != null && (latestDriftMs == null || eventMs > latestDriftMs)) {
          latestDriftMs = eventMs;
        }
      }
      if (includeFallback && skill === "reload-check" && String(event.result ?? "") === "fallback") {
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

export function collectGatingObservations({ targetRoot, eventFile, indexSyncCheckFile, mode, reloadResult, gitAdapter }) {
  const sessionsRoot = path.join(targetRoot, "docs", "audit", "sessions");
  const latestSession = getLatestFileByPattern(sessionsRoot, /^S\d+.*\.md$/i);
  const sessionObjective = extractSessionObjective(latestSession);
  const cycleGoal = getActiveCycleGoal(targetRoot);
  const changedFiles = getChangedFiles(targetRoot, gitAdapter);
  const noChangeFastPath = buildNoChangeFastPath(reloadResult, changedFiles);
  const eventStats = readEventSignalStats(eventFile, {
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
  };
}
