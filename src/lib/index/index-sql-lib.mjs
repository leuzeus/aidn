function sqlString(value) {
  if (value == null) {
    return "NULL";
  }
  const text = String(value).replace(/'/g, "''");
  return `'${text}'`;
}

function sqlNumber(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "NULL";
  }
  return String(Number(value));
}

function insertCycles(lines, cycles) {
  for (const cycle of cycles) {
    lines.push(
      `INSERT INTO cycles (cycle_id, session_id, state, outcome, branch_name, dor_state, continuity_rule, continuity_base_branch, continuity_latest_cycle_branch, updated_at) VALUES (${sqlString(cycle.cycle_id)}, ${sqlString(cycle.session_id)}, ${sqlString(cycle.state)}, ${sqlString(cycle.outcome)}, ${sqlString(cycle.branch_name)}, ${sqlString(cycle.dor_state)}, ${sqlString(cycle.continuity_rule)}, ${sqlString(cycle.continuity_base_branch)}, ${sqlString(cycle.continuity_latest_cycle_branch)}, ${sqlString(cycle.updated_at)});`,
    );
  }
}

function insertArtifacts(lines, artifacts) {
  for (const artifact of artifacts) {
    const canonicalJson = artifact?.canonical && typeof artifact.canonical === "object"
      ? JSON.stringify(artifact.canonical)
      : null;
    lines.push(
      `INSERT INTO artifacts (path, kind, family, subtype, gate_relevance, classification_reason, content_format, content, canonical_format, canonical_json, sha256, size_bytes, mtime_ns, session_id, cycle_id, source_mode, entity_confidence, legacy_origin, updated_at) VALUES (${sqlString(artifact.path)}, ${sqlString(artifact.kind)}, ${sqlString(artifact.family)}, ${sqlString(artifact.subtype)}, ${sqlNumber(artifact.gate_relevance)}, ${sqlString(artifact.classification_reason)}, ${sqlString(artifact.content_format)}, ${sqlString(artifact.content)}, ${sqlString(artifact.canonical_format)}, ${sqlString(canonicalJson)}, ${sqlString(artifact.sha256)}, ${sqlNumber(artifact.size_bytes)}, ${sqlNumber(artifact.mtime_ns)}, ${sqlString(artifact.session_id)}, ${sqlString(artifact.cycle_id)}, ${sqlString(artifact.source_mode ?? "explicit")}, ${sqlNumber(artifact.entity_confidence ?? 1)}, ${sqlString(artifact.legacy_origin)}, ${sqlString(artifact.updated_at)});`,
    );
  }
}

function insertSessions(lines, sessions) {
  for (const row of sessions) {
    lines.push(
      `INSERT INTO sessions (session_id, branch_name, state, owner, started_at, ended_at, source_artifact_path, source_confidence, source_mode, updated_at) VALUES (${sqlString(row.session_id)}, ${sqlString(row.branch_name)}, ${sqlString(row.state)}, ${sqlString(row.owner)}, ${sqlString(row.started_at)}, ${sqlString(row.ended_at)}, ${sqlString(row.source_artifact_path)}, ${sqlNumber(row.source_confidence ?? 1)}, ${sqlString(row.source_mode ?? "explicit")}, ${sqlString(row.updated_at)});`,
    );
  }
}

function insertFileMap(lines, fileMap) {
  for (const row of fileMap) {
    lines.push(
      `INSERT INTO file_map (cycle_id, path, role, relation, last_seen_at) VALUES (${sqlString(row.cycle_id)}, ${sqlString(row.path)}, ${sqlString(row.role)}, ${sqlString(row.relation)}, ${sqlString(row.last_seen_at)});`,
    );
  }
}

function insertTags(lines, tags) {
  for (const tag of tags) {
    lines.push(`INSERT INTO tags (tag) VALUES (${sqlString(tag.tag)});`);
  }
}

function insertArtifactTags(lines, artifactTags) {
  for (const row of artifactTags) {
    lines.push(
      `INSERT INTO artifact_tags (artifact_id, tag_id) SELECT a.artifact_id, t.tag_id FROM artifacts a, tags t WHERE a.path = ${sqlString(row.path)} AND t.tag = ${sqlString(row.tag)};`,
    );
  }
}

function insertRunMetrics(lines, runMetrics) {
  for (const row of runMetrics) {
    lines.push(
      `INSERT INTO run_metrics (run_id, started_at, ended_at, overhead_ratio, artifacts_churn, gates_frequency) VALUES (${sqlString(row.run_id)}, ${sqlString(row.started_at)}, ${sqlString(row.ended_at)}, ${sqlNumber(row.overhead_ratio)}, ${sqlNumber(row.artifacts_churn)}, ${sqlNumber(row.gates_frequency)});`,
    );
  }
}

function insertArtifactLinks(lines, rows) {
  for (const row of rows) {
    lines.push(
      `INSERT INTO artifact_links (source_path, target_path, relation_type, confidence, inference_source, source_mode, relation_status, updated_at) VALUES (${sqlString(row.source_path)}, ${sqlString(row.target_path)}, ${sqlString(row.relation_type)}, ${sqlNumber(row.confidence ?? 1)}, ${sqlString(row.inference_source)}, ${sqlString(row.source_mode ?? "explicit")}, ${sqlString(row.relation_status ?? "explicit")}, ${sqlString(row.updated_at)});`,
    );
  }
}

function insertCycleLinks(lines, rows) {
  for (const row of rows) {
    lines.push(
      `INSERT INTO cycle_links (source_cycle_id, target_cycle_id, relation_type, confidence, inference_source, source_mode, relation_status, updated_at) VALUES (${sqlString(row.source_cycle_id)}, ${sqlString(row.target_cycle_id)}, ${sqlString(row.relation_type)}, ${sqlNumber(row.confidence ?? 1)}, ${sqlString(row.inference_source)}, ${sqlString(row.source_mode ?? "explicit")}, ${sqlString(row.relation_status ?? "explicit")}, ${sqlString(row.updated_at)});`,
    );
  }
}

function insertSessionCycleLinks(lines, rows) {
  for (const row of rows) {
    lines.push(
      `INSERT INTO session_cycle_links (session_id, cycle_id, relation_type, confidence, inference_source, source_mode, relation_status, ambiguity_status, updated_at) VALUES (${sqlString(row.session_id)}, ${sqlString(row.cycle_id)}, ${sqlString(row.relation_type)}, ${sqlNumber(row.confidence ?? 1)}, ${sqlString(row.inference_source)}, ${sqlString(row.source_mode ?? "explicit")}, ${sqlString(row.relation_status ?? "explicit")}, ${sqlString(row.ambiguity_status)}, ${sqlString(row.updated_at)});`,
    );
  }
}

function insertMigrationRuns(lines, rows) {
  for (const row of rows) {
    lines.push(
      `INSERT INTO migration_runs (migration_run_id, engine_version, started_at, ended_at, status, target_root, notes) VALUES (${sqlString(row.migration_run_id)}, ${sqlString(row.engine_version)}, ${sqlString(row.started_at)}, ${sqlString(row.ended_at)}, ${sqlString(row.status)}, ${sqlString(row.target_root)}, ${sqlString(row.notes)});`,
    );
  }
}

function insertMigrationFindings(lines, rows) {
  for (const row of rows) {
    lines.push(
      `INSERT INTO migration_findings (migration_run_id, severity, finding_type, entity_type, entity_id, artifact_path, message, confidence, suggested_action, created_at) VALUES (${sqlString(row.migration_run_id)}, ${sqlString(row.severity)}, ${sqlString(row.finding_type)}, ${sqlString(row.entity_type)}, ${sqlString(row.entity_id)}, ${sqlString(row.artifact_path)}, ${sqlString(row.message)}, ${sqlNumber(row.confidence)}, ${sqlString(row.suggested_action)}, ${sqlString(row.created_at)});`,
    );
  }
}

function insertRepairDecisions(lines, rows) {
  for (const row of rows) {
    lines.push(
      `INSERT INTO repair_decisions (relation_scope, source_ref, target_ref, relation_type, decision, decided_at, decided_by, notes) VALUES (${sqlString(row.relation_scope)}, ${sqlString(row.source_ref)}, ${sqlString(row.target_ref)}, ${sqlString(row.relation_type)}, ${sqlString(row.decision)}, ${sqlString(row.decided_at)}, ${sqlString(row.decided_by)}, ${sqlString(row.notes)});`,
    );
  }
}

export function buildSqlFromIndex(indexData, options = {}) {
  const includeSchema = options.includeSchema !== false;
  const schemaText = (options.schemaText ?? "").trim();
  const lines = [];
  lines.push("-- Generated by tools/perf/index-to-sql.mjs");
  lines.push("-- Source of truth remains Markdown files; this SQL is a derived import format.");
  lines.push("PRAGMA foreign_keys=OFF;");
  lines.push("BEGIN TRANSACTION;");
  lines.push("");

  if (includeSchema) {
    lines.push("-- Schema");
    lines.push(schemaText.endsWith(";") ? schemaText : `${schemaText};`);
    lines.push("");
  }

  lines.push("-- Clean existing rows");
  lines.push("DELETE FROM artifact_tags;");
  lines.push("DELETE FROM tags;");
  lines.push("DELETE FROM file_map;");
  lines.push("DELETE FROM artifacts;");
  lines.push("DELETE FROM cycles;");
  lines.push("DELETE FROM run_metrics;");
  lines.push("DELETE FROM artifact_links;");
  lines.push("DELETE FROM cycle_links;");
  lines.push("DELETE FROM session_cycle_links;");
  lines.push("DELETE FROM sessions;");
  lines.push("DELETE FROM migration_findings;");
  lines.push("DELETE FROM migration_runs;");
  lines.push("DELETE FROM repair_decisions;");
  lines.push("");

  const cycles = Array.isArray(indexData.cycles) ? indexData.cycles : [];
  const artifacts = Array.isArray(indexData.artifacts) ? indexData.artifacts : [];
  const fileMap = Array.isArray(indexData.file_map) ? indexData.file_map : [];
  const tags = Array.isArray(indexData.tags) ? indexData.tags : [];
  const artifactTags = Array.isArray(indexData.artifact_tags) ? indexData.artifact_tags : [];
  const runMetrics = Array.isArray(indexData.run_metrics) ? indexData.run_metrics : [];
  const sessions = Array.isArray(indexData.sessions) ? indexData.sessions : [];
  const artifactLinks = Array.isArray(indexData.artifact_links) ? indexData.artifact_links : [];
  const cycleLinks = Array.isArray(indexData.cycle_links) ? indexData.cycle_links : [];
  const sessionCycleLinks = Array.isArray(indexData.session_cycle_links) ? indexData.session_cycle_links : [];
  const migrationRuns = Array.isArray(indexData.migration_runs) ? indexData.migration_runs : [];
  const migrationFindings = Array.isArray(indexData.migration_findings) ? indexData.migration_findings : [];
  const repairDecisions = Array.isArray(indexData.repair_decisions) ? indexData.repair_decisions : [];

  lines.push("-- Insert data");
  insertCycles(lines, cycles);
  insertArtifacts(lines, artifacts);
  insertSessions(lines, sessions);
  insertFileMap(lines, fileMap);
  insertTags(lines, tags);
  insertArtifactTags(lines, artifactTags);
  insertRunMetrics(lines, runMetrics);
  insertArtifactLinks(lines, artifactLinks);
  insertCycleLinks(lines, cycleLinks);
  insertSessionCycleLinks(lines, sessionCycleLinks);
  insertMigrationRuns(lines, migrationRuns);
  insertMigrationFindings(lines, migrationFindings);
  insertRepairDecisions(lines, repairDecisions);

  lines.push("");
  lines.push("COMMIT;");
  lines.push("PRAGMA foreign_keys=ON;");
  lines.push("");
  return `${lines.join("\n")}\n`;
}
