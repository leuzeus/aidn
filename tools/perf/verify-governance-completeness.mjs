#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectGovernanceDiagnostics } from "../../src/application/runtime/governance-diagnostics-use-case.mjs";
import { verifyGovernanceAdoptionFixtures } from "./verify-governance-adoption-fixtures.mjs";

function parseArgs(argv) {
  const args = {
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
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
  console.log("  node tools/perf/verify-governance-completeness.mjs");
  console.log("  node tools/perf/verify-governance-completeness.mjs --json");
}

function isSupervisionCandidateCoverage(concept) {
  return concept?.status === "complete" && concept.coverage_kind === "supervision_candidate"
    && concept.cli_contract === "runtime-agent-run.v1.schema.json" && concept.cli_contract_status === "covered"
    && concept.required?.includes("cli_contract")
    && /conditional native prototype/i.test(concept.coverage_note ?? "")
    && /matching native qualification are required/i.test(concept.coverage_note ?? "")
    && /No runtime instances or operational availability are inferred/i.test(concept.coverage_note ?? "");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = projectGovernanceDiagnostics({
    targetRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
    workspace: null,
    includeObservedArtifacts: false,
  });
  const adoption = verifyGovernanceAdoptionFixtures();
  output.adoption_declaration_validation = adoption;
  if (adoption.status !== "PASS") {
    output.issues.push(`governance adoption: ${adoption.failure?.stage ?? "cleanup"}: ${adoption.failure?.message ?? "fixture cleanup failed"}`);
    output.ok = false;
    console.error(JSON.stringify({ status: adoption.status,
      failed_checks: adoption.checks.filter((check) => !check.pass),
      failure: adoption.failure, cleanup: adoption.cleanup }));
  }
  for (const conceptId of ["execution_run", "delegated_task", "execution_attempt"]) {
    const concept = output.concepts.find((item) => item.concept === conceptId);
    if (!isSupervisionCandidateCoverage(concept)) {
      output.issues.push(`${conceptId}: supervision candidate coverage requires its public CLI contract and explicit native qualification limits`);
      output.ok = false;
    }
    // Public command coverage must not be mistaken for native availability.
    // Keep the two regressions independent: losing a CLI contract or promoting
    // the candidate to an operational capability must both fail this gate.
    for (const changed of [
      { ...concept, cli_contract_status: "not_applicable" },
      { ...concept, coverage_kind: "operational" },
      { ...concept, coverage_note: "Public commands are operational without native qualification." },
    ]) if (isSupervisionCandidateCoverage(changed)) {
      output.issues.push(`${conceptId}: supervision coverage negative fixture was accepted`);
      output.ok = false;
    }
  }
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Governance completeness: ${output.ok ? "PASS" : "FAIL"}`);
    console.log(`- governed_concepts=${output.governed_concepts}`);
    console.log(`- complete=${output.summary.complete}`);
    console.log(`- partial=${output.summary.partial}`);
    console.log(`- missing=${output.summary.missing}`);
    console.log(`- adoption_declaration=${adoption.status} checks=${adoption.checks.length} native_client=${adoption.native_client_qualification}`);
    for (const concept of output.concepts) {
      console.log(`- ${concept.concept}: ${concept.status}`);
    }
    for (const issue of output.issues) {
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
