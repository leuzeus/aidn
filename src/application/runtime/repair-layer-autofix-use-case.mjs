import fs from "node:fs";
import path from "node:path";
import { buildRepairLayerService } from "./repair-layer-service.mjs";
import { createWorkflowStateStoreAdapter } from "../../adapters/runtime/workflow-state-store-adapter.mjs";
import { persistWorkflowIndexProjection } from "./index-state-store-service.mjs";
import { buildRepairLayerInputDigest, mergeRepairLayerPayload } from "./repair-layer-payload-lib.mjs";
import { resolveRuntimePath } from "./runtime-path-resolution.mjs";
import { upsertRepairDecision } from "./repair-layer-decision-lib.mjs";
import { collectRepairLayerSafeAutofixPlan } from "./repair-layer-autofix-plan-lib.mjs";
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

function countOpenFindings(payload) {
  const findings = Array.isArray(payload?.migration_findings) ? payload.migration_findings : [];
  return findings.filter((row) => {
    const severity = String(row?.severity ?? "").toLowerCase();
    return severity === "warning" || severity === "error";
  }).length;
}

export async function runRepairLayerAutofixUseCase({ args, targetRoot }) {
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
    throw new Error("Repair layer autofix requires an index payload with artifacts and cycles.");
  }

  const suggestions = collectRepairLayerSafeAutofixPlan(payload, {
    sessionId: args.sessionId,
  });
  const decisions = [];
  for (const suggestion of suggestions) {
    for (const cycleId of suggestion.conflicting_cycle_ids) {
      decisions.push({
        relation_scope: "session_cycle_link",
        source_ref: suggestion.session_id,
        target_ref: cycleId,
        relation_type: "attached_cycle",
        decision: "rejected",
        decided_at: new Date().toISOString(),
        decided_by: args.decidedBy || "repair-layer-autofix",
        notes: `auto_reject_conflict_with_${suggestion.anchor_cycle_id}`,
      });
    }
  }

  if (decisions.length === 0) {
    return {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      index_file: index.absolute,
      index_backend: backend,
      action: "skipped",
      skipped: true,
      reason: "no_safe_autofix_candidates",
      summary: {
        suggestions_count: 0,
        decisions_count: 0,
        open_findings_before: countOpenFindings(payload),
        open_findings_after: countOpenFindings(payload),
      },
      suggestions: [],
      decisions: [],
    };
  }

  let repairDecisions = Array.isArray(payload.repair_decisions) ? payload.repair_decisions : [];
  for (const decision of decisions) {
    repairDecisions = upsertRepairDecision(repairDecisions, decision);
  }
  const repaired = buildRepairLayerService({
    auditRoot,
    targetRoot,
    artifacts: payload.artifacts,
    cycles: payload.cycles,
    repairDecisions,
  });
  const mergedPayload = mergeRepairLayerPayload(payload, repaired, {
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

  return {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    index_file: index.absolute,
    index_backend: backend,
    action: args.apply ? "applied" : "preview",
    summary: {
      suggestions_count: suggestions.length,
      decisions_count: decisions.length,
      open_findings_before: countOpenFindings(payload),
      open_findings_after: countOpenFindings(mergedPayload),
    },
    suggestions,
    decisions,
    apply_result: applyResult,
  };
}
