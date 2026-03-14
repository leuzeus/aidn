#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canAgentRolePerform } from "../../src/core/agents/agent-role-model.mjs";
import { admitHandoff } from "./handoff-admit.mjs";

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

function exists(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath);
}

function readTextIfExists(filePath) {
  return exists(filePath) ? fs.readFileSync(filePath, "utf8") : "";
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
    return {
      role: "repair",
      action: "repair",
      goal: repairAdvice || "resolve blocking repair findings before continuing",
      source: "runtime-state",
      reason: "runtime repair routing is blocking",
      stop_required: true,
    };
  }
  if (repairRouting === "audit-first") {
    return {
      role: "auditor",
      action: "audit",
      goal: repairAdvice || "review runtime warnings before continuing implementation",
      source: "runtime-state",
      reason: "runtime repair routing requires an audit-first pass",
      stop_required: false,
    };
  }
  if (mode === "COMMITTING" && !canonicalNone(activeCycle) && !canonicalUnknown(activeCycle) && dorState === "READY" && firstPlanStep && !canonicalUnknown(firstPlanStep)) {
    return {
      role: "executor",
      action: "implement",
      goal: firstPlanStep,
      source: "current-state",
      reason: "current state is ready for committing execution",
      stop_required: false,
    };
  }
  if (mode === "EXPLORING") {
    return {
      role: "auditor",
      action: "analyze",
      goal: sharedPlanningGoal || nextActions[0] || "continue analysis and validate the next hypothesis",
      source: "current-state",
      reason: sharedPlanningGoal
        ? "shared session backlog defines the next planning step for analysis"
        : "exploring mode favors audit/analyze routing",
      stop_required: false,
    };
  }
  if (mode === "THINKING") {
    return {
      role: "coordinator",
      action: "coordinate",
      goal: sharedPlanningGoal || nextActions[0] || "restate the objective and smallest compliant next step",
      source: "current-state",
      reason: sharedPlanningGoal
        ? "shared session backlog defines the next coordination step"
        : "thinking mode favors coordination before execution",
      stop_required: false,
    };
  }
  if (canonicalNone(activeSession) && canonicalNone(activeCycle)) {
    return {
      role: "coordinator",
      action: "reanchor",
      goal: "reload the active session, cycle, and runtime facts before acting",
      source: "current-state",
      reason: "no active session or cycle is declared",
      stop_required: false,
    };
  }
  return {
    role: "coordinator",
    action: "coordinate",
    goal: nextActions[0] ?? "review the active artifacts and select the smallest compliant next step",
    source: "current-state",
    reason: "fallback coordination path",
    stop_required: false,
  };
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

export function computeCoordinatorNextAction({
  targetRoot,
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  packetFile = "docs/audit/HANDOFF-PACKET.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const currentStatePath = resolveTargetPath(absoluteTargetRoot, currentStateFile);
  const runtimeStatePath = resolveTargetPath(absoluteTargetRoot, runtimeStateFile);
  const packetPath = resolveTargetPath(absoluteTargetRoot, packetFile);
  const currentStateText = readTextIfExists(currentStatePath);
  const runtimeStateText = readTextIfExists(runtimeStatePath);
  const currentMap = parseSimpleMap(currentStateText);
  const runtimeMap = parseSimpleMap(runtimeStateText);
  const nextActions = parseNumberedSection(currentStateText, "## Next Actions");

  let handoff = null;
  let recommendation = null;
  let scope = null;
  if (exists(packetPath) && exists(currentStatePath) && exists(runtimeStatePath)) {
    handoff = admitHandoff({
      targetRoot: absoluteTargetRoot,
      packetFile,
      currentStateFile,
      runtimeStateFile,
    });
    const preferredDispatchSource = normalizeScalar(handoff.preferred_dispatch_source ?? "workflow") || "workflow";
    recommendation = {
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
    };
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
    current_state_file: currentStatePath,
    runtime_state_file: runtimeStatePath,
    packet_file: exists(packetPath) ? packetPath : "none",
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
    },
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = computeCoordinatorNextAction({
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
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
