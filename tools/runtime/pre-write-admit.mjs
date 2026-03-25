#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createLocalGitAdapter } from "../../src/adapters/runtime/local-git-adapter.mjs";
import { WORKFLOW_REPAIR_HINT } from "../../src/application/runtime/workflow-transition-constants.mjs";
import { evaluateRepairRouting } from "../../src/application/runtime/workflow-transition-lib.mjs";
import { resolveEffectiveStateMode } from "../../src/core/state-mode/state-mode-policy.mjs";
import { readIndexFromSqlite, readRuntimeHeadArtifactsFromSqlite } from "../../src/lib/sqlite/index-sqlite-lib.mjs";
import { evaluateCurrentStateConsistency } from "../perf/verify-current-state-consistency.mjs";

const DEFAULT_POLICY = Object.freeze({
  requireMode: true,
  requireBranchKind: false,
  requireActiveSession: false,
  requireActiveCycle: false,
  requireCycleStatus: false,
  requireDorReady: false,
  requireFirstPlanStep: false,
  requireFreshCurrentState: false,
  requireRuntimeClearInDbModes: false,
});

const SKILL_POLICIES = Object.freeze({
  "start-session": {
    requireMode: false,
  },
  "close-session": {
    requireActiveSession: true,
  },
  "branch-cycle-audit": {
    requireMode: false,
  },
  "drift-check": {
    requireMode: false,
  },
  "handoff-close": {
    requireActiveSession: false,
  },
  "cycle-create": {
    requireFreshCurrentState: true,
    requireRuntimeClearInDbModes: true,
  },
  "cycle-close": {
    requireBranchKind: true,
    requireActiveCycle: true,
    requireCycleStatus: true,
    requireFreshCurrentState: true,
    requireRuntimeClearInDbModes: true,
  },
  "promote-baseline": {
    requireBranchKind: true,
    requireActiveCycle: true,
    requireCycleStatus: true,
    requireDorReady: true,
    requireFreshCurrentState: true,
    requireRuntimeClearInDbModes: true,
  },
  "requirements-delta": {
    requireActiveCycle: true,
    requireCycleStatus: true,
    requireFreshCurrentState: true,
    requireRuntimeClearInDbModes: true,
  },
  "convert-to-spike": {
    requireActiveCycle: true,
    requireCycleStatus: true,
    requireFreshCurrentState: true,
    requireRuntimeClearInDbModes: true,
  },
});

function parseArgs(argv) {
  const args = {
    target: ".",
    skill: "",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: "docs/audit/RUNTIME-STATE.md",
    strict: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--skill") {
      args.skill = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--current-state-file") {
      args.currentStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--runtime-state-file") {
      args.runtimeStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime pre-write-admit --target . --json");
  console.log("  npx aidn runtime pre-write-admit --target . --skill cycle-create --strict --json");
  console.log("  npx aidn runtime pre-write-admit --target tests/fixtures/perf-handoff/ready --skill requirements-delta --json");
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

function exists(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath);
}

function readTextIfExists(filePath) {
  return exists(filePath) ? fs.readFileSync(filePath, "utf8") : "";
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

const RUNTIME_HEAD_KEYS_BY_PATH = new Map([
  ["CURRENT-STATE.md", "current_state"],
  ["RUNTIME-STATE.md", "runtime_state"],
  ["HANDOFF-PACKET.md", "handoff_packet"],
  ["AGENT-ROSTER.md", "agent_roster"],
  ["AGENT-HEALTH-SUMMARY.md", "agent_health_summary"],
  ["AGENT-SELECTION-SUMMARY.md", "agent_selection_summary"],
  ["MULTI-AGENT-STATUS.md", "multi_agent_status"],
  ["COORDINATION-SUMMARY.md", "coordination_summary"],
]);

function resolveRuntimeHeadKeyForArtifactPath(artifactPath) {
  const normalized = normalizeRelativeArtifactPath(artifactPath);
  if (!normalized) {
    return "";
  }
  const fileName = normalized.split("/").pop() ?? "";
  return RUNTIME_HEAD_KEYS_BY_PATH.get(fileName) ?? "";
}

function findRuntimeHeadArtifact(runtimeHeads, artifactPath) {
  if (!runtimeHeads || typeof runtimeHeads !== "object") {
    return null;
  }
  const headKey = resolveRuntimeHeadKeyForArtifactPath(artifactPath);
  if (!headKey) {
    return null;
  }
  const artifact = runtimeHeads[headKey];
  return artifact && normalizeRelativeArtifactPath(artifact.path) ? artifact : null;
}

function normalizeScalar(value) {
  const normalized = String(value ?? "").trim();
  if (normalized.startsWith("`") && normalized.endsWith("`") && normalized.length >= 2) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

function canonicalNone(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return normalized === "none" || normalized === "(none)";
}

function canonicalUnknown(value) {
  return normalizeScalar(value).toLowerCase() === "unknown";
}

function normalizeUsageMatrixScope(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  if (normalized === "shared" || normalized === "high-risk") {
    return normalized;
  }
  return "local";
}

function normalizeUsageMatrixState(value) {
  const normalized = normalizeScalar(value).toUpperCase();
  if (["NOT_DEFINED", "DECLARED", "PARTIAL", "VERIFIED", "WAIVED"].includes(normalized)) {
    return normalized;
  }
  return "NOT_DEFINED";
}

function usageMatrixSatisfied({ scope, state, rationale }) {
  if (scope === "local") {
    return true;
  }
  if (state === "VERIFIED") {
    return true;
  }
  if (state === "WAIVED" && String(rationale ?? "").trim().length > 0 && String(rationale ?? "").trim().toLowerCase() !== "none") {
    return true;
  }
  return false;
}

function isResolvedPlanningArbitrationStatus(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return !normalized
    || normalized === "none"
    || normalized === "resolved"
    || normalized === "closed"
    || normalized === "approved"
    || normalized === "cleared";
}

function parseSimpleMap(text) {
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

function parseListSection(text, header) {
  const lines = String(text).split(/\r?\n/);
  const items = [];
  let active = false;
  for (const line of lines) {
    if (line.trim() === `${header}:`) {
      active = true;
      continue;
    }
    if (active && (/^[A-Za-z0-9_]+:\s*/.test(line) || /^##\s+/.test(line))) {
      break;
    }
    if (active) {
      const match = line.match(/^\s*-\s+(.+)$/);
      if (match) {
        const item = normalizeScalar(match[1]);
        if (item) {
          items.push(item);
        }
      }
    }
  }
  return items;
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

function findCycleStatus(auditRoot, cycleId) {
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

function deriveFirstPlanStep(planText) {
  const lines = String(planText).split(/\r?\n/);
  let inTasks = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "## Tasks") {
      inTasks = true;
      continue;
    }
    if (inTasks && /^##\s+/.test(line)) {
      break;
    }
    if (!inTasks) {
      continue;
    }
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered && normalizeScalar(numbered[1])) {
      return normalizeScalar(numbered[1]);
    }
    const bullet = line.match(/^-\s+(.+)$/);
    if (bullet && normalizeScalar(bullet[1])) {
      return normalizeScalar(bullet[1]);
    }
  }
  return "unknown";
}

function uniqueItems(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeScalar(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function summarizePorcelain(lines, limit = 3) {
  return lines.slice(0, limit).map((line) => normalizeScalar(line));
}

function evaluateCycleCreateGitGate(targetRoot) {
  const git = createLocalGitAdapter();
  const currentBranch = normalizeScalar(git.getCurrentBranch(targetRoot) ?? "unknown") || "unknown";
  const repoRoot = normalizeScalar(typeof git.getRepoRoot === "function" ? git.getRepoRoot(targetRoot) : "") || "none";
  const repoScoped = repoRoot !== "none" && path.resolve(repoRoot) === path.resolve(targetRoot);
  const output = {
    branch: currentBranch,
    repo_root: repoRoot,
    repo_scoped: repoScoped,
    upstream_branch: "none",
    upstream_ahead: 0,
    upstream_behind: 0,
    dirty_entries: [],
    blocking_reasons: [],
    warnings: [],
  };

  try {
    const statusOutput = git.execStatusPorcelain(targetRoot, ".", true);
    output.dirty_entries = String(statusOutput)
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
  } catch {
    output.warnings.push("git status is unavailable; cycle-create hygiene could not be verified automatically");
    return output;
  }

  if (output.dirty_entries.length > 0) {
    const samples = summarizePorcelain(output.dirty_entries).join(", ");
    output.blocking_reasons.push(
      `git working tree is not clean before cycle creation; reconcile pending files first (${samples}${output.dirty_entries.length > 3 ? ", ..." : ""})`,
    );
  }

  if (!repoScoped) {
    output.warnings.push("target is not the git repository root; upstream sync gate is skipped for this pre-write check");
    return output;
  }

  if (typeof git.getUpstreamBranch !== "function" || typeof git.getAheadBehind !== "function") {
    output.warnings.push("upstream sync check is unavailable in the current git adapter");
    return output;
  }

  const upstreamBranch = normalizeScalar(git.getUpstreamBranch(targetRoot) ?? "") || "none";
  output.upstream_branch = upstreamBranch;
  if (upstreamBranch === "none" || currentBranch === "unknown") {
    output.warnings.push("no upstream tracking branch is configured; push/merge reconciliation cannot be verified automatically");
    return output;
  }

  const divergence = git.getAheadBehind(targetRoot, "HEAD", upstreamBranch);
  if (divergence?.known !== true) {
    output.warnings.push(`upstream divergence for ${currentBranch} could not be determined automatically`);
    return output;
  }

  output.upstream_ahead = Number(divergence.ahead ?? 0);
  output.upstream_behind = Number(divergence.behind ?? 0);
  if (output.upstream_ahead > 0 || output.upstream_behind > 0) {
    output.blocking_reasons.push(
      `current branch ${currentBranch} diverges from ${upstreamBranch}: ahead ${output.upstream_ahead}, behind ${output.upstream_behind}; push/reconcile before creating a new cycle`,
    );
  }
  return output;
}

function evaluateSessionIntegrationGate(targetRoot, {
  branchKind,
  sessionBranch,
  cycleBranch,
} = {}) {
  const output = {
    applicable: false,
    session_branch: normalizeScalar(sessionBranch ?? "") || "none",
    cycle_branch: normalizeScalar(cycleBranch ?? "") || "none",
    session_upstream_branch: "none",
    session_upstream_ahead: 0,
    session_upstream_behind: 0,
    cycle_upstream_branch: "none",
    cycle_upstream_ahead: 0,
    cycle_upstream_behind: 0,
    cycle_merged_into_session: "unknown",
    blocking_reasons: [],
    warnings: [],
  };
  if (String(branchKind).toLowerCase() !== "session") {
    return output;
  }
  output.applicable = true;
  if (canonicalNone(output.session_branch) || canonicalUnknown(output.session_branch)) {
    output.warnings.push("session integration gate could not verify the session branch");
    return output;
  }
  if (canonicalNone(output.cycle_branch) || canonicalUnknown(output.cycle_branch)) {
    output.warnings.push("session integration gate could not verify the previous cycle branch");
    return output;
  }

  const git = createLocalGitAdapter();
  const repoRoot = normalizeScalar(typeof git.getRepoRoot === "function" ? git.getRepoRoot(targetRoot) : "") || "none";
  if (repoRoot === "none" || path.resolve(repoRoot) !== path.resolve(targetRoot)) {
    output.warnings.push("session integration gate is skipped because the target is not the git repository root");
    return output;
  }
  if (typeof git.refExists !== "function" || typeof git.isAncestor !== "function") {
    output.warnings.push("session integration gate is unavailable in the current git adapter");
    return output;
  }
  if (!git.refExists(targetRoot, output.session_branch)) {
    output.warnings.push(`session branch ${output.session_branch} is not available locally`);
    return output;
  }
  if (!git.refExists(targetRoot, output.cycle_branch)) {
    output.warnings.push(`previous cycle branch ${output.cycle_branch} is not available locally`);
    return output;
  }

  const cycleUpstreamBranch = normalizeScalar(typeof git.getUpstreamBranch === "function" ? git.getUpstreamBranch(targetRoot, output.cycle_branch) : "") || "none";
  output.cycle_upstream_branch = cycleUpstreamBranch;
  if (cycleUpstreamBranch !== "none" && typeof git.getAheadBehind === "function") {
    const divergence = git.getAheadBehind(targetRoot, output.cycle_branch, cycleUpstreamBranch);
    if (divergence?.known === true) {
      output.cycle_upstream_ahead = Number(divergence.ahead ?? 0);
      output.cycle_upstream_behind = Number(divergence.behind ?? 0);
      if (output.cycle_upstream_ahead > 0 || output.cycle_upstream_behind > 0) {
        output.blocking_reasons.push(
          `previous cycle branch ${output.cycle_branch} diverges from ${cycleUpstreamBranch}: ahead ${output.cycle_upstream_ahead}, behind ${output.cycle_upstream_behind}; push/reconcile the previous cycle before creating a new one`,
        );
      }
    }
  } else {
    output.warnings.push(`previous cycle branch ${output.cycle_branch} has no upstream tracking branch; push status cannot be verified automatically`);
  }

  output.cycle_merged_into_session = git.isAncestor(targetRoot, output.cycle_branch, output.session_branch) ? "yes" : "no";
  if (output.cycle_merged_into_session !== "yes") {
    output.blocking_reasons.push(
      `previous cycle branch ${output.cycle_branch} is not merged into session branch ${output.session_branch}; merge or close/report the cycle before creating a new one`,
    );
  }

  const sessionUpstreamBranch = normalizeScalar(typeof git.getUpstreamBranch === "function" ? git.getUpstreamBranch(targetRoot, output.session_branch) : "") || "none";
  output.session_upstream_branch = sessionUpstreamBranch;
  if (sessionUpstreamBranch !== "none" && typeof git.getAheadBehind === "function") {
    const divergence = git.getAheadBehind(targetRoot, output.session_branch, sessionUpstreamBranch);
    if (divergence?.known === true) {
      output.session_upstream_ahead = Number(divergence.ahead ?? 0);
      output.session_upstream_behind = Number(divergence.behind ?? 0);
      if (output.session_upstream_ahead > 0 || output.session_upstream_behind > 0) {
        output.blocking_reasons.push(
          `session branch ${output.session_branch} diverges from ${sessionUpstreamBranch}: ahead ${output.session_upstream_ahead}, behind ${output.session_upstream_behind}; reconcile the merged session branch before creating a new cycle`,
        );
      }
    }
  } else {
    output.warnings.push(`session branch ${output.session_branch} has no upstream tracking branch; post-merge reconciliation cannot be verified automatically`);
  }

  return output;
}

function classifyRepairFindingSummary(item) {
  const text = String(item ?? "").trim();
  if (!text) {
    return null;
  }
  if (text.includes("UNTRACKED_CYCLE_STATUS_REFERENCE")) {
    return "repair layer found a locally present cycle status artifact that is not tracked/materialized in the current index";
  }
  if (text.includes("UNINDEXED_CYCLE_STATUS_REFERENCE")) {
    return "repair layer found a tracked cycle status artifact that is still missing from the current index";
  }
  return null;
}

function relativePath(root, filePath) {
  if (!filePath) {
    return "none";
  }
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function loadSqliteIndexPayloadSafe(targetRoot) {
  const sqliteFile = path.join(targetRoot, ".aidn", "runtime", "index", "workflow-index.sqlite");
  if (!exists(sqliteFile)) {
    return {
      exists: false,
      sqliteFile,
      payload: null,
      runtimeHeads: {},
      warning: "",
    };
  }
  try {
    return {
      exists: true,
      sqliteFile,
      payload: readIndexFromSqlite(sqliteFile).payload,
      runtimeHeads: readRuntimeHeadArtifactsFromSqlite(sqliteFile).heads,
      warning: "",
    };
  } catch (error) {
    return {
      exists: true,
      sqliteFile,
      payload: null,
      runtimeHeads: {},
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

function resolveAuditArtifactText({
  targetRoot,
  candidatePath,
  dbBacked = false,
  sqlitePayload = null,
  sqliteRuntimeHeads = null,
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
  if (!dbBacked) {
    return {
      exists: false,
      source: "missing",
      absolutePath,
      logicalPath: relativePath(targetRoot, absolutePath),
      artifactPath: normalizeRelativeArtifactPath(candidatePath),
      text: "",
    };
  }
  const runtimeHeadArtifact = findRuntimeHeadArtifact(sqliteRuntimeHeads, candidatePath);
  const runtimeHeadText = decodeArtifactContent(runtimeHeadArtifact);
  if (runtimeHeadArtifact && runtimeHeadText) {
    return {
      exists: true,
      source: "sqlite",
      absolutePath,
      logicalPath: toAuditArtifactPath(runtimeHeadArtifact.path),
      artifactPath: normalizeRelativeArtifactPath(runtimeHeadArtifact.path),
      text: runtimeHeadText,
    };
  }
  if (!sqlitePayload) {
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

function findSessionArtifact(sqlitePayload, sessionId) {
  if (!sqlitePayload || !Array.isArray(sqlitePayload.artifacts) || !sessionId || canonicalNone(sessionId) || canonicalUnknown(sessionId)) {
    return null;
  }
  return sqlitePayload.artifacts.find((artifact) => {
    const rel = normalizeRelativeArtifactPath(artifact?.path);
    return rel.startsWith(`sessions/${sessionId}`) && rel.endsWith(".md");
  }) ?? null;
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

function findCyclePlanArtifact(sqlitePayload, cycleId, cycleStatusArtifactPath = "") {
  if (!sqlitePayload || !Array.isArray(sqlitePayload.artifacts)) {
    return null;
  }
  const preferred = normalizeRelativeArtifactPath(cycleStatusArtifactPath);
  if (preferred) {
    const sibling = preferred.replace(/\/status\.md$/i, "/plan.md");
    const direct = findArtifactByPath(sqlitePayload, sibling);
    if (direct) {
      return direct;
    }
  }
  if (!cycleId || canonicalNone(cycleId) || canonicalUnknown(cycleId)) {
    return null;
  }
  return sqlitePayload.artifacts.find((artifact) => {
    const rel = normalizeRelativeArtifactPath(artifact?.path);
    return String(artifact?.cycle_id ?? "") === cycleId && rel.endsWith("/plan.md");
  }) ?? null;
}

function resolveSessionArtifact({ targetRoot, auditRoot, sessionId, dbBacked = false, sqlitePayload = null } = {}) {
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

function resolveCycleStatusArtifact({ targetRoot, auditRoot, cycleId, dbBacked = false, sqlitePayload = null } = {}) {
  const filePath = findCycleStatus(auditRoot, cycleId);
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

function resolveCyclePlanArtifact({
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
  const artifact = findCyclePlanArtifact(sqlitePayload, cycleId, cycleStatusResolution?.artifactPath);
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

function mergePolicy(skill) {
  const specific = SKILL_POLICIES[skill] ?? {};
  return { ...DEFAULT_POLICY, ...specific };
}

function addCheck(checks, key, pass, details) {
  checks[key] = {
    pass,
    details,
  };
}

export function preWriteAdmit({
  targetRoot,
  skill = "",
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const auditRoot = path.join(absoluteTargetRoot, "docs", "audit");
  const effectiveStateMode = resolveEffectiveStateMode({
    targetRoot: absoluteTargetRoot,
    stateMode: "files",
  });
  const dbBackedMode = effectiveStateMode === "dual" || effectiveStateMode === "db-only";
  const sqliteFallback = dbBackedMode ? loadSqliteIndexPayloadSafe(absoluteTargetRoot) : {
    exists: false,
    sqliteFile: "",
    payload: null,
    runtimeHeads: {},
    warning: "",
  };
  const currentStateResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: currentStateFile,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
  });
  const runtimeStateResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: runtimeStateFile,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
  });
  const currentStatePath = currentStateResolution.absolutePath;
  const runtimeStatePath = runtimeStateResolution.absolutePath;
  const currentStateText = currentStateResolution.text;
  const runtimeStateText = runtimeStateResolution.text;
  const currentMap = parseSimpleMap(currentStateText);
  const runtimeMap = parseSimpleMap(runtimeStateText);
  const policy = mergePolicy(skill);
  const checks = {};
  const blockingReasons = [];
  const warnings = [];

  if (sqliteFallback.warning) {
    warnings.push(sqliteFallback.warning);
  }

  const currentStateExists = currentStateResolution.exists;
  addCheck(checks, "current_state_exists", currentStateExists, currentStateExists
    ? `CURRENT-STATE.md available via ${currentStateResolution.source}`
    : "CURRENT-STATE.md missing");
  if (!currentStateExists) {
    blockingReasons.push("missing docs/audit/CURRENT-STATE.md");
  }

  const consistency = currentStateResolution.source === "file"
    ? evaluateCurrentStateConsistency({ targetRoot: absoluteTargetRoot })
    : currentStateExists
      ? { pass: true, checks: {}, skipped_in_db_mode: true }
      : { pass: false, checks: {} };
  addCheck(checks, "current_state_consistency", consistency.pass === true, consistency.pass
    ? (consistency.skipped_in_db_mode
      ? "CURRENT-STATE consistency checks deferred because the artifact was resolved from SQLite"
      : "CURRENT-STATE.md consistency checks passed")
    : "CURRENT-STATE.md consistency checks reported issues");
  if (currentStateResolution.source === "file" && currentStateExists && consistency.pass !== true) {
    warnings.push("CURRENT-STATE.md consistency checks reported issues; verify session/cycle facts before writing");
  }

  const mode = normalizeScalar(currentMap.get("mode") ?? "unknown") || "unknown";
  const branchKind = normalizeScalar(currentMap.get("branch_kind") ?? "unknown") || "unknown";
  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
  const dorState = normalizeScalar(currentMap.get("dor_state") ?? "unknown") || "unknown";
  const currentFirstPlanStep = normalizeScalar(currentMap.get("first_plan_step") ?? "unknown") || "unknown";
  const activeBacklog = normalizeScalar(currentMap.get("active_backlog") ?? "none") || "none";
  const backlogStatus = normalizeScalar(currentMap.get("backlog_status") ?? "unknown") || "unknown";
  const backlogNextStep = normalizeScalar(currentMap.get("backlog_next_step") ?? "unknown") || "unknown";
  const backlogSelectedExecutionScope = normalizeScalar(currentMap.get("backlog_selected_execution_scope") ?? "none") || "none";
  const planningArbitrationStatus = normalizeScalar(currentMap.get("planning_arbitration_status") ?? "none") || "none";
  const cycleBranch = normalizeScalar(currentMap.get("cycle_branch") ?? "none") || "none";
  const sessionBranch = normalizeScalar(currentMap.get("session_branch") ?? "none") || "none";

  const sessionResolution = resolveSessionArtifact({
    targetRoot: absoluteTargetRoot,
    auditRoot,
    sessionId: activeSession,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
  });
  const cycleStatusResolution = resolveCycleStatusArtifact({
    targetRoot: absoluteTargetRoot,
    auditRoot,
    cycleId: activeCycle,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
  });
  const sessionFile = sessionResolution.filePath;
  const cycleStatusFile = cycleStatusResolution.filePath;
  const cycleStatusText = cycleStatusResolution.text;
  const cycleStatusMap = parseSimpleMap(cycleStatusText);
  const planResolution = resolveCyclePlanArtifact({
    targetRoot: absoluteTargetRoot,
    cycleStatusResolution,
    cycleId: activeCycle,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
  });
  const planFile = planResolution.filePath;
  const planText = planResolution.text;
  const derivedFirstPlanStep = deriveFirstPlanStep(planText);
  const effectiveFirstPlanStep = !canonicalUnknown(currentFirstPlanStep) && !canonicalNone(currentFirstPlanStep)
    ? currentFirstPlanStep
    : derivedFirstPlanStep;

  const runtimeStateExists = runtimeStateResolution.exists;
  const runtimeStateMode = normalizeScalar(runtimeMap.get("runtime_state_mode") ?? currentMap.get("runtime_state_mode") ?? effectiveStateMode ?? "unknown") || "unknown";
  const repairLayerStatus = normalizeScalar(runtimeMap.get("repair_layer_status") ?? currentMap.get("repair_layer_status") ?? "unknown") || "unknown";
  const currentStateFreshness = normalizeScalar(runtimeMap.get("current_state_freshness") ?? "unknown") || "unknown";
  const blockingFindings = uniqueItems(
    parseListSection(runtimeStateText, "blocking_findings")
      .filter((item) => item.toLowerCase() !== "none"),
  );
  const dorOverrideReason = normalizeScalar(cycleStatusMap.get("dor_override_reason") ?? "none") || "none";
  const mappedCycleBranch = normalizeScalar(cycleStatusMap.get("branch_name") ?? "none") || "none";
  const usageMatrixScope = normalizeUsageMatrixScope(cycleStatusMap.get("usage_matrix_scope") ?? "local");
  const usageMatrixState = normalizeUsageMatrixState(cycleStatusMap.get("usage_matrix_state") ?? "NOT_DEFINED");
  const usageMatrixSummary = normalizeScalar(cycleStatusMap.get("usage_matrix_summary") ?? "none") || "none";
  const usageMatrixRationale = normalizeScalar(cycleStatusMap.get("usage_matrix_rationale") ?? "none") || "none";
  const cycleCreateGitGate = skill === "cycle-create"
    ? evaluateCycleCreateGitGate(absoluteTargetRoot)
    : null;
  const sessionIntegrationGate = skill === "cycle-create"
    ? evaluateSessionIntegrationGate(absoluteTargetRoot, {
      branchKind,
      sessionBranch,
      cycleBranch: !canonicalNone(mappedCycleBranch) && !canonicalUnknown(mappedCycleBranch)
        ? mappedCycleBranch
        : cycleBranch,
    })
    : null;

  addCheck(checks, "mode_known", !canonicalUnknown(mode), `mode=${mode}`);
  if (policy.requireMode && canonicalUnknown(mode)) {
    blockingReasons.push("mode is unknown");
  }

  addCheck(checks, "branch_kind_known", !canonicalUnknown(branchKind), `branch_kind=${branchKind}`);
  if (policy.requireBranchKind && canonicalUnknown(branchKind)) {
    blockingReasons.push("branch kind is unknown");
  }

  addCheck(checks, "active_session_known", !canonicalUnknown(activeSession), `active_session=${activeSession}`);
  if (policy.requireActiveSession && (canonicalUnknown(activeSession) || canonicalNone(activeSession))) {
    blockingReasons.push("active session is missing");
  }

  addCheck(checks, "active_cycle_known", !canonicalUnknown(activeCycle) && !canonicalNone(activeCycle), `active_cycle=${activeCycle}`);
  if (policy.requireActiveCycle && (canonicalUnknown(activeCycle) || canonicalNone(activeCycle))) {
    blockingReasons.push("active cycle is missing");
  }

  addCheck(checks, "session_file_exists", sessionResolution.exists, sessionResolution.exists
    ? `session artifact resolved via ${sessionResolution.source}: ${sessionResolution.logicalPath}`
    : "session file not resolved");
  if (policy.requireActiveSession && !sessionResolution.exists) {
    blockingReasons.push("active session file is missing");
  }

  addCheck(checks, "cycle_status_exists", cycleStatusResolution.exists, cycleStatusResolution.exists
    ? `cycle status resolved via ${cycleStatusResolution.source}: ${cycleStatusResolution.logicalPath}`
    : "cycle status file not resolved");
  if (policy.requireCycleStatus && !cycleStatusResolution.exists) {
    blockingReasons.push("active cycle status file is missing");
  }

  addCheck(checks, "first_plan_step_known", !canonicalUnknown(effectiveFirstPlanStep) && !canonicalNone(effectiveFirstPlanStep), `first_plan_step=${effectiveFirstPlanStep}`);
  if (policy.requireFirstPlanStep && (canonicalUnknown(effectiveFirstPlanStep) || canonicalNone(effectiveFirstPlanStep))) {
    blockingReasons.push("first implementation step is unknown");
  }
  if (!canonicalUnknown(currentFirstPlanStep) && !canonicalUnknown(derivedFirstPlanStep)
    && !canonicalNone(currentFirstPlanStep) && !canonicalNone(derivedFirstPlanStep)
    && currentFirstPlanStep !== derivedFirstPlanStep) {
    warnings.push("CURRENT-STATE.md first_plan_step differs from the first parseable plan task");
  }

  addCheck(checks, "dor_ready_or_override", dorState === "READY" || !canonicalNone(dorOverrideReason), `dor_state=${dorState}; dor_override_reason=${dorOverrideReason}`);
  if (policy.requireDorReady && dorState !== "READY" && canonicalNone(dorOverrideReason)) {
    blockingReasons.push("dor_state is not READY and no override reason is documented");
  } else if (policy.requireDorReady && dorState !== "READY" && !canonicalNone(dorOverrideReason)) {
    warnings.push(`DoR override in effect: ${dorOverrideReason}`);
  }

  addCheck(
    checks,
    "usage_matrix_cycle_close_ready",
    skill !== "cycle-close"
      || normalizeScalar(cycleStatusMap.get("state") ?? "unknown").toUpperCase() !== "DONE"
      || usageMatrixSatisfied({
        scope: usageMatrixScope,
        state: usageMatrixState,
        rationale: usageMatrixRationale,
      }),
    `usage_matrix_scope=${usageMatrixScope}; usage_matrix_state=${usageMatrixState}`,
  );
  if (
    skill === "cycle-close"
    && normalizeScalar(cycleStatusMap.get("state") ?? "unknown").toUpperCase() === "DONE"
    && !usageMatrixSatisfied({
      scope: usageMatrixScope,
      state: usageMatrixState,
      rationale: usageMatrixRationale,
    })
  ) {
    blockingReasons.push(
      `cycle ${activeCycle} is marked DONE but usage matrix is not complete for cycle-close (scope=${usageMatrixScope}, state=${usageMatrixState})`,
    );
  }

  addCheck(checks, "runtime_state_exists", runtimeStateExists, runtimeStateExists
    ? `runtime digest resolved via ${runtimeStateResolution.source}: ${runtimeStateResolution.logicalPath}`
    : "runtime digest missing");

  addCheck(checks, "runtime_repair_status_known", !canonicalUnknown(repairLayerStatus), `repair_layer_status=${repairLayerStatus}`);
  addCheck(checks, "current_state_freshness_known", !canonicalUnknown(currentStateFreshness), `current_state_freshness=${currentStateFreshness}`);

  const repairRouting = evaluateRepairRouting({
    status: repairLayerStatus,
    advice: normalizeScalar(runtimeMap.get("repair_routing_reason") ?? runtimeMap.get("repair_layer_advice") ?? "unknown") || "unknown",
    blocking: repairLayerStatus.toLowerCase() === "block",
  });

  if (repairRouting.routing_hint === WORKFLOW_REPAIR_HINT.REPAIR) {
    blockingReasons.push(blockingFindings.length > 0
      ? `repair layer is blocking: ${blockingFindings.join(", ")}`
      : "repair layer is blocking");
  } else if (repairRouting.routing_hint === WORKFLOW_REPAIR_HINT.AUDIT_FIRST) {
    const repairSpecificWarning = blockingFindings
      .map((item) => classifyRepairFindingSummary(item))
      .find(Boolean);
    if (repairSpecificWarning) {
      warnings.push(repairSpecificWarning);
    }
  }

  if (policy.requireFreshCurrentState) {
    if (currentStateFreshness.toLowerCase() === "stale") {
      blockingReasons.push("CURRENT-STATE.md is stale according to RUNTIME-STATE.md");
    } else if (canonicalUnknown(currentStateFreshness)) {
      if (["dual", "db-only"].includes(runtimeStateMode.toLowerCase())) {
        blockingReasons.push("current state freshness is unknown in DB-backed mode");
      } else {
        warnings.push("current state freshness is unknown; confirm live session/cycle facts before writing");
      }
    }
  }

  if (policy.requireRuntimeClearInDbModes && ["dual", "db-only"].includes(runtimeStateMode.toLowerCase())) {
    if (!runtimeStateExists) {
      blockingReasons.push("runtime digest is missing in DB-backed mode");
    }
    if (canonicalUnknown(repairLayerStatus)) {
      blockingReasons.push("repair layer status is unknown in DB-backed mode");
    }
  }

  if (!canonicalNone(cycleBranch) && !canonicalNone(mappedCycleBranch) && !canonicalUnknown(mappedCycleBranch)
    && cycleBranch !== mappedCycleBranch) {
    blockingReasons.push(`cycle branch mismatch: CURRENT-STATE=${cycleBranch} status.md=${mappedCycleBranch}`);
  }

  if (mode === "COMMITTING" && branchKind === "session") {
    warnings.push("COMMITTING work on a session branch should stay limited to integration, handoff, or orchestration unless explicitly documented");
  }

  if (cycleCreateGitGate) {
    addCheck(checks, "git_cycle_create_clean", cycleCreateGitGate.dirty_entries.length === 0, cycleCreateGitGate.dirty_entries.length === 0
      ? "git working tree is clean for cycle creation"
      : `pending files detected before cycle creation: ${summarizePorcelain(cycleCreateGitGate.dirty_entries).join(", ")}`);
    addCheck(checks, "git_cycle_create_upstream_sync", cycleCreateGitGate.upstream_ahead === 0 && cycleCreateGitGate.upstream_behind === 0, cycleCreateGitGate.upstream_branch === "none"
      ? "upstream sync not configured"
      : `upstream=${cycleCreateGitGate.upstream_branch}; ahead=${cycleCreateGitGate.upstream_ahead}; behind=${cycleCreateGitGate.upstream_behind}`);
    blockingReasons.push(...cycleCreateGitGate.blocking_reasons);
    warnings.push(...cycleCreateGitGate.warnings);
  }
  if (sessionIntegrationGate?.applicable) {
    addCheck(checks, "cycle_create_previous_cycle_merged_into_session", sessionIntegrationGate.cycle_merged_into_session === "yes", `cycle_merged_into_session=${sessionIntegrationGate.cycle_merged_into_session}`);
    addCheck(checks, "cycle_create_session_branch_reconciled", sessionIntegrationGate.session_upstream_ahead === 0 && sessionIntegrationGate.session_upstream_behind === 0, sessionIntegrationGate.session_upstream_branch === "none"
      ? "session upstream sync not configured"
      : `session_upstream=${sessionIntegrationGate.session_upstream_branch}; ahead=${sessionIntegrationGate.session_upstream_ahead}; behind=${sessionIntegrationGate.session_upstream_behind}`);
    addCheck(checks, "cycle_create_previous_cycle_branch_pushed", sessionIntegrationGate.cycle_upstream_ahead === 0 && sessionIntegrationGate.cycle_upstream_behind === 0, sessionIntegrationGate.cycle_upstream_branch === "none"
      ? "cycle upstream sync not configured"
      : `cycle_upstream=${sessionIntegrationGate.cycle_upstream_branch}; ahead=${sessionIntegrationGate.cycle_upstream_ahead}; behind=${sessionIntegrationGate.cycle_upstream_behind}`);
    blockingReasons.push(...sessionIntegrationGate.blocking_reasons);
    warnings.push(...sessionIntegrationGate.warnings);
  }

  const promotedSharedPlanning = !canonicalNone(activeBacklog)
    && !canonicalUnknown(activeBacklog)
    && !canonicalNone(backlogStatus)
    && !canonicalUnknown(backlogStatus)
    && backlogStatus.toLowerCase() !== "closed"
    && backlogStatus.toLowerCase() !== "consumed_by_cycle";
  addCheck(checks, "shared_planning_scope_selected", !promotedSharedPlanning || (!canonicalNone(backlogSelectedExecutionScope) && !canonicalUnknown(backlogSelectedExecutionScope)), `backlog_selected_execution_scope=${backlogSelectedExecutionScope}`);
  if (skill === "cycle-create" && promotedSharedPlanning) {
    if (!isResolvedPlanningArbitrationStatus(planningArbitrationStatus)) {
      blockingReasons.push(`shared planning arbitration remains unresolved: ${planningArbitrationStatus}`);
    }
    if (canonicalNone(backlogSelectedExecutionScope) || canonicalUnknown(backlogSelectedExecutionScope)) {
      blockingReasons.push("shared planning does not define a selected execution scope for cycle creation");
    } else if (backlogSelectedExecutionScope.toLowerCase() !== "new_cycle") {
      blockingReasons.push(`shared planning selected execution scope is ${backlogSelectedExecutionScope}; cycle-create requires new_cycle`);
    }
  }

  const prioritizedArtifacts = uniqueItems([
    "docs/audit/CURRENT-STATE.md",
    "docs/audit/WORKFLOW-KERNEL.md",
    "docs/audit/RUNTIME-STATE.md",
    "docs/audit/REANCHOR_PROMPT.md",
    !canonicalNone(activeBacklog) && !canonicalUnknown(activeBacklog) ? `docs/audit/${activeBacklog.replace(/^docs\/audit\//, "")}` : "",
    sessionFile ? relativePath(absoluteTargetRoot, sessionFile) : "",
    cycleStatusFile ? relativePath(absoluteTargetRoot, cycleStatusFile) : "",
    planFile && exists(planFile) ? relativePath(absoluteTargetRoot, planFile) : "",
  ]);

  const ok = blockingReasons.length === 0;
  const admissionStatus = ok
    ? (warnings.length > 0 ? "admitted_with_warnings" : "admitted")
    : "blocked";

  return {
    ok,
    admission_status: admissionStatus,
    target_root: absoluteTargetRoot,
    skill: skill || "generic",
    policy,
    current_state_file: currentStateExists ? currentStateResolution.logicalPath : "none",
    runtime_state_file: runtimeStateExists ? runtimeStateResolution.logicalPath : "none",
    session_file: sessionResolution.exists ? sessionResolution.logicalPath : "none",
    cycle_status_file: cycleStatusResolution.exists ? cycleStatusResolution.logicalPath : "none",
    plan_file: planResolution.exists ? planResolution.logicalPath : "none",
    context: {
      mode,
      branch_kind: branchKind,
      active_session: activeSession,
      session_branch: sessionBranch,
      active_cycle: activeCycle,
      cycle_branch: cycleBranch,
      cycle_state: normalizeScalar(cycleStatusMap.get("state") ?? "unknown").toUpperCase() || "UNKNOWN",
      dor_state: dorState,
      usage_matrix_scope: usageMatrixScope,
      usage_matrix_state: usageMatrixState,
      usage_matrix_summary: usageMatrixSummary,
      usage_matrix_rationale: usageMatrixRationale,
      first_plan_step: effectiveFirstPlanStep,
      active_backlog: activeBacklog,
      backlog_status: backlogStatus,
      backlog_next_step: backlogNextStep,
      backlog_selected_execution_scope: backlogSelectedExecutionScope,
      planning_arbitration_status: planningArbitrationStatus,
      current_state_freshness: currentStateFreshness,
      runtime_state_mode: runtimeStateMode,
      effective_state_mode: effectiveStateMode,
      repair_layer_status: repairLayerStatus,
      current_state_source: currentStateResolution.source,
      runtime_state_source: runtimeStateResolution.source,
      session_artifact_source: sessionResolution.source,
      cycle_status_source: cycleStatusResolution.source,
      plan_artifact_source: planResolution.source,
      git_branch: cycleCreateGitGate?.branch ?? "unknown",
      git_repo_root: cycleCreateGitGate?.repo_root ?? "none",
      git_repo_scoped: cycleCreateGitGate?.repo_scoped === true ? "yes" : "no",
      git_upstream_branch: cycleCreateGitGate?.upstream_branch ?? "none",
      git_upstream_ahead: cycleCreateGitGate?.upstream_ahead ?? 0,
      git_upstream_behind: cycleCreateGitGate?.upstream_behind ?? 0,
      previous_cycle_session_merge_gate: sessionIntegrationGate?.applicable === true ? "applies" : "n/a",
      previous_cycle_branch: sessionIntegrationGate?.cycle_branch ?? "none",
      previous_cycle_upstream_branch: sessionIntegrationGate?.cycle_upstream_branch ?? "none",
      previous_cycle_upstream_ahead: sessionIntegrationGate?.cycle_upstream_ahead ?? 0,
      previous_cycle_upstream_behind: sessionIntegrationGate?.cycle_upstream_behind ?? 0,
      previous_cycle_merged_into_session: sessionIntegrationGate?.cycle_merged_into_session ?? "unknown",
      session_merge_upstream_branch: sessionIntegrationGate?.session_upstream_branch ?? "none",
      session_merge_upstream_ahead: sessionIntegrationGate?.session_upstream_ahead ?? 0,
      session_merge_upstream_behind: sessionIntegrationGate?.session_upstream_behind ?? 0,
    },
    checks,
    blocking_reasons: blockingReasons,
    warnings,
    blocking_findings: blockingFindings,
    prioritized_artifacts: prioritizedArtifacts,
  };
}

function printText(output) {
  console.log("Pre-write admission:");
  console.log(`- status=${output.admission_status}`);
  console.log(`- skill=${output.skill}`);
  console.log(`- mode=${output.context.mode}`);
  console.log(`- branch_kind=${output.context.branch_kind}`);
  console.log(`- active_session=${output.context.active_session}`);
  console.log(`- active_cycle=${output.context.active_cycle}`);
  console.log(`- dor_state=${output.context.dor_state}`);
  console.log(`- first_plan_step=${output.context.first_plan_step}`);
  console.log(`- runtime_state_mode=${output.context.runtime_state_mode}`);
  console.log(`- repair_layer_status=${output.context.repair_layer_status}`);
  console.log(`- current_state_freshness=${output.context.current_state_freshness}`);
  if (output.blocking_reasons.length > 0) {
    console.log("Blocking reasons:");
    for (const item of output.blocking_reasons) {
      console.log(`- ${item}`);
    }
  }
  if (output.warnings.length > 0) {
    console.log("Warnings:");
    for (const item of output.warnings) {
      console.log(`- ${item}`);
    }
  }
  console.log("Prioritized reads:");
  for (const item of output.prioritized_artifacts) {
    console.log(`- ${item}`);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const output = preWriteAdmit({
      targetRoot: args.target,
      skill: args.skill,
      currentStateFile: args.currentStateFile,
      runtimeStateFile: args.runtimeStateFile,
    });
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      printText(output);
    }
    if (args.strict && !output.ok) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
