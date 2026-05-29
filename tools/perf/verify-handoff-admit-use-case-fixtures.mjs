#!/usr/bin/env node
import { evaluateHandoffAdmission } from "../../src/application/runtime/handoff-admit-use-case.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildBaseArgs() {
  return {
    packet: new Map([
      ["updated_at", "2026-05-18T00:00:00.000Z"],
      ["handoff_status", "ready"],
      ["consistency_status", "pass"],
      ["current_state_freshness", "ok"],
      ["mode", "COMMITTING"],
      ["handoff_from_agent_role", "coordinator"],
      ["handoff_from_agent_action", "relay"],
      ["recommended_next_agent_role", "executor"],
      ["recommended_next_agent_action", "implement"],
      ["transition_policy_status", "pass"],
      ["transition_policy_reason", "clear"],
      ["scope_type", "cycle"],
      ["scope_id", "C101"],
      ["target_branch", "dev"],
      ["next_agent_goal", "implement alpha feature validation"],
      ["shared_planning_candidate_ready", "yes"],
      ["shared_planning_candidate_aligned", "yes"],
      ["shared_planning_dispatch_scope", "cycle"],
      ["shared_planning_dispatch_action", "implement"],
    ]),
    current: new Map([
      ["updated_at", "2026-05-18T00:00:00.000Z"],
      ["mode", "COMMITTING"],
      ["active_session", "S101"],
      ["active_cycle", "C101"],
      ["cycle_branch", "dev"],
      ["branch_kind", "cycle"],
      ["dor_state", "READY"],
      ["first_plan_step", "implement alpha feature validation"],
    ]),
    runtime: new Map([
      ["runtime_state_mode", "dual"],
      ["repair_layer_status", "warn"],
      ["current_state_freshness", "ok"],
    ]),
    prioritizedArtifacts: ["docs/audit/CURRENT-STATE.md"],
    handoffPacket: null,
    packetActiveBacklog: "none",
    preferredDispatchSource: "workflow",
    sharedPlanningFreshness: "ok",
    sharedPlanningGateStatus: "ok",
    sharedPlanningGateReason: "clear",
    packetSource: "file",
    packetResolutionInfo: { selected_source: "packet" },
    workspace: { workspace_id: "workspace-1" },
    sharedStateBackend: null,
    sharedRuntimeValidation: { status: "clear", issues: [], warnings: [] },
    transitionEvaluator: () => ({ allowed: true, status: "pass", reason: "clear" }),
    consistency: { pass: true },
    effectiveStateMode: "dual",
    dbBackedMode: false,
    packetFile: "docs/audit/HANDOFF-PACKET.md",
    packetRef: "shared-coordination://handoff_relays",
    currentStateSource: "file",
    runtimeStateSource: "file",
    artifactExists() {
      return true;
    },
    canAgentRolePerform() {
      return true;
    },
    isKnownAgentRole() {
      return true;
    },
    normalizeAgentRole(value) {
      return String(value ?? "").trim();
    },
    normalizeAgentAction(value) {
      return String(value ?? "").trim();
    },
  };
}

function verifyReadyAdmission() {
  const result = evaluateHandoffAdmission(buildBaseArgs());
  assert(result.admitted === true, "ready handoff should be admitted");
  assert(result.admission_status === "admitted", "ready handoff should stay admitted");
  assert(result.recommended_next_agent_role === "executor", "ready handoff should preserve executor role");
  assert(result.recommended_action === "implement", "ready handoff should preserve implement action");
}

function verifyRejectedAdmission() {
  const args = buildBaseArgs();
  args.current.set("active_cycle", "C999");
  const result = evaluateHandoffAdmission(args);
  assert(result.admitted === false, "mismatched cycle should be rejected");
  assert(result.admission_status === "rejected", "mismatched cycle should report rejected");
  assert(result.recommended_next_agent_role === "coordinator", "rejected handoff should fall back to coordinator");
  assert(result.recommended_action === "reanchor", "rejected handoff should fall back to reanchor");
}

function verifyBlockedAdmission() {
  const args = buildBaseArgs();
  args.packet.set("handoff_status", "blocked");
  const result = evaluateHandoffAdmission(args);
  assert(result.admitted === false, "blocked handoff should not be admitted");
  assert(result.admission_status === "blocked", "blocked handoff should report blocked");
  assert(result.recommended_next_agent_role === "repair", "blocked handoff should route to repair");
  assert(result.recommended_action === "repair", "blocked handoff should route to repair action");
}

function main() {
  try {
    verifyReadyAdmission();
    verifyRejectedAdmission();
    verifyBlockedAdmission();
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
