#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  defaultIndexStoreFromStateMode,
  normalizeStateMode,
  readAidnProjectConfig,
  resolveConfigStateMode,
  writeAidnProjectConfig,
} from "../../src/lib/config/aidn-config-lib.mjs";

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const PERF_INDEX_SYNC = path.resolve(RUNTIME_DIR, "..", "perf", "index-sync.mjs");
const PERF_INDEX_EXPORT = path.resolve(RUNTIME_DIR, "..", "perf", "index-export-files.mjs");
const RUNTIME_REPAIR_LAYER = path.resolve(RUNTIME_DIR, "repair-layer.mjs");

function parseArgs(argv) {
  const args = {
    target: ".",
    from: "",
    to: "",
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    auditRoot: "docs/audit",
    repairLayer: true,
    repairLayerReportFile: ".aidn/runtime/index/repair-layer-report.json",
    strict: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--from") {
      args.from = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--to") {
      args.to = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--audit-root") {
      args.auditRoot = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--no-repair-layer") {
      args.repairLayer = false;
    } else if (token === "--repair-layer-report-file") {
      args.repairLayerReportFile = String(argv[i + 1] ?? "").trim();
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
  if (!args.to) {
    throw new Error("Missing value for --to");
  }
  if (!normalizeStateMode(args.to)) {
    throw new Error("Invalid --to. Expected files|dual|db-only");
  }
  if (args.from && !normalizeStateMode(args.from)) {
    throw new Error("Invalid --from. Expected files|dual|db-only");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime mode-migrate --target . --to dual --json");
  console.log("  npx aidn runtime mode-migrate --target . --from db-only --to files --strict --json");
  console.log("  npx aidn runtime mode-migrate --target . --to db-only --no-repair-layer --json");
}

function resolveTargetPath(targetRoot, candidate) {
  if (path.isAbsolute(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(targetRoot, candidate);
}

function resolveFromMode(targetRoot, requestedFrom) {
  const explicit = normalizeStateMode(requestedFrom);
  if (explicit) {
    return explicit;
  }
  const envMode = normalizeStateMode(process.env.AIDN_STATE_MODE);
  if (envMode) {
    return envMode;
  }
  const config = readAidnProjectConfig(targetRoot);
  return resolveConfigStateMode(config.data) ?? "files";
}

function runJson(script, scriptArgs) {
  const stdout = execFileSync(process.execPath, [script, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseJsonOutput(stdout);
}

function parseJsonOutput(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    throw new Error("Empty stdout");
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("Invalid JSON output");
  }
}

function updateConfigStateMode(targetRoot, toMode) {
  const cfg = readAidnProjectConfig(targetRoot);
  const data = cfg.data && typeof cfg.data === "object" ? cfg.data : {};
  const runtime = data.runtime && typeof data.runtime === "object" ? data.runtime : {};
  runtime.stateMode = toMode;
  runtime.indexStoreMode = defaultIndexStoreFromStateMode(toMode);
  data.runtime = runtime;
  const saved = writeAidnProjectConfig(targetRoot, data);
  return {
    config_file: saved,
    runtime,
  };
}

function main() {
  let outputJson = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    outputJson = args.json;
    const targetRoot = path.resolve(process.cwd(), args.target);
    const fromMode = resolveFromMode(targetRoot, args.from);
    const toMode = normalizeStateMode(args.to);
    const indexFile = resolveTargetPath(targetRoot, args.indexFile);
    const auditRoot = args.auditRoot;

    const steps = [];
    let syncResult = null;
    let exportResult = null;
    let repairLayerResult = null;

    if (toMode === "dual" || toMode === "db-only") {
      const store = defaultIndexStoreFromStateMode(toMode);
      syncResult = runJson(PERF_INDEX_SYNC, [
        "--target",
        targetRoot,
        "--store",
        store,
        "--with-content",
        "--json",
      ]);
      steps.push({
        step: "sync_to_db",
        ok: true,
        store,
      });
      if (args.repairLayer) {
        repairLayerResult = runJson(RUNTIME_REPAIR_LAYER, [
          "--target",
          targetRoot,
          "--index-file",
          indexFile,
          "--index-backend",
          "sqlite",
          ...(args.repairLayerReportFile ? ["--report-file", args.repairLayerReportFile] : ["--no-report"]),
          "--apply",
          "--json",
        ]);
        steps.push({
          step: "repair_layer",
          ok: true,
          report_file: repairLayerResult.report_file,
        });
      }
    }

    if (toMode === "files" && (fromMode === "dual" || fromMode === "db-only")) {
      exportResult = runJson(PERF_INDEX_EXPORT, [
        "--index-file",
        indexFile,
        "--backend",
        "sqlite",
        "--target",
        targetRoot,
        "--audit-root",
        auditRoot,
        "--json",
      ]);
      steps.push({
        step: "materialize_files_from_db",
        ok: true,
        index_file: indexFile,
      });
    }

    const configUpdate = updateConfigStateMode(targetRoot, toMode);
    steps.push({
      step: "update_project_config",
      ok: true,
      config_file: configUpdate.config_file,
    });

    const out = {
      ts: new Date().toISOString(),
      ok: true,
      target_root: targetRoot,
      from_mode: fromMode,
      to_mode: toMode,
      strict: args.strict,
      steps,
      sync_result: syncResult,
      repair_layer_result: repairLayerResult,
      export_result: exportResult,
      config_update: configUpdate,
    };
    if (args.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`Mode migrate OK: ${fromMode} -> ${toMode}`);
      console.log(`Config updated: ${configUpdate.config_file}`);
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

main();

