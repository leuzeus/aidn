#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readLatestSharedHandoffRelay, resolveSharedCoordinationStore } from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { WORKFLOW_REPAIR_HINT } from "../../src/application/runtime/workflow-transition-constants.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { buildWorkflowRoute } from "../../src/application/runtime/workflow-transition-lib.mjs";
import { canAgentRolePerform } from "../../src/core/agents/agent-role-model.mjs";
import { admitHandoff } from "./handoff-admit.mjs";
import {
  canonicalNone,
  canonicalUnknown,
  loadSqliteIndexPayloadSafe,
  normalizeScalar,
  parseTimestamp,
  parseSimpleMap,
  resolveAuditArtifactText,
  resolveDbBackedMode,
} from "./db-first-runtime-view-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: "docs/audit/RUNTIME-STATE.md",
    packetFile: "docs/audit/HANDOFF-PACKET.md",
    json: false,
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
    } else if (token === "--packet-file") {
      args.packetFile = String(argv[i + 1] ?? "").trim();
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/coordinator-next-action.mjs --target .");
  console.log("  node tools/runtime/coordinator-next-action.mjs --target tests/fixtures/repo-installed-core --json");
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

function parseNumberedSection(text, header) {
  const lines = String(text).split(/\r?\n/);
  const items = [];
  let active = false;
  for (const line of lines) {
    if (line.trim() === header) {
      active = true;
      continue;
    }
    if (active && /^##\s+/.test(line)) {
      break;
    }
    if (active) {
      const match = line.match(/^\s*\d+\.\s+(.+)$/);
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

function deriveFallbackRecommendation(currentMap, runtimeMap, nextActions) {
  const mode = normalizeScalar(currentMap.get("mode") ?? "unknown") || "unknown";
  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
  const dorState = normalizeScalar(currentMap.get("dor_state") ?? "unknown") || "unknown";
  const firstPlanStep = normalizeScalar(currentMap.get("first_plan_step") ?? "unknown") || "unknown";
  const activeBacklog = normalizeScalar(currentMap.get("active_backlog") ?? "none") || "none";
  const backlogNextStep = normalizeScalar(currentMap.get("backlog_next_step") ?? "unknown") || "unknown";
  const repairRouting = normalizeScalar(runtimeMap.get("repair_routing_hint") ?? runtimeMap.get("repair_layer_status") ?? "unknown").toLowerCase();
  const repairAdvice = normalizeScalar(runtimeMap.get("repair_routing_reason") ?? runtimeMap.get("repair_layer_advice") ?? "");
  const sharedPlanningGoal = !canonicalNone(activeBacklog) && !canonicalUnknown(activeBacklog) && backlogNextStep && !canonicalUnknown(backlogNextStep)
    ? backlogNextStep
    : "";

  if (repairRouting === "repair" || repairRouting === "block") {
    return buildWorkflowRoute({
      role: "repair",
      action: "repair",
      goal: repairAdvice || "resolve blocking repair findings before continuing",
      source: "runtime-state",
      reason: "runtime repair routing is blocking",
      stop_required: true,
    });
  }
  if (repairRouting === WORKFLOW_REPAIR_HINT.AUDIT_FIRST) {
    return buildWorkflowRoute({
      role: "auditor",
      action: "audit",
      goal: repairAdvice || "review runtime warnings before continuing implementation",
      source: "runtime-state",
      reason: "runtime repair routing requires an audit-first pass",
      stop_required: false,
    });
  }
  if (mode === "COMMITTING" && !canonicalNone(activeCycle) && !canonicalUnknown(activeCycle) && dorState === "READY" && firstPlanStep && !canonicalUnknown(firstPlanStep)) {
    return buildWorkflowRoute({
      role: "executor",
      action: "implement",
      goal: firstPlanStep,
      source: "current-state",
      reason: "current state is ready for committing execution",
      stop_required: false,
    });
  }
  if (mode === "EXPLORING") {
    return buildWorkflowRoute({
      role: "auditor",
      action: "analyze",
      goal: sharedPlanningGoal || nextActions[0] || "continue analysis and validate the next hypothesis",
      source: "current-state",
      reason: sharedPlanningGoal
        ? "shared session backlog defines the next planning step for analysis"
        : "exploring mode favors audit/analyze routing",
      stop_required: false,
    });
  }
  if (mode === "THINKING") {
    return buildWorkflowRoute({
      role: "coordinator",
      action: "coordinate",
      goal: sharedPlanningGoal || nextActions[0] || "restate the objective and smallest compliant next step",
      source: "current-state",
      reason: sharedPlanningGoal
        ? "shared session backlog defines the next coordination step"
        : "thinking mode favors coordination before execution",
      stop_required: false,
    });
  }
  if (canonicalNone(activeSession) && canonicalNone(activeCycle)) {
    return buildWorkflowRoute({
      role: "coordinator",
      action: "reanchor",
      goal: "reload the active session, cycle, and runtime facts before acting",
      source: "current-state",
      reason: "no active session or cycle is declared",
      stop_required: false,
    });
  }
  return buildWorkflowRoute({
    role: "coordinator",
    action: "coordinate",
    goal: nextActions[0] ?? "review the active artifacts and select the smallest compliant next step",
    source: "current-state",
    reason: "fallback coordination path",
    stop_required: false,
  });
}

function deriveFallbackScope(currentMap) {
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
  const cycleBranch = normalizeScalar(currentMap.get("cycle_branch") ?? "none") || "none";
  const sessionBranch = normalizeScalar(currentMap.get("session_branch") ?? "none") || "none";
  if (!canonicalNone(activeCycle) && !canonicalUnknown(activeCycle)) {
    return {
      scope_type: "cycle",
      scope_id: activeCycle,
      target_branch: !canonicalNone(cycleBranch) && !canonicalUnknown(cycleBranch) ? cycleBranch : "none",
    };
  }
  if (!canonicalNone(activeSession) && !canonicalUnknown(activeSession)) {
    return {
      scope_type: "session",
      scope_id: activeSession,
      target_branch: !canonicalNone(sessionBranch) && !canonicalUnknown(sessionBranch) ? sessionBranch : "none",
    };
  }
  return {
    scope_type: "none",
    scope_id: "none",
    target_branch: "none",
  };
}

function deriveSharedPlanningCandidate(handoff) {
  return {
    preferred_dispatch_source: normalizeScalar(handoff?.preferred_dispatch_source ?? "workflow") || "workflow",
    shared_planning_candidate_ready: normalizeScalar(handoff?.shared_planning_candidate_ready ?? "no") || "no",
    shared_planning_candidate_aligned: normalizeScalar(handoff?.shared_planning_candidate_aligned ?? "no") || "no",
    shared_planning_dispatch_scope: normalizeScalar(handoff?.shared_planning_dispatch_scope ?? "none") || "none",
    shared_planning_dispatch_action: normalizeScalar(handoff?.shared_planning_dispatch_action ?? "none") || "none",
  };
}

function readPacketSummary(packetResolution) {
  if (!packetResolution?.exists) {
    return {
      exists: false,
      updated_at: "",
      updated_at_ms: null,
      recommended_role: "",
      recommended_action: "",
      goal: "",
      scope_type: "",
      scope_id: "",
      preferred_dispatch_source: "",
    };
  }
  const packetMap = parseSimpleMap(packetResolution.text);
  const updatedAt = normalizeScalar(packetMap.get("updated_at") ?? "");
  return {
    exists: true,
    updated_at: updatedAt,
    updated_at_ms: parseTimestamp(updatedAt),
    recommended_role: normalizeScalar(packetMap.get("recommended_next_agent_role") ?? ""),
    recommended_action: normalizeScalar(packetMap.get("recommended_next_agent_action") ?? ""),
    goal: normalizeScalar(packetMap.get("next_agent_goal") ?? ""),
    scope_type: normalizeScalar(packetMap.get("scope_type") ?? ""),
    scope_id: normalizeScalar(packetMap.get("scope_id") ?? ""),
    preferred_dispatch_source: normalizeScalar(packetMap.get("preferred_dispatch_source") ?? ""),
  };
}

function readSharedRelaySummary(relay) {
  if (!relay || typeof relay !== "object") {
    return {
      exists: false,
      updated_at: "",
      updated_at_ms: null,
      recommended_role: "",
      recommended_action: "",
      goal: "",
      scope_type: "",
      scope_id: "",
      preferred_dispatch_source: "",
    };
  }
  const metadata = relay.metadata && typeof relay.metadata === "object"
    ? relay.metadata
    : {};
  const updatedAt = normalizeScalar(metadata.updated_at || relay.created_at || "");
  return {
    exists: true,
    updated_at: updatedAt,
    updated_at_ms: parseTimestamp(updatedAt),
    recommended_role: normalizeScalar(metadata.recommended_next_agent_role || relay.recommended_next_agent_role || ""),
    recommended_action: normalizeScalar(metadata.recommended_next_agent_action || relay.recommended_next_agent_action || ""),
    goal: normalizeScalar(metadata.next_agent_goal || ""),
    scope_type: normalizeScalar(metadata.scope_type || relay.scope_type || ""),
    scope_id: normalizeScalar(metadata.scope_id || relay.scope_id || ""),
    preferred_dispatch_source: normalizeScalar(metadata.preferred_dispatch_source || ""),
  };
}

function derivePacketResolution(localPacket, sharedRelay) {
  if (!localPacket.exists && !sharedRelay.exists) {
    return {
      selected_source: "none",
      selection_reason: "no local packet or shared handoff relay is available",
      freshness_status: "missing",
      conflict_status: "not_applicable",
      local_packet_updated_at: "",
      shared_relay_updated_at: "",
    };
  }
  if (!localPacket.exists && sharedRelay.exists) {
    return {
      selected_source: "shared-coordination",
      selection_reason: "local handoff packet is missing",
      freshness_status: "local-missing",
      conflict_status: "not_applicable",
      local_packet_updated_at: "",
      shared_relay_updated_at: sharedRelay.updated_at,
    };
  }
  if (localPacket.exists && !sharedRelay.exists) {
    return {
      selected_source: "local-packet",
      selection_reason: "no shared handoff relay is available",
      freshness_status: "shared-missing",
      conflict_status: "not_applicable",
      local_packet_updated_at: localPacket.updated_at,
      shared_relay_updated_at: "",
    };
  }

  const diverged = localPacket.recommended_role !== sharedRelay.recommended_role
    || localPacket.recommended_action !== sharedRelay.recommended_action
    || localPacket.goal !== sharedRelay.goal
    || localPacket.scope_type !== sharedRelay.scope_type
    || localPacket.scope_id !== sharedRelay.scope_id
    || localPacket.preferred_dispatch_source !== sharedRelay.preferred_dispatch_source;

  if (localPacket.updated_at_ms === null && sharedRelay.updated_at_ms !== null) {
    return {
      selected_source: "shared-coordination",
      selection_reason: "local handoff packet has no parseable timestamp while the shared relay does",
      freshness_status: "shared-newer",
      conflict_status: diverged ? "diverged-shared-preferred" : "aligned-shared-preferred",
      local_packet_updated_at: localPacket.updated_at,
      shared_relay_updated_at: sharedRelay.updated_at,
    };
  }
  if (localPacket.updated_at_ms !== null && sharedRelay.updated_at_ms === null) {
    return {
      selected_source: "local-packet",
      selection_reason: "shared handoff relay has no parseable timestamp while the local packet does",
      freshness_status: "local-newer",
      conflict_status: diverged ? "diverged-local-preferred" : "aligned-local-preferred",
      local_packet_updated_at: localPacket.updated_at,
      shared_relay_updated_at: sharedRelay.updated_at,
    };
  }
  if (localPacket.updated_at_ms !== null && sharedRelay.updated_at_ms !== null) {
    if (sharedRelay.updated_at_ms > localPacket.updated_at_ms) {
      return {
        selected_source: "shared-coordination",
        selection_reason: "shared handoff relay is newer than the local packet",
        freshness_status: "shared-newer",
        conflict_status: diverged ? "diverged-shared-preferred" : "aligned-shared-preferred",
        local_packet_updated_at: localPacket.updated_at,
        shared_relay_updated_at: sharedRelay.updated_at,
      };
    }
    if (localPacket.updated_at_ms > sharedRelay.updated_at_ms) {
      return {
        selected_source: "local-packet",
        selection_reason: "local handoff packet is newer than the shared relay",
        freshness_status: "local-newer",
        conflict_status: diverged ? "diverged-local-preferred" : "aligned-local-preferred",
        local_packet_updated_at: localPacket.updated_at,
        shared_relay_updated_at: sharedRelay.updated_at,
      };
    }
  }
  return {
    selected_source: "local-packet",
    selection_reason: diverged
      ? "local and shared handoff timestamps are tied; local packet stays authoritative for this worktree"
      : "local and shared handoff timestamps are tied and aligned",
    freshness_status: "same-age",
    conflict_status: diverged ? "diverged-local-preferred" : "aligned",
    local_packet_updated_at: localPacket.updated_at,
    shared_relay_updated_at: sharedRelay.updated_at,
  };
}

function buildSharedRelayHandoff(relay) {
  const metadata = relay?.metadata && typeof relay.metadata === "object"
    ? relay.metadata
    : {};
  const packet = {
    handoff_status: normalizeScalar(metadata.handoff_status || relay?.handoff_status || "unknown") || "unknown",
    recommended_next_agent_role: normalizeScalar(metadata.recommended_next_agent_role || relay?.recommended_next_agent_role || "coordinator") || "coordinator",
    recommended_next_agent_action: normalizeScalar(metadata.recommended_next_agent_action || relay?.recommended_next_agent_action || "coordinate") || "coordinate",
    next_agent_goal: normalizeScalar(metadata.next_agent_goal || "reload the shared relay and continue") || "reload the shared relay and continue",
    preferred_dispatch_source: normalizeScalar(metadata.preferred_dispatch_source || "workflow") || "workflow",
    shared_planning_candidate_ready: normalizeScalar(metadata.shared_planning_candidate_ready || "no") || "no",
    shared_planning_candidate_aligned: normalizeScalar(metadata.shared_planning_candidate_aligned || "no") || "no",
    shared_planning_dispatch_scope: normalizeScalar(metadata.shared_planning_dispatch_scope || "none") || "none",
    shared_planning_dispatch_action: normalizeScalar(metadata.shared_planning_dispatch_action || "none") || "none",
    scope_type: normalizeScalar(metadata.scope_type || relay?.scope_type || "none") || "none",
    scope_id: normalizeScalar(metadata.scope_id || relay?.scope_id || "none") || "none",
    target_branch: normalizeScalar(metadata.target_branch || "none") || "none",
    repair_layer_status: normalizeScalar(metadata.repair_layer_status || "unknown") || "unknown",
    repair_primary_reason: normalizeScalar(metadata.repair_primary_reason || "unknown") || "unknown",
    updated_at: normalizeScalar(metadata.updated_at || relay?.created_at || ""),
  };
  return {
    admission_status: "admitted",
    status: {
      admission_status: "admitted",
      admitted: true,
      issues: [],
      warnings: [],
    },
    packet,
    recommended_next_agent_role: packet.recommended_next_agent_role,
    recommended_action: packet.recommended_next_agent_action,
    next_agent_goal: packet.next_agent_goal,
    preferred_dispatch_source: packet.preferred_dispatch_source,
    scope_type: packet.scope_type,
    scope_id: packet.scope_id,
    target_branch: packet.target_branch,
    transition_policy: {
      status: "shared_relay_fallback",
      reason: "shared coordination handoff relay used because the local packet is missing or older",
    },
    route: {
      role: packet.recommended_next_agent_role,
      action: packet.recommended_next_agent_action,
      goal: packet.next_agent_goal,
    },
    source: "shared-coordination",
  };
}

export async function computeCoordinatorNextAction({
  targetRoot,
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  packetFile = "docs/audit/HANDOFF-PACKET.md",
  workspace = null,
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const effectiveWorkspace = workspace ?? resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const { dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
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
  const packetResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: packetFile,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
  });
  const currentStateText = currentStateResolution.text;
  const runtimeStateText = runtimeStateResolution.text;
  const currentMap = parseSimpleMap(currentStateText);
  const runtimeMap = parseSimpleMap(runtimeStateText);
  const nextActions = parseNumberedSection(currentStateText, "## Next Actions");
  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
  const sharedCoordinationResolution = sharedCoordination ?? await resolveSharedCoordinationStore({
    targetRoot: absoluteTargetRoot,
    workspace: effectiveWorkspace,
    ...sharedCoordinationOptions,
  });
  const sharedRelayRead = await readLatestSharedHandoffRelay(sharedCoordinationResolution, {
    workspace: effectiveWorkspace,
    sessionId: activeSession !== "none" ? activeSession : "",
    scopeType: activeCycle !== "none" ? "cycle" : "",
    scopeId: activeCycle !== "none" ? activeCycle : "",
  });
  const sharedRelay = sharedRelayRead.handoff_relay ?? null;
  const localPacket = readPacketSummary(packetResolution);
  const sharedRelayPacket = readSharedRelaySummary(sharedRelay);
  const packetResolutionInfo = derivePacketResolution(localPacket, sharedRelayPacket);
  const shouldUseSharedRelay = packetResolutionInfo.selected_source === "shared-coordination";

  let handoff = null;
  let recommendation = null;
  let scope = null;
  if (packetResolution.exists && currentStateResolution.exists && runtimeStateResolution.exists && !shouldUseSharedRelay) {
    handoff = admitHandoff({
      targetRoot: absoluteTargetRoot,
      packetFile,
      currentStateFile,
      runtimeStateFile,
    });
    const preferredDispatchSource = normalizeScalar(handoff.preferred_dispatch_source ?? "workflow") || "workflow";
    recommendation = handoff.route
      ? buildWorkflowRoute({
        ...handoff.route,
        source: handoff.admission_status === "admitted"
          ? (preferredDispatchSource === "shared_planning" ? "handoff-shared-planning" : "handoff")
          : "handoff-admit",
        reason: handoff.admission_status === "admitted"
          ? (
            preferredDispatchSource === "shared_planning"
              ? `admitted handoff packet provides a shared-planning relay (${handoff.transition_policy?.status ?? "unknown-transition"})`
              : `admitted handoff packet provides the next relay (${handoff.transition_policy?.status ?? "unknown-transition"})`
          )
          : `handoff admission ${handoff.admission_status}`,
        stop_required: handoff.admission_status === "blocked",
      })
      : buildWorkflowRoute({
        role: handoff.recommended_next_agent_role,
        action: handoff.recommended_action,
        goal: handoff.next_agent_goal,
        source: handoff.admission_status === "admitted"
          ? (preferredDispatchSource === "shared_planning" ? "handoff-shared-planning" : "handoff")
          : "handoff-admit",
        reason: handoff.admission_status === "admitted"
          ? (
            preferredDispatchSource === "shared_planning"
              ? `admitted handoff packet provides a shared-planning relay (${handoff.transition_policy?.status ?? "unknown-transition"})`
              : `admitted handoff packet provides the next relay (${handoff.transition_policy?.status ?? "unknown-transition"})`
          )
          : `handoff admission ${handoff.admission_status}`,
        stop_required: handoff.admission_status === "blocked",
      });
    scope = {
      scope_type: normalizeScalar(handoff.scope_type ?? "none") || "none",
      scope_id: normalizeScalar(handoff.scope_id ?? "none") || "none",
      target_branch: normalizeScalar(handoff.target_branch ?? "none") || "none",
    };
  } else if (shouldUseSharedRelay && currentStateResolution.exists && runtimeStateResolution.exists) {
    handoff = buildSharedRelayHandoff(sharedRelay);
    const preferredDispatchSource = normalizeScalar(handoff.preferred_dispatch_source ?? "workflow") || "workflow";
    recommendation = buildWorkflowRoute({
      role: handoff.recommended_next_agent_role,
      action: handoff.recommended_action,
      goal: handoff.next_agent_goal,
      source: preferredDispatchSource === "shared_planning" ? "handoff-shared-planning" : "handoff-shared-relay",
      reason: preferredDispatchSource === "shared_planning"
        ? `shared handoff relay provides a shared-planning recommendation (${handoff.transition_policy?.status ?? "shared-relay"})`
        : `shared handoff relay provides the next recommendation (${handoff.transition_policy?.status ?? "shared-relay"})`,
      stop_required: handoff.admission_status === "blocked",
    });
    scope = {
      scope_type: normalizeScalar(handoff.scope_type ?? "none") || "none",
      scope_id: normalizeScalar(handoff.scope_id ?? "none") || "none",
      target_branch: normalizeScalar(handoff.target_branch ?? "none") || "none",
    };
  } else {
    recommendation = deriveFallbackRecommendation(currentMap, runtimeMap, nextActions);
    scope = deriveFallbackScope(currentMap);
  }

  if (!recommendation) {
    recommendation = deriveFallbackRecommendation(currentMap, runtimeMap, nextActions);
    scope = deriveFallbackScope(currentMap);
  }
  if (!canAgentRolePerform(recommendation.role, recommendation.action)) {
    throw new Error(`Invalid coordinator recommendation: role=${recommendation.role} action=${recommendation.action}`);
  }

  return {
    target_root: absoluteTargetRoot,
    current_state_file: currentStateResolution.exists ? currentStateResolution.logicalPath : "none",
    runtime_state_file: runtimeStateResolution.exists ? runtimeStateResolution.logicalPath : "none",
    packet_file: handoff?.source === "shared-coordination"
      ? (normalizeScalar(sharedRelay?.handoff_packet_ref) || "shared-coordination://handoff_relays")
      : (packetResolution.exists ? packetResolution.logicalPath : "none"),
    packet_resolution: packetResolutionInfo,
    handoff,
    preferred_dispatch_source: handoff
      ? (normalizeScalar(handoff.preferred_dispatch_source ?? "workflow") || "workflow")
      : "workflow",
    shared_planning_candidate: handoff ? deriveSharedPlanningCandidate(handoff) : null,
    recommendation,
    scope,
    context: {
      mode: normalizeScalar(currentMap.get("mode") ?? "unknown") || "unknown",
      active_session: normalizeScalar(currentMap.get("active_session") ?? "none") || "none",
      active_cycle: normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none",
      dor_state: normalizeScalar(currentMap.get("dor_state") ?? "unknown") || "unknown",
      repair_routing_hint: normalizeScalar(runtimeMap.get("repair_routing_hint") ?? runtimeMap.get("repair_layer_status") ?? "unknown") || "unknown",
      next_actions: nextActions,
      current_state_source: currentStateResolution.source,
      runtime_state_source: runtimeStateResolution.source,
      packet_source: handoff?.source === "shared-coordination"
        ? "shared-coordination"
        : packetResolution.source,
      packet_resolution: packetResolutionInfo,
    },
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await computeCoordinatorNextAction({
      targetRoot: args.target,
      currentStateFile: args.currentStateFile,
      runtimeStateFile: args.runtimeStateFile,
      packetFile: args.packetFile,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Coordinator next action:");
      console.log(`- role=${result.recommendation.role}`);
      console.log(`- action=${result.recommendation.action}`);
      console.log(`- scope=${result.scope.scope_type}:${result.scope.scope_id}`);
      console.log(`- goal=${result.recommendation.goal}`);
      console.log(`- source=${result.recommendation.source}`);
      console.log(`- reason=${result.recommendation.reason}`);
      console.log(`- stop_required=${result.recommendation.stop_required}`);
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
