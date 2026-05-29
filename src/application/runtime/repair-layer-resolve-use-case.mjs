import fs from "node:fs";
import path from "node:path";
import { buildRepairLayerService } from "./repair-layer-service.mjs";
import { createWorkflowStateStoreAdapter } from "../../adapters/runtime/workflow-state-store-adapter.mjs";
import { persistWorkflowIndexProjection } from "./index-state-store-service.mjs";
import { buildRepairLayerInputDigest, mergeRepairLayerPayload } from "./repair-layer-payload-lib.mjs";
import { resolveRuntimePath } from "./runtime-path-resolution.mjs";
import { upsertRepairDecision } from "./repair-layer-decision-lib.mjs";
import { detectRuntimeSnapshotBackend, readRuntimeSnapshot } from "./runtime-snapshot-service.mjs";

function detectBackend(indexFile, backend) {
  return detectRuntimeSnapshotBackend(indexFile, backend);
}

function readJsonIndex(indexFile) {
  const absolute = path.resolve(process.cwd(), indexFile);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Index file not found: ${absolute}`);
  }
  const payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
  return { absolute, payload };
}

function resolveFileProjectionPath(indexFile) {
  const absolute = path.resolve(process.cwd(), indexFile);
  if (absolute.toLowerCase().endsWith(".json")) {
    return absolute;
  }
  return path.join(path.dirname(absolute), `${path.basename(absolute, path.extname(absolute))}.json`);
}

function createStateStoreForBackend(targetRoot, indexFile, backend) {
  if (backend === "sqlite") {
    return createWorkflowStateStoreAdapter({
      targetRoot,
      mode: "sqlite",
      sqliteOutput: indexFile,
    });
  }
  return createWorkflowStateStoreAdapter({
    targetRoot,
    mode: "file",
    jsonOutput: resolveFileProjectionPath(indexFile),
    runtimePersistenceBackend: backend === "postgres" ? "postgres" : "",
  });
}

export async function runRepairLayerResolveUseCase({ args, targetRoot }) {
  const auditRoot = path.join(targetRoot, "docs", "audit");
  if (!fs.existsSync(auditRoot)) {
    throw new Error(`Missing audit root: ${auditRoot}`);
  }

  const indexFile = resolveRuntimePath(targetRoot, args.indexFile);
  const backend = detectBackend(indexFile, args.indexBackend);
  const index = backend === "json"
    ? readJsonIndex(indexFile)
    : await readRuntimeSnapshot({ indexFile, backend, targetRoot });
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
  const mergedPayload = mergeRepairLayerPayload(payload, repairLayer, {
    repairDecisions,
    inputDigest: buildRepairLayerInputDigest({
      artifacts: payload.artifacts,
      cycles: payload.cycles,
      repair_decisions: repairDecisions,
    }),
  });

  let applyResult = {
    outputs: [],
    writes: {
      files_written_count: 0,
      bytes_written: 0,
    },
  };
  if (args.apply) {
    const stateStore = createStateStoreForBackend(targetRoot, indexFile, backend);
    applyResult = await persistWorkflowIndexProjection({
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
