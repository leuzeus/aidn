#!/usr/bin/env node
import path from "node:path";
import { runAuditReviewUseCase } from "../../src/application/runtime/audit-review-use-case.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
    contextFile: ".aidn/runtime/context/codex-context.json",
    out: ".aidn/runtime/perf/audit-review.json",
    maxFallbackRate: 0.35,
    maxStopRate: 0.25,
    minContextEntries: 1,
    strict: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--event-file") {
      args.eventFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--context-file") {
      args.contextFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--max-fallback-rate") {
      args.maxFallbackRate = Number(argv[i + 1] ?? 0.35);
      i += 1;
    } else if (token === "--max-stop-rate") {
      args.maxStopRate = Number(argv[i + 1] ?? 0.25);
      i += 1;
    } else if (token === "--min-context-entries") {
      args.minContextEntries = Number(argv[i + 1] ?? 1);
      i += 1;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!args.eventFile) {
    throw new Error("Missing value for --event-file");
  }
  if (!args.contextFile) {
    throw new Error("Missing value for --context-file");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/audit-review.mjs --target . --json");
  console.log("  node tools/perf/audit-review.mjs --target . --max-fallback-rate 0.30 --max-stop-rate 0.20 --strict");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const report = runAuditReviewUseCase({ args, targetRoot });

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Audit review: ${report.status}`);
      console.log(`Decision: ${report.decision}`);
      console.log(`Report: ${report.out_file}`);
    }

    if (args.strict && report.status !== "PASS") {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
