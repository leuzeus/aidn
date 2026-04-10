CREATE SCHEMA IF NOT EXISTS aidn_runtime;

CREATE TABLE IF NOT EXISTS aidn_runtime.schema_migrations (
  schema_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  applied_by TEXT,
  notes TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (schema_name, schema_version)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.index_meta (
  scope_key TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_key, key)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.cycles (
  scope_key TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  session_id TEXT,
  state TEXT NOT NULL,
  outcome TEXT,
  branch_name TEXT,
  dor_state TEXT,
  continuity_rule TEXT,
  continuity_base_branch TEXT,
  continuity_latest_cycle_branch TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope_key, cycle_id)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.artifacts (
  scope_key TEXT NOT NULL,
  artifact_id BIGINT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  family TEXT NOT NULL DEFAULT 'unknown',
  subtype TEXT,
  gate_relevance INTEGER NOT NULL DEFAULT 0,
  classification_reason TEXT,
  content_format TEXT,
  content TEXT,
  canonical_format TEXT,
  canonical_json JSONB,
  sha256 TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  mtime_ns BIGINT NOT NULL,
  session_id TEXT,
  cycle_id TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  entity_confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  legacy_origin TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope_key, artifact_id),
  UNIQUE (scope_key, path)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.sessions (
  scope_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  branch_name TEXT,
  state TEXT,
  owner TEXT,
  parent_session TEXT,
  branch_kind TEXT,
  cycle_branch TEXT,
  intermediate_branch TEXT,
  integration_target_cycle TEXT,
  carry_over_pending TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  source_artifact_path TEXT,
  source_confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope_key, session_id)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.file_map (
  scope_key TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  path TEXT NOT NULL,
  role TEXT,
  relation TEXT NOT NULL DEFAULT 'unknown',
  last_seen_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope_key, cycle_id, path)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.tags (
  scope_key TEXT NOT NULL,
  tag_id BIGINT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (scope_key, tag_id),
  UNIQUE (scope_key, tag)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.artifact_tags (
  scope_key TEXT NOT NULL,
  artifact_id BIGINT NOT NULL,
  tag_id BIGINT NOT NULL,
  PRIMARY KEY (scope_key, artifact_id, tag_id)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.run_metrics (
  scope_key TEXT NOT NULL,
  run_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  overhead_ratio DOUBLE PRECISION,
  artifacts_churn DOUBLE PRECISION,
  gates_frequency DOUBLE PRECISION,
  PRIMARY KEY (scope_key, run_id)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.artifact_links (
  scope_key TEXT NOT NULL,
  source_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  inference_source TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  relation_status TEXT NOT NULL DEFAULT 'explicit',
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope_key, source_path, target_path, relation_type)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.cycle_links (
  scope_key TEXT NOT NULL,
  source_cycle_id TEXT NOT NULL,
  target_cycle_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  inference_source TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  relation_status TEXT NOT NULL DEFAULT 'explicit',
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope_key, source_cycle_id, target_cycle_id, relation_type)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.session_cycle_links (
  scope_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  inference_source TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  relation_status TEXT NOT NULL DEFAULT 'explicit',
  ambiguity_status TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope_key, session_id, cycle_id, relation_type)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.session_links (
  scope_key TEXT NOT NULL,
  source_session_id TEXT NOT NULL,
  target_session_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  inference_source TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  relation_status TEXT NOT NULL DEFAULT 'explicit',
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope_key, source_session_id, target_session_id, relation_type)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.repair_decisions (
  scope_key TEXT NOT NULL,
  relation_scope TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  decision TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL,
  decided_by TEXT,
  notes TEXT,
  PRIMARY KEY (scope_key, relation_scope, source_ref, target_ref, relation_type)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.migration_runs (
  scope_key TEXT NOT NULL,
  migration_run_id TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  target_root TEXT,
  notes TEXT,
  PRIMARY KEY (scope_key, migration_run_id)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.migration_findings (
  scope_key TEXT NOT NULL,
  finding_id BIGINT NOT NULL,
  migration_run_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  artifact_path TEXT,
  message TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  suggested_action TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope_key, finding_id)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.artifact_blobs (
  scope_key TEXT NOT NULL,
  artifact_id BIGINT NOT NULL,
  content_format TEXT,
  content TEXT,
  canonical_format TEXT,
  canonical_json JSONB,
  sha256 TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope_key, artifact_id)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.runtime_heads (
  scope_key TEXT NOT NULL,
  head_key TEXT NOT NULL,
  artifact_path TEXT NOT NULL,
  artifact_sha256 TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  payload_json JSONB,
  PRIMARY KEY (scope_key, head_key)
);

ALTER TABLE aidn_runtime.runtime_heads
  ADD COLUMN IF NOT EXISTS artifact_id BIGINT,
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS cycle_id TEXT,
  ADD COLUMN IF NOT EXISTS kind TEXT,
  ADD COLUMN IF NOT EXISTS subtype TEXT;

CREATE TABLE IF NOT EXISTS aidn_runtime.adoption_events (
  event_id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  source_backend TEXT,
  target_backend TEXT NOT NULL,
  source_payload_digest TEXT,
  target_payload_digest TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_cycle_id ON aidn_runtime.artifacts(scope_key, cycle_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_session_id ON aidn_runtime.artifacts(scope_key, session_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_source_mode ON aidn_runtime.artifacts(scope_key, source_mode);
CREATE INDEX IF NOT EXISTS idx_artifacts_subtype_updated ON aidn_runtime.artifacts(scope_key, subtype, updated_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_session_subtype ON aidn_runtime.artifacts(scope_key, session_id, subtype);
CREATE INDEX IF NOT EXISTS idx_artifacts_cycle_subtype ON aidn_runtime.artifacts(scope_key, cycle_id, subtype);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON aidn_runtime.sessions(scope_key, updated_at);
CREATE INDEX IF NOT EXISTS idx_artifact_links_target ON aidn_runtime.artifact_links(scope_key, target_path, relation_type);
CREATE INDEX IF NOT EXISTS idx_cycle_links_target ON aidn_runtime.cycle_links(scope_key, target_cycle_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_session_cycle_links_cycle ON aidn_runtime.session_cycle_links(scope_key, cycle_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_session_links_target ON aidn_runtime.session_links(scope_key, target_session_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_migration_findings_run ON aidn_runtime.migration_findings(scope_key, migration_run_id);
CREATE INDEX IF NOT EXISTS idx_repair_decisions_scope ON aidn_runtime.repair_decisions(scope_key, relation_scope, decision);
CREATE INDEX IF NOT EXISTS idx_artifact_blobs_updated_at ON aidn_runtime.artifact_blobs(scope_key, updated_at);
CREATE INDEX IF NOT EXISTS idx_runtime_heads_artifact_path ON aidn_runtime.runtime_heads(scope_key, artifact_path);
CREATE INDEX IF NOT EXISTS idx_runtime_heads_session_cycle_updated ON aidn_runtime.runtime_heads(scope_key, session_id, cycle_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_adoption_events_scope_created ON aidn_runtime.adoption_events(scope_key, created_at DESC);

CREATE OR REPLACE VIEW aidn_runtime.v_session_cycle_context AS
SELECT
  scl.scope_key,
  scl.session_id,
  scl.cycle_id,
  scl.relation_type,
  scl.confidence,
  scl.inference_source,
  scl.source_mode,
  scl.relation_status,
  scl.ambiguity_status,
  scl.updated_at,
  s.branch_name AS session_branch_name,
  s.state AS session_state,
  s.owner AS session_owner,
  s.parent_session,
  s.branch_kind,
  s.cycle_branch,
  s.intermediate_branch,
  s.integration_target_cycle,
  s.carry_over_pending,
  s.source_mode AS session_source_mode,
  s.source_confidence AS session_source_confidence,
  c.state AS cycle_state,
  c.outcome AS cycle_outcome,
  c.branch_name AS cycle_branch_name,
  c.updated_at AS cycle_updated_at
FROM aidn_runtime.session_cycle_links scl
LEFT JOIN aidn_runtime.sessions s ON s.scope_key = scl.scope_key AND s.session_id = scl.session_id
LEFT JOIN aidn_runtime.cycles c ON c.scope_key = scl.scope_key AND c.cycle_id = scl.cycle_id;

CREATE OR REPLACE VIEW aidn_runtime.v_session_link_context AS
SELECT
  sl.scope_key,
  sl.source_session_id,
  sl.target_session_id,
  sl.relation_type,
  sl.confidence,
  sl.inference_source,
  sl.source_mode,
  sl.relation_status,
  sl.updated_at,
  ss.branch_name AS source_branch_name,
  ss.state AS source_state,
  ss.parent_session AS source_parent_session,
  ts.branch_name AS target_branch_name,
  ts.state AS target_state
FROM aidn_runtime.session_links sl
LEFT JOIN aidn_runtime.sessions ss ON ss.scope_key = sl.scope_key AND ss.session_id = sl.source_session_id
LEFT JOIN aidn_runtime.sessions ts ON ts.scope_key = sl.scope_key AND ts.session_id = sl.target_session_id;

CREATE OR REPLACE VIEW aidn_runtime.v_artifact_link_context AS
SELECT
  al.scope_key,
  al.source_path,
  al.target_path,
  al.relation_type,
  al.confidence,
  al.inference_source,
  al.source_mode,
  al.relation_status,
  al.updated_at,
  sa.kind AS source_kind,
  sa.family AS source_family,
  sa.subtype AS source_subtype,
  sa.cycle_id AS source_cycle_id,
  sa.session_id AS source_session_id,
  ta.kind AS target_kind,
  ta.family AS target_family,
  ta.subtype AS target_subtype,
  ta.cycle_id AS target_cycle_id,
  ta.session_id AS target_session_id,
  ta.source_mode AS target_source_mode,
  ta.entity_confidence AS target_entity_confidence,
  ta.updated_at AS target_updated_at
FROM aidn_runtime.artifact_links al
LEFT JOIN aidn_runtime.artifacts sa ON sa.scope_key = al.scope_key AND sa.path = al.source_path
LEFT JOIN aidn_runtime.artifacts ta ON ta.scope_key = al.scope_key AND ta.path = al.target_path;

CREATE OR REPLACE VIEW aidn_runtime.v_repair_findings_open AS
SELECT
  scope_key,
  migration_run_id,
  severity,
  finding_type,
  entity_type,
  entity_id,
  artifact_path,
  message,
  confidence,
  suggested_action,
  created_at
FROM aidn_runtime.migration_findings
WHERE severity IN ('warning', 'error');

CREATE OR REPLACE VIEW aidn_runtime.v_materializable_artifacts AS
SELECT
  a.scope_key,
  a.artifact_id,
  a.path,
  a.kind,
  a.family,
  a.subtype,
  a.gate_relevance,
  a.classification_reason,
  COALESCE(ab.content_format, a.content_format) AS content_format,
  COALESCE(ab.content, a.content) AS content,
  COALESCE(ab.canonical_format, a.canonical_format) AS canonical_format,
  COALESCE(ab.canonical_json, a.canonical_json) AS canonical_json,
  COALESCE(ab.sha256, a.sha256) AS sha256,
  COALESCE(ab.size_bytes, a.size_bytes) AS size_bytes,
  a.mtime_ns,
  a.session_id,
  a.cycle_id,
  a.source_mode,
  a.entity_confidence,
  a.legacy_origin,
  COALESCE(ab.updated_at, a.updated_at) AS updated_at
FROM aidn_runtime.artifacts a
LEFT JOIN aidn_runtime.artifact_blobs ab
  ON ab.scope_key = a.scope_key AND ab.artifact_id = a.artifact_id;
