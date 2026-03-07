import fs from "node:fs";
import path from "node:path";
import { readIndexFromSqlite } from "../../lib/sqlite/index-sqlite-lib.mjs";
import { buildRepairLayerService } from "./repair-layer-service.mjs";
import { createWorkflowStateStoreAdapter } from "../../adapters/runtime/workflow-state-store-adapter.mjs";
import { persistWorkflowIndexProjection } from "./index-state-store-service.mjs";
import {
  buildRepairLayerInputDigest,
  mergeRepairLayerPayload,
  REPAIR_LAYER_ENGINE_VERSION,
  summarizeRepairLayer,
} from "./repair-layer-payload-lib.mjs";

function resolveTargetPath(targetRoot, candidatePath) {
  if (!candidatePath) {
    return "";
  }
  if (path.isAbsolute(candidatePath)) {
    return path.resolve(candidatePath);
  }
  return path.resolve(targetRoot, candidatePath);
}

function detectBackend(indexFile, backend) {
  if (backend === "json" || backend === "sqlite") {
    return backend;
  }
  return String(indexFile).toLowerCase().endsWith(".sqlite") ? "sqlite" : "json";
}

function readJsonIndex(indexFile) {
  const absolute = path.resolve(process.cwd(), indexFile);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Index file not found: ${absolute}`);
  }
  const payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
  return { absolute, payload };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createStateStoreForBackend(indexFile, backend) {
  if (backend === "sqlite") {
    return createWorkflowStateStoreAdapter({
      mode: "sqlite",
      sqliteOutput: indexFile,
    });
  }
  return createWorkflowStateStoreAdapter({
    mode: "file",
    jsonOutput: indexFile,
  });
}

export function runRepairLayerUseCase({ args, targetRoot }) {
  const auditRoot = path.join(targetRoot, "docs", "audit");
  if (!fs.existsSync(auditRoot)) {
    throw new Error(`Missing audit root: ${auditRoot}`);
  }

  const indexFile = resolveTargetPath(targetRoot, args.indexFile);
  const backend = detectBackend(indexFile, args.indexBackend);
  const index = backend === "sqlite"
    ? readIndexFromSqlite(indexFile)
    : readJsonIndex(indexFile);
  const payload = index.payload && typeof index.payload === "object" ? index.payload : null;
  if (!payload) {
    throw new Error(`Invalid index payload: ${indexFile}`);
  }
  if (!Array.isArray(payload.artifacts) || !Array.isArray(payload.cycles)) {
    throw new Error("Repair layer requires an index payload with artifacts and cycles.");
  }

  const repairDecisions = Array.isArray(payload.repair_decisions) ? payload.repair_decisions : [];
  const inputDigest = buildRepairLayerInputDigest({
    artifacts: payload.artifacts,
    cycles: payload.cycles,
    repair_decisions: repairDecisions,
  });
  const previousMeta = payload.repair_layer_meta && typeof payload.repair_layer_meta === "object"
    ? payload.repair_layer_meta
    : null;
  const alreadyCurrent = previousMeta
    && previousMeta.engine_version === REPAIR_LAYER_ENGINE_VERSION
    && previousMeta.input_digest === inputDigest;

  if (args.apply && alreadyCurrent) {
    const repairLayer = {
      sessions: Array.isArray(payload.sessions) ? payload.sessions : [],
      artifact_links: Array.isArray(payload.artifact_links) ? payload.artifact_links : [],
      session_cycle_links: Array.isArray(payload.session_cycle_links) ? payload.session_cycle_links : [],
      migration_runs: Array.isArray(payload.migration_runs) ? payload.migration_runs : [],
      migration_findings: Array.isArray(payload.migration_findings) ? payload.migration_findings : [],
    };
    const summary = summarizeRepairLayer(repairLayer, {
      repairDecisions,
      inputDigest,
    });
    let reportFile = null;
    if (args.reportFile) {
      reportFile = resolveTargetPath(targetRoot, args.reportFile);
      writeJson(reportFile, {
        ts: new Date().toISOString(),
        target_root: targetRoot,
        audit_root: auditRoot,
        index_file: index.absolute,
        index_backend: backend,
        action: "skipped",
        skip_reason: "input_unchanged",
        summary,
        migration_runs: repairLayer.migration_runs,
        migration_findings: repairLayer.migration_findings,
      });
    }
    return {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      audit_root: auditRoot,
      index_file: index.absolute,
      index_backend: backend,
      action: "skipped",
      skipped: true,
      skip_reason: "input_unchanged",
      report_file: reportFile,
      summary,
      apply_result: {
        outputs: [],
        writes: {
          files_written_count: 0,
          bytes_written: 0,
        },
      },
    };
  }

  const repairLayer = buildRepairLayerService({
    auditRoot,
    targetRoot,
    artifacts: payload.artifacts,
    cycles: payload.cycles,
    repairDecisions,
  });
  const mergedPayload = mergeRepairLayerPayload(payload, repairLayer, {
    repairDecisions,
    inputDigest,
  });
  const summary = summarizeRepairLayer(repairLayer, {
    repairDecisions,
    inputDigest,
  });

  let applyResult = {
    outputs: [],
    writes: {
      files_written_count: 0,
      bytes_written: 0,
    },
  };
  if (args.apply) {
    const stateStore = createStateStoreForBackend(indexFile, backend);
    applyResult = persistWorkflowIndexProjection({
      stateStore,
      payload: mergedPayload,
      dryRun: false,
    });
  }

  let reportFile = null;
  if (args.reportFile) {
    reportFile = resolveTargetPath(targetRoot, args.reportFile);
    writeJson(reportFile, {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      audit_root: auditRoot,
      index_file: index.absolute,
      index_backend: backend,
      action: args.apply ? "applied" : "preview",
      summary,
      migration_runs: repairLayer.migration_runs,
      migration_findings: repairLayer.migration_findings,
    });
  }

  return {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    audit_root: auditRoot,
    index_file: index.absolute,
    index_backend: backend,
    action: args.apply ? "applied" : "preview",
    report_file: reportFile,
    summary,
    apply_result: applyResult,
  };
}
