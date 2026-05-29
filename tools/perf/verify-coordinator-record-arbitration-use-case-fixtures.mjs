#!/usr/bin/env node
import {
  buildCoordinatorArbitrationAppendedMarkdown,
  buildCoordinatorArbitrationEvent,
  buildCoordinatorArbitrationLogEntry,
  buildCoordinatorRecordArbitrationResult,
  COORDINATOR_ALLOWED_ARBITRATION_DECISIONS,
} from "../../src/application/runtime/coordinator-record-arbitration-use-case.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function verifyAllowedDecisions() {
  assert(COORDINATOR_ALLOWED_ARBITRATION_DECISIONS.has("integration_cycle"), "allowed decisions should include integration_cycle");
  assert(COORDINATOR_ALLOWED_ARBITRATION_DECISIONS.has("reanchor"), "allowed decisions should include reanchor");
}

function verifyEventAndLogEntry() {
  const event = buildCoordinatorArbitrationEvent({
    decision: "continue",
    note: "validated by user",
    goal: "implement alpha feature validation",
  });
  const entry = buildCoordinatorArbitrationLogEntry(event);
  assert(event.event === "user_arbitration", "arbitration event should preserve event kind");
  assert(entry.includes("decision: continue"), "arbitration log should preserve decision");
}

function verifyAppendedMarkdown() {
  const markdown = buildCoordinatorArbitrationAppendedMarkdown(
    "# User Arbitration Log\n\n",
    "## Arbitration 2026-03-09T02:00:00Z\n\n",
    "# User Arbitration Log\n\n",
  );
  assert(markdown.includes("## Arbitration 2026-03-09T02:00:00Z"), "appended markdown should append arbitration entry");
}

function verifyResultAssembly() {
  const event = buildCoordinatorArbitrationEvent({
    decision: "continue",
    note: "validated by user",
    goal: "",
  });
  const result = buildCoordinatorRecordArbitrationResult({
    absoluteTargetRoot: "G:/fixture/project",
    workspace: { root: "G:/fixture/project" },
    sharedCoordinationBackend: { status: "available" },
    sharedCoordinationSync: { ok: true },
    effectiveStateMode: "db-only",
    arbitrationPath: "G:/fixture/project/docs/audit/USER-ARBITRATION.md",
    historyPath: "G:/fixture/project/.aidn/runtime/context/coordination-history.ndjson",
    summaryPath: "G:/fixture/project/docs/audit/COORDINATION-SUMMARY.md",
    arbitrationLogAppended: true,
    arbitrationDbFirst: { ok: true, materialized: false },
    summary: { written: true },
    event,
  });
  assert(result.state_mode === "db-only", "result assembly should preserve state mode");
  assert(result.arbitration_db_first_applied === true, "result assembly should expose db-first application");
  assert(result.arbitration_event.decision === "continue", "result assembly should preserve arbitration event");
}

function main() {
  try {
    verifyAllowedDecisions();
    verifyEventAndLogEntry();
    verifyAppendedMarkdown();
    verifyResultAssembly();
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
