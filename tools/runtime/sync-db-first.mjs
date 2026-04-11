#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalProcessAdapter } from "../../src/adapters/runtime/local-process-adapter.mjs";
import { runSyncDbFirstUseCase } from "../../src/application/runtime/sync-db-first-use-case.mjs";
import { normalizeStateMode } from "../../src/lib/config/aidn-config-lib.mjs";

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const PERF_INDEX_SYNC = path.resolve(RUNTIME_DIR, "..", "perf", "index-sync.mjs");
const RUNTIME_REPAIR_LAYER = path.resolve(RUNTIME_DIR, "repair-layer.mjs");
const RUNTIME_REPAIR_LAYER_AUTOFIX = path.resolve(RUNTIME_DIR, "repair-layer-autofix.mjs");
const PERF_REPAIR_LAYER_TRIAGE_SUMMARY = path.resolve(RUNTIME_DIR, "..", "perf", "render-repair-layer-triage-summary.mjs");

function parseArgs(argv) {
  const args = {
    target: ".",
    stateMode: "",
    store: "",
    forceInFiles: false,
    repairLayer: true,
    repairLayerAutofixSafeOnly: false,
    repairLayerIndexFile: ".aidn/runtime/index/workflow-index.sqlite",
    repairLayerReportFile: ".aidn/runtime/index/repair-layer-report.json",
    repairLayerTriage: true,
    repairLayerTriageFile: ".aidn/runtime/index/repair-layer-triage.json",
    repairLayerTriageSummaryFile: ".aidn/runtime/index/repair-layer-triage-summary.md",
    strict: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--state-mode") {
      args.stateMode = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--store") {
      args.store = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--force-in-files") {
      args.forceInFiles = true;
    } else if (token === "--no-repair-layer") {
      args.repairLayer = false;
    } else if (token === "--repair-layer-autofix-safe-only") {
      args.repairLayerAutofixSafeOnly = true;
    } else if (token === "--repair-layer-index-file") {
      args.repairLayerIndexFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--repair-layer-report-file") {
      args.repairLayerReportFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--no-repair-layer-triage") {
      args.repairLayerTriage = false;
    } else if (token === "--repair-layer-triage-file") {
      args.repairLayerTriageFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--repair-layer-triage-summary-file") {
      args.repairLayerTriageSummaryFile = String(argv[i + 1] ?? "").trim();
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime sync-db-first --target . --json");
  console.log("  npx aidn runtime sync-db-first --target . --state-mode dual --strict --json");
  console.log("  npx aidn runtime sync-db-first --target . --force-in-files --json");
  console.log("  npx aidn runtime sync-db-first --target . --no-repair-layer --json");
  console.log("  npx aidn runtime sync-db-first --target . --no-repair-layer-triage --json");
  console.log("  npx aidn runtime sync-db-first --target . --repair-layer-autofix-safe-only --json");
}

async function main() {
  let outputJson = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    outputJson = args.json;
    const targetRoot = path.resolve(process.cwd(), args.target);
    const processAdapter = createLocalProcessAdapter();
    const out = await runSyncDbFirstUseCase({
      args,
      targetRoot,
      processAdapter,
      perfIndexSyncScript: PERF_INDEX_SYNC,
      repairLayerScript: RUNTIME_REPAIR_LAYER,
      repairLayerAutofixScript: RUNTIME_REPAIR_LAYER_AUTOFIX,
      repairLayerTriageSummaryScript: PERF_REPAIR_LAYER_TRIAGE_SUMMARY,
    });
    if (args.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`DB sync ${out.ok ? "OK" : "WARN"} (state_mode=${out.state_mode}, store=${out.store ?? "n/a"}).`);
    }
  } catch (error) {
    const out = {
      ts: new Date().toISOString(),
      ok: false,
      message: String(error.message ?? error),
    };
    if (outputJson) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.error(`ERROR: ${out.message}`);
    }
    process.exit(1);
  }
}

await main();

