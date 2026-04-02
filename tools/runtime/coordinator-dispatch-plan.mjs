#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readSharedPlanningState, resolveSharedCoordinationStore } from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { buildWorkflowStatus } from "../../src/application/runtime/workflow-transition-lib.mjs";
import { loadRegisteredAgentAdapters } from "../../src/application/runtime/agent-adapter-registry-service.mjs";
import { loadAgentRoster } from "../../src/application/runtime/agent-roster-service.mjs";
import { assessIntegrationRisk } from "../../src/application/runtime/integration-risk-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { selectAgentAdapter } from "../../src/core/agents/agent-selection-policy.mjs";
import { computeCoordinatorLoopState } from "./coordinator-loop.mjs";
import { buildAgentHealthMap, verifyAgentRoster } from "./verify-agent-roster.mjs";
import {
  loadSqliteIndexPayloadSafe as loadSqliteIndexPayloadSafeDb,
  resolveAuditArtifactText as resolveAuditArtifactTextDb,
  resolveDbBackedMode as resolveDbBackedModeDb,
} from "./db-first-runtime-view-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    agent: "auto",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: "docs/audit/RUNTIME-STATE.md",
    packetFile: "docs/audit/HANDOFF-PACKET.md",
    agentRosterFile: "docs/audit/AGENT-ROSTER.md",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--agent") {
      args.agent = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--current-state-file") {
      args.currentStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--runtime-state-file") {
      args.runtimeStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--packet-file") {
      args.packetFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--agent-roster-file") {
      args.agentRosterFile = String(argv[i + 1] ?? "").trim();
      i += 1;
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
  if (!args.agent) {
    throw new Error("Missing value for --agent");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/coordinator-dispatch-plan.mjs --target .");
  console.log("  node tools/runtime/coordinator-dispatch-plan.mjs --target . --agent auto --json");
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

function readTextIfExists(filePath) {
  return filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function normalizeScalar(value) {
  const normalized = String(value ?? "").trim();
  if (normalized.startsWith("`") && normalized.endsWith("`") && normalized.length >= 2) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
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

function canonicalNone(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return normalized === "none" || normalized === "(none)";
}

function canonicalUnknown(value) {
  return normalizeScalar(value).toLowerCase() === "unknown";
}

function parseTimestamp(value) {
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

function splitList(value) {
  if (!value) {
    return [];
  }
  return uniqueItems(String(value).split(",").map((item) => item.trim()));
}

function isMeaningfulScalar(value, { allowNone = false, allowUnknown = false } = {}) {
  const normalized = normalizeScalar(value);
  if (!normalized) {
    return false;
  }
  if (!allowNone && canonicalNone(normalized)) {
    return false;
  }
  if (!allowUnknown && canonicalUnknown(normalized)) {
    return false;
  }
  return true;
}

function pickScalar(values, options = {}) {
  for (const value of values) {
    if (isMeaningfulScalar(value, options)) {
      return normalizeScalar(value);
    }
  }
  return "";
}

function parseLabeledBulletList(text, label) {
  const lines = String(text).split(/\r?\n/);
  const items = [];
  let active = false;
  for (const line of lines) {
    if (!active && line.trim() === label) {
      active = true;
      continue;
    }
    if (!active) {
      continue;
    }
    if (/^##\s+/.test(line) || (/^[a-zA-Z0-9_]+:\s*/.test(line) && line.trim() !== label)) {
      break;
    }
    const match = line.match(/^\s*-\s+(.+)$/);
    if (match) {
      const item = normalizeScalar(match[1]);
      if (item && !canonicalNone(item)) {
        items.push(item);
      }
    }
  }
  return uniqueItems(items);
}

function parseSectionBulletList(text, heading) {
  const lines = String(text).split(/\r?\n/);
  const items = [];
  let active = false;
  for (const line of lines) {
    if (!active && line.trim() === heading) {
      active = true;
      continue;
    }
    if (!active) {
      continue;
    }
    if (/^##\s+/.test(line)) {
      break;
    }
    const match = line.match(/^\s*-\s+(.+)$/);
    if (match) {
      const item = normalizeScalar(match[1]);
      if (item) {
        items.push(item);
      }
    }
  }
  return uniqueItems(items);
}

function parseSectionBulletEntries(text, heading) {
  const lines = String(text).split(/\r?\n/);
  const items = [];
  let active = false;
  for (const line of lines) {
    if (!active && line.trim() === heading) {
      active = true;
      continue;
    }
    if (!active) {
      continue;
    }
    if (/^##\s+/.test(line)) {
      break;
    }
    const match = line.match(/^\s*-\s+(.+)$/);
    if (match) {
      const item = normalizeScalar(match[1]);
      if (item) {
        items.push(item);
      }
    }
  }
  return items;
}

function parseAddendumLine(line) {
  const tokens = String(line).split("|").map((item) => normalizeScalar(item)).filter(Boolean);
  const addendum = {
    timestamp: "",
    agent_role: "unknown",
    rationale: "planning update",
    affected_item: "none",
    affected_question: "none",
    note: "",
    raw: normalizeScalar(line),
  };
  if (tokens.length === 0) {
    return addendum;
  }
  const first = tokens[0];
  if (!first.includes(":")) {
    addendum.timestamp = first;
  }
  for (const token of tokens) {
    const match = token.match(/^([a-z_]+):\s*(.+)$/i);
    if (!match) {
      continue;
    }
    const key = String(match[1]).toLowerCase();
    const value = normalizeScalar(match[2]);
    if (key === "ts" || key === "timestamp") {
      addendum.timestamp = value;
    } else if (key === "agent_role") {
      addendum.agent_role = value || "unknown";
    } else if (key === "rationale") {
      addendum.rationale = value || "planning update";
    } else if (key === "affected_item") {
      addendum.affected_item = value || "none";
    } else if (key === "affected_question") {
      addendum.affected_question = value || "none";
    } else if (key === "note") {
      addendum.note = value;
    }
  }
  if (!addendum.timestamp && tokens[0]) {
    addendum.timestamp = tokens[0];
  }
  return addendum;
}

function parseAddendaSection(text) {
  return parseSectionBulletEntries(text, "## Addenda").map(parseAddendumLine);
}

function relPath(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function quoteArg(value) {
  return `"${String(value ?? "").replace(/"/g, '\\"')}"`;
}

function resolveSelectedAgent({ requestedAgent, recommendation, roster, adapters, adapterHealth }) {
  return selectAgentAdapter({
    requestedAgent,
    role: recommendation.role,
    action: recommendation.action,
    adapters,
    roster,
    adapterHealth,
  });
}

function deriveModeForInvocation(contextMode) {
  const normalized = String(contextMode ?? "").trim().toUpperCase();
  if (!normalized || normalized === "UNKNOWN") {
    return "THINKING";
  }
  return normalized;
}

function buildCommandLine(command, args) {
  return `${command} ${args.map((item) => (/\s/.test(item) ? quoteArg(item) : item)).join(" ")}`.trim();
}

function buildStep(command, args, label) {
  const executable = process.platform === "win32" && command === "npx" ? "npx.cmd" : command;
  return {
    label,
    command: executable,
    args,
    command_line: buildCommandLine(command, args),
  };
}

function resolveActiveBacklogPath(targetRoot, activeBacklog) {
  const normalized = normalizeScalar(activeBacklog);
  if (!normalized || canonicalNone(normalized) || canonicalUnknown(normalized)) {
    return { relative_path: "none", absolute_path: "", found: false };
  }
  const relativePath = normalized.startsWith("docs/")
    ? normalized.replace(/\\/g, "/")
    : `docs/audit/${normalized.replace(/\\/g, "/").replace(/^\/+/, "")}`;
  const absolutePath = resolveTargetPath(targetRoot, relativePath);
  return {
    relative_path: relativePath,
    absolute_path: absolutePath,
    found: fs.existsSync(absolutePath),
  };
}

function parseBacklogArtifact(text) {
  const map = parseSimpleMap(text);
  return {
    updated_at: normalizeScalar(map.get("updated_at") ?? "") || "",
    planning_status: normalizeScalar(map.get("planning_status") ?? "unknown") || "unknown",
    linked_cycles: splitList(map.get("linked_cycles") ?? ""),
    dispatch_ready: normalizeScalar(map.get("dispatch_ready") ?? "no") || "no",
    planning_arbitration_status: normalizeScalar(map.get("planning_arbitration_status") ?? "none") || "none",
    next_dispatch_scope: normalizeScalar(map.get("next_dispatch_scope") ?? "none") || "none",
    next_dispatch_action: normalizeScalar(map.get("next_dispatch_action") ?? "none") || "none",
    backlog_next_step: normalizeScalar(map.get("backlog_next_step") ?? "unknown") || "unknown",
    backlog_items: parseLabeledBulletList(text, "backlog_items:"),
    open_questions: parseLabeledBulletList(text, "open_questions:"),
    addenda: parseAddendaSection(text),
  };
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

function normalizeSharedPlanning(currentState) {
  const activeBacklog = String(currentState?.active_backlog ?? "none").trim() || "none";
  const backlogStatus = String(currentState?.backlog_status ?? "unknown").trim() || "unknown";
  const backlogNextStep = String(currentState?.backlog_next_step ?? "unknown").trim() || "unknown";
  const planningArbitrationStatus = String(currentState?.planning_arbitration_status ?? "none").trim() || "none";
  return {
    active_backlog: activeBacklog,
    backlog_status: backlogStatus,
    backlog_next_step: backlogNextStep,
    planning_arbitration_status: planningArbitrationStatus,
    enabled: activeBacklog !== "none" && activeBacklog !== "unknown",
  };
}

async function readSharedPlanning(targetRoot, currentStateFile, {
  workspace = null,
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const { dbBackedMode } = resolveDbBackedModeDb(targetRoot);
  const sqliteFallback = dbBackedMode ? loadSqliteIndexPayloadSafeDb(targetRoot) : {
    exists: false,
    sqliteFile: "",
    payload: null,
    runtimeHeads: {},
    warning: "",
  };
  const currentStateResolution = resolveAuditArtifactTextDb({
    targetRoot,
    candidatePath: currentStateFile,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
  });
  const currentStateText = currentStateResolution.text;
  const currentMap = parseSimpleMap(currentStateText);
  const currentState = normalizeSharedPlanning({
    active_backlog: currentMap.get("active_backlog") ?? "none",
    backlog_status: currentMap.get("backlog_status") ?? "unknown",
    backlog_next_step: currentMap.get("backlog_next_step") ?? "unknown",
    planning_arbitration_status: currentMap.get("planning_arbitration_status") ?? "none",
  });
  const effectiveWorkspace = workspace ?? resolveWorkspaceContext({
    targetRoot,
  });
  const sharedCoordinationResolution = sharedCoordination ?? await resolveSharedCoordinationStore({
    targetRoot,
    workspace: effectiveWorkspace,
    ...sharedCoordinationOptions,
  });
  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
  const sharedPlanningRead = activeSession !== "none"
    ? await readSharedPlanningState(sharedCoordinationResolution, {
      workspace: effectiveWorkspace,
      sessionId: activeSession,
      planningKey: `session:${activeSession}`,
    })
    : null;
  const sharedPlanningState = sharedPlanningRead?.planning_state ?? null;

  if (sharedPlanningRead?.ok === true && sharedPlanningState) {
    const payload = sharedPlanningState.payload && typeof sharedPlanningState.payload === "object"
      ? sharedPlanningState.payload
      : {};
    const planningArbitrationStatus = pickScalar(
      [sharedPlanningState.planning_arbitration_status, payload.planning_arbitration_status, currentState.planning_arbitration_status],
      { allowNone: false, allowUnknown: false },
    ) || "none";
    const currentUpdatedAtMs = parseTimestamp(currentMap.get("updated_at") ?? "");
    const planningUpdatedAtMs = parseTimestamp(sharedPlanningState.updated_at ?? "");
    let freshnessStatus = "unknown";
    let freshnessBasis = "shared planning freshness could not be derived";
    if (currentUpdatedAtMs !== null && planningUpdatedAtMs !== null) {
      freshnessStatus = planningUpdatedAtMs >= currentUpdatedAtMs ? "ok" : "stale";
      freshnessBasis = planningUpdatedAtMs >= currentUpdatedAtMs
        ? "shared planning state updated_at is aligned with CURRENT-STATE.md"
        : "shared planning state updated_at is older than CURRENT-STATE.md";
    } else if (sharedPlanningRead.status === "found") {
      freshnessStatus = "ok";
      freshnessBasis = "shared planning state exists but timestamp comparison is incomplete";
    }
    const arbitrationResolved = isResolvedPlanningArbitrationStatus(planningArbitrationStatus);
    return {
      active_backlog: pickScalar(
        [sharedPlanningState.backlog_artifact_ref, currentState.active_backlog],
        { allowNone: false, allowUnknown: false },
      ) || "none",
      backlog_status: pickScalar(
        [sharedPlanningState.planning_status, payload.planning_status, currentState.backlog_status],
        { allowNone: false, allowUnknown: false },
      ) || "unknown",
      backlog_next_step: pickScalar(
        [sharedPlanningState.backlog_next_step, payload.backlog_next_step, currentState.backlog_next_step],
        { allowNone: false, allowUnknown: false },
      ) || "unknown",
      planning_arbitration_status: planningArbitrationStatus,
      enabled: true,
      artifact_found: true,
      artifact_path: pickScalar(
        [sharedPlanningState.backlog_artifact_ref, currentState.active_backlog],
        { allowNone: false, allowUnknown: false },
      ) || "none",
      backlog_items: Array.isArray(payload.backlog_items) ? payload.backlog_items.map((item) => normalizeScalar(item)).filter(Boolean) : [],
      open_questions: Array.isArray(payload.open_questions) ? payload.open_questions.map((item) => normalizeScalar(item)).filter(Boolean) : [],
      linked_cycles: Array.isArray(payload.linked_cycles)
        ? payload.linked_cycles.map((item) => normalizeScalar(item)).filter(Boolean)
        : splitList(payload.linked_cycles ?? ""),
      addenda_count: Array.isArray(payload.addenda) ? payload.addenda.length : 0,
      recent_addenda: Array.isArray(payload.addenda) ? payload.addenda.slice(-3) : [],
      dispatch_ready: sharedPlanningState.dispatch_ready === true,
      next_dispatch_scope: pickScalar(
        [sharedPlanningState.next_dispatch_scope, payload.next_dispatch_scope],
        { allowNone: false, allowUnknown: false },
      ) || "none",
      next_dispatch_action: pickScalar(
        [sharedPlanningState.next_dispatch_action, payload.next_dispatch_action],
        { allowNone: false, allowUnknown: false },
      ) || "none",
      freshness_status: freshnessStatus,
      freshness_basis: freshnessBasis,
      gate_status: arbitrationResolved ? "ok" : "blocked",
      gate_reason: arbitrationResolved
        ? "shared planning arbitration is resolved"
        : `planning arbitration remains unresolved: ${planningArbitrationStatus}`,
      current_state_source: currentStateResolution.source,
      backlog_artifact_source: "shared-coordination",
      shared_planning_source: "shared-coordination",
    };
  }

  const backlogArtifactRef = resolveActiveBacklogPath(targetRoot, currentState.active_backlog);
  const backlogResolution = resolveAuditArtifactTextDb({
    targetRoot,
    candidatePath: backlogArtifactRef.relative_path,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
  });
  const backlogArtifact = backlogResolution.exists
    ? parseBacklogArtifact(backlogResolution.text)
    : null;
  const backlogStatus = pickScalar(
    [backlogArtifact?.planning_status, currentState.backlog_status],
    { allowNone: false, allowUnknown: false },
  ) || "unknown";
  const backlogNextStep = pickScalar(
    [backlogArtifact?.backlog_next_step, currentState.backlog_next_step],
    { allowNone: false, allowUnknown: false },
  ) || "unknown";
  const planningArbitrationStatus = pickScalar(
    [backlogArtifact?.planning_arbitration_status, currentState.planning_arbitration_status],
    { allowNone: false, allowUnknown: false },
  ) || "none";
  const nextDispatchScope = pickScalar(
    [backlogArtifact?.next_dispatch_scope],
    { allowNone: false, allowUnknown: false },
  ) || "none";
  const nextDispatchAction = pickScalar(
    [backlogArtifact?.next_dispatch_action],
    { allowNone: false, allowUnknown: false },
  ) || "none";
  const dispatchReady = String(backlogArtifact?.dispatch_ready ?? "no").trim().toLowerCase() === "yes";
  const currentUpdatedAtMs = parseTimestamp(currentMap.get("updated_at") ?? "");
  const backlogUpdatedAtMs = parseTimestamp(backlogArtifact?.updated_at ?? "");
  let freshnessStatus = "unknown";
  let freshnessBasis = "shared planning freshness could not be derived";
  if (!backlogResolution.exists) {
    freshnessStatus = "missing";
    freshnessBasis = "active backlog artifact is referenced but not found";
  } else if (currentUpdatedAtMs !== null && backlogUpdatedAtMs !== null) {
    freshnessStatus = backlogUpdatedAtMs >= currentUpdatedAtMs ? "ok" : "stale";
    freshnessBasis = backlogUpdatedAtMs >= currentUpdatedAtMs
      ? "backlog updated_at is aligned with CURRENT-STATE.md"
      : "backlog updated_at is older than CURRENT-STATE.md";
  } else if (currentStateText.includes("active_backlog:") && currentStateText.includes("backlog_next_step:")) {
    freshnessStatus = "ok";
    freshnessBasis = "shared planning summary fields are present but timestamps are incomplete";
  }
  const arbitrationResolved = isResolvedPlanningArbitrationStatus(planningArbitrationStatus);
  const gateStatus = !currentState.enabled
    ? "not_applicable"
    : (!backlogResolution.exists
      ? "warn"
      : (!arbitrationResolved ? "blocked" : "ok"));
  const gateReason = !currentState.enabled
    ? "no active shared planning backlog"
    : (!backlogResolution.exists
      ? "active shared planning backlog is referenced but missing"
      : (!arbitrationResolved
        ? `planning arbitration remains unresolved: ${planningArbitrationStatus}`
        : "shared planning arbitration is resolved"));
  return {
    active_backlog: currentState.active_backlog,
    backlog_status: backlogStatus,
    backlog_next_step: backlogNextStep,
    planning_arbitration_status: planningArbitrationStatus,
    enabled: currentState.enabled,
    artifact_found: backlogResolution.exists,
    artifact_path: backlogResolution.exists ? backlogResolution.logicalPath : backlogArtifactRef.relative_path,
    backlog_items: backlogArtifact?.backlog_items ?? [],
    open_questions: backlogArtifact?.open_questions ?? [],
    linked_cycles: backlogArtifact?.linked_cycles ?? [],
    addenda_count: Array.isArray(backlogArtifact?.addenda) ? backlogArtifact.addenda.length : 0,
    recent_addenda: Array.isArray(backlogArtifact?.addenda) ? backlogArtifact.addenda.slice(-3) : [],
    dispatch_ready: dispatchReady,
    next_dispatch_scope: nextDispatchScope,
    next_dispatch_action: nextDispatchAction,
    freshness_status: freshnessStatus,
    freshness_basis: freshnessBasis,
    gate_status: gateStatus,
    gate_reason: gateReason,
    current_state_source: currentStateResolution.source,
    backlog_artifact_source: backlogResolution.source,
    shared_planning_source: "artifact",
  };
}

function buildRecommendedRoleCoverage({ recommendation, adapters, rosterVerification, roster, adapterHealth }) {
  const role = recommendation.role;
  const summary = {
    ready: 0,
    degraded: 0,
    unavailable: 0,
    disabled: 0,
    unknown: 0,
  };
  const counted = new Set();
  for (const adapter of adapters) {
    const profile = adapter.getProfile();
    const override = roster?.agents?.[profile.id] ?? null;
    const visibleRoles = Array.isArray(override?.roles) && override.roles.length > 0
      ? override.roles
      : profile.supported_roles;
    if (!visibleRoles.includes(role)) {
      continue;
    }
    counted.add(profile.id);
    const healthStatus = String(adapterHealth?.[profile.id]?.health_status ?? "ready").trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(summary, healthStatus)) {
      summary[healthStatus] += 1;
    } else {
      summary.unknown += 1;
    }
  }
  for (const entry of rosterVerification.entries ?? []) {
    if (counted.has(entry.id)) {
      continue;
    }
    const visibleRoles = Array.isArray(entry.effective_roles) && entry.effective_roles.length > 0
      ? entry.effective_roles
      : (entry.supported_roles ?? []);
    if (!visibleRoles.includes(role)) {
      continue;
    }
    const healthStatus = String(entry.health_status ?? "unknown").trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(summary, healthStatus)) {
      summary[healthStatus] += 1;
    } else {
      summary.unknown += 1;
    }
  }
  const runnableCount = summary.ready + summary.degraded;
  if (runnableCount > 0) {
    return {
      role,
      status: "ok",
      summary,
      reason: `${runnableCount} runnable adapter(s) remain available for role ${role}`,
    };
  }
  if (summary.unavailable > 0) {
    return {
      role,
      status: "blocked",
      summary,
      reason: `no runnable adapter remains for role ${role}; fix adapter environment compatibility or roster configuration before dispatch`,
    };
  }
  if (summary.disabled > 0) {
    return {
      role,
      status: "blocked",
      summary,
      reason: `all adapters for role ${role} are disabled by roster`,
    };
  }
  return {
    role,
    status: "unknown",
    summary,
    reason: `no adapter is currently exposed for role ${role}`,
  };
}

function summarizeList(items, limit = 2) {
  const values = uniqueItems(items);
  if (values.length === 0) {
    return "";
  }
  const visible = values.slice(0, limit);
  if (values.length > limit) {
    visible.push(`+${values.length - limit} more`);
  }
  return visible.join("; ");
}

function summarizeAddenda(addenda, limit = 2) {
  const values = Array.isArray(addenda) ? addenda.slice(-limit) : [];
  return values
    .map((item) => {
      const agentRole = normalizeScalar(item?.agent_role) || "unknown";
      const rationale = normalizeScalar(item?.rationale) || "planning update";
      return `${agentRole}: ${rationale}`;
    })
    .join("; ");
}

function normalizeDecision(value) {
  return String(value ?? "").trim().toLowerCase();
}

function resolveAppliedIntegrationDecision(loopState) {
  if (!loopState?.loop?.history?.arbitration_applied) {
    return null;
  }
  const decision = normalizeDecision(loopState.loop.history.last_arbitration?.decision ?? "");
  if (["integration_cycle", "report_forward", "rework_from_example"].includes(decision)) {
    return decision;
  }
  return null;
}

function buildIntegrationRiskGate({ loopState, assessment, recommendation, scope }) {
  const appliedDecision = resolveAppliedIntegrationDecision(loopState);
  const sessionScoped = scope?.scope_type === "session" || recommendation.role === "coordinator";
  if (!sessionScoped || assessment.candidate_cycles.length <= 1) {
    return {
      active: false,
      applied_decision: appliedDecision,
      reason: "integration gate not required for the current relay scope",
    };
  }
  if (assessment.recommended_strategy === "direct_merge") {
    return {
      active: false,
      applied_decision: appliedDecision,
      reason: "integration risk allows a direct merge path",
    };
  }
  if (appliedDecision && appliedDecision === assessment.recommended_strategy) {
    return {
      active: false,
      applied_decision: appliedDecision,
      reason: `user arbitration already selected ${appliedDecision}`,
    };
  }
  return {
    active: true,
    applied_decision: appliedDecision,
    reason: `integration strategy ${assessment.recommended_strategy} must be resolved explicitly before session-level relay`,
  };
}

function buildEntryPlan({ targetRoot, recommendation, context }) {
  const targetArg = targetRoot;
  const mode = deriveModeForInvocation(context.mode);
  const plan = {
    entrypoint_kind: "manual",
    entrypoint_name: "manual-review",
    steps: [],
    commands: [],
    notes: [],
  };

  if (recommendation.role === "coordinator" && recommendation.action === "reanchor") {
    plan.entrypoint_kind = "skill";
    plan.entrypoint_name = "context-reload";
    plan.steps = [
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "context-reload", "--mode", mode, "--target", targetArg, "--strict", "--json"], "context-reload"),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "context-reload", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-context-reload"),
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "start-session", "--mode", mode, "--target", targetArg, "--strict", "--json"], "start-session"),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push("Re-anchor before any durable write.");
    return plan;
  }

  if (recommendation.role === "coordinator" && recommendation.action === "coordinate") {
    plan.entrypoint_kind = "skill";
    plan.entrypoint_name = "start-session";
    plan.steps = [
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "start-session", "--mode", mode, "--target", targetArg, "--strict", "--json"], "start-session"),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "start-session", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-start-session"),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push("Restate the objective, constraints, and next compliant step.");
    return plan;
  }

  if (recommendation.role === "executor" && recommendation.action === "implement") {
    plan.entrypoint_kind = "skill";
    plan.entrypoint_name = "branch-cycle-audit";
    plan.steps = [
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "branch-cycle-audit", "--mode", "COMMITTING", "--target", targetArg, "--strict", "--fail-on-repair-block", "--json"], "branch-cycle-audit"),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "branch-cycle-audit", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-branch-cycle-audit"),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push(`Then implement: ${recommendation.goal}`);
    return plan;
  }

  if (recommendation.role === "auditor" && recommendation.action === "audit") {
    plan.entrypoint_kind = "skill";
    plan.entrypoint_name = "drift-check";
    plan.steps = [
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "drift-check", "--mode", mode, "--target", targetArg, "--strict", "--json"], "drift-check"),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "drift-check", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-drift-check"),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push(`Audit focus: ${recommendation.goal}`);
    return plan;
  }

  if (recommendation.role === "auditor" && recommendation.action === "analyze") {
    plan.entrypoint_kind = "skill";
    plan.entrypoint_name = "requirements-delta";
    plan.steps = [
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "requirements-delta", "--mode", mode, "--target", targetArg, "--strict", "--json"], "requirements-delta"),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "requirements-delta", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-requirements-delta"),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push(`Analysis focus: ${recommendation.goal}`);
    return plan;
  }

  if (recommendation.role === "repair" && recommendation.action === "repair") {
    const sqliteIndex = path.join(targetRoot, ".aidn", "runtime", "index", "workflow-index.sqlite");
    plan.entrypoint_kind = "runtime";
    if (fs.existsSync(sqliteIndex)) {
      plan.entrypoint_name = "repair-layer-triage";
      plan.steps = [
        buildStep("npx", ["aidn", "runtime", "repair-layer-triage", "--target", targetArg, "--json"], "repair-layer-triage"),
        buildStep("npx", ["aidn", "runtime", "project-runtime-state", "--target", targetArg, "--json"], "project-runtime-state-after-repair"),
      ];
    } else {
      plan.entrypoint_name = "project-runtime-state";
      plan.steps = [
        buildStep("npx", ["aidn", "runtime", "project-runtime-state", "--target", targetArg, "--json"], "project-runtime-state-after-repair"),
      ];
      plan.notes.push("SQLite index is unavailable; repair triage cannot run yet, so only the runtime digest is refreshed.");
    }
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push("Repair routing is gated; do not resume implementation until blocking findings are cleared.");
    return plan;
  }

  plan.notes.push(`Manual relay required for ${recommendation.role} + ${recommendation.action}.`);
  return plan;
}

export async function computeCoordinatorDispatchPlan({
  targetRoot,
  agent = "auto",
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  packetFile = "docs/audit/HANDOFF-PACKET.md",
  agentRosterFile = "docs/audit/AGENT-ROSTER.md",
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const workspace = resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const loopState = await computeCoordinatorLoopState({
    targetRoot: absoluteTargetRoot,
    currentStateFile,
    runtimeStateFile,
    packetFile,
    workspace,
    sharedCoordination,
    sharedCoordinationOptions,
  });
  const recommendation = loopState.recommendation;
  const sharedPlanning = await readSharedPlanning(absoluteTargetRoot, currentStateFile, {
    workspace,
    sharedCoordination,
    sharedCoordinationOptions,
  });
  const integrationRisk = assessIntegrationRisk({
    targetRoot: absoluteTargetRoot,
    currentStateFile,
  });
  const roster = loadAgentRoster({
    targetRoot: absoluteTargetRoot,
    rosterFile: agentRosterFile,
  });
  const rosterVerification = await verifyAgentRoster({
    targetRoot: absoluteTargetRoot,
    rosterFile: agentRosterFile,
  });
  const adapterHealth = buildAgentHealthMap(rosterVerification);
  const adapters = await loadRegisteredAgentAdapters({
    targetRoot: absoluteTargetRoot,
    roster,
    ignoreLoadFailures: true,
  });
  const selection = resolveSelectedAgent({
    requestedAgent: String(agent).trim().toLowerCase() || "auto",
    recommendation,
    roster,
    adapters,
    adapterHealth,
  });
  const profile = selection.selected_profile;
  const supported = selection.status === "selected" && Boolean(profile);
  const recommendedRoleCoverage = buildRecommendedRoleCoverage({
    recommendation,
    adapters,
    rosterVerification,
    roster,
    adapterHealth,
  });
  const dispatch = buildEntryPlan({
    targetRoot: absoluteTargetRoot,
    recommendation,
    context: loopState.context,
  });
  const integrationRiskGate = buildIntegrationRiskGate({
    loopState,
    assessment: integrationRisk,
    recommendation,
    scope: loopState.scope,
  });

  if (loopState.loop?.escalation?.level === "user_arbitration_required") {
    dispatch.entrypoint_kind = "manual";
    dispatch.entrypoint_name = "user-arbitration";
    dispatch.steps = [];
    dispatch.commands = [];
    dispatch.notes = [
      `User arbitration required: ${loopState.loop.escalation.reason}`,
      "Do not dispatch another agent automatically until the issue is resolved.",
      "Run `aidn runtime coordinator-suggest-arbitration --target . --json` to review the structured arbitration options.",
    ];
  }
  if (integrationRiskGate.active) {
    dispatch.entrypoint_kind = "manual";
    dispatch.entrypoint_name = "user-arbitration";
    dispatch.steps = [];
    dispatch.commands = [];
    dispatch.notes = [
      `Integration strategy requires explicit resolution: ${integrationRisk.recommended_strategy}.`,
      ...integrationRisk.rationale.map((reason) => `Rationale: ${reason}`),
      "Run `aidn runtime project-integration-risk --target . --json` to inspect the cycle collision assessment.",
      "Run `aidn runtime coordinator-suggest-arbitration --target . --json` to review the structured integration decisions.",
    ];
  } else if (integrationRisk.candidate_cycles.length > 1) {
    dispatch.notes = [
      ...dispatch.notes,
      `Integration strategy assessment: ${integrationRisk.recommended_strategy} (${integrationRisk.mergeability}).`,
    ];
  }
  if (recommendedRoleCoverage.status === "blocked") {
    dispatch.entrypoint_kind = "manual";
    dispatch.entrypoint_name = "user-arbitration";
    dispatch.steps = [];
    dispatch.commands = [];
    dispatch.notes = [
      `Recommended role coverage is blocked: ${recommendedRoleCoverage.reason}`,
      "Do not dispatch another agent automatically until adapter availability is restored or the user selects a different path.",
      "Run `aidn runtime coordinator-suggest-arbitration --target . --json` to review the structured arbitration options.",
    ];
  }
  if (sharedPlanning.gate_status === "blocked") {
    dispatch.entrypoint_kind = "manual";
    dispatch.entrypoint_name = "user-arbitration";
    dispatch.steps = [];
    dispatch.commands = [];
    dispatch.notes = [
      `Shared planning arbitration must be resolved before dispatch: ${sharedPlanning.gate_reason}.`,
      "Run `aidn runtime session-plan --target . --planning-arbitration-status resolved --promote --json` after the planning decision is explicit.",
      "Run `aidn runtime coordinator-suggest-arbitration --target . --json` if the next dispatch scope still needs user arbitration.",
    ];
  }
  if (sharedPlanning.enabled) {
    dispatch.notes = [
      ...dispatch.notes,
      `Shared planning backlog: ${sharedPlanning.active_backlog}.`,
    ];
    dispatch.notes.push(`Shared planning freshness: ${sharedPlanning.freshness_status} (${sharedPlanning.freshness_basis}).`);
    if (sharedPlanning.backlog_next_step !== "unknown") {
      dispatch.notes.push(`Shared planning next step: ${sharedPlanning.backlog_next_step}.`);
    }
    if (sharedPlanning.planning_arbitration_status !== "none") {
      dispatch.notes.push(`Planning arbitration status: ${sharedPlanning.planning_arbitration_status}.`);
    }
    if (sharedPlanning.backlog_items.length > 0) {
      dispatch.notes.push(`Shared planning items: ${summarizeList(sharedPlanning.backlog_items)}.`);
    }
    if (sharedPlanning.open_questions.length > 0) {
      dispatch.notes.push(`Shared planning open questions: ${summarizeList(sharedPlanning.open_questions)}.`);
    }
    if (sharedPlanning.addenda_count > 0) {
      dispatch.notes.push(`Shared planning addenda: ${sharedPlanning.addenda_count} (${summarizeAddenda(sharedPlanning.recent_addenda)}).`);
    }
    if (sharedPlanning.dispatch_ready) {
      dispatch.notes.push(`Shared planning dispatch candidate: ${sharedPlanning.next_dispatch_scope} + ${sharedPlanning.next_dispatch_action}.`);
    }
  }

  const dispatchStatus = (loopState.loop?.escalation?.level === "user_arbitration_required" || recommendedRoleCoverage.status === "blocked" || integrationRiskGate.active || sharedPlanning.gate_status === "blocked")
    ? "escalated"
    : (!supported
      ? "unsupported"
      : (recommendation.stop_required ? "gated" : "ready"));
  const coordinatorStatus = buildWorkflowStatus({
    admission_status: loopState.handoff?.status?.admission_status ?? loopState.handoff?.admission_status ?? "admitted",
    admitted: loopState.handoff?.status?.admitted ?? loopState.handoff?.admitted ?? true,
    issues: loopState.handoff?.status?.issues ?? loopState.handoff?.issues ?? [],
    warnings: loopState.handoff?.status?.warnings ?? loopState.handoff?.warnings ?? [],
  });

  return {
    target_root: absoluteTargetRoot,
    selected_agent: {
      id: profile?.id ?? "unsupported",
      label: profile?.label ?? "Unsupported Agent",
      default_role: profile?.default_role ?? "coordinator",
      supported_roles: profile?.supported_roles ?? [],
      selection_status: selection.status,
      selection_reason: selection.reason,
      candidate_ids: selection.candidate_profiles.map((candidate) => candidate.id),
    },
    agent_roster: {
      found: roster.found,
      file_path: roster.file_path,
      default_requested_agent: roster.default_requested_agent,
    },
    agent_roster_verification: {
      pass: rosterVerification.pass,
      issue_count: rosterVerification.issues.length,
      warning_count: rosterVerification.warnings.length,
    },
    recommended_role_coverage: recommendedRoleCoverage,
    coordinator_recommendation: recommendation,
    coordinator_status: coordinatorStatus,
    integration_risk: integrationRisk,
    integration_risk_gate: integrationRiskGate,
    shared_planning: sharedPlanning,
    dispatch_scope: loopState.scope ?? {
      scope_type: "none",
      scope_id: "none",
      target_branch: "none",
    },
    dispatch_status: dispatchStatus,
    entrypoint_kind: dispatch.entrypoint_kind,
    entrypoint_name: dispatch.entrypoint_name,
    steps: dispatch.steps,
    commands: dispatch.commands,
    notes: dispatch.notes,
    preconditions: [
      "reload prioritized artifacts before acting",
      ...(sharedPlanning.enabled ? ["read the active shared backlog artifact before acting"] : []),
      "complete the mandatory pre-write restatement before durable write",
      recommendation.stop_required
        ? "respect the stop gate before any normal implementation relay"
        : "follow workflow gates for the selected mode before writing",
    ],
    handoff: loopState.handoff,
    context: loopState.context,
    loop: loopState.loop,
    base_recommendation: loopState.base_recommendation,
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await computeCoordinatorDispatchPlan({
      targetRoot: args.target,
      agent: args.agent,
      currentStateFile: args.currentStateFile,
      runtimeStateFile: args.runtimeStateFile,
      packetFile: args.packetFile,
      agentRosterFile: args.agentRosterFile,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Coordinator dispatch plan:");
      console.log(`- agent=${result.selected_agent.id}`);
      console.log(`- role=${result.coordinator_recommendation.role}`);
      console.log(`- action=${result.coordinator_recommendation.action}`);
      console.log(`- scope=${result.dispatch_scope.scope_type}:${result.dispatch_scope.scope_id}`);
      console.log(`- dispatch_status=${result.dispatch_status}`);
      console.log(`- entrypoint=${result.entrypoint_kind}:${result.entrypoint_name}`);
      for (const command of result.commands) {
        console.log(`- command=${command}`);
      }
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
