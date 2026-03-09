#!/usr/bin/env node
import { evaluateAgentTransition, getAllowedTargetRolesForMode } from "../../src/core/agents/agent-transition-policy.mjs";

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
  console.log("  node tools/perf/verify-agent-transition-policy.mjs");
  console.log("  node tools/perf/verify-agent-transition-policy.mjs --json");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const samples = {
      committingCoordinatorToExecutor: evaluateAgentTransition({
        mode: "COMMITTING",
        fromRole: "coordinator",
        fromAction: "relay",
        toRole: "executor",
        toAction: "implement",
      }),
      committingExecutorToAuditor: evaluateAgentTransition({
        mode: "COMMITTING",
        fromRole: "executor",
        fromAction: "relay",
        toRole: "auditor",
        toAction: "audit",
      }),
      committingExecutorToRepair: evaluateAgentTransition({
        mode: "COMMITTING",
        fromRole: "executor",
        fromAction: "relay",
        toRole: "repair",
        toAction: "repair",
      }),
      committingRepairToExecutor: evaluateAgentTransition({
        mode: "COMMITTING",
        fromRole: "repair",
        fromAction: "repair",
        toRole: "executor",
        toAction: "implement",
      }),
      thinkingRepairToExecutor: evaluateAgentTransition({
        mode: "THINKING",
        fromRole: "repair",
        fromAction: "repair",
        toRole: "executor",
        toAction: "implement",
      }),
      invalidSourceAction: evaluateAgentTransition({
        mode: "COMMITTING",
        fromRole: "coordinator",
        fromAction: "implement",
        toRole: "executor",
        toAction: "implement",
      }),
    };

    assert(samples.committingCoordinatorToExecutor.allowed === true, "COMMITTING should allow coordinator -> executor");
    assert(samples.committingExecutorToAuditor.allowed === true, "COMMITTING should allow executor -> auditor");
    assert(samples.committingExecutorToRepair.allowed === true, "COMMITTING should allow executor -> repair");
    assert(samples.committingRepairToExecutor.allowed === false, "COMMITTING should reject repair -> executor");
    assert(samples.committingRepairToExecutor.status === "transition_not_allowed", "COMMITTING repair -> executor should fail by transition policy");
    assert(samples.thinkingRepairToExecutor.allowed === false, "THINKING should still reject repair -> executor");
    assert(samples.invalidSourceAction.allowed === false, "Invalid source action should be rejected");
    assert(samples.invalidSourceAction.status === "invalid_source_action", "Invalid source action should expose invalid_source_action");

    const thinkingTargets = getAllowedTargetRolesForMode("THINKING", "executor");
    const committingTargets = getAllowedTargetRolesForMode("COMMITTING", "executor");
    assert(thinkingTargets.includes("executor"), "THINKING executor should be able to stay executor");
    assert(!committingTargets.includes("executor"), "COMMITTING executor should not self-route to executor");

    const output = {
      ts: new Date().toISOString(),
      samples,
      pass: true,
    };

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
