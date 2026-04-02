#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
  loadSqliteIndexPayloadSafe,
  normalizeScalar,
  parseSimpleMap,
  parseTimestamp,
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
  console.log("  node tools/runtime/project-handoff-packet.mjs --target . --from-agent-role coordinator --from-agent-action relay --next-agent-goal \"reanchor and continue cycle validation\"");
  console.log("  node tools/runtime/project-handoff-packet.mjs --target tests/fixtures/repo-installed-core --json");
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

function deriveHandoffStatus({ consistency, runtimeMap, currentMap }) {
  const repairStatus = normalizeScalar(runtimeMap.get("repair_layer_status") ?? "unknown").toLowerCase();
  const freshness = normalizeScalar(runtimeMap.get("current_state_freshness") ?? "unknown").toLowerCase();
  const mode = normalizeScalar(currentMap.get("mode") ?? "unknown").toLowerCase();
  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none").toLowerCase();
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none").toLowerCase();
  if (repairStatus === "block") {
    return "blocked";
  }
  if (mode === "unknown" || (activeSession === "none" && activeCycle === "none")) {
    return "refresh_required";
  }
  if (freshness === "stale" || consistency.pass === false) {
    return "refresh_required";
  }
  return "ready";
}

function deriveNextAgentRouting({ handoffStatus, mode, repairStatus }) {
  const normalizedRepair = String(repairStatus ?? "").trim().toLowerCase();
  if (handoffStatus === "blocked" || normalizedRepair === "block" || normalizedRepair === WORKFLOW_REPAIR_HINT.REPAIR) {
    return { role: "repair", action: "repair" };
  }
  if (normalizedRepair === WORKFLOW_REPAIR_HINT.AUDIT_FIRST) {
    return { role: "auditor", action: "audit" };
  }
  if (handoffStatus === "refresh_required") {
    return { role: "coordinator", action: "reanchor" };
  }
  if (mode === "COMMITTING") {
    return { role: "executor", action: "implement" };
  }
  if (mode === "EXPLORING") {
    return { role: "auditor", action: "analyze" };
  }
  return { role: "coordinator", action: "coordinate" };
}

function deriveNextAgentGoal({
  explicitGoal,
  handoffStatus,
  mode,
  repairStatus,
  repairAdvice,
  firstPlanStep,
  backlogNextStep,
  blockingFindings,
}) {
  const manualGoal = normalizeScalar(explicitGoal);
  if (manualGoal) {
    return manualGoal;
  }
  if (handoffStatus === "blocked" || repairStatus === "block" || repairStatus === WORKFLOW_REPAIR_HINT.REPAIR) {
    const topFinding = normalizeScalar(blockingFindings[0] ?? "");
    if (topFinding) {
      return `resolve blocking finding: ${topFinding}`;
    }
    return "resolve blocking repair-layer or workflow findings before continuing";
  }
  if (repairStatus === WORKFLOW_REPAIR_HINT.AUDIT_FIRST) {
    const normalizedAdvice = normalizeScalar(repairAdvice);
    if (normalizedAdvice && normalizedAdvice.toLowerCase() !== "unknown") {
      return `review runtime warnings first: ${normalizedAdvice}`;
    }
    return "review runtime warnings and validate the relay before implementation";
  }
  if (handoffStatus === "refresh_required") {
    return "reanchor current session, cycle, and runtime facts before any durable write";
  }
  if (backlogNextStep && !canonicalUnknown(backlogNextStep) && !canonicalNone(backlogNextStep)) {
    return backlogNextStep;
  }
  if (mode === "COMMITTING" && firstPlanStep && !canonicalUnknown(firstPlanStep) && !canonicalNone(firstPlanStep)) {
    return firstPlanStep;
  }
  if (mode === "EXPLORING") {
    return "continue analysis and validate the next hypothesis before durable write";
  }
  if (mode === "THINKING") {
    return "restate the objective, active constraints, and the smallest compliant next step";
  }
  return "reload the prioritized artifacts and choose the next compliant action";
}

function buildPrioritizedArtifacts({
  runtimeStateText,
  sessionArtifact,
  cycleStatusArtifact,
  planArtifact,
  activeBacklog,
  firstPlanStep,
}) {
  const items = [
    "docs/audit/CURRENT-STATE.md",
    "docs/audit/WORKFLOW-KERNEL.md",
    "docs/audit/RUNTIME-STATE.md",
    "docs/audit/WORKFLOW_SUMMARY.md",
  ];
  const runtimeArtifacts = parseListSection(runtimeStateText, "prioritized_artifacts");
  const normalizedBacklog = normalizeBacklogRef(activeBacklog);
  if (normalizedBacklog !== "none") {
    items.push(normalizedBacklog);
  }
  if (sessionArtifact?.exists) {
    items.push(sessionArtifact.logicalPath);
  }
  if (cycleStatusArtifact?.exists) {
    items.push(cycleStatusArtifact.logicalPath);
  }
  if (firstPlanStep && planArtifact?.exists) {
    items.push(planArtifact.logicalPath);
  }
  return uniqueItems([...items, ...runtimeArtifacts]);
}

function deriveDispatchScope({ currentMap, nextRouting }) {
  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
  const sessionBranch = normalizeScalar(currentMap.get("session_branch") ?? "none") || "none";
  const cycleBranch = normalizeScalar(currentMap.get("cycle_branch") ?? "none") || "none";
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
  if (nextRouting.role === "coordinator") {
    return {
      scope_type: "session",
      scope_id: !canonicalNone(activeSession) && !canonicalUnknown(activeSession) ? activeSession : "none",
      target_branch: !canonicalNone(sessionBranch) && !canonicalUnknown(sessionBranch) ? sessionBranch : "none",
    };
  }
  return {
    scope_type: "none",
    scope_id: "none",
    target_branch: "none",
  };
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

function buildMarkdown(packet) {
  const lines = [];
  lines.push("# Handoff Packet");
  lines.push("");
  lines.push("Purpose:");
  lines.push("");
  lines.push("- provide a short, deterministic handoff digest between agents");
  lines.push("- reduce restart cost for long sessions or multi-window work");
  lines.push("- point the next agent to the minimum artifact set before acting");
  lines.push("");
  lines.push("Rule/State boundary:");
  lines.push("");
  lines.push("- this file is a state digest, not a canonical workflow rules file");
  lines.push("- keep canonical workflow rules in `docs/audit/SPEC.md`");
  lines.push("- keep local policy extensions in `docs/audit/WORKFLOW.md`");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`updated_at: ${packet.updated_at}`);
  lines.push(`workspace_id: ${packet.workspace_id}`);
  lines.push(`workspace_id_source: ${packet.workspace_id_source}`);
  lines.push(`worktree_id: ${packet.worktree_id}`);
  lines.push(`is_linked_worktree: ${packet.is_linked_worktree}`);
  lines.push(`shared_runtime_mode: ${packet.shared_runtime_mode}`);
  lines.push(`shared_runtime_validation_status: ${packet.shared_runtime_validation_status}`);
  lines.push(`shared_runtime_locator_ref: ${packet.shared_runtime_locator_ref}`);
  lines.push(`shared_backend_kind: ${packet.shared_backend_kind}`);
  lines.push(`handoff_status: ${packet.handoff_status}`);
  lines.push(`handoff_from_agent_role: ${packet.handoff_from_agent_role}`);
  lines.push(`handoff_from_agent_action: ${packet.handoff_from_agent_action}`);
  lines.push(`recommended_next_agent_role: ${packet.recommended_next_agent_role}`);
  lines.push(`recommended_next_agent_action: ${packet.recommended_next_agent_action}`);
  lines.push(`next_agent_goal: ${packet.next_agent_goal}`);
  lines.push(`scope_type: ${packet.scope_type}`);
  lines.push(`scope_id: ${packet.scope_id}`);
  lines.push(`target_branch: ${packet.target_branch}`);
  lines.push(`backlog_refs: ${packet.backlog_refs}`);
  lines.push(`planning_arbitration_status: ${packet.planning_arbitration_status}`);
  lines.push(`preferred_dispatch_source: ${packet.preferred_dispatch_source}`);
  lines.push(`shared_planning_candidate_ready: ${packet.shared_planning_candidate_ready}`);
  lines.push(`shared_planning_candidate_aligned: ${packet.shared_planning_candidate_aligned}`);
  lines.push(`shared_planning_dispatch_scope: ${packet.shared_planning_dispatch_scope}`);
  lines.push(`shared_planning_dispatch_action: ${packet.shared_planning_dispatch_action}`);
  lines.push(`shared_planning_freshness: ${packet.shared_planning_freshness}`);
  lines.push(`shared_planning_freshness_basis: ${packet.shared_planning_freshness_basis}`);
  lines.push(`shared_planning_gate_status: ${packet.shared_planning_gate_status}`);
  lines.push(`shared_planning_gate_reason: ${packet.shared_planning_gate_reason}`);
  lines.push(`transition_policy_status: ${packet.transition_policy_status}`);
  lines.push(`transition_policy_reason: ${packet.transition_policy_reason}`);
  lines.push("");
  lines.push("## Active Context");
  lines.push("");
  lines.push(`mode: ${packet.mode}`);
  lines.push(`branch_kind: ${packet.branch_kind}`);
  lines.push(`active_session: ${packet.active_session}`);
  lines.push(`active_cycle: ${packet.active_cycle}`);
  lines.push(`dor_state: ${packet.dor_state}`);
  lines.push(`first_plan_step: ${packet.first_plan_step}`);
  lines.push(`active_backlog: ${packet.active_backlog}`);
  lines.push(`backlog_status: ${packet.backlog_status}`);
  lines.push(`backlog_next_step: ${packet.backlog_next_step}`);
  lines.push(`linked_backlog_cycles: ${packet.linked_backlog_cycles.length > 0 ? packet.linked_backlog_cycles.join(", ") : "none"}`);
  lines.push("");
  lines.push("## Runtime Signals");
  lines.push("");
  lines.push(`runtime_state_mode: ${packet.runtime_state_mode}`);
  lines.push(`repair_layer_status: ${packet.repair_layer_status}`);
  lines.push(`repair_primary_reason: ${packet.repair_primary_reason}`);
  lines.push(`repair_routing_hint: ${packet.repair_routing_hint}`);
  lines.push(`current_state_freshness: ${packet.current_state_freshness}`);
  lines.push("");
  lines.push("## Blocking Findings");
  lines.push("");
  lines.push("blocking_findings:");
  if (packet.blocking_findings.length === 0) {
    lines.push("- none");
  } else {
    for (const item of packet.blocking_findings) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("");
  lines.push("## Prioritized Reads");
  lines.push("");
  lines.push("prioritized_artifacts:");
  for (const item of packet.prioritized_artifacts) {
    lines.push(`- \`${item}\``);
  }
  lines.push("");
  lines.push("## Handoff Guidance");
  lines.push("");
  lines.push("- `ready`: the next agent can resume from the prioritized artifacts and restate the workflow context before writing");
  lines.push("- `refresh_required`: the next agent must reload session/cycle facts before any durable write");
  lines.push("- `blocked`: the next agent must resolve runtime blocking findings or workflow contradictions before continuing");
  lines.push("- stale shared planning is a warning signal; reload the referenced backlog before replacing the relay intent");
  lines.push("");
  lines.push("## Handoff Intent");
  lines.push("");
  lines.push(`handoff_note: ${packet.handoff_note}`);
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(`- Current-state consistency: ${packet.consistency_status}`);
  lines.push(`- Session file: ${packet.session_file}`);
  lines.push(`- Cycle status: ${packet.cycle_status_file}`);
  lines.push("- Refresh this packet after significant session/cycle state changes when work is likely to continue in another agent.");
  lines.push("- In `dual` / `db-only`, refresh this packet after refreshing `docs/audit/RUNTIME-STATE.md`.");
  lines.push("");
  return `${lines.join("\n")}\n`;
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
  });
  const cycleStatusResolution = resolveCycleStatusArtifact({
    targetRoot: absoluteTargetRoot,
    auditRoot,
    cycleId: activeCycle,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
  });
  const planResolution = resolveCyclePlanArtifact({
    targetRoot: absoluteTargetRoot,
    cycleStatusResolution,
    cycleId: activeCycle,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
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
  const handoffStatus = deriveHandoffStatus({ consistency, runtimeMap, currentMap });
  const mode = normalizeScalar(currentMap.get("mode") ?? "unknown") || "unknown";
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
  const blockingFindings = uniqueItems(parseListSection(runtimeStateText, "blocking_findings").slice(0, 5));
  const nextRouting = deriveNextAgentRouting({
    handoffStatus,
    mode,
    repairStatus: repairRoutingHint,
  });
  const handoffFromAgentRole = normalizeScalar(fromAgentRole) || "coordinator";
  const handoffFromAgentAction = normalizeScalar(fromAgentAction) || "relay";
  const transition = evaluateAgentTransition({
    mode,
    fromRole: handoffFromAgentRole,
    fromAction: handoffFromAgentAction,
    toRole: nextRouting.role,
    toAction: nextRouting.action,
  });
  const scope = deriveDispatchScope({ currentMap, nextRouting });
  const sharedPlanning = deriveSharedPlanningCandidate({
    targetRoot: absoluteTargetRoot,
    activeBacklog,
    scope,
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
  });

  const packet = {
    updated_at: new Date().toISOString(),
    workspace_id: workspace.workspace_id,
    workspace_id_source: workspace.workspace_id_source,
    worktree_id: workspace.worktree_id,
    is_linked_worktree: workspace.is_linked_worktree ? "yes" : "no",
    shared_runtime_mode: workspace.shared_runtime_mode,
    shared_runtime_validation_status: sharedRuntimeValidation.status,
    shared_runtime_locator_ref: workspace.shared_runtime_locator_ref,
    shared_backend_kind: workspace.shared_backend_kind,
    handoff_status: handoffStatus,
    handoff_from_agent_role: handoffFromAgentRole,
    handoff_from_agent_action: handoffFromAgentAction,
    recommended_next_agent_role: nextRouting.role,
    recommended_next_agent_action: nextRouting.action,
    next_agent_goal: deriveNextAgentGoal({
      explicitGoal: nextAgentGoal,
      handoffStatus,
      mode,
      repairStatus: repairRoutingHint,
      repairAdvice: repairRoutingReason,
      firstPlanStep,
      backlogNextStep,
      blockingFindings,
    }),
    scope_type: scope.scope_type,
    scope_id: scope.scope_id,
    target_branch: scope.target_branch,
    backlog_refs: activeBacklog,
    planning_arbitration_status: planningArbitrationStatus,
    preferred_dispatch_source: sharedPlanning.preferred_dispatch_source,
    shared_planning_candidate_ready: sharedPlanning.candidate_ready ? "yes" : "no",
    shared_planning_candidate_aligned: sharedPlanning.candidate_aligned ? "yes" : "no",
    shared_planning_dispatch_scope: sharedPlanning.next_dispatch_scope,
    shared_planning_dispatch_action: sharedPlanning.next_dispatch_action,
    shared_planning_freshness: sharedPlanning.freshness_status,
    shared_planning_freshness_basis: sharedPlanning.freshness_basis,
    shared_planning_gate_status: sharedPlanning.gate_status,
    shared_planning_gate_reason: sharedPlanning.gate_reason,
    handoff_note: normalizeScalar(handoffNote) || "none",
    mode,
    branch_kind: normalizeScalar(currentMap.get("branch_kind") ?? "unknown") || "unknown",
    active_session: activeSession,
    active_cycle: activeCycle,
    dor_state: normalizeScalar(currentMap.get("dor_state") ?? "unknown") || "unknown",
    first_plan_step: firstPlanStep,
    active_backlog: activeBacklog,
    backlog_status: backlogStatus,
    backlog_next_step: sharedPlanning.artifact_found && !canonicalUnknown(sharedPlanning.backlog_next_step) ? sharedPlanning.backlog_next_step : backlogNextStep,
    linked_backlog_cycles: sharedPlanning.linked_cycles,
    runtime_state_mode: normalizeScalar(
      dbBackedMode
        ? effectiveStateMode
        : (runtimeMap.get("runtime_state_mode") ?? currentMap.get("runtime_state_mode") ?? "unknown"),
    ) || "unknown",
    repair_layer_status: repairStatus,
    repair_primary_reason: repairPrimaryReason,
    repair_routing_hint: repairRoutingHint,
    current_state_freshness: normalizeScalar(runtimeMap.get("current_state_freshness") ?? "unknown") || "unknown",
    transition_policy_status: transition.status,
    transition_policy_reason: transition.reason,
    blocking_findings: blockingFindings,
    prioritized_artifacts: buildPrioritizedArtifacts({
      runtimeStateText,
      sessionArtifact: sessionResolution,
      cycleStatusArtifact: cycleStatusResolution,
      planArtifact: planResolution,
      activeBacklog,
      firstPlanStep,
    }),
    consistency_status: consistency.pass ? "pass" : "fail",
    session_file: sessionResolution.exists ? sessionResolution.logicalPath : "none",
    cycle_status_file: cycleStatusResolution.exists ? cycleStatusResolution.logicalPath : "none",
    current_state_source: currentStateResolution.source,
    runtime_state_source: runtimeStateResolution.source,
    shared_planning_artifact_source: sharedPlanning.backlog_artifact_source,
  };

  if (!canAgentRolePerform(packet.recommended_next_agent_role, packet.recommended_next_agent_action)) {
    throw new Error(`Invalid handoff routing: role=${packet.recommended_next_agent_role} action=${packet.recommended_next_agent_action}`);
  }

  if (packet.blocking_findings.length === 0 && packet.handoff_status === "blocked") {
    packet.blocking_findings.push("runtime or workflow blocking condition detected without detailed finding list");
  }

  const markdown = buildMarkdown(packet);
  const outWrite = writeUtf8IfChanged(resolveTargetPath(absoluteTargetRoot, out), markdown);
  const sharedCoordinationSync = await appendSharedHandoffRelay(sharedCoordinationResolution, {
    workspace,
    packet,
    outputFile: relativePath(absoluteTargetRoot, outWrite.path),
  });
  return {
    target_root: absoluteTargetRoot,
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
