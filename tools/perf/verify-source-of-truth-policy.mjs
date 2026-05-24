#!/usr/bin/env node
import {
  getSourceOfTruthPolicy,
  listSourceOfTruthPolicies,
  listStateModes,
  validateSourceOfTruthPolicies,
} from "../../src/core/source-of-truth/source-of-truth-policy.mjs";

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
  console.log("  node tools/perf/verify-source-of-truth-policy.mjs --json");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const validation = validateSourceOfTruthPolicies();
  const policies = listSourceOfTruthPolicies();
  const modes = listStateModes();
  const expectedConcepts = [
    "workflow_rules",
    "project_policy",
    "runtime_defaults",
    "workspace_identity",
    "session_state",
    "cycle_state",
    "artifact_inventory",
    "decision",
    "incident",
    "coordination_summary",
    "coordination_log",
    "user_arbitration",
    "baseline",
    "snapshot",
    "runtime_digests",
    "repair_findings",
    "coordination_records",
    "agent_roster",
    "cli_output_contracts",
  ];
  const matrixIssues = [];
  for (const policy of policies) {
    for (const mode of modes) {
      const resolved = getSourceOfTruthPolicy(policy.concept, mode);
      if (!resolved?.source_of_truth) {
        matrixIssues.push(`${policy.concept}: unresolved source for ${mode}`);
      }
    }
  }
  for (const concept of expectedConcepts) {
    if (!getSourceOfTruthPolicy(concept)) {
      matrixIssues.push(`missing expected concept: ${concept}`);
    }
  }
  const output = {
    ok: validation.ok && matrixIssues.length === 0,
    validation,
    matrix_issues: matrixIssues,
    policy_count: policies.length,
    state_modes: modes,
  };
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Source-of-truth policy: ${output.ok ? "PASS" : "FAIL"}`);
    console.log(`- policies=${output.policy_count}`);
    console.log(`- state_modes=${output.state_modes.join(", ")}`);
    for (const issue of [...validation.issues, ...matrixIssues]) {
      console.log(`  - ${issue}`);
    }
  }
  if (!output.ok) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  printUsage();
  process.exit(1);
}
