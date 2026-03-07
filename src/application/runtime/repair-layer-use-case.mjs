import fs from "node:fs";
import path from "node:path";
import { readIndexFromSqlite } from "../../lib/sqlite/index-sqlite-lib.mjs";
import { buildRepairLayerService } from "./repair-layer-service.mjs";
import { createWorkflowStateStoreAdapter } from "../../adapters/runtime/workflow-state-store-adapter.mjs";
import { persistWorkflowIndexProjection } from "./index-state-store-service.mjs";

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

function mergeRepairLayer(payload, repairLayer) {
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
  const cycles = Array.isArray(payload?.cycles) ? payload.cycles : [];
  const fileMap = Array.isArray(payload?.file_map) ? payload.file_map : [];
  const tags = Array.isArray(payload?.tags) ? payload.tags : [];
  const runMetrics = Array.isArray(payload?.run_metrics) ? payload.run_metrics : [];
  return {
    ...payload,
    schema_version: Math.max(Number(payload?.schema_version ?? 1), 2),
    sessions: repairLayer.sessions,
    artifact_links: repairLayer.artifact_links,
    cycle_links: Array.isArray(payload?.cycle_links) ? payload.cycle_links : [],
    session_cycle_links: repairLayer.session_cycle_links,
    migration_runs: repairLayer.migration_runs,
    migration_findings: repairLayer.migration_findings,
    repair_decisions: Array.isArray(payload?.repair_decisions) ? payload.repair_decisions : [],
    summary: {
      ...(payload?.summary && typeof payload.summary === "object" ? payload.summary : {}),
      cycles_count: cycles.length,
      sessions_count: repairLayer.sessions.length,
      artifacts_count: artifacts.length,
      file_map_count: fileMap.length,
      tags_count: tags.length,
      run_metrics_count: runMetrics.length,
      artifact_links_count: repairLayer.artifact_links.length,
      cycle_links_count: Array.isArray(payload?.cycle_links) ? payload.cycle_links.length : 0,
      session_cycle_links_count: repairLayer.session_cycle_links.length,
      migration_runs_count: repairLayer.migration_runs.length,
      migration_findings_count: repairLayer.migration_findings.length,
      repair_decisions_count: Array.isArray(payload?.repair_decisions) ? payload.repair_decisions.length : 0,
    },
  };
}

function summarizeRepairLayer(repairLayer) {
  const findings = Array.isArray(repairLayer?.migration_findings) ? repairLayer.migration_findings : [];
  const severityCounts = {};
  const typeCounts = {};
  for (const row of findings) {
    const severity = String(row?.severity ?? "unknown");
    const type = String(row?.finding_type ?? "unknown");
    severityCounts[severity] = Number(severityCounts[severity] ?? 0) + 1;
    typeCounts[type] = Number(typeCounts[type] ?? 0) + 1;
  }
  return {
    sessions_count: Array.isArray(repairLayer?.sessions) ? repairLayer.sessions.length : 0,
    artifact_links_count: Array.isArray(repairLayer?.artifact_links) ? repairLayer.artifact_links.length : 0,
    session_cycle_links_count: Array.isArray(repairLayer?.session_cycle_links) ? repairLayer.session_cycle_links.length : 0,
    migration_runs_count: Array.isArray(repairLayer?.migration_runs) ? repairLayer.migration_runs.length : 0,
    migration_findings_count: findings.length,
    repair_decisions_count: 0,
    severity_counts: severityCounts,
    type_counts: typeCounts,
    top_findings: findings.slice(0, 10),
  };
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

  const repairLayer = buildRepairLayerService({
    auditRoot,
    targetRoot,
    artifacts: payload.artifacts,
    cycles: payload.cycles,
    repairDecisions: Array.isArray(payload.repair_decisions) ? payload.repair_decisions : [],
  });
  const mergedPayload = mergeRepairLayer(payload, repairLayer);
  const summary = summarizeRepairLayer(repairLayer);

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
