export const DB_ONLY_STRICT_REANCHOR_PATHS = Object.freeze([
  "docs/audit/CURRENT-STATE.md",
  "docs/audit/RUNTIME-STATE.md",
  "docs/audit/HANDOFF-PACKET.md",
  "docs/audit/snapshots/context-snapshot.md",
  "docs/audit/baseline/current.md",
  "docs/audit/baseline/history.md",
  "docs/audit/parking-lot.md",
]);

export const DB_ONLY_STRICT_WORKFLOW_BOOTSTRAP_PATHS = Object.freeze([
  "AGENTS.md",
  ".gitignore",
  ".codex",
  ".codex/skills.yaml",
  "docs/audit/AGENT-ADAPTERS.md",
  "docs/audit/AGENT-ROSTER.md",
  "docs/audit/ARTIFACT_MANIFEST.md",
  "docs/audit/CODEX_ONLINE.md",
  "docs/audit/CONTINUITY_GATE.md",
  "docs/audit/CRASH-RECOVERY-RUNBOOK.md",
  "docs/audit/REANCHOR_PROMPT.md",
  "docs/audit/RULE_STATE_BOUNDARY.md",
  "docs/audit/SPEC.md",
  "docs/audit/WORKFLOW-KERNEL.md",
  "docs/audit/WORKFLOW.md",
  "docs/audit/WORKFLOW_SUMMARY.md",
  "docs/audit/backlog/TEMPLATE_SESSION_BACKLOG.md",
  "docs/audit/cycles/TEMPLATE_CYCLE.md",
  "docs/audit/cycles/TEMPLATE_STATUS.md",
  "docs/audit/cycles/TEMPLATE_audit-spec.md",
  "docs/audit/cycles/TEMPLATE_brief.md",
  "docs/audit/cycles/TEMPLATE_change-requests.md",
  "docs/audit/cycles/TEMPLATE_decisions.md",
  "docs/audit/cycles/TEMPLATE_gap-report.md",
  "docs/audit/cycles/TEMPLATE_hypotheses.md",
  "docs/audit/cycles/TEMPLATE_plan.md",
  "docs/audit/cycles/TEMPLATE_traceability.md",
  "docs/audit/cycles/cycle-status.md",
  "docs/audit/glossary.md",
  "docs/audit/incidents/TEMPLATE_INC_TMP.md",
  "docs/audit/index.md",
  "docs/audit/sessions/TEMPLATE_SESSION_SXXX.md",
]);

export const DB_ONLY_STRICT_VISIBLE_INSTALL_PREFIXES = Object.freeze([
  ".codex/skills/",
  "docs/audit/fragments/",
]);

const DB_ONLY_STRICT_VISIBLE_INSTALL_ALLOWED = new Set([
  ...DB_ONLY_STRICT_WORKFLOW_BOOTSTRAP_PATHS,
  ...DB_ONLY_STRICT_REANCHOR_PATHS,
].map(normalizeVisibleRelative));

export function normalizeVisibleRelative(value) {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .trim();
}

export function listDbOnlyStrictProtectedVisiblePaths() {
  return Array.from(DB_ONLY_STRICT_VISIBLE_INSTALL_ALLOWED);
}

export function isDbOnlyStrictVisibleInstallAllowed(relativePath) {
  const normalized = normalizeVisibleRelative(relativePath);
  if (!normalized) {
    return false;
  }
  if (DB_ONLY_STRICT_VISIBLE_INSTALL_ALLOWED.has(normalized)) {
    return true;
  }
  return DB_ONLY_STRICT_VISIBLE_INSTALL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function hasDbOnlyStrictVisibleInstallAllowedUnder(relativePath) {
  const normalized = normalizeVisibleRelative(relativePath);
  if (!normalized) {
    return false;
  }
  if (isDbOnlyStrictVisibleInstallAllowed(normalized)) {
    return true;
  }
  const prefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
  for (const allowed of DB_ONLY_STRICT_VISIBLE_INSTALL_ALLOWED) {
    if (allowed.startsWith(prefix)) {
      return true;
    }
  }
  return DB_ONLY_STRICT_VISIBLE_INSTALL_PREFIXES.some((allowedPrefix) => allowedPrefix.startsWith(prefix));
}

function extractMarkdownScalar(text, key) {
  const pattern = new RegExp(`^${key}:\\s*(.+?)\\s*$`, "imu");
  const match = String(text ?? "").match(pattern);
  if (!match) {
    return "";
  }
  return String(match[1] ?? "").trim();
}

function normalizeSessionId(value) {
  const match = String(value ?? "").trim().match(/\bS\d+[A-Za-z0-9_-]*\b/u);
  return match ? match[0] : "";
}

function normalizeCycleId(value) {
  const match = String(value ?? "").trim().match(/\bC\d+[A-Za-z0-9_-]*\b/u);
  return match ? match[0] : "";
}

export function collectDynamicReanchorProtectedPathsFromText(text) {
  const paths = [];
  const activeSession = normalizeSessionId(extractMarkdownScalar(text, "active_session"));
  const activeCycle = normalizeCycleId(extractMarkdownScalar(text, "active_cycle"));
  const scopeId = String(extractMarkdownScalar(text, "scope_id") ?? "").trim();
  const scopeType = String(extractMarkdownScalar(text, "scope_type") ?? "").trim().toLowerCase();

  if (activeSession) {
    paths.push(`docs/audit/sessions/${activeSession}.md`);
  }
  if (activeCycle) {
    paths.push(`docs/audit/cycles/${activeCycle}`);
  }
  if (scopeType === "session") {
    const scopedSession = normalizeSessionId(scopeId);
    if (scopedSession) {
      paths.push(`docs/audit/sessions/${scopedSession}.md`);
    }
  }
  if (scopeType === "cycle") {
    const scopedCycle = normalizeCycleId(scopeId);
    if (scopedCycle) {
      paths.push(`docs/audit/cycles/${scopedCycle}`);
    }
  }

  return Array.from(new Set(paths.map(normalizeVisibleRelative)));
}

export function isPathProtectedByVisiblePolicy(relativePath, protectedPaths) {
  const normalized = normalizeVisibleRelative(relativePath);
  if (!normalized) {
    return false;
  }
  for (const protectedPath of protectedPaths) {
    const protectedNormalized = normalizeVisibleRelative(protectedPath);
    if (!protectedNormalized) {
      continue;
    }
    if (normalized === protectedNormalized || normalized.startsWith(`${protectedNormalized}/`)) {
      return true;
    }
  }
  return false;
}
