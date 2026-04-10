function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function normalizeArtifactPath(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

function normalizeMetaValue(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

const RUNTIME_HEAD_DEFINITIONS = Object.freeze([
  ["current_state", ["current_state"], ["CURRENT-STATE.md"]],
  ["runtime_state", ["runtime_state"], ["RUNTIME-STATE.md"]],
  ["handoff_packet", ["handoff_packet"], ["HANDOFF-PACKET.md"]],
  ["agent_roster", ["agent_roster"], ["AGENT-ROSTER.md"]],
  ["agent_health_summary", ["agent_health_summary"], ["AGENT-HEALTH-SUMMARY.md"]],
  ["agent_selection_summary", ["agent_selection_summary"], ["AGENT-SELECTION-SUMMARY.md"]],
  ["multi_agent_status", ["multi_agent_status"], ["MULTI-AGENT-STATUS.md"]],
  ["coordination_summary", ["coordination_summary"], ["COORDINATION-SUMMARY.md"]],
]);

function resolveRuntimeHeadDefinition(artifact) {
  const subtype = normalizeScalar(artifact?.subtype).toLowerCase();
  if (subtype) {
    for (const [headKey, subtypes] of RUNTIME_HEAD_DEFINITIONS) {
      if (subtypes.includes(subtype)) {
        return { headKey };
      }
    }
  }
  const fileName = normalizeArtifactPath(artifact?.path).split("/").pop() ?? "";
  if (!fileName) {
    return null;
  }
  for (const [headKey, , fileNames] of RUNTIME_HEAD_DEFINITIONS) {
    if (fileNames.includes(fileName)) {
      return { headKey };
    }
  }
  return null;
}

export function buildRuntimeHeadRows(input, options = {}) {
  const artifacts = Array.isArray(input)
    ? input
    : (Array.isArray(input?.artifacts) ? input.artifacts : []);
  const scopeKey = normalizeScalar(options.scopeKey);
  const rows = [];
  const seen = new Set();
  const ordered = artifacts.slice().sort((left, right) =>
    String(right?.updated_at ?? "").localeCompare(String(left?.updated_at ?? "")));
  for (const artifact of ordered) {
    const definition = resolveRuntimeHeadDefinition(artifact);
    if (!definition || seen.has(definition.headKey)) {
      continue;
    }
    seen.add(definition.headKey);
    rows.push({
      scope_key: scopeKey || null,
      head_key: definition.headKey,
      artifact_id: Number(artifact?.artifact_id ?? 0) || null,
      artifact_path: normalizeArtifactPath(artifact?.path),
      artifact_sha256: normalizeScalar(artifact?.sha256) || null,
      session_id: normalizeScalar(artifact?.session_id) || null,
      cycle_id: normalizeScalar(artifact?.cycle_id) || null,
      kind: normalizeScalar(artifact?.kind) || null,
      subtype: normalizeScalar(artifact?.subtype) || null,
      updated_at: normalizeScalar(artifact?.updated_at) || new Date().toISOString(),
      payload_json: {
        scope_key: scopeKey || null,
        head_key: definition.headKey,
        artifact_id: Number(artifact?.artifact_id ?? 0) || null,
        artifact_path: normalizeArtifactPath(artifact?.path),
        artifact_sha256: normalizeScalar(artifact?.sha256) || null,
        session_id: normalizeScalar(artifact?.session_id) || null,
        cycle_id: normalizeScalar(artifact?.cycle_id) || null,
        kind: normalizeScalar(artifact?.kind) || null,
        subtype: normalizeScalar(artifact?.subtype) || null,
        updated_at: normalizeScalar(artifact?.updated_at) || null,
      },
    });
  }
  return rows;
}

export function buildRuntimeIndexMetaRows(payload = {}, options = {}) {
  const scopeKey = normalizeScalar(options.scopeKey);
  const updatedAt = normalizeScalar(options.generatedAt ?? payload?.generated_at) || new Date().toISOString();
  const structureProfile = payload?.structure_profile && typeof payload.structure_profile === "object"
    ? payload.structure_profile
    : null;
  const rows = [
    { scope_key: scopeKey || null, key: "schema_version", value: normalizeMetaValue(payload?.schema_version ?? 1), updated_at: updatedAt },
    { scope_key: scopeKey || null, key: "payload_schema_version", value: normalizeMetaValue(payload?.schema_version ?? 1), updated_at: updatedAt },
    { scope_key: scopeKey || null, key: "generated_at", value: normalizeMetaValue(options.generatedAt ?? payload?.generated_at ?? updatedAt), updated_at: updatedAt },
    { scope_key: scopeKey || null, key: "target_root", value: normalizeMetaValue(options.projectRootRef ?? payload?.target_root), updated_at: updatedAt },
    { scope_key: scopeKey || null, key: "audit_root", value: normalizeMetaValue(payload?.audit_root), updated_at: updatedAt },
    { scope_key: scopeKey || null, key: "structure_kind", value: normalizeMetaValue(payload?.summary?.structure_kind ?? structureProfile?.kind ?? "unknown"), updated_at: updatedAt },
    { scope_key: scopeKey || null, key: "structure_profile_json", value: normalizeMetaValue(structureProfile), updated_at: updatedAt },
    { scope_key: scopeKey || null, key: "repair_layer_meta_json", value: normalizeMetaValue(payload?.repair_layer_meta), updated_at: updatedAt },
    { scope_key: scopeKey || null, key: "payload_digest", value: normalizeMetaValue(options.payloadDigest), updated_at: updatedAt },
    { scope_key: scopeKey || null, key: "source_backend", value: normalizeMetaValue(options.sourceBackend), updated_at: updatedAt },
    { scope_key: scopeKey || null, key: "source_sqlite_file", value: normalizeMetaValue(options.sourceSqliteFile), updated_at: updatedAt },
    { scope_key: scopeKey || null, key: "adoption_status", value: normalizeMetaValue(options.adoptionStatus), updated_at: updatedAt },
    { scope_key: scopeKey || null, key: "adoption_metadata_json", value: normalizeMetaValue(options.adoptionMetadata), updated_at: updatedAt },
  ];
  return rows.filter((row) => row.value != null);
}

export function projectRuntimePayloadToRelationalRows(payload = {}, options = {}) {
  const scopeKey = normalizeScalar(options.scopeKey);
  const cycles = Array.isArray(payload?.cycles) ? payload.cycles : [];
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
  const fileMap = Array.isArray(payload?.file_map) ? payload.file_map : [];
  const tags = Array.isArray(payload?.tags) ? payload.tags : [];
  const artifactTags = Array.isArray(payload?.artifact_tags) ? payload.artifact_tags : [];
  const runMetrics = Array.isArray(payload?.run_metrics) ? payload.run_metrics : [];
  const artifactLinks = Array.isArray(payload?.artifact_links) ? payload.artifact_links : [];
  const cycleLinks = Array.isArray(payload?.cycle_links) ? payload.cycle_links : [];
  const sessionCycleLinks = Array.isArray(payload?.session_cycle_links) ? payload.session_cycle_links : [];
  const sessionLinks = Array.isArray(payload?.session_links) ? payload.session_links : [];
  const repairDecisions = Array.isArray(payload?.repair_decisions) ? payload.repair_decisions : [];
  const migrationRuns = Array.isArray(payload?.migration_runs) ? payload.migration_runs : [];
  const migrationFindings = Array.isArray(payload?.migration_findings) ? payload.migration_findings : [];

  const cycleRows = cycles.map((row) => ({ ...row }));
  const sessionRows = sessions.map((row) => ({ ...row }));
  const artifactRows = artifacts.map((row, index) => ({
    scope_key: scopeKey || null,
    artifact_id: index + 1,
    path: normalizeArtifactPath(row?.path),
    kind: row?.kind ?? null,
    family: row?.family ?? "unknown",
    subtype: row?.subtype ?? null,
    gate_relevance: Number(row?.gate_relevance ?? 0),
    classification_reason: row?.classification_reason ?? null,
    content_format: row?.content_format ?? null,
    content: row?.content ?? null,
    canonical_format: row?.canonical_format ?? null,
    canonical_json: row?.canonical ?? null,
    sha256: row?.sha256 ?? null,
    size_bytes: Number(row?.size_bytes ?? 0),
    mtime_ns: Number(row?.mtime_ns ?? 0),
    session_id: row?.session_id ?? null,
    cycle_id: row?.cycle_id ?? null,
    source_mode: row?.source_mode ?? "explicit",
    entity_confidence: Number(row?.entity_confidence ?? 1),
    legacy_origin: row?.legacy_origin ?? null,
    updated_at: row?.updated_at ?? null,
  }));
  const artifactByPath = new Map(artifactRows.map((row) => [row.path, row]));

  const tagRows = tags.map((row, index) => ({
    scope_key: scopeKey || null,
    tag_id: index + 1,
    tag: normalizeScalar(row?.tag),
  }));
  const tagByValue = new Map(tagRows.map((row) => [row.tag, row]));

  const artifactTagRows = artifactTags
    .map((row) => {
      const artifact = artifactByPath.get(normalizeArtifactPath(row?.path));
      const tag = tagByValue.get(normalizeScalar(row?.tag));
      if (!artifact || !tag) {
        return null;
      }
      return {
        scope_key: scopeKey || null,
        artifact_id: artifact.artifact_id,
        tag_id: tag.tag_id,
      };
    })
    .filter(Boolean);

  const artifactBlobRows = artifactRows.map((row) => ({
    scope_key: scopeKey || null,
    artifact_id: row.artifact_id,
    content_format: row.content_format,
    content: row.content,
    canonical_format: row.canonical_format,
    canonical_json: row.canonical_json,
    sha256: row.sha256,
    size_bytes: row.size_bytes,
    updated_at: row.updated_at ?? new Date().toISOString(),
  }));

  return {
    index_meta: buildRuntimeIndexMetaRows(payload, options),
    cycles: cycleRows.map((row) => ({ scope_key: scopeKey || null, ...row })),
    sessions: sessionRows.map((row) => ({ scope_key: scopeKey || null, ...row })),
    artifacts: artifactRows,
    file_map: fileMap.map((row) => ({ scope_key: scopeKey || null, ...row })),
    tags: tagRows,
    artifact_tags: artifactTagRows,
    run_metrics: runMetrics.map((row) => ({ scope_key: scopeKey || null, ...row })),
    artifact_links: artifactLinks.map((row) => ({ scope_key: scopeKey || null, ...row })),
    cycle_links: cycleLinks.map((row) => ({ scope_key: scopeKey || null, ...row })),
    session_cycle_links: sessionCycleLinks.map((row) => ({ scope_key: scopeKey || null, ...row })),
    session_links: sessionLinks.map((row) => ({ scope_key: scopeKey || null, ...row })),
    repair_decisions: repairDecisions.map((row) => ({ scope_key: scopeKey || null, ...row })),
    migration_runs: migrationRuns.map((row) => ({ scope_key: scopeKey || null, ...row })),
    migration_findings: migrationFindings.map((row, index) => ({
      scope_key: scopeKey || null,
      finding_id: index + 1,
      ...row,
    })),
    artifact_blobs: artifactBlobRows,
    runtime_heads: buildRuntimeHeadRows(artifactRows, { scopeKey }),
  };
}
