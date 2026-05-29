#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildCoordinatorNextActionResult,
  deriveCoordinatorFallbackRecommendation,
  deriveCoordinatorFallbackScope,
  deriveCoordinatorSharedPlanningCandidate,
} from "../../src/application/runtime/coordinator-next-action-use-case.mjs";
import { deriveCoordinatorNextActionDiagnostic } from "../../src/application/runtime/coordinator-diagnostics-lib.mjs";
import { resolvePromotedSharedPlanningContext } from "../../src/application/runtime/shared-planning-resolution-service.mjs";
import { readLatestSharedHandoffRelay, resolveSharedCoordinationStore } from "../../src/application/runtime/shared-coordination-store-service.mjs";
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
    recommendation = deriveCoordinatorFallbackRecommendation(effectiveCurrentState, runtimeMap, nextActions);
    scope = deriveCoordinatorFallbackScope(currentMap);
  }

  if (!recommendation) {
    recommendation = deriveCoordinatorFallbackRecommendation(effectiveCurrentState, runtimeMap, nextActions);
    scope = deriveCoordinatorFallbackScope(currentMap);
  }
  if (!canAgentRolePerform(recommendation.role, recommendation.action)) {
    throw new Error(`Invalid coordinator recommendation: role=${recommendation.role} action=${recommendation.action}`);
  }

  const result = buildCoordinatorNextActionResult({
    targetRoot: absoluteTargetRoot,
    currentStateResolution,
    runtimeStateResolution,
    packetResolution,
    packetResolutionInfo,
    handoff,
    sharedRelay,
    recommendation,
    scope,
    currentMap,
    runtimeMap,
    nextActions,
    sharedPlanning,
  });
  return {
    ...result,
    next_action_diagnostic: deriveCoordinatorNextActionDiagnostic(result),
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
