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
    "runtime_project_context",
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
    "execution_run",
    "delegated_task",
    "execution_attempt",
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
  for (const concept of ["execution_run", "delegated_task", "execution_attempt"]) {
    for (const mode of modes) {
      const policy = getSourceOfTruthPolicy(concept, mode);
      if (policy?.coverage_kind !== "supervision_candidate" || policy?.authority_backend !== "postgres") {
        matrixIssues.push(`${concept}: ${mode} must expose candidate supervision with PostgreSQL authority`);
      }
      if (!policy?.shared_runtime.includes({ execution_run: "execution_runs", delegated_task: "execution_tasks", execution_attempt: "execution_attempts" }[concept])) {
        matrixIssues.push(`${concept}: ${mode} persistence contract must map to its port table`);
      }
      if (policy?.postgresql !== "optional" || policy?.shared_sync !== "opt-in") {
        matrixIssues.push(`${concept}: existing optional PostgreSQL and explicit synchronization must remain intact`);
      }
      if (!policy?.source_of_truth.includes("explicit qualified composition required")
        || !policy?.notes.includes("public supervised commands remain unavailable") || policy?.projection !== "none") {
        matrixIssues.push(`${concept}: ${mode} must require explicit qualification and keep public commands unavailable`);
      }
      if (!policy?.retention.includes("no automatic purge") || !policy?.notes.includes("No files, SQLite or in-memory authority fallback, inferred runtime instances")) {
        matrixIssues.push(`${concept}: candidate retention and instance boundary must be explicit`);
      }
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
