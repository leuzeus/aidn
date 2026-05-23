#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectGovernanceDiagnostics } from "../../src/application/runtime/governance-diagnostics-use-case.mjs";

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = projectGovernanceDiagnostics({
    targetRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
    workspace: null,
    includeObservedArtifacts: false,
  });
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Governance completeness: ${output.ok ? "PASS" : "FAIL"}`);
    console.log(`- governed_concepts=${output.governed_concepts}`);
    console.log(`- complete=${output.summary.complete}`);
    console.log(`- partial=${output.summary.partial}`);
    console.log(`- missing=${output.summary.missing}`);
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
