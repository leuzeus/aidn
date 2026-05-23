#!/usr/bin/env node
import {
  deriveCoordinatorDispatchExecuteDiagnostic,
  deriveCoordinatorRecordArbitrationDiagnostic,
  deriveCoordinatorResumeDiagnostic,
} from "../../src/application/runtime/coordinator-diagnostics-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const dispatchExecute = deriveCoordinatorDispatchExecuteDiagnostic({
    dispatch_status: "ready",
    execution_status: "executed",
    executed: true,
    selected_agent: { id: "codex" },
    coordinator_recommendation: { role: "executor" },
    preferred_dispatch_source: "shared_planning",
    executed_steps: [{}, {}],
    shared_coordination_sync: {
      diagnostic: {
        sync_status: "disabled",
      },
    },
  });
  assert(dispatchExecute.executed === true, "dispatch execute diagnostic should preserve executed flag");
  assert(dispatchExecute.executed_step_count === 2, "dispatch execute diagnostic should count executed steps");
  assert(dispatchExecute.shared_sync_status === "disabled", "dispatch execute diagnostic should normalize shared sync status");

  const resume = deriveCoordinatorResumeDiagnostic({
    resume_status: "blocked",
    execution_status: "blocked",
    arbitration_required: true,
    arbitration_satisfied: false,
    preferred_decision: "reanchor",
    preferred_dispatch_source: "workflow",
    can_resume: false,
    execute_requested: true,
  });
  assert(resume.recommended_command === "aidn runtime coordinator-suggest-arbitration --json", "blocked resume should point to arbitration");
  assert(resume.preferred_decision === "reanchor", "resume diagnostic should preserve preferred decision");

  const arbitration = deriveCoordinatorRecordArbitrationDiagnostic({
    arbitration_event: { decision: "continue" },
    state_mode: "db-only",
    coordination_history_appended: true,
    arbitration_log_appended: true,
    coordination_summary_written: true,
    arbitration_db_first_applied: true,
    shared_coordination_sync: {
      diagnostic: {
        sync_status: "disabled",
      },
    },
  });
  assert(arbitration.db_first_applied === true, "record arbitration diagnostic should preserve db-first flag");
  assert(arbitration.shared_sync_status === "disabled", "record arbitration diagnostic should normalize shared sync status");

  console.log("PASS");
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
