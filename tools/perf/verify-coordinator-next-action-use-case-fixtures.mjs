#!/usr/bin/env node
import {
  buildCoordinatorNextActionResult,
  deriveCoordinatorFallbackRecommendation,
  deriveCoordinatorFallbackScope,
  deriveCoordinatorSharedPlanningCandidate,
} from "../../src/application/runtime/coordinator-next-action-use-case.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function verifyFallbackRecommendation() {
  const recommendation = deriveCoordinatorFallbackRecommendation({
    mode: "COMMITTING",
    active_session: "S101",
    active_cycle: "C101",
    dor_state: "READY",
    first_plan_step: "implement alpha feature validation",
  }, new Map(), []);
  assert(recommendation.role === "executor", "fallback recommendation should route COMMITTING/READY to executor");
  assert(recommendation.action === "implement", "fallback recommendation should route implement action");
}

function verifyFallbackScope() {
  const scope = deriveCoordinatorFallbackScope(new Map([
    ["active_cycle", "C101"],
    ["cycle_branch", "feature/C101-alpha"],
  ]));
  assert(scope.scope_type === "cycle", "fallback scope should prefer active cycle");
  assert(scope.target_branch === "feature/C101-alpha", "fallback scope should preserve cycle branch");
}

function verifyResultAssembly() {
  const result = buildCoordinatorNextActionResult({
    targetRoot: "G:/fixture/project",
    currentStateResolution: { exists: true, logicalPath: "docs/audit/CURRENT-STATE.md", source: "file" },
    runtimeStateResolution: { exists: true, logicalPath: "docs/audit/RUNTIME-STATE.md", source: "file" },
    packetResolution: { exists: true, logicalPath: "docs/audit/HANDOFF-PACKET.md", source: "file" },
    packetResolutionInfo: { selected_source: "local-packet" },
    handoff: {
      preferred_dispatch_source: "shared_planning",
      shared_planning_candidate_ready: "yes",
      shared_planning_candidate_aligned: "yes",
      shared_planning_dispatch_scope: "cycle",
      shared_planning_dispatch_action: "implement",
    },
    sharedRelay: null,
    recommendation: { role: "executor", action: "implement", goal: "do work", source: "handoff", reason: "fixture", stop_required: false },
    scope: { scope_type: "cycle", scope_id: "C101", target_branch: "feature/C101-alpha" },
    currentMap: new Map([
      ["mode", "COMMITTING"],
      ["active_session", "S101"],
      ["active_cycle", "C101"],
      ["dor_state", "READY"],
    ]),
    runtimeMap: new Map([
      ["repair_routing_hint", "continue"],
    ]),
    nextActions: ["do work"],
    sharedPlanning: {
      shared_planning_source: "shared-coordination",
      shared_planning_read_status: "ok",
      active_backlog: "backlog/BL-S101.md",
      backlog_next_step: "do work",
      planning_arbitration_status: "none",
    },
  });
  assert(result.preferred_dispatch_source === "shared_planning", "result should expose preferred dispatch source");
  assert(result.shared_planning_candidate.shared_planning_candidate_ready === "yes", "result should expose shared planning candidate");
  assert(result.context.active_backlog === "backlog/BL-S101.md", "result should expose active backlog");
}

function verifySharedPlanningCandidate() {
  const candidate = deriveCoordinatorSharedPlanningCandidate({
    preferred_dispatch_source: "shared_planning",
    shared_planning_candidate_ready: "yes",
    shared_planning_candidate_aligned: "no",
    shared_planning_dispatch_scope: "session",
    shared_planning_dispatch_action: "coordinate",
  });
  assert(candidate.shared_planning_dispatch_scope === "session", "shared planning candidate helper should preserve scope");
}

function main() {
  try {
    verifyFallbackRecommendation();
    verifyFallbackScope();
    verifyResultAssembly();
    verifySharedPlanningCandidate();
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
