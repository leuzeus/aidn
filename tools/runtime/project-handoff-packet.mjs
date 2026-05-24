#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildHandoffPacketMarkdown,
  deriveHandoffStatus,
  deriveNextAgentRouting,
  prepareHandoffPacketProjection,
} from "../../src/application/runtime/handoff-packet-projector-use-case.mjs";
import {
  appendSharedHandoffRelay,
  readSharedPlanningState,
  resolveSharedCoordinationStore,
  summarizeSharedCoordinationResolution,
} from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { resolvePromotedSharedPlanningContext } from "../../src/application/runtime/shared-planning-resolution-service.mjs";
import { validateSharedRuntimeContext } from "../../src/application/runtime/shared-runtime-validation-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { WORKFLOW_REPAIR_HINT } from "../../src/application/runtime/workflow-transition-constants.mjs";
import { evaluateRepairRouting } from "../../src/application/runtime/workflow-transition-lib.mjs";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";
import { canAgentRolePerform } from "../../src/core/agents/agent-role-model.mjs";
import { evaluateAgentTransition } from "../../src/core/agents/agent-transition-policy.mjs";
import { evaluateCurrentStateConsistency } from "../perf/verify-current-state-consistency.mjs";
import {
  buildVirtualCurrentStateConsistency,
  canonicalNone,
  canonicalUnknown,
  loadDbIndexPayloadSafe,
  normalizeScalar,
  parseSimpleMap,
  parseTimestamp,
  resolveDbArtifactSourceName,
  resolveAuditArtifactText,
  resolveCyclePlanArtifact,
  resolveCycleStatusArtifact,
  resolveDbBackedMode,
  resolveSessionArtifact,
} from "./db-first-runtime-view-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: "docs/audit/RUNTIME-STATE.md",
    out: "docs/audit/HANDOFF-PACKET.md",
    nextAgentGoal: "",
    handoffNote: "",
    fromAgentRole: "",
    fromAgentAction: "",
    json: false,
    dryRun: false,
    write: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--current-state-file") {
      args.currentStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--runtime-state-file") {
      args.runtimeStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--out") {
      args.out = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--next-agent-goal") {
      args.nextAgentGoal = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--handoff-note") {
      args.handoffNote = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--from-agent-role") {
      args.fromAgentRole = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--from-agent-action") {
      args.fromAgentAction = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--write") {
      args.write = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.target || !args.out) {
    throw new Error("Missing required arguments");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/project-handoff-packet.mjs --target .");
  console.log("  node tools/runtime/project-handoff-packet.mjs --target . --write");
  console.log("  node tools/runtime/project-handoff-packet.mjs --target . --from-agent-role coordinator --from-agent-action relay --next-agent-goal \"reanchor and continue cycle validation\"");
  console.log("  node tools/runtime/project-handoff-packet.mjs --target tests/fixtures/repo-installed-core --json");
  console.log("  node tools/runtime/project-handoff-packet.mjs --target tests/fixtures/repo-installed-core --dry-run --json");
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

function isResolvedPlanningArbitrationStatus(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return !normalized
    || normalized === "none"
    || normalized === "resolved"
    || normalized === "closed"
    || normalized === "approved"
    || normalized === "cleared";
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
        if (item && item.toLowerCase() !== "none") {
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

function splitList(value) {
  if (!value) {
    return [];
  }
  return uniqueItems(String(value).split(",").map((item) => item.trim()));
}

function normalizeBacklogRef(value) {
  const normalized = normalizeScalar(value);
  if (!normalized || canonicalNone(normalized) || canonicalUnknown(normalized)) {
    return "none";
  }
  if (normalized.startsWith("docs/audit/")) {
    return normalized;
  }
  if (normalized.startsWith("backlog/")) {
    return `docs/audit/${normalized}`;
  }
  return normalized;
}

function parseBacklogArtifact(text) {
  const map = parseSimpleMap(text);
  return {
    updated_at: normalizeScalar(map.get("updated_at") ?? "") || "",
    dispatch_ready: normalizeScalar(map.get("dispatch_ready") ?? "no") || "no",
    next_dispatch_scope: normalizeScalar(map.get("next_dispatch_scope") ?? "none") || "none",
    next_dispatch_action: normalizeScalar(map.get("next_dispatch_action") ?? "none") || "none",
    backlog_next_step: normalizeScalar(map.get("backlog_next_step") ?? "unknown") || "unknown",
    planning_arbitration_status: normalizeScalar(map.get("planning_arbitration_status") ?? "none") || "none",
    linked_cycles: splitList(map.get("linked_cycles") ?? ""),
  };
}

function relativePath(root, filePath) {
  if (!filePath) {
    return "";
  }
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function deriveSharedPlanningCandidate({
  targetRoot,
  activeBacklog,
  scope,
  nextRouting,
  currentStateUpdatedAtMs,
  sharedPlanningRead = null,
  dbBacked = false,
  sqlitePayload = null,
  sqliteRuntimeHeads = null,
  dbSource = "sqlite",
}) {
  const sharedPlanningState = sharedPlanningRead?.planning_state ?? null;
  if (sharedPlanningRead?.ok === true && sharedPlanningState) {
    const payload = sharedPlanningState.payload && typeof sharedPlanningState.payload === "object"
      ? sharedPlanningState.payload
      : {};
    const backlogLogicalPath = normalizeBacklogRef(sharedPlanningState.backlog_artifact_ref || activeBacklog);
    const candidateReady = sharedPlanningState.dispatch_ready === true;
    const actionAligned = candidateReady && sharedPlanningState.next_dispatch_action !== "none"
      && (
        sharedPlanningState.next_dispatch_action === nextRouting.action
        || (nextRouting.role === "coordinator" && sharedPlanningState.next_dispatch_action === "coordinate")
      );
    const scopeAligned = candidateReady && sharedPlanningState.next_dispatch_scope !== "none"
      && (
        sharedPlanningState.next_dispatch_scope === scope.scope_type
        || (nextRouting.role === "coordinator" && sharedPlanningState.next_dispatch_scope === "session")
      );
    const candidateAligned = actionAligned && scopeAligned;
    const planningUpdatedAtMs = parseTimestamp(sharedPlanningState.updated_at ?? "");
    let freshnessStatus = "unknown";
    let freshnessBasis = "shared planning freshness could not be derived";
    if (currentStateUpdatedAtMs !== null && planningUpdatedAtMs !== null) {
      freshnessStatus = planningUpdatedAtMs >= currentStateUpdatedAtMs ? "ok" : "stale";
      freshnessBasis = planningUpdatedAtMs >= currentStateUpdatedAtMs
        ? "shared planning state updated_at is aligned with CURRENT-STATE.md"
        : "shared planning state updated_at is older than CURRENT-STATE.md";
    }
    const planningArbitrationStatus = normalizeScalar(
      sharedPlanningState.planning_arbitration_status
        || payload.planning_arbitration_status
        || "none",
    ) || "none";
    const arbitrationResolved = isResolvedPlanningArbitrationStatus(planningArbitrationStatus);
    return {
      enabled: true,
      artifact_found: true,
      preferred_dispatch_source: candidateAligned ? "shared_planning" : "workflow",
      candidate_ready: candidateReady,
      candidate_aligned: candidateAligned,
      freshness_status: freshnessStatus,
      freshness_basis: freshnessBasis,
      gate_status: arbitrationResolved ? "ok" : "blocked",
      gate_reason: arbitrationResolved
        ? "shared planning arbitration is resolved"
        : `planning arbitration remains unresolved: ${planningArbitrationStatus}`,
      next_dispatch_scope: normalizeScalar(sharedPlanningState.next_dispatch_scope) || "none",
      next_dispatch_action: normalizeScalar(sharedPlanningState.next_dispatch_action) || "none",
      backlog_next_step: normalizeScalar(sharedPlanningState.backlog_next_step || payload.backlog_next_step) || "unknown",
      planning_arbitration_status: planningArbitrationStatus,
      linked_cycles: Array.isArray(payload.linked_cycles)
        ? payload.linked_cycles.map((item) => normalizeScalar(item)).filter(Boolean)
        : splitList(payload.linked_cycles ?? ""),
      backlog_artifact_source: "shared-coordination",
      backlog_logical_path: backlogLogicalPath,
    };
  }

  const normalizedBacklog = normalizeBacklogRef(activeBacklog);
  if (normalizedBacklog === "none") {
    return {
      enabled: false,
      artifact_found: false,
      preferred_dispatch_source: "workflow",
      candidate_ready: false,
      candidate_aligned: false,
      freshness_status: "not_applicable",
      freshness_basis: "no active shared planning backlog",
      gate_status: "not_applicable",
      gate_reason: "no active shared planning backlog",
      next_dispatch_scope: "none",
      next_dispatch_action: "none",
      backlog_next_step: "unknown",
      planning_arbitration_status: "none",
      linked_cycles: [],
      backlog_artifact_source: "missing",
      backlog_logical_path: "none",
    };
  }
  const backlogResolution = resolveAuditArtifactText({
    targetRoot,
    candidatePath: normalizedBacklog,
    dbBacked,
    sqlitePayload,
    sqliteRuntimeHeads,
    dbSource,
  });
  if (!backlogResolution.exists) {
    return {
      enabled: true,
      artifact_found: false,
      preferred_dispatch_source: "workflow",
      candidate_ready: false,
      candidate_aligned: false,
      freshness_status: "missing",
      freshness_basis: "active backlog artifact is referenced but not found",
      gate_status: "warn",
      gate_reason: "active shared planning backlog is referenced but missing",
      next_dispatch_scope: "none",
      next_dispatch_action: "none",
      backlog_next_step: "unknown",
      planning_arbitration_status: "none",
      linked_cycles: [],
      backlog_artifact_source: "missing",
      backlog_logical_path: "none",
    };
  }
  const backlog = parseBacklogArtifact(backlogResolution.text);
  const candidateReady = String(backlog.dispatch_ready).trim().toLowerCase() === "yes";
  const actionAligned = candidateReady && backlog.next_dispatch_action !== "none"
    && (
      backlog.next_dispatch_action === nextRouting.action
      || (nextRouting.role === "coordinator" && backlog.next_dispatch_action === "coordinate")
    );
  const scopeAligned = candidateReady && backlog.next_dispatch_scope !== "none"
    && (
      backlog.next_dispatch_scope === scope.scope_type
      || (nextRouting.role === "coordinator" && backlog.next_dispatch_scope === "session")
    );
  const candidateAligned = actionAligned && scopeAligned;
  const backlogUpdatedAtMs = parseTimestamp(backlog.updated_at ?? "");
  let freshnessStatus = "unknown";
  let freshnessBasis = "shared planning freshness could not be derived";
  if (currentStateUpdatedAtMs !== null && backlogUpdatedAtMs !== null) {
    freshnessStatus = backlogUpdatedAtMs >= currentStateUpdatedAtMs ? "ok" : "stale";
    freshnessBasis = backlogUpdatedAtMs >= currentStateUpdatedAtMs
      ? "backlog updated_at is aligned with CURRENT-STATE.md"
      : "backlog updated_at is older than CURRENT-STATE.md";
  }
  const arbitrationResolved = isResolvedPlanningArbitrationStatus(backlog.planning_arbitration_status);
  return {
    enabled: true,
    artifact_found: true,
    preferred_dispatch_source: candidateAligned ? "shared_planning" : "workflow",
    candidate_ready: candidateReady,
    candidate_aligned: candidateAligned,
    freshness_status: freshnessStatus,
    freshness_basis: freshnessBasis,
    gate_status: arbitrationResolved ? "ok" : "blocked",
    gate_reason: arbitrationResolved
      ? "shared planning arbitration is resolved"
      : `planning arbitration remains unresolved: ${backlog.planning_arbitration_status}`,
    next_dispatch_scope: backlog.next_dispatch_scope,
    next_dispatch_action: backlog.next_dispatch_action,
    backlog_next_step: backlog.backlog_next_step,
    planning_arbitration_status: backlog.planning_arbitration_status,
    linked_cycles: backlog.linked_cycles,
    backlog_artifact_source: backlogResolution.source,
    backlog_logical_path: backlogResolution.logicalPath,
  };
}

export async function projectHandoffPacket({
  targetRoot,
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  out = "docs/audit/HANDOFF-PACKET.md",
  nextAgentGoal = "",
  handoffNote = "",
  fromAgentRole = "",
  fromAgentAction = "",
  sharedCoordination = null,
  sharedCoordinationOptions = {},
  sharedStateOptions = {},
  dryRun = false,
  write = false,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const workspace = resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const sharedCoordinationResolution = sharedCoordination ?? await resolveSharedCoordinationStore({
    targetRoot: absoluteTargetRoot,
    workspace,
    ...sharedCoordinationOptions,
  });
  const sharedRuntimeValidation = validateSharedRuntimeContext({
    targetRoot: absoluteTargetRoot,
    workspace,
  });
  const auditRoot = path.join(absoluteTargetRoot, "docs", "audit");
  const { effectiveStateMode, dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
  const sqliteFallback = dbBackedMode ? await loadDbIndexPayloadSafe(absoluteTargetRoot, sharedStateOptions) : {
    exists: false,
    sqliteFile: "",
    payload: null,
    runtimeHeads: {},
    warning: "",
  };
  const dbSource = resolveDbArtifactSourceName(sqliteFallback.backend);
  const currentStateResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: currentStateFile,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
    dbSource,
  });
  const runtimeStateResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: runtimeStateFile,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
    dbSource,
  });
  const currentStateText = currentStateResolution.text;
  const runtimeStateText = runtimeStateResolution.text;
  const currentMap = parseSimpleMap(currentStateText);
  const runtimeMap = parseSimpleMap(runtimeStateText);

  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
  const sessionResolution = resolveSessionArtifact({
    targetRoot: absoluteTargetRoot,
    auditRoot,
    sessionId: activeSession,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    dbSource,
  });
  const cycleStatusResolution = resolveCycleStatusArtifact({
    targetRoot: absoluteTargetRoot,
    auditRoot,
    cycleId: activeCycle,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    dbSource,
  });
  const planResolution = resolveCyclePlanArtifact({
    targetRoot: absoluteTargetRoot,
    cycleStatusResolution,
    cycleId: activeCycle,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    dbSource,
  });
  const consistency = currentStateResolution.source === "file"
    ? evaluateCurrentStateConsistency({ targetRoot: absoluteTargetRoot })
    : buildVirtualCurrentStateConsistency({
      currentStateResolution,
      activeCycle,
      activeSession,
      cycleStatusResolution,
    });
  const repairStatus = normalizeScalar(runtimeMap.get("repair_layer_status") ?? "unknown") || "unknown";
  const repairPrimaryReason = normalizeScalar(runtimeMap.get("repair_primary_reason") ?? runtimeMap.get("repair_layer_advice") ?? "unknown") || "unknown";
  const repairRouting = evaluateRepairRouting({
    status: repairStatus,
    advice: normalizeScalar(runtimeMap.get("repair_layer_advice") ?? "unknown") || "unknown",
    blocking: repairStatus.toLowerCase() === "block",
  });
  const repairRoutingHint = normalizeScalar(runtimeMap.get("repair_routing_hint") ?? repairRouting.routing_hint) || "unknown";
  const repairRoutingReason = normalizeScalar(runtimeMap.get("repair_routing_reason") ?? repairRouting.routing_reason) || "unknown";
  const mode = normalizeScalar(currentMap.get("mode") ?? "unknown") || "unknown";
  const branchKind = normalizeScalar(currentMap.get("branch_kind") ?? "unknown") || "unknown";
  const dorState = normalizeScalar(currentMap.get("dor_state") ?? "unknown") || "unknown";
  const firstPlanStep = normalizeScalar(currentMap.get("first_plan_step") ?? "unknown") || "unknown";
  const sharedPlanningContext = await resolvePromotedSharedPlanningContext({
    targetRoot: absoluteTargetRoot,
    workspace,
    currentState: {
      active_session: activeSession,
      active_backlog: currentMap.get("active_backlog") ?? "none",
      backlog_status: currentMap.get("backlog_status") ?? "unknown",
      backlog_next_step: currentMap.get("backlog_next_step") ?? "unknown",
      backlog_selected_execution_scope: currentMap.get("backlog_selected_execution_scope") ?? "none",
      planning_arbitration_status: currentMap.get("planning_arbitration_status") ?? "none",
    },
    sharedCoordination: sharedCoordinationResolution,
  });
  const activeBacklog = normalizeBacklogRef(sharedPlanningContext.active_backlog);
  const backlogStatus = normalizeScalar(sharedPlanningContext.backlog_status) || "unknown";
  const backlogNextStep = normalizeScalar(sharedPlanningContext.backlog_next_step) || "unknown";
  const planningArbitrationStatus = normalizeScalar(sharedPlanningContext.planning_arbitration_status) || "none";
  const handoffStatus = deriveHandoffStatus({ consistency, runtimeMap, currentMap });
  const nextRouting = deriveNextAgentRouting({
    handoffStatus,
    mode,
    repairStatus: repairRoutingHint,
    repairHints: WORKFLOW_REPAIR_HINT,
  });
  const handoffFromAgentRole = normalizeScalar(fromAgentRole) || "coordinator";
  const handoffFromAgentAction = normalizeScalar(fromAgentAction) || "relay";
  const sharedPlanning = deriveSharedPlanningCandidate({
    targetRoot: absoluteTargetRoot,
    activeBacklog,
    scope: (() => {
      const activeSessionScope = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
      const activeCycleScope = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
      const sessionBranch = normalizeScalar(currentMap.get("session_branch") ?? "none") || "none";
      const cycleBranch = normalizeScalar(currentMap.get("cycle_branch") ?? "none") || "none";
      if (!canonicalNone(activeCycleScope) && !canonicalUnknown(activeCycleScope)) {
        return {
          scope_type: "cycle",
          scope_id: activeCycleScope,
          target_branch: !canonicalNone(cycleBranch) && !canonicalUnknown(cycleBranch) ? cycleBranch : "none",
        };
      }
      if (!canonicalNone(activeSessionScope) && !canonicalUnknown(activeSessionScope)) {
        return {
          scope_type: "session",
          scope_id: activeSessionScope,
          target_branch: !canonicalNone(sessionBranch) && !canonicalUnknown(sessionBranch) ? sessionBranch : "none",
        };
      }
      if (nextRouting.role === "coordinator") {
        return {
          scope_type: "session",
          scope_id: !canonicalNone(activeSessionScope) && !canonicalUnknown(activeSessionScope) ? activeSessionScope : "none",
          target_branch: !canonicalNone(sessionBranch) && !canonicalUnknown(sessionBranch) ? sessionBranch : "none",
        };
      }
      return {
        scope_type: "none",
        scope_id: "none",
        target_branch: "none",
      };
    })(),
    nextRouting,
    currentStateUpdatedAtMs: parseTimestamp(currentMap.get("updated_at") ?? ""),
    sharedPlanningRead: activeSession !== "none"
      ? await readSharedPlanningState(sharedCoordinationResolution, {
        workspace,
        sessionId: activeSession,
        planningKey: `session:${activeSession}`,
      })
      : null,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
    dbSource,
  });
  const packet = prepareHandoffPacketProjection({
    workspace,
    sharedRuntimeValidation,
    repairHints: WORKFLOW_REPAIR_HINT,
    nextAgentGoal,
    handoffNote,
    handoffFromAgentRole,
    handoffFromAgentAction,
    mode,
    branchKind,
    activeSession,
    activeCycle,
    dorState,
    firstPlanStep,
    backlogStatus,
    backlogNextStep,
    runtimeStateMode: normalizeScalar(
      dbBackedMode
        ? effectiveStateMode
        : (runtimeMap.get("runtime_state_mode") ?? currentMap.get("runtime_state_mode") ?? "unknown"),
    ) || "unknown",
    repairStatus,
    repairPrimaryReason,
    repairRoutingHint,
    repairRoutingReason,
    planningArbitrationStatus,
    activeBacklog,
    currentStateFreshness: normalizeScalar(runtimeMap.get("current_state_freshness") ?? "unknown") || "unknown",
    runtimeStateText,
    currentMap,
    runtimeMap,
    sharedPlanning,
    consistency,
    sessionResolution,
    cycleStatusResolution,
    planResolution,
    currentStateResolution,
    runtimeStateResolution,
    transitionEvaluator: evaluateAgentTransition,
  });

  if (!canAgentRolePerform(packet.recommended_next_agent_role, packet.recommended_next_agent_action)) {
    throw new Error(`Invalid handoff routing: role=${packet.recommended_next_agent_role} action=${packet.recommended_next_agent_action}`);
  }

  if (packet.blocking_findings.length === 0 && packet.handoff_status === "blocked") {
    packet.blocking_findings.push("runtime or workflow blocking condition detected without detailed finding list");
  }

  const markdown = buildHandoffPacketMarkdown(packet);
  const outputPath = resolveTargetPath(absoluteTargetRoot, out);
  const shouldWrite = Boolean(write) && !dryRun;
  const outWrite = shouldWrite
    ? writeUtf8IfChanged(outputPath, markdown)
    : { path: outputPath, written: false };
  const sharedCoordinationSync = shouldWrite
    ? {
        attempted: false,
        ok: false,
        status: "dry-run",
        reason: "handoff packet dry-run does not write local projection or append shared relay",
        operation: "appendHandoffRelay",
        backend: summarizeSharedCoordinationResolution(sharedCoordinationResolution),
        diagnostic: {
          scope: "shared-coordination-only",
          operation: "appendHandoffRelay",
          sync_status: "dry-run",
          backend_status: summarizeSharedCoordinationResolution(sharedCoordinationResolution).status,
          readiness_status: "not_run",
          schema_status: "unknown",
          compatibility_status: "unknown",
          artifact_family: "handoff_relay",
          owner: workspace?.project_id ?? "unknown",
          summary: "handoff packet dry-run does not write local projection or append shared relay",
          recommended_action: "rerun without --dry-run when shared relay sync is explicitly desired",
        },
      }
    : await appendSharedHandoffRelay(sharedCoordinationResolution, {
        workspace,
        packet,
        outputFile: relativePath(absoluteTargetRoot, outWrite.path),
      });
  return {
    target_root: absoluteTargetRoot,
    dry_run: Boolean(dryRun),
    write: shouldWrite,
    workspace,
    shared_state_backend: sqliteFallback.backend ?? null,
    shared_coordination_backend: summarizeSharedCoordinationResolution(sharedCoordinationResolution),
    shared_coordination_sync: sharedCoordinationSync,
    shared_runtime_validation: sharedRuntimeValidation,
    output_file: outWrite.path,
    written: outWrite.written,
    packet,
    consistency,
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const output = await projectHandoffPacket({
      targetRoot: args.target,
      currentStateFile: args.currentStateFile,
      runtimeStateFile: args.runtimeStateFile,
      out: args.out,
      nextAgentGoal: args.nextAgentGoal,
      handoffNote: args.handoffNote,
      fromAgentRole: args.fromAgentRole,
      fromAgentAction: args.fromAgentAction,
      dryRun: args.dryRun,
      write: args.write,
    });
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Handoff packet: ${output.output_file} (${output.written ? "written" : "unchanged"})`);
      console.log(`- handoff_status=${output.packet.handoff_status}`);
      console.log(`- handoff_from_agent_role=${output.packet.handoff_from_agent_role}`);
      console.log(`- handoff_from_agent_action=${output.packet.handoff_from_agent_action}`);
      console.log(`- recommended_next_agent_role=${output.packet.recommended_next_agent_role}`);
      console.log(`- recommended_next_agent_action=${output.packet.recommended_next_agent_action}`);
      console.log(`- scope=${output.packet.scope_type}:${output.packet.scope_id}`);
      console.log(`- transition_policy_status=${output.packet.transition_policy_status}`);
      console.log(`- next_agent_goal=${output.packet.next_agent_goal}`);
      console.log(`- active_session=${output.packet.active_session}`);
      console.log(`- active_cycle=${output.packet.active_cycle}`);
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
