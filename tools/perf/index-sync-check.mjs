#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runIndexSyncCheckUseCase } from "../../src/application/runtime/index-sync-check-use-case.mjs";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    target: ".",
    indexFile: ".aidn/runtime/index/workflow-index.json",
    indexBackend: "auto",
    apply: false,
    strict: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-backend") {
      args.indexBackend = String(argv[i + 1] ?? "").toLowerCase();
      i += 1;
    } else if (token === "--apply") {
      args.apply = true;
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
  console.log("  node tools/perf/index-sync-check.mjs --target ../client-repo");
  console.log("  node tools/perf/index-sync-check.mjs --target ../client-repo --index-file .aidn/runtime/index/workflow-index.sqlite --index-backend sqlite");
  console.log("  node tools/perf/index-sync-check.mjs --target ../client-repo --strict");
  console.log("  node tools/perf/index-sync-check.mjs --target ../client-repo --apply");
  console.log("  node tools/perf/index-sync-check.mjs --target ../client-repo --json");
}

function printHuman(output) {
  console.log(`Target: ${output.target_root}`);
  console.log(`Index file: ${output.current.index_file}`);
  console.log(`In sync: ${output.in_sync ? "yes" : "no"}`);
  console.log(`Drift level: ${output.drift_level}`);
  console.log(`Reason codes: ${output.reason_codes.length > 0 ? output.reason_codes.join(", ") : "none"}`);
  console.log(`Expected digest: ${output.expected.digest}`);
  console.log(`Current digest: ${output.current.digest ?? "missing"}`);
  if (output.summary_mismatches.length > 0) {
    console.log("Summary mismatches:");
    for (const item of output.summary_mismatches) {
      console.log(`- ${item.key}: expected=${item.expected} current=${item.current}`);
    }
  }
  if (output.artifact_mismatches.length > 0) {
    console.log("Artifact mismatches:");
    for (const item of output.artifact_mismatches.slice(0, 20)) {
      console.log(`- ${item.type}: ${item.path}`);
    }
  }
  if (output.action === "applied") {
    console.log(
      `Apply: files_written=${output.apply_result.writes.files_written_count}, bytes_written=${output.apply_result.writes.bytes_written}`,
    );
  } else if (output.action === "drift_detected") {
    console.log("Apply: not executed (use --apply)");
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const output = await runIndexSyncCheckUseCase({
      args,
      targetRoot,
      runtimeDir: PERF_DIR,
    });

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      printHuman(output);
    }

    if (!output.in_sync && args.strict && !args.apply) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

await main();
