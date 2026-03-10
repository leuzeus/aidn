import fs from "node:fs";
import path from "node:path";

const OPEN_CYCLE_STATES = new Set(["OPEN", "IMPLEMENTING", "VERIFYING"]);

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

export function parseSimpleMap(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_ -]+):\s*(.+)$/);
    if (!match) {
      continue;
    }
    map.set(String(match[1]).trim().toLowerCase().replace(/\s+/g, "_"), normalizeScalar(match[2]));
  }
  return map;
}

export function readTextIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function extractSessionField(text, fieldName) {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  const pattern = new RegExp(`^[-*]?\\s*${fieldName}:\\s*` + "`?([^`\\n]+)`?", "im");
  const match = text.match(pattern);
  return match ? normalizeScalar(match[1]) : null;
}

function extractSessionListField(text, fieldName) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }
  const lines = String(text).split(/\r?\n/);
  const items = [];
  const inlinePattern = new RegExp(`^[-*]?\\s*${fieldName}:\\s*(.*)$`, "i");
  let collecting = false;

  for (const line of lines) {
    const inlineMatch = line.match(inlinePattern);
    if (!collecting && inlineMatch) {
      const remainder = normalizeScalar(inlineMatch[1] ?? "");
      if (remainder) {
        if (!canonicalNone(remainder)) {
          items.push(...splitEntityList(remainder));
        }
        break;
      }
      collecting = true;
      continue;
    }
    if (!collecting) {
      continue;
    }
    if (/^##\s+/.test(line) || /^[-*]?\s*[a-zA-Z0-9_ -]+:\s*/.test(line)) {
      break;
    }
    const bulletMatch = line.match(/^\s*-\s+(.+)$/);
    if (!bulletMatch) {
      continue;
    }
    items.push(...splitEntityList(String(bulletMatch[1] ?? "")));
  }

  return Array.from(new Set(items.map((item) => normalizeScalar(item)).filter(Boolean)));
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

function extractSessionMode(text) {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  if (/\[\s*x\s*\]\s*COMMITTING/i.test(text)) return "COMMITTING";
  if (/\[\s*x\s*\]\s*EXPLORING/i.test(text)) return "EXPLORING";
  if (/\[\s*x\s*\]\s*THINKING/i.test(text)) return "THINKING";
  return null;
}

function extractSectionCheckbox(text, headingText) {
  const lines = String(text).split(/\r?\n/);
  let active = false;
  for (const line of lines) {
    if (line.trim().toLowerCase() === headingText.trim().toLowerCase()) {
      active = true;
      continue;
    }
    if (active && /^##\s+/.test(line)) {
      break;
    }
    if (!active) {
      continue;
    }
    const match = line.match(/^\s*-\s*\[(x| )\]\s*Yes\s*$/i);
    if (match) {
      return String(match[1]).toLowerCase() === "x";
    }
  }
  return null;
}

export function parseSessionMetadata(text) {
  const integrationTargetCycles = extractIds(extractSessionListField(text, "integration_target_cycles"), "C");
  const attachedCycles = extractIds(extractSessionListField(text, "attached_cycles"), "C");
  const reportedFromPreviousSession = extractIds(extractSessionListField(text, "reported_from_previous_session"), "C");
  const primaryFocusCycle = extractIds(extractSessionField(text, "primary_focus_cycle") ?? "", "C").at(0) ?? null;
  const legacyIntegrationTargetCycle = extractIds(extractSessionField(text, "integration_target_cycle") ?? "", "C");
  const effectiveIntegrationTargets = integrationTargetCycles.length > 0 ? integrationTargetCycles : legacyIntegrationTargetCycle;
  return {
    mode: extractSessionMode(text),
    session_branch: extractSessionField(text, "session_branch"),
    parent_session: extractSessionField(text, "parent_session"),
    branch_kind: extractSessionField(text, "branch_kind"),
    cycle_branch: extractSessionField(text, "cycle_branch"),
    intermediate_branch: extractSessionField(text, "intermediate_branch"),
    integration_target_cycle: effectiveIntegrationTargets.length === 1 ? effectiveIntegrationTargets[0] : null,
    integration_target_cycles: effectiveIntegrationTargets,
    primary_focus_cycle: primaryFocusCycle,
    attached_cycles: attachedCycles,
    reported_from_previous_session: reportedFromPreviousSession,
    carry_over_pending: extractSessionField(text, "carry_over_pending"),
    close_gate_satisfied: extractSectionCheckbox(text, "### Session close gate satisfied?"),
    snapshot_updated: extractSectionCheckbox(text, "### Snapshot updated?"),
  };
}

export function findSessionFile(auditRoot, sessionId) {
  if (!sessionId || canonicalNone(sessionId) || canonicalUnknown(sessionId)) {
    return null;
  }
  const sessionsDir = path.join(auditRoot, "sessions");
  if (!fs.existsSync(sessionsDir)) {
    return null;
  }
  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^S\d+.*\.md$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const direct = entries.find((entry) => entry.name.toUpperCase().startsWith(String(sessionId).toUpperCase()));
  return direct ? path.join(sessionsDir, direct.name) : null;
}

export function findLatestSessionFile(auditRoot) {
  const sessionsDir = path.join(auditRoot, "sessions");
  if (!fs.existsSync(sessionsDir)) {
    return null;
  }
  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^S\d+.*\.md$/i.test(entry.name))
    .map((entry) => path.join(sessionsDir, entry.name))
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left), undefined, { numeric: true, sensitivity: "base" }));
  return entries[0] ?? null;
}

export function findCycleStatus(auditRoot, cycleId) {
  if (!cycleId || canonicalNone(cycleId) || canonicalUnknown(cycleId)) {
    return null;
  }
  const cyclesDir = path.join(auditRoot, "cycles");
  if (!fs.existsSync(cyclesDir)) {
    return null;
  }
  const entries = fs.readdirSync(cyclesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.toUpperCase().startsWith(`${String(cycleId).toUpperCase()}-`))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const statusPath = path.join(cyclesDir, entry.name, "status.md");
    if (fs.existsSync(statusPath)) {
      return statusPath;
    }
  }
  return null;
}

export function readCurrentState(targetRoot) {
  const auditRoot = path.join(targetRoot, "docs", "audit");
  const filePath = path.join(auditRoot, "CURRENT-STATE.md");
  const text = readTextIfExists(filePath);
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
    dor_state: normalizeScalar(map.get("dor_state") ?? "unknown") || "unknown",
    first_plan_step: normalizeScalar(map.get("first_plan_step") ?? "unknown") || "unknown",
  };
}

export function readSourceBranch(targetRoot) {
  const baselinePath = path.join(targetRoot, "docs", "audit", "baseline", "current.md");
  const text = readTextIfExists(baselinePath);
  const map = parseSimpleMap(text);
  const sourceBranch = normalizeScalar(map.get("source_branch") ?? "");
  return sourceBranch || null;
}

export function listSessionArtifacts(auditRoot) {
  const sessionsDir = path.join(auditRoot, "sessions");
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }
  return fs.readdirSync(sessionsDir, { withFileTypes: true })
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
}

export function listCycleStatuses(auditRoot) {
  const cyclesDir = path.join(auditRoot, "cycles");
  if (!fs.existsSync(cyclesDir)) {
    return [];
  }
  return fs.readdirSync(cyclesDir, { withFileTypes: true })
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
        continuity_rule: normalizeScalar(map.get("continuity_rule") ?? "none") || "none",
        continuity_base_branch: normalizeScalar(map.get("continuity_base_branch") ?? "none") || "none",
        continuity_latest_cycle_branch: normalizeScalar(map.get("continuity_latest_cycle_branch") ?? "none") || "none",
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.cycle_id.localeCompare(right.cycle_id, undefined, { numeric: true, sensitivity: "base" }));
}

export function isOpenCycleState(state) {
  return OPEN_CYCLE_STATES.has(String(state ?? "").toUpperCase());
}

export function collectOpenCycles(cycles) {
  return (Array.isArray(cycles) ? cycles : []).filter((cycle) => isOpenCycleState(cycle?.state));
}
