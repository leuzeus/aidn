#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createLocalGitAdapter } from "../../src/adapters/runtime/local-git-adapter.mjs";
import {
  buildPreWriteAdmissionResult,
  deriveFirstPlanStep,
  derivePreWriteObservedContext,
  findCycleStatus,
  findSessionFile,
  evaluateCycleCreateGitGate,
  evaluatePreWriteCycleCreateGates,
  evaluatePreWriteGenericWorkflowGates,
  evaluatePreWriteSourceOfTruthAndRuntimeGates,
  evaluateSessionIntegrationGate,
  mergePreWritePolicy,
} from "../../src/application/runtime/pre-write-admit-use-case.mjs";
import { resolvePromotedSharedPlanningContext } from "../../src/application/runtime/shared-planning-resolution-service.mjs";
import { validateSharedRuntimeContext } from "../../src/application/runtime/shared-runtime-validation-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { WORKFLOW_REPAIR_HINT } from "../../src/application/runtime/workflow-transition-constants.mjs";
import { evaluateRepairRouting } from "../../src/application/runtime/workflow-transition-lib.mjs";
import { resolveEffectiveStateMode } from "../../src/core/state-mode/state-mode-policy.mjs";
import { evaluateCurrentStateConsistency } from "../perf/verify-current-state-consistency.mjs";
import {
  loadDbIndexPayloadSafe,
  resolveDbArtifactSourceName,
} from "./db-first-runtime-view-lib.mjs";

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

async function loadRuntimeIndexPayloadSafe(targetRoot) {
  return await loadDbIndexPayloadSafe(targetRoot, {
    includePayload: true,
  });
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
  dbSource = "sqlite",
  preferDb = false,
} = {}) {
  const absolutePath = resolveTargetPath(targetRoot, candidatePath);
  if (dbBacked && preferDb) {
    const runtimeHeadArtifact = findRuntimeHeadArtifact(sqliteRuntimeHeads, candidatePath);
    const runtimeHeadText = decodeArtifactContent(runtimeHeadArtifact);
    if (runtimeHeadArtifact && runtimeHeadText) {
      return {
        exists: true,
        source: dbSource,
        absolutePath,
        logicalPath: toAuditArtifactPath(runtimeHeadArtifact.path),
        artifactPath: normalizeRelativeArtifactPath(runtimeHeadArtifact.path),
        text: runtimeHeadText,
      };
    }
    const artifact = findArtifactByPath(sqlitePayload, candidatePath);
    const text = decodeArtifactContent(artifact);
    if (artifact && text) {
      return {
        exists: true,
        source: dbSource,
        absolutePath,
        logicalPath: toAuditArtifactPath(artifact.path),
        artifactPath: normalizeRelativeArtifactPath(artifact.path),
        text,
      };
    }
  }
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
      source: dbSource,
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
    source: dbSource,
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

function resolveSessionArtifact({ targetRoot, auditRoot, sessionId, dbBacked = false, sqlitePayload = null, dbSource = "sqlite", preferDb = false } = {}) {
  if (dbBacked && preferDb) {
    const artifact = findSessionArtifact(sqlitePayload, sessionId);
    const text = decodeArtifactContent(artifact);
    if (artifact && text) {
      return {
        exists: true,
        source: dbSource,
        filePath: null,
        logicalPath: toAuditArtifactPath(artifact.path),
        text,
      };
    }
  }
  const filePath = findSessionFile(auditRoot, sessionId, targetRoot);
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
    source: dbSource,
    filePath: null,
    logicalPath: toAuditArtifactPath(artifact.path),
    text,
  };
}

function resolveCycleStatusArtifact({ targetRoot, auditRoot, cycleId, dbBacked = false, sqlitePayload = null, dbSource = "sqlite", preferDb = false } = {}) {
  if (dbBacked && preferDb) {
    const artifact = findCycleStatusArtifact(sqlitePayload, cycleId);
    const text = decodeArtifactContent(artifact);
    if (artifact && text) {
      return {
        exists: true,
        source: dbSource,
        filePath: null,
        logicalPath: toAuditArtifactPath(artifact.path),
        artifactPath: normalizeRelativeArtifactPath(artifact.path),
        text,
      };
    }
  }
  const filePath = findCycleStatus(auditRoot, cycleId, targetRoot);
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
    source: dbSource,
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
  dbSource = "sqlite",
  preferDb = false,
} = {}) {
  if (dbBacked && preferDb) {
    const artifact = findCyclePlanArtifact(sqlitePayload, cycleId, cycleStatusResolution?.artifactPath);
    const text = decodeArtifactContent(artifact);
    if (artifact && text) {
      return {
        exists: true,
        source: dbSource,
        filePath: null,
        logicalPath: toAuditArtifactPath(artifact.path),
        text,
      };
    }
  }
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
    source: dbSource,
    filePath: null,
    logicalPath: toAuditArtifactPath(artifact.path),
    text,
  };
}

function addCheck(checks, key, pass, details, extra = {}) {
  checks[key] = {
    pass,
    details,
    ...extra,
  };
}

export async function preWriteAdmit({
  targetRoot,
  skill = "",
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  workspace: providedWorkspace = null,
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const git = createLocalGitAdapter();
  const workspace = providedWorkspace ?? resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const sharedRuntimeValidation = validateSharedRuntimeContext({
    targetRoot: absoluteTargetRoot,
    workspace,
  });
  const auditRoot = path.join(absoluteTargetRoot, "docs", "audit");
  const effectiveStateMode = resolveEffectiveStateMode({
    targetRoot: absoluteTargetRoot,
    stateMode: "files",
  });
  const dbBackedMode = effectiveStateMode === "dual" || effectiveStateMode === "db-only";
  const sqliteFallback = dbBackedMode ? await loadRuntimeIndexPayloadSafe(absoluteTargetRoot) : {
    exists: false,
    sqliteFile: "",
    payload: null,
    runtimeHeads: {},
    warning: "",
  };
  const dbSource = resolveDbArtifactSourceName(sqliteFallback.backend);
  const preferDb = effectiveStateMode === "db-only";
  const currentStateResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: currentStateFile,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
    dbSource,
    preferDb,
  });
  const runtimeStateResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: runtimeStateFile,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
    dbSource,
    preferDb,
  });
  const currentStatePath = currentStateResolution.absolutePath;
  const runtimeStatePath = runtimeStateResolution.absolutePath;
  const currentStateText = currentStateResolution.text;
  const runtimeStateText = runtimeStateResolution.text;
  const currentMap = parseSimpleMap(currentStateText);
  const runtimeMap = parseSimpleMap(runtimeStateText);
  const sharedPlanning = await resolvePromotedSharedPlanningContext({
    targetRoot: absoluteTargetRoot,
    workspace,
    currentState: {
      active_session: currentMap.get("active_session") ?? "none",
      active_backlog: currentMap.get("active_backlog") ?? "none",
      backlog_status: currentMap.get("backlog_status") ?? "unknown",
      backlog_next_step: currentMap.get("backlog_next_step") ?? "unknown",
      backlog_selected_execution_scope: currentMap.get("backlog_selected_execution_scope") ?? "none",
      planning_arbitration_status: currentMap.get("planning_arbitration_status") ?? "none",
    },
    sharedCoordination,
    sharedCoordinationOptions,
  });
  const policy = mergePreWritePolicy(skill);
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
      ? `CURRENT-STATE consistency checks deferred because the artifact was resolved from ${currentStateResolution.source}`
      : "CURRENT-STATE.md consistency checks passed")
    : "CURRENT-STATE.md consistency checks reported issues");
  if (currentStateResolution.source === "file" && currentStateExists && consistency.pass !== true) {
    warnings.push("CURRENT-STATE.md consistency checks reported issues; verify session/cycle facts before writing");
  }

  const rawActiveSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
  const rawActiveCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
  const sessionResolution = resolveSessionArtifact({
    targetRoot: absoluteTargetRoot,
    auditRoot,
    sessionId: rawActiveSession,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    dbSource,
    preferDb,
  });
  const cycleStatusResolution = resolveCycleStatusArtifact({
    targetRoot: absoluteTargetRoot,
    auditRoot,
    cycleId: rawActiveCycle,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    dbSource,
    preferDb,
  });
  const sessionFile = sessionResolution.filePath;
  const cycleStatusFile = cycleStatusResolution.filePath;
  const cycleStatusText = cycleStatusResolution.text;
  const cycleStatusMap = parseSimpleMap(cycleStatusText);
  const planResolution = resolveCyclePlanArtifact({
    targetRoot: absoluteTargetRoot,
    cycleStatusResolution,
    cycleId: rawActiveCycle,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    dbSource,
    preferDb,
  });
  const planFile = planResolution.filePath;
  const planText = planResolution.text;
  const derivedFirstPlanStep = deriveFirstPlanStep(planText);
  const rawCurrentFirstPlanStep = normalizeScalar(currentMap.get("first_plan_step") ?? "unknown") || "unknown";
  const effectiveFirstPlanStep = !canonicalUnknown(rawCurrentFirstPlanStep) && !canonicalNone(rawCurrentFirstPlanStep)
    ? rawCurrentFirstPlanStep
    : derivedFirstPlanStep;
  const observed = derivePreWriteObservedContext({
    currentMap,
    runtimeMap,
    sharedPlanning,
    cycleStatusMap,
    effectiveStateMode,
    currentStateResolution,
    runtimeStateResolution,
    sessionResolution,
    cycleStatusResolution,
    planResolution,
    effectiveFirstPlanStep,
    normalizeUsageMatrixScope,
    normalizeUsageMatrixState,
  });
  const {
    mode,
    branchKind,
    activeSession,
    activeCycle,
    dorState,
    currentFirstPlanStep,
    activeBacklog,
    backlogStatus,
    backlogNextStep,
    backlogSelectedExecutionScope,
    planningArbitrationStatus,
    cycleBranch,
    sessionBranch,
    runtimeStateMode,
    repairLayerStatus,
    currentStateFreshness,
    dorOverrideReason,
    mappedCycleBranch,
    usageMatrixScope,
    usageMatrixState,
    usageMatrixSummary,
    usageMatrixRationale,
    cycleState,
    sourceOfTruth,
    sourceOfTruthIssues,
    sourceOfTruthRepairActions,
  } = observed;
  const runtimeStateExists = runtimeStateResolution.exists;
  const blockingFindings = uniqueItems(
    parseListSection(runtimeStateText, "blocking_findings")
      .filter((item) => item.toLowerCase() !== "none"),
  );
  const cycleCreateGitGate = skill === "cycle-create"
    ? evaluateCycleCreateGitGate({
      git,
      targetRoot: absoluteTargetRoot,
    })
    : null;
  const sessionIntegrationGate = skill === "cycle-create"
    ? evaluateSessionIntegrationGate({
      git,
      targetRoot: absoluteTargetRoot,
      branchKind,
      sessionBranch,
      cycleBranch: !canonicalNone(mappedCycleBranch) && !canonicalUnknown(mappedCycleBranch)
        ? mappedCycleBranch
        : cycleBranch,
    })
    : null;

  evaluatePreWriteGenericWorkflowGates({
    checks,
    addCheck,
    blockingReasons,
    warnings,
    policy,
    skill,
    mode,
    branchKind,
    activeSession,
    activeCycle,
    sessionResolution,
    cycleStatusResolution,
    effectiveFirstPlanStep,
    currentFirstPlanStep,
    derivedFirstPlanStep,
    dorState,
    dorOverrideReason,
    cycleState,
    usageMatrixScope,
    usageMatrixState,
    usageMatrixRationale,
    activeCycleLabel: activeCycle,
    cycleBranch,
    mappedCycleBranch,
    canonicalNone,
    canonicalUnknown,
    usageMatrixSatisfied,
  });

  addCheck(checks, "runtime_state_exists", runtimeStateExists, runtimeStateExists
    ? `runtime digest resolved via ${runtimeStateResolution.source}: ${runtimeStateResolution.logicalPath}`
    : "runtime digest missing");

  const repairRouting = evaluateRepairRouting({
    status: repairLayerStatus,
    advice: normalizeScalar(runtimeMap.get("repair_routing_reason") ?? runtimeMap.get("repair_layer_advice") ?? "unknown") || "unknown",
    blocking: repairLayerStatus.toLowerCase() === "block",
  });
  evaluatePreWriteSourceOfTruthAndRuntimeGates({
    checks,
    addCheck,
    sourceOfTruth,
    sourceOfTruthIssues,
    sourceOfTruthRepairActions,
    warnings,
    blockingReasons,
    runtimeStateExists,
    runtimeStateResolution,
    runtimeStateMode,
    effectiveStateMode,
    repairLayerStatus,
    currentStateFreshness,
    blockingFindings,
    policy,
    runtimeRepairRouting: repairRouting,
    repairHints: WORKFLOW_REPAIR_HINT,
    classifyRepairFindingSummary,
  });

  if (sharedRuntimeValidation.status === "reject") {
    blockingReasons.push(...sharedRuntimeValidation.issues);
  }
  warnings.push(...sharedRuntimeValidation.warnings);

  if (mode === "COMMITTING" && branchKind === "session") {
    warnings.push("COMMITTING work on a session branch should stay limited to integration, handoff, or orchestration unless explicitly documented");
  }

  evaluatePreWriteCycleCreateGates({
    checks,
    addCheck,
    blockingReasons,
    warnings,
    cycleCreateGitGate,
    sessionIntegrationGate,
    skill,
    activeBacklog,
    backlogStatus,
    backlogSelectedExecutionScope,
    planningArbitrationStatus,
    canonicalNone,
    canonicalUnknown,
    summarizePorcelain,
  });

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

  return buildPreWriteAdmissionResult({
    targetRoot: absoluteTargetRoot,
    workspace,
    sharedStateBackend: sqliteFallback.backend ?? null,
    sharedRuntimeValidation,
    skill,
    policy,
    sourceOfTruth,
    currentStateExists,
    runtimeStateExists,
    currentStateResolution,
    runtimeStateResolution,
    sessionResolution,
    cycleStatusResolution,
    planResolution,
    context: {
      workspace_id: workspace.workspace_id,
      workspace_id_source: workspace.workspace_id_source,
      worktree_id: workspace.worktree_id,
      is_linked_worktree: workspace.is_linked_worktree ? "yes" : "no",
      shared_runtime_mode: workspace.shared_runtime_mode,
      shared_runtime_validation_status: sharedRuntimeValidation.status,
      shared_runtime_locator_ref: workspace.shared_runtime_locator_ref,
      shared_backend_kind: workspace.shared_backend_kind,
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
      shared_planning_source: sharedPlanning.shared_planning_source,
      shared_planning_read_status: sharedPlanning.shared_planning_read_status,
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
    blockingReasons,
    warnings,
    blockingFindings,
    prioritizedArtifacts,
    sourceOfTruthIssues,
    sourceOfTruthRepairActions,
  });
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
  console.log(`- source_of_truth_status=${output.context.source_of_truth_status}`);
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
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const output = await preWriteAdmit({
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
  }).catch((error) => {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
