#!/usr/bin/env node
import { strict as assert } from "node:assert";
import {
  buildCloseSessionDecisionContext,
  evaluateCloseSessionTransition,
  evaluateMappedBranchTransition,
  evaluateRepairRouting,
  evaluateSourceBranchTransition,
} from "../../src/application/runtime/workflow-transition-lib.mjs";
import { AIDN_BRANCH_KIND } from "../../src/lib/workflow/branch-kind-lib.mjs";
import { WORKFLOW_ACTION, WORKFLOW_REASON, WORKFLOW_REPAIR_HINT } from "../../src/application/runtime/workflow-transition-constants.mjs";

function cycle(cycleId, sessionOwner = "S101") {
  return { cycle_id: cycleId, session_owner: sessionOwner };
}

function session(sessionId, metadata = {}) {
  return {
    session_id: sessionId,
    metadata: {
      session_branch: `${sessionId.toLowerCase()}-branch`,
      ...metadata,
    },
  };
}

function testEvaluateSourceBranchTransition() {
  const resumableCycle = cycle("C101");
  const staleCycle = cycle("C102");
  const result = evaluateSourceBranchTransition({
    activeSessionArtifact: null,
    latestSession: null,
    openCycleTopology: new Map([[staleCycle.cycle_id, { status: "stale_merged_into_source", blocking_reason: "stale merged cycle" }]]),
    openCycles: [resumableCycle, staleCycle],
    resumableOpenCycles: [resumableCycle],
    sourceBranch: "main",
    staleOpenCycles: [staleCycle],
  });
  assert.equal(result.action, WORKFLOW_ACTION.RESUME_CURRENT_CYCLE);
  assert.equal(result.reason_code, WORKFLOW_REASON.START_SESSION_RESUME_OPEN_CYCLE);
}

function testEvaluateMappedBranchTransition() {
  const mappedSession = session("S101", { primary_focus_cycle: "" });
  const result = evaluateMappedBranchTransition({
    baseBranch: "S101-alpha",
    branchKind: AIDN_BRANCH_KIND.SESSION,
    mapping: {
      ambiguous: false,
      missing: false,
      mapped_session: mappedSession,
      mapped_cycle: null,
    },
    openCycles: [cycle("C101"), cycle("C102")],
    sessions: [mappedSession],
    mode: "COMMITTING",
  });
  assert.equal(result.action, WORKFLOW_ACTION.CHOOSE_CYCLE);
  assert.equal(result.reason_code, WORKFLOW_REASON.START_SESSION_MULTIPLE_SESSION_CYCLES);
}

function testEvaluateRepairRouting() {
  const blocked = evaluateRepairRouting({ status: "block", advice: "Resolve repair issues.", blocking: true });
  const warned = evaluateRepairRouting({ status: "warn", advice: "Review warnings.", blocking: false });
  const clear = evaluateRepairRouting({ status: "clean", advice: "Repair layer is clean.", blocking: false });
  const unknown = evaluateRepairRouting({ status: "", advice: "", blocking: false });

  assert.equal(blocked.routing_hint, WORKFLOW_REPAIR_HINT.REPAIR);
  assert.equal(warned.routing_hint, WORKFLOW_REPAIR_HINT.AUDIT_FIRST);
  assert.equal(clear.routing_hint, WORKFLOW_REPAIR_HINT.EXECUTION_OR_AUDIT);
  assert.equal(unknown.routing_hint, WORKFLOW_REPAIR_HINT.REANCHOR);
}

function testCloseSessionDecisionHelpers() {
  const targetSession = session("S101");
  const openCycles = [cycle("C101"), cycle("C102")];
  const context = buildCloseSessionDecisionContext({
    classifyCycleTopology: {
      classifyOpenCycleTopology: ({ cycle: currentCycle }) => ({
        status: currentCycle.cycle_id === "C102" ? "stale_merged_into_source" : "open",
        blocking_reason: currentCycle.cycle_id === "C102" ? "already merged into source" : "",
      }),
      isStaleMergedOpenCycle: (topology) => topology?.status === "stale_merged_into_source",
      parseSessionCloseCycleDecisions: () => [{ cycle_id: "C102", decision: "report" }],
      targetRoot: ".",
    },
    openCycles,
    sourceBranch: "main",
    targetSession,
    targetSessionText: "close report",
    sessions: [targetSession],
  });
  const result = evaluateCloseSessionTransition({
    branchKind: AIDN_BRANCH_KIND.SESSION,
    cycleDecisions: context.cycleDecisions,
    cycleTopology: context.cycleTopology,
    staleReportedCycles: context.staleReportedCycles,
    staleUnresolvedCycles: context.staleUnresolvedCycles,
    targetSession,
    unresolvedCycles: context.unresolvedCycles,
  });

  assert.equal(result.action, WORKFLOW_ACTION.BLOCKED_OPEN_CYCLES_REQUIRE_RESOLUTION);
  assert.equal(result.reason_code, WORKFLOW_REASON.CLOSE_SESSION_OPEN_CYCLE_DECISIONS_MISSING);
}

function main() {
  try {
    testEvaluateSourceBranchTransition();
    testEvaluateMappedBranchTransition();
    testEvaluateRepairRouting();
    testCloseSessionDecisionHelpers();
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
