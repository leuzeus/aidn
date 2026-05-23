#!/usr/bin/env node
import {
  buildHandoffPacketPayload,
  prepareHandoffPacketProjection,
} from "../../src/application/runtime/handoff-packet-projector-use-case.mjs";
import { buildRuntimeStateDigest } from "../../src/application/runtime/runtime-state-projector-use-case.mjs";

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-runtime-payload-builders-fixtures.mjs");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const workspace = {
  project_id: "project-1",
  project_id_source: "fixture",
  project_root: "G:/fixture/project",
  workspace_id: "workspace-1",
  workspace_id_source: "fixture",
  worktree_id: "worktree-1",
  is_linked_worktree: false,
  shared_runtime_mode: "disabled",
  shared_runtime_locator_ref: "none",
  shared_backend_kind: "none",
};

function verifyRuntimeStateDigest() {
  const digest = buildRuntimeStateDigest({
    updatedAt: "2026-05-18T00:00:00.000Z",
    workspace,
    dbBackedMode: true,
    effectiveStateMode: "db-only",
    hydrated: { state_mode: "files" },
    repairSummary: { status: "pass", advice: "none" },
    repairPrimaryReason: "none",
    repairRouting: { routing_hint: "continue", routing_reason: "clear" },
    sharedRuntimeValidation: { status: "clear" },
    sharedPlanning: {
      active_backlog: "EIA-6.3",
      backlog_status: "done",
      backlog_next_step: "none",
      planning_arbitration_status: "none",
      shared_planning_source: "fixture",
      shared_planning_read_status: "not-applicable",
    },
    freshness: { freshness: "ok", basis: "fixture" },
    blockingFindings: [],
    prioritizedArtifacts: ["docs/audit/CURRENT-STATE.md"],
    contextSource: "docs/audit/CURRENT-STATE.md",
    consistency: { pass: true },
    currentStateResolution: { source: "fixture" },
    sessionResolution: { source: "fixture" },
    cycleStatusResolution: { source: "fixture" },
  });

  assert(digest.updated_at === "2026-05-18T00:00:00.000Z", "runtime digest updated_at should be injectable");
  assert(digest.runtime_state_mode === "db-only", "runtime digest should prefer effective db-backed state mode");
  assert(digest.repair_layer_status === "pass", "runtime digest should expose repair status");
  assert(digest.shared_runtime_validation_status === "clear", "runtime digest should expose shared runtime status");
  assert(digest.active_backlog === "EIA-6.3", "runtime digest should expose shared planning backlog");
  assert(digest.consistency_status === "pass", "runtime digest should map consistency pass");
  assert(digest.current_state_source === "fixture", "runtime digest should expose source diagnostics");
  assert(Array.isArray(digest.prioritized_artifacts), "runtime digest should keep prioritized artifacts as array");
}

function verifyHandoffPacketPayload() {
  const packet = buildHandoffPacketPayload({
    updatedAt: "2026-05-18T00:00:00.000Z",
    workspace,
    sharedRuntimeValidation: { status: "clear" },
    handoffStatus: "ready",
    handoffFromAgentRole: "coordinator",
    handoffFromAgentAction: "relay",
    nextRouting: { role: "implementer", action: "execute" },
    nextAgentGoal: "continue backlog execution",
    scope: { scope_type: "backlog", scope_id: "EIA-6.3", target_branch: "dev" },
    activeBacklog: "EIA-6.3",
    planningArbitrationStatus: "none",
    sharedPlanning: {
      preferred_dispatch_source: "runtime",
      candidate_ready: true,
      candidate_aligned: true,
      next_dispatch_scope: "backlog",
      next_dispatch_action: "execute",
      freshness_status: "ok",
      freshness_basis: "fixture",
      gate_status: "pass",
      gate_reason: "clear",
      linked_cycles: ["C001"],
      backlog_artifact_source: "fixture",
    },
    handoffNote: "none",
    mode: "COMMITTING",
    branchKind: "feature",
    activeSession: "S001",
    activeCycle: "C001",
    dorState: "ready",
    firstPlanStep: "implement",
    backlogStatus: "done",
    backlogNextStep: "none",
    runtimeStateMode: "dual",
    repairStatus: "pass",
    repairPrimaryReason: "none",
    repairRoutingHint: "continue",
    currentStateFreshness: "ok",
    transition: { status: "pass", reason: "clear" },
    blockingFindings: [],
    prioritizedArtifacts: ["docs/audit/CURRENT-STATE.md"],
    consistency: { pass: true },
    sessionResolution: { exists: true, logicalPath: "docs/audit/sessions/S001.md" },
    cycleStatusResolution: { exists: true, logicalPath: "docs/audit/cycles/C001/status.md" },
    currentStateResolution: { source: "fixture" },
    runtimeStateResolution: { source: "fixture" },
  });

  assert(packet.updated_at === "2026-05-18T00:00:00.000Z", "handoff packet updated_at should be injectable");
  assert(packet.handoff_status === "ready", "handoff packet should expose handoff status");
  assert(packet.recommended_next_agent_role === "implementer", "handoff packet should expose next role");
  assert(packet.scope_id === "EIA-6.3", "handoff packet should expose dispatch scope");
  assert(packet.shared_planning_candidate_ready === "yes", "handoff packet should normalize shared planning readiness");
  assert(packet.branch_kind === "feature", "handoff packet should use normalized CLI scalar inputs");
  assert(packet.first_plan_step === "implement", "handoff packet should expose first plan step");
  assert(packet.consistency_status === "pass", "handoff packet should map consistency pass");
  assert(packet.session_file === "docs/audit/sessions/S001.md", "handoff packet should expose session file");
  assert(packet.runtime_state_source === "fixture", "handoff packet should expose runtime source");
}

function verifyHandoffPacketProjection() {
  const packet = prepareHandoffPacketProjection({
    workspace,
    sharedRuntimeValidation: { status: "clear" },
    repairHints: {
      REPAIR: "repair",
      AUDIT_FIRST: "audit_first",
    },
    nextAgentGoal: "",
    handoffNote: "none",
    handoffFromAgentRole: "coordinator",
    handoffFromAgentAction: "relay",
    mode: "COMMITTING",
    branchKind: "feature",
    activeSession: "S001",
    activeCycle: "C001",
    dorState: "ready",
    firstPlanStep: "implement",
    backlogStatus: "ready",
    backlogNextStep: "continue backlog execution",
    runtimeStateMode: "dual",
    repairStatus: "warn",
    repairPrimaryReason: "warning: relay",
    repairRoutingHint: "continue",
    repairRoutingReason: "clear",
    planningArbitrationStatus: "none",
    activeBacklog: "docs/audit/backlog/example.md",
    currentStateFreshness: "ok",
    runtimeStateText: [
      "blocking_findings:",
      "- warning: relay: fixture finding",
      "",
      "prioritized_artifacts:",
      "- docs/audit/custom.md",
    ].join("\n"),
    currentMap: new Map([
      ["mode", "COMMITTING"],
      ["active_session", "S001"],
      ["active_cycle", "C001"],
      ["cycle_branch", "dev"],
    ]),
    runtimeMap: new Map([
      ["repair_layer_status", "warn"],
      ["current_state_freshness", "ok"],
    ]),
    sharedPlanning: {
      artifact_found: true,
      backlog_next_step: "continue backlog execution",
      preferred_dispatch_source: "shared_planning",
      candidate_ready: true,
      candidate_aligned: true,
      next_dispatch_scope: "cycle",
      next_dispatch_action: "implement",
      freshness_status: "ok",
      freshness_basis: "fixture",
      gate_status: "ok",
      gate_reason: "clear",
      linked_cycles: ["C001"],
      backlog_artifact_source: "fixture",
    },
    consistency: { pass: true },
    sessionResolution: { exists: true, logicalPath: "docs/audit/sessions/S001.md" },
    cycleStatusResolution: { exists: true, logicalPath: "docs/audit/cycles/C001/status.md" },
    planResolution: { exists: true, logicalPath: "docs/audit/cycles/C001/plan.md" },
    currentStateResolution: { source: "fixture" },
    runtimeStateResolution: { source: "fixture" },
    transitionEvaluator: () => ({ status: "pass", reason: "clear" }),
  });

  assert(packet.handoff_status === "ready", "prepared handoff packet should derive ready status");
  assert(packet.recommended_next_agent_role === "executor", "prepared handoff packet should derive executor role");
  assert(packet.recommended_next_agent_action === "implement", "prepared handoff packet should derive implement action");
  assert(packet.scope_type === "cycle", "prepared handoff packet should derive cycle scope");
  assert(packet.target_branch === "dev", "prepared handoff packet should preserve target branch");
  assert(packet.next_agent_goal === "continue backlog execution", "prepared handoff packet should derive backlog next step");
  assert(packet.blocking_findings.includes("warning: relay: fixture finding"), "prepared handoff packet should keep blocking findings");
  assert(packet.prioritized_artifacts.includes("docs/audit/custom.md"), "prepared handoff packet should keep prioritized artifacts");
}

function main() {
  try {
    verifyRuntimeStateDigest();
    verifyHandoffPacketPayload();
    verifyHandoffPacketProjection();
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
