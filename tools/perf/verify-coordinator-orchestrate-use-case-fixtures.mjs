#!/usr/bin/env node
import {
  buildCoordinatorArbitrationSurface,
  buildCoordinatorOrchestrationDryRunResult,
  buildCoordinatorOrchestrationInitialBlockedResult,
  buildCoordinatorOrchestrationResult,
  buildCoordinatorResumeOptions,
  sameCoordinatorDispatch,
} from "../../src/application/runtime/coordinator-orchestrate-use-case.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildArgs() {
  return {
    target: "G:/fixture/project",
    agent: "auto",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: "docs/audit/RUNTIME-STATE.md",
    packetFile: "docs/audit/HANDOFF-PACKET.md",
    agentRosterFile: "docs/audit/AGENT-ROSTER.md",
    historyFile: ".aidn/runtime/context/coordination-history.ndjson",
    summaryFile: "docs/audit/COORDINATION-SUMMARY.md",
    coordinationLogFile: "docs/audit/COORDINATION-LOG.md",
    coordinationSummaryFile: "docs/audit/COORDINATION-SUMMARY.md",
    coordinationHistoryFile: ".aidn/runtime/context/coordination-history.ndjson",
    maxIterations: 3,
  };
}

function buildPreview(canResume = true) {
  return {
    can_resume: canResume,
    arbitration_required: !canResume,
    preferred_decision: canResume ? null : "reanchor",
    preferred_dispatch_source: "shared_planning",
    shared_planning_candidate: {
      candidate_aligned: true,
    },
    dispatch: {
      coordinator_recommendation: {
        role: "executor",
        action: "implement",
        goal: "implement alpha feature validation",
      },
    },
  };
}

function verifyResumeOptions() {
  const options = buildCoordinatorResumeOptions(buildArgs(), true);
  assert(options.execute === true, "resume options should preserve execute flag");
  assert(options.targetRoot === "G:/fixture/project", "resume options should preserve target");
}

function verifySameDispatch() {
  const preview = buildPreview(true);
  assert(sameCoordinatorDispatch(preview, buildPreview(true)) === true, "same dispatch helper should match identical recommendations");
}

function verifyArbitrationSurface() {
  const surface = buildCoordinatorArbitrationSurface(buildPreview(false));
  assert(surface.preferred_decision === "reanchor", "arbitration surface should expose preferred decision");
  assert(surface.shared_planning_candidate?.candidate_aligned === true, "arbitration surface should expose shared planning candidate");
}

function verifyDryRunResult() {
  const result = buildCoordinatorOrchestrationDryRunResult({
    args: buildArgs(),
    effectiveStateMode: "dual",
    dbBackedMode: false,
    initialPreview: buildPreview(true),
  });
  assert(result.orchestration_status === "dry_run", "dry-run result should stay dry_run");
  assert(result.iterations_completed === 0, "dry-run result should not execute iterations");
}

function verifyBlockedResult() {
  const result = buildCoordinatorOrchestrationInitialBlockedResult({
    args: buildArgs(),
    effectiveStateMode: "dual",
    dbBackedMode: false,
    initialPreview: buildPreview(false),
  });
  assert(result.orchestration_status === "blocked", "blocked result should be blocked");
  assert(result.preferred_decision === "reanchor", "blocked result should expose preferred decision");
}

function verifyExecutedResult() {
  const initialPreview = buildPreview(true);
  const lastPreview = buildPreview(false);
  const result = buildCoordinatorOrchestrationResult({
    args: buildArgs(),
    effectiveStateMode: "dual",
    dbBackedMode: false,
    orchestrationStatus: "paused",
    stopReason: "repeat_guard_same_dispatch",
    initialPreview,
    lastPreview,
    runs: [
      {
        execution_status: "executed",
      },
    ],
  });
  assert(result.orchestration_status === "paused", "executed result should preserve orchestration status");
  assert(result.can_continue === true, "paused result should remain resumable");
  assert(result.iterations_completed === 1, "executed result should count iterations");
}

function main() {
  try {
    verifyResumeOptions();
    verifySameDispatch();
    verifyArbitrationSurface();
    verifyDryRunResult();
    verifyBlockedResult();
    verifyExecutedResult();
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
