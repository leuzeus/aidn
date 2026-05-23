#!/usr/bin/env node
import {
  buildCoordinatorResumeBlockedResult,
  buildCoordinatorResumeResult,
  deriveCoordinatorResumeState,
  deriveCoordinatorSharedPlanningCandidate,
} from "../../src/application/runtime/coordinator-resume-use-case.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildDispatch() {
  return {
    shared_planning: {
      enabled: true,
      dispatch_ready: true,
      next_dispatch_scope: "cycle",
      next_dispatch_action: "implement",
      backlog_next_step: "implement alpha feature validation",
    },
    coordinator_recommendation: {
      role: "executor",
      action: "implement",
      goal: "implement alpha feature validation",
    },
    dispatch_scope: {
      scope_type: "cycle",
      scope_id: "C101",
      target_branch: "feature/C101-alpha",
    },
    dispatch_status: "ready",
  };
}

function buildLoopState() {
  return {
    loop: {
      history: {
        arbitration_applied: true,
      },
      escalation: {
        reason: "fixture escalation",
      },
    },
    context: {
      mode: "COMMITTING",
    },
    handoff: {
      source: "fixture",
    },
  };
}

function verifySharedPlanningCandidate() {
  const candidate = deriveCoordinatorSharedPlanningCandidate(buildDispatch());
  assert(candidate.candidate_ready === true, "shared planning candidate should be ready");
  assert(candidate.candidate_aligned === true, "shared planning candidate should be aligned");
  assert(candidate.preferred_source === "shared_planning", "shared planning candidate should prefer shared planning");
}

function verifyResumeState() {
  const state = deriveCoordinatorResumeState({
    loopState: buildLoopState(),
    dispatch: buildDispatch(),
  });
  assert(state.resume_status === "resumed_after_arbitration", "resume state should preserve arbitration-aware status");
  assert(state.shared_planning_candidate.candidate_aligned === true, "resume state should expose aligned shared planning candidate");
}

function verifyBlockedResult() {
  const result = buildCoordinatorResumeBlockedResult({
    absoluteTargetRoot: "G:/fixture/project",
    effectiveStateMode: "dual",
    dbBackedMode: false,
    dispatch: {
      ...buildDispatch(),
      dispatch_status: "escalated",
    },
    loopState: buildLoopState(),
    arbitrationSuggestions: {
      preferred_decision: "reanchor",
      arbitration_reason: "user arbitration is required",
    },
    executeRequested: true,
  });
  assert(result.resume_status === "blocked", "blocked result should stay blocked");
  assert(result.preferred_decision === "reanchor", "blocked result should expose preferred decision");
  assert(result.execution_status === "blocked", "blocked result should not execute");
}

function verifyReadyResult() {
  const resumeState = deriveCoordinatorResumeState({
    loopState: buildLoopState(),
    dispatch: buildDispatch(),
  });
  const result = buildCoordinatorResumeResult({
    absoluteTargetRoot: "G:/fixture/project",
    effectiveStateMode: "dual",
    dbBackedMode: false,
    loopState: buildLoopState(),
    dispatch: buildDispatch(),
    resumeState,
    executeRequested: false,
  });
  assert(result.resume_status === "resumed_after_arbitration", "ready result should preserve resumed status");
  assert(result.execution_status === "dry_run", "ready result should default to dry_run without execution");
  assert(result.preferred_dispatch_source === "shared_planning", "ready result should expose preferred dispatch source");
}

function verifyExecutedResult() {
  const resumeState = deriveCoordinatorResumeState({
    loopState: buildLoopState(),
    dispatch: buildDispatch(),
  });
  const result = buildCoordinatorResumeResult({
    absoluteTargetRoot: "G:/fixture/project",
    effectiveStateMode: "dual",
    dbBackedMode: false,
    loopState: buildLoopState(),
    dispatch: buildDispatch(),
    resumeState,
    executeRequested: true,
    execution: {
      execution_status: "executed",
      executed: true,
    },
  });
  assert(result.execution_status === "executed", "executed result should preserve execution status");
  assert(result.executed === true, "executed result should preserve executed flag");
}

function main() {
  try {
    verifySharedPlanningCandidate();
    verifyResumeState();
    verifyBlockedResult();
    verifyReadyResult();
    verifyExecutedResult();
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
