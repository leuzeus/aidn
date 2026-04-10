#!/usr/bin/env node
import path from "node:path";
import { runRepairLayerUseCase } from "../../src/application/runtime/repair-layer-use-case.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    indexBackend: "auto",
    reportFile: ".aidn/runtime/index/repair-layer-report.json",
    apply: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--index-backend") {
      args.indexBackend = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--report-file") {
      args.reportFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--no-report") {
      args.reportFile = "";
    } else if (token === "--apply") {
      args.apply = true;
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
  if (!args.indexFile) {
    throw new Error("Missing value for --index-file");
  }
  if (!["auto", "json", "sqlite", "postgres"].includes(args.indexBackend)) {
    throw new Error("Invalid --index-backend. Expected auto|json|sqlite|postgres");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/repair-layer.mjs --target . --json");
  console.log("  node tools/runtime/repair-layer.mjs --target . --index-file .aidn/runtime/index/workflow-index.sqlite --index-backend sqlite --apply");
  console.log("  node tools/runtime/repair-layer.mjs --target . --no-report");
}

function printHuman(output) {
  console.log(`Target: ${output.target_root}`);
  console.log(`Index file: ${output.index_file}`);
  console.log(`Backend: ${output.index_backend}`);
  console.log(`Action: ${output.action}`);
  console.log(`Sessions: ${output.summary.sessions_count}`);
  console.log(`Artifact links: ${output.summary.artifact_links_count}`);
  console.log(`Session cycle links: ${output.summary.session_cycle_links_count}`);
  console.log(`Findings: ${output.summary.migration_findings_count}`);
  console.log(`Report: ${output.report_file ?? "disabled"}`);
  if (output.action === "applied") {
    console.log(`Write: files=${output.apply_result.writes.files_written_count} bytes=${output.apply_result.writes.bytes_written}`);
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const output = await runRepairLayerUseCase({ args, targetRoot });
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      printHuman(output);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

await main();
