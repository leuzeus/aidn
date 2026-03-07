import crypto from "node:crypto";

export const REPAIR_LAYER_ENGINE_VERSION = "repair-layer-v1";

function stableClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortByKey(rows, keyFn) {
  return [...rows].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));
}

export function buildRepairLayerInputDigest(payload) {
  const artifacts = sortByKey(Array.isArray(payload?.artifacts) ? payload.artifacts : [], (row) => String(row?.path ?? ""))
    .map((row) => ({
      path: row?.path ?? null,
      kind: row?.kind ?? null,
      family: row?.family ?? null,
      subtype: row?.subtype ?? null,
      sha256: row?.sha256 ?? null,
      size_bytes: Number(row?.size_bytes ?? 0),
      mtime_ns: String(row?.mtime_ns ?? ""),
      session_id: row?.session_id ?? null,
      cycle_id: row?.cycle_id ?? null,
      source_mode: row?.source_mode ?? null,
      entity_confidence: Number(row?.entity_confidence ?? 1),
      legacy_origin: row?.legacy_origin ?? null,
      updated_at: row?.updated_at ?? null,
    }));
  const cycles = sortByKey(Array.isArray(payload?.cycles) ? payload.cycles : [], (row) => String(row?.cycle_id ?? ""))
    .map((row) => ({
      cycle_id: row?.cycle_id ?? null,
      session_id: row?.session_id ?? null,
      state: row?.state ?? null,
      outcome: row?.outcome ?? null,
      branch_name: row?.branch_name ?? null,
      dor_state: row?.dor_state ?? null,
      continuity_rule: row?.continuity_rule ?? null,
      continuity_base_branch: row?.continuity_base_branch ?? null,
      continuity_latest_cycle_branch: row?.continuity_latest_cycle_branch ?? null,
      updated_at: row?.updated_at ?? null,
    }));
  const repairDecisions = sortByKey(Array.isArray(payload?.repair_decisions) ? payload.repair_decisions : [], (row) =>
    `${row?.relation_scope ?? ""}:${row?.source_ref ?? ""}:${row?.target_ref ?? ""}:${row?.relation_type ?? ""}`)
    .map((row) => ({
      relation_scope: row?.relation_scope ?? null,
      source_ref: row?.source_ref ?? null,
      target_ref: row?.target_ref ?? null,
      relation_type: row?.relation_type ?? null,
      decision: row?.decision ?? null,
      decided_at: row?.decided_at ?? null,
      decided_by: row?.decided_by ?? null,
      notes: row?.notes ?? null,
    }));

  return crypto.createHash("sha256").update(JSON.stringify({
    engine_version: REPAIR_LAYER_ENGINE_VERSION,
    artifacts,
    cycles,
    repair_decisions: repairDecisions,
  })).digest("hex");
}

export function buildRepairLayerMeta(payload, options = {}) {
  const appliedAt = options.appliedAt ?? new Date().toISOString();
  const inputDigest = options.inputDigest ?? buildRepairLayerInputDigest(payload);
  return {
    engine_version: REPAIR_LAYER_ENGINE_VERSION,
    input_digest: inputDigest,
    applied_at: appliedAt,
  };
}

export function mergeRepairLayerPayload(payload, repairLayer, options = {}) {
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
  const cycles = Array.isArray(payload?.cycles) ? payload.cycles : [];
  const fileMap = Array.isArray(payload?.file_map) ? payload.file_map : [];
  const tags = Array.isArray(payload?.tags) ? payload.tags : [];
  const runMetrics = Array.isArray(payload?.run_metrics) ? payload.run_metrics : [];
  const repairDecisions = Array.isArray(options.repairDecisions)
    ? options.repairDecisions
    : (Array.isArray(payload?.repair_decisions) ? payload.repair_decisions : []);
  const repairLayerMeta = buildRepairLayerMeta({
    ...payload,
    repair_decisions: repairDecisions,
  }, {
    appliedAt: options.appliedAt,
    inputDigest: options.inputDigest,
  });
  return {
    ...stableClone(payload),
    schema_version: Math.max(Number(payload?.schema_version ?? 1), 2),
    sessions: repairLayer.sessions,
    artifact_links: repairLayer.artifact_links,
    cycle_links: Array.isArray(payload?.cycle_links) ? payload.cycle_links : [],
    session_cycle_links: repairLayer.session_cycle_links,
    migration_runs: repairLayer.migration_runs,
    migration_findings: repairLayer.migration_findings,
    repair_decisions: repairDecisions,
    repair_layer_meta: repairLayerMeta,
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
      repair_decisions_count: repairDecisions.length,
    },
  };
}

export function summarizeRepairLayer(repairLayer, options = {}) {
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
    repair_decisions_count: Array.isArray(options.repairDecisions) ? options.repairDecisions.length : 0,
    input_digest: options.inputDigest ?? null,
    severity_counts: severityCounts,
    type_counts: typeCounts,
    top_findings: findings.slice(0, 10),
  };
}
