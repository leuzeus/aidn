#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  defaultIndexStoreFromStateMode,
  normalizeStateMode,
  readAidnProjectConfig,
  resolveConfigStateMode,
  resolveConfigRuntimePersistenceBackend,
  writeAidnProjectConfig,
} from "../../src/lib/config/aidn-config-lib.mjs";
import { writeRepairLayerTriageArtifacts } from "../../src/application/runtime/repair-layer-artifact-service.mjs";
import { runRepairLayerAutofixUseCase } from "../../src/application/runtime/repair-layer-autofix-use-case.mjs";
import { createRuntimePersistenceAdmin } from "../../src/application/runtime/runtime-persistence-service.mjs";

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const PERF_INDEX_SYNC = path.resolve(RUNTIME_DIR, "..", "perf", "index-sync.mjs");
const PERF_INDEX_EXPORT = path.resolve(RUNTIME_DIR, "..", "perf", "index-export-files.mjs");
const RUNTIME_REPAIR_LAYER = path.resolve(RUNTIME_DIR, "repair-layer.mjs");
const PERF_REPAIR_LAYER_TRIAGE_SUMMARY = path.resolve(RUNTIME_DIR, "..", "perf", "render-repair-layer-triage-summary.mjs");

function parseArgs(argv) {
  const args = {
    target: ".",
    from: "",
    to: "",
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    auditRoot: "docs/audit",
    repairLayer: true,
    repairLayerAutofixSafeOnly: false,
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
    } else if (token === "--repair-layer-autofix-safe-only") {
      args.repairLayerAutofixSafeOnly = true;
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
  console.log("  npx aidn runtime mode-migrate --target . --to db-only --no-repair-layer-triage --json");
  console.log("  npx aidn runtime mode-migrate --target . --to db-only --repair-layer-autofix-safe-only --json");
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

function runNode(script, scriptArgs) {
  return execFileSync(process.execPath, [script, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  const runtimePersistence = runtime.persistence && typeof runtime.persistence === "object" ? runtime.persistence : {};
  runtime.stateMode = toMode;
  runtime.indexStoreMode = defaultIndexStoreFromStateMode(toMode);
  runtimePersistence.backend = resolveConfigRuntimePersistenceBackend(data) ?? "sqlite";
  runtimePersistence.localProjectionPolicy = String(runtimePersistence.localProjectionPolicy ?? "").trim() || "keep-local-sqlite";
  runtime.persistence = runtimePersistence;
  data.runtime = runtime;
  const saved = writeAidnProjectConfig(targetRoot, data);
  return {
    config_file: saved,
    runtime,
  };
}

function shouldRunSchemaMigration(fromMode, toMode) {
  return [fromMode, toMode].some((mode) => mode === "dual" || mode === "db-only");
}

async function main() {
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
    let repairLayerAutofixResult = null;
    let repairLayerTriageResult = null;
    let schemaStatusBefore = null;
    let schemaMigrationResult = null;
    let schemaStatusAfter = null;
    const runtimePersistenceAdmin = createRuntimePersistenceAdmin({
      targetRoot,
      backend: "sqlite",
      sqliteFile: indexFile,
      role: "mode-migrate",
    });

    if (shouldRunSchemaMigration(fromMode, toMode)) {
      schemaStatusBefore = runtimePersistenceAdmin.inspectSchema();
      steps.push({
        step: "schema_status_before",
        ok: true,
        exists: schemaStatusBefore.exists,
        pending_ids: schemaStatusBefore.pending_ids,
      });
      schemaMigrationResult = runtimePersistenceAdmin.migrateSchema();
      steps.push({
        step: "schema_migrate",
        ok: true,
        backup_file: schemaMigrationResult?.migration?.backup_file ?? null,
        applied_ids: schemaMigrationResult?.migration?.applied_ids ?? [],
      });
      schemaStatusAfter = schemaMigrationResult?.status ?? runtimePersistenceAdmin.inspectSchema();
      steps.push({
        step: "schema_status_after",
        ok: true,
        exists: schemaStatusAfter.exists,
        pending_ids: schemaStatusAfter.pending_ids,
      });
    }

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
        if (args.repairLayerAutofixSafeOnly) {
          repairLayerAutofixResult = await runRepairLayerAutofixUseCase({
            args: {
              indexFile,
              indexBackend: "sqlite",
              apply: true,
              sessionId: "",
              decidedBy: "mode-migrate",
            },
            targetRoot,
          });
          steps.push({
            step: "repair_layer_autofix",
            ok: true,
            decisions_count: repairLayerAutofixResult?.summary?.decisions_count ?? 0,
          });
        }
        if (args.repairLayerTriage) {
          repairLayerTriageResult = writeRepairLayerTriageArtifacts({
            targetRoot,
            indexFile,
            backend: "sqlite",
            triageFile: args.repairLayerTriageFile,
            summaryFile: args.repairLayerTriageSummaryFile,
            renderScript: PERF_REPAIR_LAYER_TRIAGE_SUMMARY,
            runNodeScript(scriptPath, scriptArgs) {
              return runNode(scriptPath, scriptArgs);
            },
          });
          steps.push({
            step: "repair_layer_triage",
            ok: true,
            triage_file: repairLayerTriageResult.triage_file,
            summary_file: repairLayerTriageResult.summary_file,
          });
        }
      }
    }

    if (
      (toMode === "files" && (fromMode === "dual" || fromMode === "db-only"))
      || (toMode === "dual" && fromMode === "db-only")
    ) {
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
        target_mode: toMode,
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
      schema_status_before: schemaStatusBefore,
      schema_migration_result: schemaMigrationResult,
      schema_status_after: schemaStatusAfter,
      steps,
      sync_result: syncResult,
      repair_layer_result: repairLayerResult,
      repair_layer_autofix_result: repairLayerAutofixResult,
      repair_layer_triage_result: repairLayerTriageResult,
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

await main();

