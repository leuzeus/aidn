import { getLatestWorkflowPayloadSchemaVersion } from "../../lib/sqlite/workflow-db-schema-lib.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function parseJsonOrNull(text) {
  if (text == null || (typeof text === "string" && text.trim().length === 0)) {
    return null;
  }
  if (typeof text === "object") {
    return text;
  }
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}

function toSchemaVersion(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function resolveRuntimePayloadSchemaVersion(meta = {}) {
  const explicit = Number(meta?.payload_schema_version ?? "");
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const dbSchemaVersion = Number(meta?.schema_version ?? "");
  if (Number.isFinite(dbSchemaVersion) && dbSchemaVersion > 0) {
    return Math.min(dbSchemaVersion, getLatestWorkflowPayloadSchemaVersion());
  }
  return getLatestWorkflowPayloadSchemaVersion();
}

export function buildRuntimePayloadSummary(payload, structureKindHint = null) {
  return {
    cycles_count: Array.isArray(payload.cycles) ? payload.cycles.length : 0,
    sessions_count: Array.isArray(payload.sessions) ? payload.sessions.length : 0,
    artifacts_count: Array.isArray(payload.artifacts) ? payload.artifacts.length : 0,
    file_map_count: Array.isArray(payload.file_map) ? payload.file_map.length : 0,
    tags_count: Array.isArray(payload.tags) ? payload.tags.length : 0,
    run_metrics_count: Array.isArray(payload.run_metrics) ? payload.run_metrics.length : 0,
    artifact_links_count: Array.isArray(payload.artifact_links) ? payload.artifact_links.length : 0,
    cycle_links_count: Array.isArray(payload.cycle_links) ? payload.cycle_links.length : 0,
    session_cycle_links_count: Array.isArray(payload.session_cycle_links) ? payload.session_cycle_links.length : 0,
    session_links_count: Array.isArray(payload.session_links) ? payload.session_links.length : 0,
    migration_runs_count: Array.isArray(payload.migration_runs) ? payload.migration_runs.length : 0,
    migration_findings_count: Array.isArray(payload.migration_findings) ? payload.migration_findings.length : 0,
    repair_decisions_count: Array.isArray(payload.repair_decisions) ? payload.repair_decisions.length : 0,
    structure_kind: structureKindHint ?? "unknown",
    artifacts_with_content_count: Array.isArray(payload.artifacts)
      ? payload.artifacts.filter((row) => typeof row?.content === "string").length
      : 0,
    artifacts_with_canonical_count: Array.isArray(payload.artifacts)
      ? payload.artifacts.filter((row) => row?.canonical && typeof row.canonical === "object").length
      : 0,
  };
}

export function buildRuntimeMetaMap(rows = []) {
  const meta = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeScalar(row?.key);
    if (!key) {
      continue;
    }
    meta[key] = row?.value ?? null;
  }
  return meta;
}

function mapArtifacts(rows = [], blobRows = []) {
  const blobByArtifactId = new Map(
    blobRows.map((row) => [Number(row?.artifact_id ?? 0) || null, row]),
  );
  return rows.map((row) => {
    const artifactId = Number(row?.artifact_id ?? 0) || null;
    const blob = blobByArtifactId.get(artifactId) ?? null;
    return {
      path: row?.path ?? null,
      kind: row?.kind ?? "other",
      family: row?.family ?? "unknown",
      subtype: row?.subtype ?? null,
      gate_relevance: Number(row?.gate_relevance ?? 0),
      classification_reason: row?.classification_reason ?? null,
      content_format: blob?.content_format ?? row?.content_format ?? null,
      content: blob?.content ?? row?.content ?? null,
      canonical_format: blob?.canonical_format ?? row?.canonical_format ?? null,
      canonical: parseJsonOrNull(blob?.canonical_json ?? row?.canonical_json),
      sha256: blob?.sha256 ?? row?.sha256 ?? null,
      size_bytes: Number(blob?.size_bytes ?? row?.size_bytes ?? 0),
      mtime_ns: row?.mtime_ns == null ? null : String(row.mtime_ns),
      session_id: row?.session_id ?? null,
      cycle_id: row?.cycle_id ?? null,
      source_mode: row?.source_mode ?? "explicit",
      entity_confidence: Number(row?.entity_confidence ?? 1),
      legacy_origin: row?.legacy_origin ?? null,
      updated_at: blob?.updated_at ?? row?.updated_at ?? null,
    };
  });
}

export function rehydrateRuntimePayloadFromRelationalRows({
  scopeKey = "",
  meta = {},
  cycles = [],
  sessions = [],
  artifacts = [],
  artifactBlobs = [],
  fileMap = [],
  tags = [],
  artifactTags = [],
  runMetrics = [],
  artifactLinks = [],
  cycleLinks = [],
  sessionCycleLinks = [],
  sessionLinks = [],
  migrationRuns = [],
  migrationFindings = [],
  repairDecisions = [],
} = {}) {
  const structureProfile = parseJsonOrNull(meta.structure_profile_json);
  const structureKind = meta.structure_kind
    ?? structureProfile?.kind
    ?? "unknown";
  const artifactRows = mapArtifacts(artifacts, artifactBlobs);
  const artifactById = new Map(
    artifacts.map((row) => [Number(row?.artifact_id ?? 0) || null, row]),
  );
  const tagById = new Map(
    tags.map((row) => [Number(row?.tag_id ?? 0) || null, row]),
  );

  const payload = {
    schema_version: toSchemaVersion(meta.schema_version, resolveRuntimePayloadSchemaVersion(meta)),
    generated_at: normalizeScalar(meta.generated_at) || null,
    target_root: normalizeScalar(meta.target_root) || normalizeScalar(scopeKey) || null,
    audit_root: normalizeScalar(meta.audit_root) || null,
    structure_profile: structureProfile ?? null,
    repair_layer_meta: parseJsonOrNull(meta.repair_layer_meta_json),
    cycles: cycles.map((row) => ({
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
    })),
    artifacts: artifactRows,
    sessions: sessions.map((row) => ({
      session_id: row?.session_id ?? null,
      branch_name: row?.branch_name ?? null,
      state: row?.state ?? null,
      owner: row?.owner ?? null,
      started_at: row?.started_at ?? null,
      ended_at: row?.ended_at ?? null,
      source_artifact_path: row?.source_artifact_path ?? null,
      source_confidence: Number(row?.source_confidence ?? 1),
      source_mode: row?.source_mode ?? "explicit",
      parent_session: row?.parent_session ?? null,
      branch_kind: row?.branch_kind ?? null,
      cycle_branch: row?.cycle_branch ?? null,
      intermediate_branch: row?.intermediate_branch ?? null,
      integration_target_cycle: row?.integration_target_cycle ?? null,
      carry_over_pending: row?.carry_over_pending ?? null,
      updated_at: row?.updated_at ?? null,
    })),
    file_map: fileMap.map((row) => ({
      cycle_id: row?.cycle_id ?? null,
      path: row?.path ?? null,
      role: row?.role ?? null,
      relation: row?.relation ?? "unknown",
      last_seen_at: row?.last_seen_at ?? null,
    })),
    tags: tags.map((row) => ({
      tag: row?.tag ?? null,
    })),
    artifact_tags: artifactTags.map((row) => {
      const artifact = artifactById.get(Number(row?.artifact_id ?? 0) || null);
      const tag = tagById.get(Number(row?.tag_id ?? 0) || null);
      return {
        path: artifact?.path ?? null,
        tag: tag?.tag ?? null,
      };
    }).filter((row) => row.path && row.tag),
    run_metrics: runMetrics.map((row) => ({
      run_id: row?.run_id ?? null,
      started_at: row?.started_at ?? null,
      ended_at: row?.ended_at ?? null,
      overhead_ratio: row?.overhead_ratio == null ? null : Number(row.overhead_ratio),
      artifacts_churn: row?.artifacts_churn == null ? null : Number(row.artifacts_churn),
      gates_frequency: row?.gates_frequency == null ? null : Number(row.gates_frequency),
    })),
    artifact_links: artifactLinks.map((row) => ({
      source_path: row?.source_path ?? null,
      target_path: row?.target_path ?? null,
      relation_type: row?.relation_type ?? null,
      confidence: Number(row?.confidence ?? 1),
      inference_source: row?.inference_source ?? null,
      source_mode: row?.source_mode ?? "explicit",
      relation_status: row?.relation_status ?? "explicit",
      updated_at: row?.updated_at ?? null,
    })),
    cycle_links: cycleLinks.map((row) => ({
      source_cycle_id: row?.source_cycle_id ?? null,
      target_cycle_id: row?.target_cycle_id ?? null,
      relation_type: row?.relation_type ?? null,
      confidence: Number(row?.confidence ?? 1),
      inference_source: row?.inference_source ?? null,
      source_mode: row?.source_mode ?? "explicit",
      relation_status: row?.relation_status ?? "explicit",
      updated_at: row?.updated_at ?? null,
    })),
    session_cycle_links: sessionCycleLinks.map((row) => ({
      session_id: row?.session_id ?? null,
      cycle_id: row?.cycle_id ?? null,
      relation_type: row?.relation_type ?? null,
      confidence: Number(row?.confidence ?? 1),
      inference_source: row?.inference_source ?? null,
      source_mode: row?.source_mode ?? "explicit",
      relation_status: row?.relation_status ?? "explicit",
      ambiguity_status: row?.ambiguity_status ?? null,
      updated_at: row?.updated_at ?? null,
    })),
    session_links: sessionLinks.map((row) => ({
      source_session_id: row?.source_session_id ?? null,
      target_session_id: row?.target_session_id ?? null,
      relation_type: row?.relation_type ?? null,
      confidence: Number(row?.confidence ?? 1),
      inference_source: row?.inference_source ?? null,
      source_mode: row?.source_mode ?? "explicit",
      relation_status: row?.relation_status ?? "explicit",
      updated_at: row?.updated_at ?? null,
    })),
    migration_runs: migrationRuns.map((row) => ({
      migration_run_id: row?.migration_run_id ?? null,
      engine_version: row?.engine_version ?? null,
      started_at: row?.started_at ?? null,
      ended_at: row?.ended_at ?? null,
      status: row?.status ?? null,
      target_root: row?.target_root ?? null,
      notes: row?.notes ?? null,
    })),
    migration_findings: migrationFindings.map((row) => ({
      migration_run_id: row?.migration_run_id ?? null,
      severity: row?.severity ?? null,
      finding_type: row?.finding_type ?? null,
      entity_type: row?.entity_type ?? null,
      entity_id: row?.entity_id ?? null,
      artifact_path: row?.artifact_path ?? null,
      message: row?.message ?? null,
      confidence: row?.confidence == null ? null : Number(row.confidence),
      suggested_action: row?.suggested_action ?? null,
      created_at: row?.created_at ?? null,
    })),
    repair_decisions: repairDecisions.map((row) => ({
      relation_scope: row?.relation_scope ?? null,
      source_ref: row?.source_ref ?? null,
      target_ref: row?.target_ref ?? null,
      relation_type: row?.relation_type ?? null,
      decision: row?.decision ?? null,
      decided_at: row?.decided_at ?? null,
      decided_by: row?.decided_by ?? null,
      notes: row?.notes ?? null,
    })),
  };
  payload.summary = buildRuntimePayloadSummary(payload, structureKind);
  return payload;
}
