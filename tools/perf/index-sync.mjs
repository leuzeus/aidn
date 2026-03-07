#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createArtifactProjectorAdapter,
  payloadDigest,
} from "../../src/adapters/runtime/artifact-projector-adapter.mjs";
import { runIndexSyncUseCase } from "../../src/application/runtime/index-sync-use-case.mjs";
import {
  normalizeIndexStoreMode,
} from "../aidn-config-lib.mjs";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const envStore = String(process.env.AIDN_INDEX_STORE_MODE ?? "").trim().toLowerCase();
  const envStateMode = String(process.env.AIDN_STATE_MODE ?? "").trim().toLowerCase();
  const envEmbedContent = String(process.env.AIDN_EMBED_ARTIFACT_CONTENT ?? "").trim().toLowerCase();
  const args = {
    target: ".",
    output: ".aidn/runtime/index/workflow-index.json",
    store: envStore || "",
    stateMode: envStateMode || "files",
    storeExplicit: false,
    sqlOutput: ".aidn/runtime/index/workflow-index.sql",
    sqliteOutput: ".aidn/runtime/index/workflow-index.sqlite",
    schemaFile: path.join(PERF_DIR, "sql", "schema.sql"),
    includeSchema: true,
    embedContent: envEmbedContent === "1" || envEmbedContent === "true" || envEmbedContent === "yes",
    embedContentExplicit: false,
    kpiFile: "",
    includePayload: false,
    json: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--output") {
      args.output = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--store") {
      args.store = argv[i + 1] ?? "";
      args.storeExplicit = true;
      i += 1;
    } else if (token === "--sql-output") {
      args.sqlOutput = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sqlite-output") {
      args.sqliteOutput = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--schema-file") {
      args.schemaFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--no-schema") {
      args.includeSchema = false;
    } else if (token === "--with-content") {
      args.embedContent = true;
      args.embedContentExplicit = true;
    } else if (token === "--no-content") {
      args.embedContent = false;
      args.embedContentExplicit = true;
    } else if (token === "--kpi-file") {
      args.kpiFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--include-payload") {
      args.includePayload = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--dry-run") {
      args.dryRun = true;
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
  if (!args.output) {
    throw new Error("Missing value for --output");
  }
  args.stateMode = String(args.stateMode ?? "").trim().toLowerCase() || "files";
  if (!["files", "dual", "db-only"].includes(args.stateMode)) {
    throw new Error("Invalid AIDN_STATE_MODE. Expected files|dual|db-only");
  }
  if (!args.store) {
    if (args.stateMode === "dual") {
      args.store = "dual-sqlite";
    } else if (args.stateMode === "db-only") {
      args.store = "sqlite";
    } else {
      args.store = "file";
    }
  }
  if (!args.embedContentExplicit) {
    args.embedContent = args.stateMode === "dual" || args.stateMode === "db-only";
  }
  args.store = String(args.store).toLowerCase();
  if (!normalizeIndexStoreMode(args.store)) {
    throw new Error(`Invalid --store mode: ${args.store}. Expected file|sql|dual|sqlite|dual-sqlite|all.`);
  }
  if ((args.store === "sql" || args.store === "dual" || args.store === "all") && !args.sqlOutput) {
    throw new Error("Missing value for --sql-output");
  }
  if ((args.store === "sqlite" || args.store === "dual-sqlite" || args.store === "all") && !args.sqliteOutput) {
    throw new Error("Missing value for --sqlite-output");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/index-sync.mjs --target ../client");
  console.log("  AIDN_INDEX_STORE_MODE=sqlite node tools/perf/index-sync.mjs --target ../client");
  console.log("  AIDN_STATE_MODE=dual node tools/perf/index-sync.mjs --target ../client");
  console.log("  AIDN_STATE_MODE=db-only node tools/perf/index-sync.mjs --target ../client");
  console.log("  node tools/perf/index-sync.mjs --target . --output .aidn/runtime/index/workflow-index.json");
  console.log("  node tools/perf/index-sync.mjs --target . --store dual --output .aidn/runtime/index/workflow-index.json --sql-output .aidn/runtime/index/workflow-index.sql");
  console.log("  node tools/perf/index-sync.mjs --target . --store sqlite --sqlite-output .aidn/runtime/index/workflow-index.sqlite");
  console.log("  node tools/perf/index-sync.mjs --target . --store all --output .aidn/runtime/index/workflow-index.json --sql-output .aidn/runtime/index/workflow-index.sql --sqlite-output .aidn/runtime/index/workflow-index.sqlite");
  console.log("  node tools/perf/index-sync.mjs --target . --store dual --kpi-file .aidn/runtime/perf/kpi-report.json");
  console.log("  node tools/perf/index-sync.mjs --target . --with-content");
  console.log("  node tools/perf/index-sync.mjs --target . --no-content");
  console.log("  node tools/perf/index-sync.mjs --target . --json --include-payload");
  console.log("  node tools/perf/index-sync.mjs --target . --json");
  console.log("  node tools/perf/index-sync.mjs --target . --json --dry-run");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const artifactProjector = createArtifactProjectorAdapter();
    const result = runIndexSyncUseCase({
      args,
      targetRoot,
      artifactProjector,
      payloadDigest,
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log("Index synced.");
    console.log(`Target: ${result.target_root}`);
    console.log(`State mode: ${result.state_mode}`);
    console.log(`Embed content: ${result.embed_content ? "yes" : "no"}`);
    console.log(`Payload digest: ${result.payload_digest}`);
    if (result.dry_run) {
      console.log("Dry-run mode: no files written.");
    }
    for (const out of result.outputs) {
      const state = out.written ? "updated" : "unchanged";
      console.log(`Output (${out.kind}, ${state}): ${out.path}`);
    }
    console.log(
      `Summary: cycles=${result.summary.cycles_count}, artifacts=${result.summary.artifacts_count}, file_map=${result.summary.file_map_count}, tags=${result.summary.tags_count}, run_metrics=${result.summary.run_metrics_count}`,
    );
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
