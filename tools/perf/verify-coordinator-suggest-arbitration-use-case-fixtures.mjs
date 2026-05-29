#!/usr/bin/env node
import {
  buildCoordinatorArbitrationRecordCommand,
  buildCoordinatorArbitrationResult,
  selectCoordinatorArbitrationSuggestionBundle,
  suggestCoordinatorForBlockedRoleCoverage,
  suggestCoordinatorForIntegrationStrategy,
  suggestCoordinatorForReadyDispatch,
} from "../../src/application/runtime/coordinator-suggest-arbitration-use-case.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildDispatch(overrides = {}) {
  return {
    dispatch_status: "ready",
    coordinator_recommendation: {
      role: "executor",
      action: "implement",
      goal: "implement alpha feature validation",
    },
    recommended_role_coverage: {
      role: "executor",
      status: "ok",
      reason: "1 runnable adapter remains available for role executor",
    },
    integration_risk_gate: {
      active: false,
    },
    integration_risk: {
      recommended_strategy: "direct_merge",
      rationale: [],
    },
    loop: {
      escalation: {
        reason: "fixture escalation",
      },
    },
    ...overrides,
  };
}

function verifyRecordCommand() {
  const command = buildCoordinatorArbitrationRecordCommand({
    targetRoot: "G:/fixture/project",
    decision: "continue",
    note: "continue with the current coordinator recommendation",
    goal: "implement alpha feature validation",
  });
  assert(command.includes("coordinator-record-arbitration"), "record command should target coordinator-record-arbitration");
  assert(command.includes("--decision continue"), "record command should preserve decision");
}

function verifyReadySuggestion() {
  const bundle = suggestCoordinatorForReadyDispatch(buildDispatch(), "G:/fixture/project");
  assert(bundle.arbitration_required === false, "ready suggestion should not require arbitration");
  assert(bundle.preferred_decision === "continue", "ready suggestion should prefer continue");
}

function verifyBlockedRoleSuggestion() {
  const bundle = suggestCoordinatorForBlockedRoleCoverage(buildDispatch({
    dispatch_status: "escalated",
    recommended_role_coverage: {
      role: "auditor",
      status: "blocked",
      reason: "no runnable adapter remains for role auditor",
    },
    coordinator_recommendation: {
      role: "auditor",
      action: "audit",
      goal: "review runtime warnings",
    },
  }), "G:/fixture/project");
  assert(bundle.preferred_decision === "reanchor", "blocked role suggestion should prefer reanchor");
  assert(bundle.suggestions.some((item) => item.decision === "continue" && item.immediately_actionable === false), "blocked role suggestion should include non-actionable continue");
}

function verifyIntegrationSuggestion() {
  const bundle = suggestCoordinatorForIntegrationStrategy(buildDispatch({
    dispatch_status: "escalated",
    integration_risk_gate: {
      active: true,
    },
    integration_risk: {
      recommended_strategy: "integration_cycle",
      rationale: ["two candidate cycles must be resolved explicitly"],
    },
  }), "G:/fixture/project");
  assert(bundle.preferred_decision === "integration_cycle", "integration suggestion should prefer integration_cycle");
  assert(bundle.suggestions.some((item) => item.decision === "report_forward"), "integration suggestion should include report_forward alternative");
}

function verifyBundleSelection() {
  const bundle = selectCoordinatorArbitrationSuggestionBundle(buildDispatch({
    dispatch_status: "escalated",
    recommended_role_coverage: {
      role: "auditor",
      status: "blocked",
      reason: "no runnable adapter remains for role auditor",
    },
  }), "G:/fixture/project");
  assert(bundle.preferred_decision === "reanchor", "bundle selection should prioritize blocked role coverage");
}

function verifyResultAssembly() {
  const dispatch = buildDispatch();
  const suggestionBundle = selectCoordinatorArbitrationSuggestionBundle(dispatch, "G:/fixture/project");
  const result = buildCoordinatorArbitrationResult({
    absoluteTargetRoot: "G:/fixture/project",
    effectiveStateMode: "dual",
    dbBackedMode: false,
    dispatch,
    suggestionBundle,
  });
  assert(result.dispatch_status === "ready", "result assembly should preserve dispatch status");
  assert(result.preferred_decision === "continue", "result assembly should preserve preferred decision");
  assert(Array.isArray(result.suggestions) && result.suggestions.length === 1, "result assembly should preserve suggestions");
}

function main() {
  try {
    verifyRecordCommand();
    verifyReadySuggestion();
    verifyBlockedRoleSuggestion();
    verifyIntegrationSuggestion();
    verifyBundleSelection();
    verifyResultAssembly();
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
