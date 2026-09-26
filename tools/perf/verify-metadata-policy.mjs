#!/usr/bin/env node
import {
  evaluateMetadataPolicy,
  getMetadataPolicy,
  listMetadataPolicies,
  validateMetadataPolicies,
} from "../../src/core/metadata/metadata-policy.mjs";
import { listCriticalMarkdownContracts } from "../../src/lib/workflow/markdown-contract-registry-lib.mjs";
import runSchema from "../../src/core/contracts/agent-execution/run.v1.schema.json" with { type: "json" };
import taskSchema from "../../src/core/contracts/agent-execution/task.v1.schema.json" with { type: "json" };
import attemptSchema from "../../src/core/contracts/agent-execution/attempt.v1.schema.json" with { type: "json" };

const CRITICAL_ARTIFACT_TYPES = Object.freeze([
  "current_state",
  "runtime_state",
  "handoff_packet",
  "session",
  "cycle_status",
]);

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
  console.log("  node tools/perf/verify-metadata-policy.mjs --json");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const validation = validateMetadataPolicies();
  const policies = listMetadataPolicies();
  const issues = [];
  const policyByConcept = new Map(policies.map((policy) => [policy.concept, policy]));

  for (const concept of CRITICAL_ARTIFACT_TYPES) {
    const policy = getMetadataPolicy(concept);
    if (!policy) {
      issues.push(`${concept}: missing metadata policy`);
      continue;
    }
    for (const fieldName of ["contract_version", "updated_at", "source_of_truth", "lifecycle_status"]) {
      if (!policy.required_fields.includes(fieldName) && !policy.legacy_tolerated_missing_fields.includes(fieldName)) {
        issues.push(`${concept}: ${fieldName} must be required or legacy tolerated`);
      }
    }
  }

  for (const contract of listCriticalMarkdownContracts()) {
    const policy = policyByConcept.get(contract.artifact_type);
    if (!policy) {
      issues.push(`${contract.artifact_type}: critical markdown contract has no metadata policy`);
      continue;
    }
    if (contract.metadata_policy_version !== policy.policy_version) {
      issues.push(`${contract.artifact_type}: contract metadata policy version mismatch`);
    }
    if (!Array.isArray(contract.governed_metadata_fields) || contract.governed_metadata_fields.length === 0) {
      issues.push(`${contract.artifact_type}: contract does not expose governed metadata fields`);
    }
  }

  for (const concept of ["execution_run", "delegated_task", "execution_attempt"]) {
    const policy = getMetadataPolicy(concept);
    if (policy?.coverage_kind !== "model_only" || policy?.authority_backend !== "postgres"
      || policy?.source_of_truth_concept !== concept) {
      issues.push(`${concept}: model-only metadata must close over its PostgreSQL authority policy`);
      continue;
    }
    const schema = { execution_run: runSchema, delegated_task: taskSchema, execution_attempt: attemptSchema }[concept];
    for (const fieldName of policy.required_fields) {
      if (!schema.required.includes(fieldName)) {
        issues.push(`${concept}: required metadata field ${fieldName} must be required by its internal schema`);
      }
    }
    if (schema.properties.lifecycle_status) {
      const policyStates = policy.lifecycle.split(/\s*->\s*|\|/);
      const schemaStates = schema.properties.lifecycle_status.enum;
      if (JSON.stringify([...policyStates].sort()) !== JSON.stringify([...schemaStates].sort())) {
        issues.push(`${concept}: lifecycle policy must match the internal schema's states`);
      }
    }
    for (const fieldName of ["contract_version", "run_id", "plan_sha256"]) {
      if (!policy.required_fields.includes(fieldName)) {
        issues.push(`${concept}: missing immutable identity field ${fieldName}`);
      }
    }
    const subject = Object.fromEntries(policy.required_fields.map((field) => [field, "fixture-value"]));
    subject.depends_on = [];
    if (evaluateMetadataPolicy(concept, subject).metadata_status !== "complete") {
      issues.push(`${concept}: complete identity metadata must not require fabricated nonempty dependencies`);
    }
    delete subject.run_id;
    if (evaluateMetadataPolicy(concept, subject).metadata_status !== "missing") {
      issues.push(`${concept}: missing run identity must not be legacy tolerated`);
    }
  }

  const output = {
    ok: validation.ok && issues.length === 0,
    validation,
    policy_count: policies.length,
    critical_artifact_types: CRITICAL_ARTIFACT_TYPES,
    issues,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Metadata policy: ${output.ok ? "PASS" : "FAIL"}`);
    console.log(`- policies=${output.policy_count}`);
    for (const issue of [...validation.issues, ...issues]) {
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
