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

function mergeRepairLayer(payload, repairLayer, repairDecisions) {
  return {
    ...payload,
    schema_version: Math.max(Number(payload?.schema_version ?? 1), 2),
    sessions: repairLayer.sessions,
    artifact_links: repairLayer.artifact_links,
    cycle_links: Array.isArray(payload?.cycle_links) ? payload.cycle_links : [],
    session_cycle_links: repairLayer.session_cycle_links,
    migration_runs: repairLayer.migration_runs,
    migration_findings: repairLayer.migration_findings,
    repair_decisions: repairDecisions,
    summary: {
      ...(payload?.summary && typeof payload.summary === "object" ? payload.summary : {}),
      repair_decisions_count: repairDecisions.length,
      session_cycle_links_count: repairLayer.session_cycle_links.length,
      migration_findings_count: repairLayer.migration_findings.length,
    },
  };
}

function upsertRepairDecision(existing, nextDecision) {
  const list = Array.isArray(existing) ? [...existing] : [];
  const index = list.findIndex((row) =>
    String(row?.relation_scope ?? "") === String(nextDecision.relation_scope)
    && String(row?.source_ref ?? "") === String(nextDecision.source_ref)
    && String(row?.target_ref ?? "") === String(nextDecision.target_ref)
    && String(row?.relation_type ?? "") === String(nextDecision.relation_type));
  if (index >= 0) {
    list[index] = nextDecision;
  } else {
    list.push(nextDecision);
  }
  return list.sort((a, b) => `${a.relation_scope}:${a.source_ref}:${a.target_ref}:${a.relation_type}`.localeCompare(`${b.relation_scope}:${b.source_ref}:${b.target_ref}:${b.relation_type}`));
}

export function runRepairLayerResolveUseCase({ args, targetRoot }) {
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
  if (!payload || !Array.isArray(payload.artifacts) || !Array.isArray(payload.cycles)) {
    throw new Error("Repair layer resolution requires an index payload with artifacts and cycles.");
  }

  const decision = {
    relation_scope: "session_cycle_link",
    source_ref: args.sessionId,
    target_ref: args.cycleId,
    relation_type: args.relationType,
    decision: args.decision,
    decided_at: new Date().toISOString(),
    decided_by: args.decidedBy || null,
    notes: args.notes || null,
  };
  const repairDecisions = upsertRepairDecision(payload.repair_decisions, decision);
  const repairLayer = buildRepairLayerService({
    auditRoot,
    targetRoot,
    artifacts: payload.artifacts,
    cycles: payload.cycles,
    repairDecisions,
  });
  const mergedPayload = mergeRepairLayer(payload, repairLayer, repairDecisions);

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

  const resolvedLink = repairLayer.session_cycle_links.find((row) =>
    String(row?.session_id ?? "") === String(args.sessionId)
    && String(row?.cycle_id ?? "") === String(args.cycleId)
    && String(row?.relation_type ?? "") === String(args.relationType)) ?? null;

  return {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    index_file: index.absolute,
    index_backend: backend,
    decision,
    resolved_link: resolvedLink,
    repair_decisions_count: repairDecisions.length,
    action: args.apply ? "applied" : "preview",
    apply_result: applyResult,
  };
}
