#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readLatestSharedHandoffRelay, resolveSharedCoordinationStore } from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { validateSharedRuntimeContext } from "../../src/application/runtime/shared-runtime-validation-service.mjs";
import {
  WORKFLOW_ADMISSION_STATUS,
} from "../../src/application/runtime/workflow-transition-constants.mjs";
import {
  buildWorkflowRoute,
  buildWorkflowStatus,
} from "../../src/application/runtime/workflow-transition-lib.mjs";
import { canAgentRolePerform, isKnownAgentRole, normalizeAgentAction, normalizeAgentRole } from "../../src/core/agents/agent-role-model.mjs";
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
  resolveCycleStatusArtifact,
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
    packetFile: "docs/audit/HANDOFF-PACKET.md",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: "docs/audit/RUNTIME-STATE.md",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--packet-file") {
      args.packetFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--current-state-file") {
      args.currentStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--runtime-state-file") {
      args.runtimeStateFile = String(argv[i + 1] ?? "").trim();
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
  console.log("  node tools/runtime/handoff-admit.mjs --target .");
  console.log("  node tools/runtime/handoff-admit.mjs --target tests/fixtures/repo-installed-core --json");
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

function isPathLikeArtifact(item) {
  const normalized = normalizeScalar(item);
  if (!normalized) {
    return false;
  }
  if (/^active (session file|cycle `status\.md`)$/.test(normalized)) {
    return false;
  }
  return normalized.includes("/") || normalized.startsWith(".aidn/") || /\.(md|json|yaml|yml|sqlite|txt)$/i.test(normalized);
}

function isConcreteArtifactPath(item) {
  const normalized = normalizeScalar(item);
  if (!isPathLikeArtifact(normalized)) {
    return false;
  }
  return !/[*?]/.test(normalized);
}

function addMismatch(issues, field, packetValue, liveValue) {
  issues.push(`${field} mismatch: packet=${packetValue || "missing"} live=${liveValue || "missing"}`);
}

export async function admitHandoff({
  targetRoot,
  packetFile = "docs/audit/HANDOFF-PACKET.md",
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  sharedCoordination = null,
  sharedCoordinationOptions = {},
  sharedStateOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const { effectiveStateMode, dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
  const sqliteFallback = dbBackedMode ? await loadDbIndexPayloadSafe(absoluteTargetRoot, sharedStateOptions) : {
    exists: false,
    sqliteFile: "",
    payload: null,
    runtimeHeads: {},
    warning: "",
  };
  const dbSource = resolveDbArtifactSourceName(sqliteFallback.backend);
  const packetResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: packetFile,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
    dbSource,
  });
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
  if (!currentStateResolution.exists) {
    throw new Error(`Missing file: ${resolveTargetPath(absoluteTargetRoot, currentStateFile)}`);
  }
  if (!runtimeStateResolution.exists) {
    throw new Error(`Missing file: ${resolveTargetPath(absoluteTargetRoot, runtimeStateFile)}`);
  }

  const currentStateText = currentStateResolution.text;
  const runtimeStateText = runtimeStateResolution.text;
  const current = parseSimpleMap(currentStateText);
  const runtime = parseSimpleMap(runtimeStateText);
  const workspace = resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const sharedRuntimeValidation = validateSharedRuntimeContext({
    targetRoot: absoluteTargetRoot,
    workspace,
  });
  const sharedCoordinationResolution = sharedCoordination ?? await resolveSharedCoordinationStore({
    targetRoot: absoluteTargetRoot,
    workspace,
    ...sharedCoordinationOptions,
  });
  const activeSession = normalizeScalar(current.get("active_session") ?? "none") || "none";
  const activeCycle = normalizeScalar(current.get("active_cycle") ?? "none") || "none";
  const sharedRelayRead = await readLatestSharedHandoffRelay(sharedCoordinationResolution, {
    workspace,
    sessionId: activeSession !== "none" ? activeSession : "",
    scopeType: activeCycle !== "none" ? "cycle" : "",
    scopeId: activeCycle !== "none" ? activeCycle : "",
  });
  const sharedRelay = sharedRelayRead.handoff_relay ?? null;
  const packetResolutionInfo = derivePacketResolution(
    readPacketSummary(packetResolution),
    readSharedRelaySummary(sharedRelay),
  );
  const packetSource = packetResolutionInfo.selected_source === "shared-coordination"
    ? "shared-coordination"
    : packetResolution.source;
  const handoffPacket = packetResolutionInfo.selected_source === "shared-coordination"
    ? buildSharedRelayHandoff(sharedRelay)
    : null;
  if (!packetResolution.exists && !handoffPacket) {
    throw new Error(`Missing file: ${resolveTargetPath(absoluteTargetRoot, packetFile)}`);
  }
  const packet = handoffPacket
    ? new Map(Object.entries(handoffPacket.packet))
    : parseSimpleMap(packetResolution.text);
  const prioritizedArtifacts = handoffPacket
    ? (handoffPacket.packet.prioritized_artifacts ?? [])
    : parseListSection(packetResolution.text, "prioritized_artifacts");
  const cycleStatusResolution = resolveCycleStatusArtifact({
    targetRoot: absoluteTargetRoot,
    auditRoot: path.join(absoluteTargetRoot, "docs", "audit"),
    cycleId: normalizeScalar(current.get("active_cycle") ?? "none") || "none",
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    dbSource,
  });
  const consistency = currentStateResolution.source === "file"
    ? evaluateCurrentStateConsistency({ targetRoot: absoluteTargetRoot })
    : buildVirtualCurrentStateConsistency({
      currentStateResolution,
      activeCycle: normalizeScalar(current.get("active_cycle") ?? "none") || "none",
      activeSession: normalizeScalar(current.get("active_session") ?? "none") || "none",
      cycleStatusResolution,
    });
  const issues = [];
  const warnings = [];

  const handoffStatus = normalizeScalar(packet.get("handoff_status") ?? "unknown").toLowerCase();
  const consistencyStatus = normalizeScalar(packet.get("consistency_status") ?? "unknown").toLowerCase();
  const packetFreshness = normalizeScalar(packet.get("current_state_freshness") ?? "unknown").toLowerCase();
  const packetMode = normalizeScalar(packet.get("mode") ?? current.get("mode") ?? "unknown");
  const packetFromRole = normalizeAgentRole(packet.get("handoff_from_agent_role") ?? "");
  const packetFromAction = normalizeAgentAction(packet.get("handoff_from_agent_action") ?? "");
  const packetRole = normalizeAgentRole(packet.get("recommended_next_agent_role") ?? "");
  const packetAction = normalizeAgentAction(packet.get("recommended_next_agent_action") ?? "");
  const packetTransitionStatus = normalizeScalar(packet.get("transition_policy_status") ?? "unknown");
  const packetTransitionReason = normalizeScalar(packet.get("transition_policy_reason") ?? "unknown");
  const packetScopeType = normalizeScalar(packet.get("scope_type") ?? "none").toLowerCase();
  const packetScopeId = normalizeScalar(packet.get("scope_id") ?? "none");
  const packetTargetBranch = normalizeScalar(packet.get("target_branch") ?? "none");
  const preferredDispatchSource = normalizeScalar(packet.get("preferred_dispatch_source") ?? "workflow") || "workflow";
  const packetActiveBacklog = normalizeScalar(packet.get("active_backlog") ?? packet.get("backlog_refs") ?? "none") || "none";
  const sharedPlanningFreshness = normalizeScalar(packet.get("shared_planning_freshness") ?? "not_applicable") || "not_applicable";
  const sharedPlanningGateStatus = normalizeScalar(packet.get("shared_planning_gate_status") ?? "not_applicable") || "not_applicable";
  const sharedPlanningGateReason = normalizeScalar(packet.get("shared_planning_gate_reason") ?? "none") || "none";
  const transition = evaluateAgentTransition({
    mode: packetMode,
    fromRole: packetFromRole,
    fromAction: packetFromAction,
    toRole: packetRole,
    toAction: packetAction,
  });

  if (handoffStatus === "blocked") {
    issues.push("handoff packet is blocked");
  }
  if (consistencyStatus === "fail") {
    issues.push("handoff packet captured failed current-state consistency");
  }
  if (packetFreshness === "stale") {
    issues.push("handoff packet reports stale current-state freshness");
  }
  if (sharedPlanningGateStatus === "blocked") {
    issues.push(`shared planning gate is blocked: ${sharedPlanningGateReason}`);
  }
  if (sharedRuntimeValidation.status === "reject") {
    issues.push(...sharedRuntimeValidation.issues);
  }
  if (consistency.pass === false) {
    issues.push("live current-state consistency failed");
  }
  if (!isKnownAgentRole(packetFromRole)) {
    issues.push(`unknown packet source role: ${packet.get("handoff_from_agent_role") ?? "missing"}`);
  }
  if (!isKnownAgentRole(packetRole)) {
    issues.push(`unknown packet role: ${packet.get("recommended_next_agent_role") ?? "missing"}`);
  }
  if (packetFromAction && !canAgentRolePerform(packetFromRole, packetFromAction)) {
    issues.push(`packet source role/action mismatch: role=${packetFromRole || "missing"} action=${packetFromAction}`);
  }
  if (packetAction && !canAgentRolePerform(packetRole, packetAction)) {
    issues.push(`packet role/action mismatch: role=${packetRole || "missing"} action=${packetAction}`);
  }
  if (!transition.allowed) {
    issues.push(`transition policy rejected handoff: ${transition.reason}`);
  }
  if (!["cycle", "session", "none"].includes(packetScopeType)) {
    issues.push(`unknown packet scope_type: ${packet.get("scope_type") ?? "missing"}`);
  }
  if (handoffStatus === "ready" && packetRole !== "coordinator" && (packetScopeType === "none" || canonicalNone(packetScopeId))) {
    issues.push("ready handoff for non-coordinator role is missing an explicit scope");
  }
  if (packetTransitionStatus && packetTransitionStatus !== "unknown" && packetTransitionStatus !== transition.status) {
    issues.push(`transition_policy_status mismatch: packet=${packetTransitionStatus} live=${transition.status}`);
  }
  if (packetTransitionReason && packetTransitionReason !== "unknown" && packetTransitionReason !== transition.reason) {
    warnings.push(`transition_policy_reason drift: packet=${packetTransitionReason} live=${transition.reason}`);
  }

  const currentChecks = [
    "mode",
    "branch_kind",
    "active_session",
    "active_cycle",
    "dor_state",
    "first_plan_step",
  ];
  for (const field of currentChecks) {
    const packetValue = normalizeScalar(packet.get(field) ?? "");
    const liveValue = normalizeScalar(current.get(field) ?? "");
    if (!packetValue || !liveValue || canonicalUnknown(packetValue) || canonicalUnknown(liveValue) || canonicalNone(packetValue) || canonicalNone(liveValue)) {
      continue;
    }
    if (packetValue !== liveValue) {
      addMismatch(issues, field, packetValue, liveValue);
    }
  }

  const runtimeChecks = [
    "runtime_state_mode",
    "repair_layer_status",
    "current_state_freshness",
  ];
  for (const field of runtimeChecks) {
    const packetValue = normalizeScalar(packet.get(field) ?? "");
    const liveValue = field === "runtime_state_mode" && dbBackedMode
      ? normalizeScalar(effectiveStateMode)
      : normalizeScalar(runtime.get(field) ?? "");
    if (!packetValue || !liveValue || canonicalUnknown(packetValue) || canonicalUnknown(liveValue)) {
      continue;
    }
    if (packetValue !== liveValue) {
      addMismatch(issues, field, packetValue, liveValue);
    }
  }

  const packetUpdatedAtMs = parseTimestamp(packet.get("updated_at") ?? "");
  const currentUpdatedAtMs = parseTimestamp(current.get("updated_at") ?? "");
  if (packetUpdatedAtMs !== null && currentUpdatedAtMs !== null && packetUpdatedAtMs < currentUpdatedAtMs) {
    issues.push("handoff packet is older than CURRENT-STATE.md");
  }
  const liveActiveCycle = normalizeScalar(current.get("active_cycle") ?? "none");
  const liveActiveSession = normalizeScalar(current.get("active_session") ?? "none");
  const liveCycleBranch = normalizeScalar(current.get("cycle_branch") ?? "none");
  const liveSessionBranch = normalizeScalar(current.get("session_branch") ?? "none");
  if (packetScopeType === "cycle" && !canonicalNone(liveActiveCycle) && !canonicalUnknown(liveActiveCycle) && packetScopeId !== liveActiveCycle) {
    addMismatch(issues, "scope_id", packetScopeId, liveActiveCycle);
  }
  if (packetScopeType === "session" && !canonicalNone(liveActiveSession) && !canonicalUnknown(liveActiveSession) && packetScopeId !== liveActiveSession) {
    addMismatch(issues, "scope_id", packetScopeId, liveActiveSession);
  }
  if (packetScopeType === "cycle" && !canonicalNone(packetTargetBranch) && !canonicalNone(liveCycleBranch) && !canonicalUnknown(liveCycleBranch) && packetTargetBranch !== liveCycleBranch) {
    addMismatch(issues, "target_branch", packetTargetBranch, liveCycleBranch);
  }
  if (packetScopeType === "session" && !canonicalNone(packetTargetBranch) && !canonicalNone(liveSessionBranch) && !canonicalUnknown(liveSessionBranch) && packetTargetBranch !== liveSessionBranch) {
    addMismatch(issues, "target_branch", packetTargetBranch, liveSessionBranch);
  }

  const missingArtifacts = prioritizedArtifacts
    .filter(isConcreteArtifactPath)
    .filter((item) => {
      const normalizedItem = String(item).replace(/\\/g, "/");
      if (handoffPacket && normalizedItem === "docs/audit/HANDOFF-PACKET.md") {
        return false;
      }
      if (
        handoffPacket
        && preferredDispatchSource === "shared_planning"
        && !canonicalNone(packetActiveBacklog)
        && !canonicalUnknown(packetActiveBacklog)
        && normalizedItem === String(packetActiveBacklog).replace(/\\/g, "/")
      ) {
        return false;
      }
      if (String(item).replace(/\\/g, "/").startsWith("docs/audit/")) {
        return !resolveAuditArtifactText({
          targetRoot: absoluteTargetRoot,
          candidatePath: item,
          dbBacked: dbBackedMode,
          sqlitePayload: sqliteFallback.payload,
          sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
          dbSource,
        }).exists;
      }
      return !fs.existsSync(resolveTargetPath(absoluteTargetRoot, item));
    });
  for (const item of missingArtifacts) {
    issues.push(`missing prioritized artifact: ${item}`);
  }

  if (handoffStatus === "refresh_required" && issues.length === 0) {
    warnings.push("handoff packet requires normal re-anchor before durable write");
  }
  if (sharedPlanningFreshness === "stale") {
    warnings.push("shared planning backlog is stale relative to CURRENT-STATE.md");
  }
  warnings.push(...sharedRuntimeValidation.warnings);

  let admissionStatus = WORKFLOW_ADMISSION_STATUS.ADMITTED;
  let admitted = true;
  let recommendedRole = packetRole || "coordinator";
  let recommendedAction = packetAction || "coordinate";
  if (issues.some((item) => item === "handoff packet is blocked")) {
    admissionStatus = WORKFLOW_ADMISSION_STATUS.BLOCKED;
    admitted = false;
    recommendedRole = "repair";
    recommendedAction = "repair";
  } else if (issues.length > 0) {
    admissionStatus = WORKFLOW_ADMISSION_STATUS.REJECTED;
    admitted = false;
    recommendedRole = "coordinator";
    recommendedAction = "reanchor";
  } else if (handoffStatus === "refresh_required") {
    recommendedRole = "coordinator";
    recommendedAction = "reanchor";
  }

  const route = buildWorkflowRoute({
    role: recommendedRole,
    action: recommendedAction,
    goal: normalizeScalar(packet.get("next_agent_goal") ?? "unknown") || "unknown",
    source: preferredDispatchSource === "shared_planning" && admitted
      ? "handoff-shared-planning"
      : (admitted ? "handoff" : "handoff-admit"),
    reason: admitted
      ? `handoff admission ${admissionStatus}`
      : `handoff admission ${admissionStatus}`,
    stop_required: admissionStatus === WORKFLOW_ADMISSION_STATUS.BLOCKED,
  });
  const status = buildWorkflowStatus({
    admission_status: admissionStatus,
    admitted,
    issues,
    warnings,
  });

  return {
    target_root: absoluteTargetRoot,
    packet_file: handoffPacket
      ? (normalizeScalar(sharedRelay?.handoff_packet_ref) || "shared-coordination://handoff_relays")
      : packetResolution.logicalPath,
    admission_status: status.admission_status,
    admitted: status.admitted,
    recommended_action: route.action,
    recommended_next_agent_role: route.role,
    next_agent_goal: route.goal,
    route,
    status,
    preferred_dispatch_source: preferredDispatchSource,
    shared_planning_candidate_ready: normalizeScalar(packet.get("shared_planning_candidate_ready") ?? "no") || "no",
    shared_planning_candidate_aligned: normalizeScalar(packet.get("shared_planning_candidate_aligned") ?? "no") || "no",
    shared_planning_dispatch_scope: normalizeScalar(packet.get("shared_planning_dispatch_scope") ?? "none") || "none",
    shared_planning_dispatch_action: normalizeScalar(packet.get("shared_planning_dispatch_action") ?? "none") || "none",
    shared_planning_freshness: sharedPlanningFreshness,
    shared_planning_gate_status: sharedPlanningGateStatus,
    shared_planning_gate_reason: sharedPlanningGateReason,
    scope_type: packetScopeType || "none",
    scope_id: packetScopeId || "none",
    target_branch: packetTargetBranch || "none",
    workspace,
    shared_state_backend: sqliteFallback.backend ?? null,
    shared_runtime_validation: sharedRuntimeValidation,
    packet: Object.fromEntries(packet.entries()),
    transition_policy: transition,
    prioritized_artifacts: prioritizedArtifacts,
    consistency,
    issues: status.issues,
    warnings: status.warnings,
    current_state_source: currentStateResolution.source,
    runtime_state_source: runtimeStateResolution.source,
    packet_source: packetSource,
    packet_resolution: packetResolutionInfo,
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await admitHandoff({
      targetRoot: args.target,
      packetFile: args.packetFile,
      currentStateFile: args.currentStateFile,
      runtimeStateFile: args.runtimeStateFile,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Handoff admit: ${result.admission_status}`);
      console.log(`- admitted=${result.admitted}`);
      console.log(`- recommended_action=${result.recommended_action}`);
      console.log(`- recommended_next_agent_role=${result.recommended_next_agent_role}`);
      console.log(`- next_agent_goal=${result.next_agent_goal}`);
      console.log(`- scope=${result.scope_type}:${result.scope_id}`);
      if (result.issues.length > 0) {
        console.log("- issues:");
        for (const issue of result.issues) {
          console.log(`  - ${issue}`);
        }
      }
      if (result.warnings.length > 0) {
        console.log("- warnings:");
        for (const warning of result.warnings) {
          console.log(`  - ${warning}`);
        }
      }
    }
    if (!result.admitted) {
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
