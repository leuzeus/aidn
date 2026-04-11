#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolvePromotedSharedPlanningContext } from "../../src/application/runtime/shared-planning-resolution-service.mjs";
import { readLatestSharedHandoffRelay, resolveSharedCoordinationStore } from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { WORKFLOW_REPAIR_HINT } from "../../src/application/runtime/workflow-transition-constants.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { buildWorkflowRoute } from "../../src/application/runtime/workflow-transition-lib.mjs";
import { canAgentRolePerform } from "../../src/core/agents/agent-role-model.mjs";
import { admitHandoff } from "./handoff-admit.mjs";
import {
  canonicalNone,
  canonicalUnknown,
  loadDbIndexPayloadSafe,
  normalizeScalar,
  parseSimpleMap,
  resolveDbArtifactSourceName,
  resolveAuditArtifactText,
  resolveDbBackedMode,
} from "./db-first-runtime-view-lib.mjs";
import {
  buildSharedRelayHandoff,
  derivePacketResolution,
  readPacketSummary,
  readSharedRelaySummary,
} from "./shared-handoff-relay-resolution-lib.mjs";

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

function deriveFallbackRecommendation(currentState, runtimeMap, nextActions) {
  const mode = normalizeScalar(currentState?.mode ?? "unknown") || "unknown";
  const activeSession = normalizeScalar(currentState?.active_session ?? "none") || "none";
  const activeCycle = normalizeScalar(currentState?.active_cycle ?? "none") || "none";
  const dorState = normalizeScalar(currentState?.dor_state ?? "unknown") || "unknown";
  const firstPlanStep = normalizeScalar(currentState?.first_plan_step ?? "unknown") || "unknown";
  const activeBacklog = normalizeScalar(currentState?.active_backlog ?? "none") || "none";
  const backlogNextStep = normalizeScalar(currentState?.backlog_next_step ?? "unknown") || "unknown";
  const sharedPlanningSource = normalizeScalar(currentState?.shared_planning_source ?? "current-state") || "current-state";
  const repairRouting = normalizeScalar(runtimeMap.get("repair_routing_hint") ?? runtimeMap.get("repair_layer_status") ?? "unknown").toLowerCase();
  const repairAdvice = normalizeScalar(runtimeMap.get("repair_routing_reason") ?? runtimeMap.get("repair_layer_advice") ?? "");
  const sharedPlanningGoal = !canonicalNone(activeBacklog) && !canonicalUnknown(activeBacklog) && backlogNextStep && !canonicalUnknown(backlogNextStep)
    ? backlogNextStep
    : "";
  const sharedPlanningRouteSource = sharedPlanningGoal && sharedPlanningSource === "shared-coordination"
    ? "current-state-shared-planning"
    : "current-state";

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
      source: sharedPlanningRouteSource,
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
      source: sharedPlanningRouteSource,
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

export async function computeCoordinatorNextAction({
  targetRoot,
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  packetFile = "docs/audit/HANDOFF-PACKET.md",
  workspace = null,
  sharedCoordination = null,
  sharedCoordinationOptions = {},
  sharedStateOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const effectiveWorkspace = workspace ?? resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const { dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
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
  const packetResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: packetFile,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
    dbSource,
  });
  const currentStateText = currentStateResolution.text;
  const runtimeStateText = runtimeStateResolution.text;
  const currentMap = parseSimpleMap(currentStateText);
  const runtimeMap = parseSimpleMap(runtimeStateText);
  const nextActions = parseNumberedSection(currentStateText, "## Next Actions");
  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
  const sharedPlanning = await resolvePromotedSharedPlanningContext({
    targetRoot: absoluteTargetRoot,
    workspace: effectiveWorkspace,
    currentState: {
      active_session: activeSession,
      active_backlog: currentMap.get("active_backlog") ?? "none",
      backlog_status: currentMap.get("backlog_status") ?? "unknown",
      backlog_next_step: currentMap.get("backlog_next_step") ?? "unknown",
      backlog_selected_execution_scope: currentMap.get("backlog_selected_execution_scope") ?? "none",
      planning_arbitration_status: currentMap.get("planning_arbitration_status") ?? "none",
    },
    sharedCoordination,
    sharedCoordinationOptions,
  });
  const effectiveCurrentState = {
    mode: normalizeScalar(currentMap.get("mode") ?? "unknown") || "unknown",
    active_session: activeSession,
    active_cycle: activeCycle,
    dor_state: normalizeScalar(currentMap.get("dor_state") ?? "unknown") || "unknown",
    first_plan_step: normalizeScalar(currentMap.get("first_plan_step") ?? "unknown") || "unknown",
    active_backlog: sharedPlanning.active_backlog,
    backlog_next_step: sharedPlanning.backlog_next_step,
    shared_planning_source: sharedPlanning.shared_planning_source,
  };
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
    handoff = await admitHandoff({
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
    recommendation = deriveFallbackRecommendation(effectiveCurrentState, runtimeMap, nextActions);
    scope = deriveFallbackScope(currentMap);
  }

  if (!recommendation) {
    recommendation = deriveFallbackRecommendation(effectiveCurrentState, runtimeMap, nextActions);
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
      shared_planning_source: sharedPlanning.shared_planning_source,
      shared_planning_read_status: sharedPlanning.shared_planning_read_status,
      active_backlog: sharedPlanning.active_backlog,
      backlog_next_step: sharedPlanning.backlog_next_step,
      planning_arbitration_status: sharedPlanning.planning_arbitration_status,
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
