import fs from "node:fs";
import path from "node:path";
import {
  loadSqliteIndexPayloadSafe,
  resolveAuditArtifactText,
  resolveDbBackedMode,
} from "../../../tools/runtime/db-first-runtime-view-lib.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function parseBoolean(value, fallback = true) {
  const normalized = normalizeScalar(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["yes", "true", "1", "on"].includes(normalized)) {
    return true;
  }
  if (["no", "false", "0", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseInteger(value, fallback = 0) {
  const parsed = Number.parseInt(normalizeScalar(value), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseRoles(value) {
  return normalizeScalar(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function createDefaultRoster() {
  return {
    file_path: null,
    source: "missing",
    logical_path: "none",
    default_requested_agent: "auto",
    agents: {},
    found: false,
  };
}

function parseRosterContent(content, rosterPath, source, logicalPath) {
  const lines = String(content ?? "").replace(/\r\n/g, "\n").split("\n");
  const roster = {
    file_path: rosterPath,
    source,
    logical_path: logicalPath,
    default_requested_agent: "auto",
    agents: {},
    found: true,
  };

  let currentSection = "__root__";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^##\s+([A-Za-z0-9_-]+)\s*$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim().toLowerCase();
      if (!roster.agents[currentSection]) {
        roster.agents[currentSection] = {
          enabled: true,
          priority: 0,
          roles: [],
          notes: "",
          adapter_module: "",
          adapter_export: "default",
          settings: {},
        };
      }
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_ -]+):\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    const key = kvMatch[1].trim().toLowerCase().replace(/\s+/g, "_");
    const value = kvMatch[2].trim();
    if (currentSection === "__root__") {
      if (key === "default_agent_selection") {
        roster.default_requested_agent = normalizeScalar(value).toLowerCase() || "auto";
      }
      continue;
    }
    const section = roster.agents[currentSection];
    if (key === "enabled") {
      section.enabled = parseBoolean(value, true);
    } else if (key === "priority") {
      section.priority = parseInteger(value, 0);
    } else if (key === "roles") {
      section.roles = parseRoles(value);
    } else if (key === "notes") {
      section.notes = normalizeScalar(value);
    } else if (key === "adapter_module") {
      section.adapter_module = normalizeScalar(value);
    } else if (key === "adapter_export") {
      section.adapter_export = normalizeScalar(value) || "default";
    } else {
      section.settings[key] = normalizeScalar(value);
    }
  }

  return roster;
}

export function loadAgentRoster({
  targetRoot,
  rosterFile = "docs/audit/AGENT-ROSTER.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const rosterPath = path.resolve(absoluteTargetRoot, rosterFile);
  const { dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
  const sqliteFallback = dbBackedMode ? loadSqliteIndexPayloadSafe(absoluteTargetRoot, { includePayload: false }) : null;
  const sqlitePayload = sqliteFallback?.payload ?? null;
  const resolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: rosterFile,
    dbBacked: dbBackedMode,
    sqlitePayload,
    sqliteRuntimeHeads: sqliteFallback?.runtimeHeads ?? {},
  });

  if (!resolution.exists) {
    return createDefaultRoster();
  }

  return parseRosterContent(
    resolution.source === "file" ? fs.readFileSync(rosterPath, "utf8") : resolution.text,
    rosterPath,
    resolution.source,
    resolution.logicalPath,
  );
}
