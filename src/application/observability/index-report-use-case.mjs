function toCount(arr) {
  return Array.isArray(arr) ? arr.length : 0;
}

function hasCanonical(row) {
  if (row?.canonical && typeof row.canonical === "object") {
    return true;
  }
  if (typeof row?.canonical_json === "string" && row.canonical_json.trim().length > 0) {
    return true;
  }
  return typeof row?.canonical_format === "string" && row.canonical_format.trim().length > 0;
}

function hasContent(row) {
  return typeof row?.content === "string" && row.content.length > 0;
}

function isMarkdownArtifact(row) {
  const artifactPath = String(row?.path ?? "").toLowerCase();
  return artifactPath.endsWith(".md");
}

function boolNum(value) {
  return value ? 1 : 0;
}

function numericOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parityOkFromPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (typeof payload.ok === "boolean") {
    return payload.ok;
  }
  if (typeof payload.in_sync === "boolean") {
    return payload.in_sync;
  }
  if (typeof payload.status === "string") {
    if (payload.status === "pass") {
      return true;
    }
    if (payload.status === "fail") {
      return false;
    }
  }
  return null;
}

function parityStatusFrom(ok, exists) {
  if (!exists) {
    return "missing";
  }
  if (ok === true) {
    return "pass";
  }
  if (ok === false) {
    return "fail";
  }
  return "unknown";
}

export function buildIndexReport(indexData, sqlParityData = null, sqlParityExists = false, sqliteParityData = null, sqliteParityExists = false) {
  const declared = {
    cycles: numericOrNull(indexData?.summary?.cycles_count),
    artifacts: numericOrNull(indexData?.summary?.artifacts_count),
    file_map: numericOrNull(indexData?.summary?.file_map_count),
    tags: numericOrNull(indexData?.summary?.tags_count),
    run_metrics: numericOrNull(indexData?.summary?.run_metrics_count),
  };
  const actual = {
    cycles: toCount(indexData?.cycles),
    artifacts: toCount(indexData?.artifacts),
    artifacts_with_content: Array.isArray(indexData?.artifacts) ? indexData.artifacts.filter((row) => hasContent(row)).length : 0,
    artifacts_with_canonical: Array.isArray(indexData?.artifacts) ? indexData.artifacts.filter((row) => hasCanonical(row)).length : 0,
    artifacts_markdown: Array.isArray(indexData?.artifacts) ? indexData.artifacts.filter((row) => isMarkdownArtifact(row)).length : 0,
    artifacts_markdown_with_canonical: Array.isArray(indexData?.artifacts)
      ? indexData.artifacts.filter((row) => isMarkdownArtifact(row) && hasCanonical(row)).length
      : 0,
    file_map: toCount(indexData?.file_map),
    tags: toCount(indexData?.tags),
    artifact_tags: toCount(indexData?.artifact_tags),
    run_metrics: toCount(indexData?.run_metrics),
  };

  const consistency = {
    cycles_count_match: boolNum(declared.cycles === actual.cycles),
    artifacts_count_match: boolNum(declared.artifacts === actual.artifacts),
    file_map_count_match: boolNum(declared.file_map === actual.file_map),
    tags_count_match: boolNum(declared.tags === actual.tags),
    run_metrics_count_match: boolNum(declared.run_metrics === actual.run_metrics),
  };
  consistency.all_count_match = boolNum(
    consistency.cycles_count_match === 1
      && consistency.artifacts_count_match === 1
      && consistency.file_map_count_match === 1
      && consistency.tags_count_match === 1
      && consistency.run_metrics_count_match === 1,
  );

  const sqlParityOkRaw = parityOkFromPayload(sqlParityData);
  const sqliteParityOkRaw = parityOkFromPayload(sqliteParityData);
  const sqlParityStatus = parityStatusFrom(sqlParityOkRaw, sqlParityExists);
  const sqliteParityStatus = parityStatusFrom(sqliteParityOkRaw, sqliteParityExists);
  const activeParityChecks = [];
  if (sqlParityExists && sqlParityOkRaw != null) {
    activeParityChecks.push(sqlParityOkRaw === true);
  }
  if (sqliteParityExists && sqliteParityOkRaw != null) {
    activeParityChecks.push(sqliteParityOkRaw === true);
  }
  const parityAllOk = activeParityChecks.length > 0 && activeParityChecks.every(Boolean);
  const parityStatus = activeParityChecks.length === 0
    ? "missing"
    : (parityAllOk ? "pass" : "fail");
  const parityOk = boolNum(parityAllOk);
  const structureProfile = indexData?.structure_profile ?? null;
  const structureKind = String(structureProfile?.kind ?? "unknown");
  const declaredVersion = structureProfile?.declared_workflow_version ?? null;
  const declaredVersionNote = Array.isArray(structureProfile?.notes)
    && structureProfile.notes.some((note) => /Declared workflow_version/i.test(String(note)));
  const declaredVersionLooksStale = boolNum(
    declaredVersionNote
      || (structureKind === "modern"
        && typeof declaredVersion === "string"
        && /^0\.1\./.test(declaredVersion)),
  );

  return {
    ts: new Date().toISOString(),
    summary: {
      schema_version: numericOrNull(indexData?.schema_version),
      rows: actual,
      declared_counts: declared,
      consistency,
      run_metrics: {
        present: boolNum(actual.run_metrics > 0),
      },
      projection: {
        artifacts_with_content: actual.artifacts_with_content,
        artifacts_with_canonical: actual.artifacts_with_canonical,
        artifacts_markdown: actual.artifacts_markdown,
        artifacts_markdown_with_canonical: actual.artifacts_markdown_with_canonical,
        canonical_coverage_ratio: actual.artifacts > 0
          ? Number((actual.artifacts_with_canonical / actual.artifacts).toFixed(4))
          : 0,
        canonical_coverage_ratio_markdown: actual.artifacts_markdown > 0
          ? Number((actual.artifacts_markdown_with_canonical / actual.artifacts_markdown).toFixed(4))
          : 0,
      },
      parity: {
        status: parityStatus,
        ok_numeric: parityOk,
      },
      parity_sql: {
        status: sqlParityStatus,
        ok_numeric: boolNum(sqlParityOkRaw === true),
      },
      parity_sqlite: {
        status: sqliteParityStatus,
        ok_numeric: boolNum(sqliteParityOkRaw === true),
      },
      structure: {
        kind: structureKind,
        is_mixed: boolNum(structureKind === "mixed"),
        is_unknown: boolNum(structureKind === "unknown"),
        declared_workflow_version: declaredVersion,
        declared_version_looks_stale: declaredVersionLooksStale,
      },
    },
  };
}
