#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { projectCoordinationSummary } from "../../src/application/runtime/coordination-summary-projector-use-case.mjs";

export { projectCoordinationSummary } from "../../src/application/runtime/coordination-summary-projector-use-case.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    historyFile: ".aidn/runtime/context/coordination-history.ndjson",
    out: "docs/audit/COORDINATION-SUMMARY.md",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--history-file") {
      args.historyFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--out") {
      args.out = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target || !args.out) {
    throw new Error("Missing required arguments");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/project-coordination-summary.mjs --target .");
  console.log("  node tools/runtime/project-coordination-summary.mjs --target tests/fixtures/repo-installed-core --json");
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await projectCoordinationSummary({
      targetRoot: args.target,
      historyFile: args.historyFile,
      out: args.out,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Coordination summary: ${result.output_file} (${result.written ? "written" : "unchanged"})`);
      console.log(`- history_status=${result.summary.history_status}`);
      console.log(`- total_dispatches=${result.summary.total_dispatches}`);
      console.log(`- last_recommended_role=${result.summary.last_recommended_role}`);
      console.log(`- last_execution_status=${result.summary.last_execution_status}`);
    }
  }).catch((error) => {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
