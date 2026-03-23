#!/usr/bin/env node
import { evaluateCoordinatorEscalation } from "../../src/core/agents/coordinator-escalation-policy.mjs";

function parseArgs(argv) {
  const args = { json: false };
  for (const token of argv) {
    if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-coordinator-escalation-policy.mjs");
  console.log("  node tools/perf/verify-coordinator-escalation-policy.mjs --json");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  try {
    const samples = {
      none: evaluateCoordinatorEscalation({
        recommendation: { stop_required: false },
        loopStatus: "steady",
        history: { repeated_dispatch_count: 1, recent_failure_count: 0 },
        summaryAlignment: { status: "aligned", reason: "ok" },
      }),
      summaryWatch: evaluateCoordinatorEscalation({
        recommendation: { stop_required: false },
        loopStatus: "steady",
        history: { repeated_dispatch_count: 1, recent_failure_count: 0 },
        summaryAlignment: { status: "mismatch", reason: "summary mismatch" },
      }),
      guarded: evaluateCoordinatorEscalation({
        recommendation: { stop_required: true },
        loopStatus: "gated",
        history: { repeated_dispatch_count: 1, recent_failure_count: 0 },
        summaryAlignment: { status: "aligned", reason: "ok" },
      }),
      failureEscalation: evaluateCoordinatorEscalation({
        recommendation: { stop_required: false },
        loopStatus: "reanchor_after_failure",
        history: { repeated_dispatch_count: 1, recent_failure_count: 2 },
        summaryAlignment: { status: "aligned", reason: "ok" },
      }),
      repeatEscalation: evaluateCoordinatorEscalation({
        recommendation: { stop_required: false },
        loopStatus: "repeat_detected",
        history: { repeated_dispatch_count: 5, recent_failure_count: 0 },
        summaryAlignment: { status: "aligned", reason: "ok" },
      }),
    };

    assert(samples.none.level === "none", "steady state should not escalate");
    assert(samples.summaryWatch.level === "watch", "summary mismatch should trigger watch");
    assert(samples.guarded.status === "guarded", "gated recommendation should expose guarded status");
    assert(samples.failureEscalation.level === "user_arbitration_required", "repeated failures should escalate");
    assert(samples.repeatEscalation.level === "user_arbitration_required", "repeated relays should escalate");

    const output = {
      ts: new Date().toISOString(),
      samples,
      pass: true,
    };

    const args = parseArgs(process.argv.slice(2));
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log("Result: PASS");
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
